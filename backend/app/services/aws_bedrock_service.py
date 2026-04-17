"""
AWS Bedrock Service - LLM and model listing. No Streamlit; API returns errors.
"""

import logging
import os
import re
import boto3
from botocore.exceptions import NoCredentialsError, ClientError
from botocore.config import Config
from typing import Optional, List, Tuple

from langchain_aws import ChatBedrock

from app.config.settings import (
    build_models_from_api_response,
    FALLBACK_MODELS,
    BEDROCK_INFERENCE_PROFILE_OVERRIDES,
    MODELS_WITHOUT_SAMPLING_PARAMS,
)

logger = logging.getLogger(__name__)


def fetch_bedrock_models_for_ui(aws_region: str, aws_profile: Optional[str] = None) -> dict:
    """Fetch Bedrock model list for UI. Returns display name -> model_id or profile ID.
    Includes foundation models (ON_DEMAND + PROVISIONED) with pagination, inference profiles,
    and always merges in FALLBACK_MODELS so newer models (e.g. Opus 4.5) appear even if API is limited.
    """
    # Start with fallback so we always have Opus 4.5, Sonnet 4.x, etc. even when API fails or omits them
    models = dict(FALLBACK_MODELS)
    try:
        if aws_profile:
            session = boto3.Session(profile_name=aws_profile)
            client = session.client("bedrock", region_name=aws_region)
        else:
            client = boto3.client("bedrock", region_name=aws_region)

        # Fetch foundation models for both ON_DEMAND and PROVISIONED (newer models like Opus 4.x often in PROVISIONED)
        all_summaries: List[dict] = []
        for inference_type in ("ON_DEMAND", "PROVISIONED"):
            try:
                response = client.list_foundation_models(byInferenceType=inference_type)
                all_summaries.extend(response.get("modelSummaries", []))
            except Exception:
                pass

        if all_summaries:
            from_api = build_models_from_api_response(all_summaries)
            for display_name, model_id in from_api.items():
                if model_id in BEDROCK_INFERENCE_PROFILE_OVERRIDES:
                    model_id = BEDROCK_INFERENCE_PROFILE_OVERRIDES[model_id]
                models[display_name] = model_id

        # Add inference profiles (cross-region / newer models like Opus 4.5 often appear here)
        profile_key_to_id = {}
        next_token = None
        while True:
            kwargs = {"typeEquals": "SYSTEM_DEFINED", "maxResults": 100}
            if next_token:
                kwargs["nextToken"] = next_token
            prof_response = client.list_inference_profiles(**kwargs)
            for p in prof_response.get("inferenceProfileSummaries", []):
                if p.get("status") != "ACTIVE":
                    continue
                name = (p.get("inferenceProfileName") or "").strip()
                profile_id = p.get("inferenceProfileId") or p.get("inferenceProfileArn") or ""
                if name and profile_id:
                    key = AWSBedrockService._normalize_model_name_for_profile_match(name)
                    if key:
                        profile_key_to_id[key] = profile_id
                    models[name] = profile_id
            next_token = prof_response.get("nextToken")
            if not next_token:
                break

        # Prefer inference profile ID for foundation models when we have a matching profile
        for display_name in list(models.keys()):
            key = AWSBedrockService._normalize_foundation_display_name(display_name)
            if key and key in profile_key_to_id:
                models[display_name] = profile_key_to_id[key]
    except Exception:
        pass
    return dict(sorted(models.items(), key=lambda x: x[0].lower()))


class AWSBedrockService:
    """AWS Bedrock LLM service. No Streamlit; init may leave _llm None on failure."""

    DEFAULT_MODEL = ""
    DEFAULT_REGION = "us-east-1"
    DEFAULT_TEMPERATURE = 0.8
    DEFAULT_MAX_TOKENS = 16384

    def __init__(
        self,
        aws_region: str = DEFAULT_REGION,
        aws_profile: Optional[str] = None,
        bedrock_model: str = DEFAULT_MODEL,
        temperature: float = DEFAULT_TEMPERATURE,
        max_tokens: int = DEFAULT_MAX_TOKENS,
    ):
        self.aws_region = aws_region
        self.aws_profile = aws_profile
        self.bedrock_model = bedrock_model
        self.temperature = temperature
        self.max_tokens = max_tokens
        self._session: Optional[boto3.Session] = None
        self._bedrock_client = None
        self._bedrock_runtime_client = None
        self._llm: Optional[ChatBedrock] = None
        self._initialize()

    def _initialize(self) -> None:
        if not self.bedrock_model:
            logger.info("No model specified; skipping LLM initialization")
            return
        try:
            self._session = self._create_session()
            self._bedrock_runtime_client = self._create_bedrock_runtime_client()
            self._llm = self._create_llm()
            if not self._test_connection_on_init():
                logger.warning("Bedrock test_connection_on_init failed region=%s model=%s", self.aws_region, self.bedrock_model)
                self._llm = None
            else:
                logger.info("AWSBedrockService initialized region=%s model=%s", self.aws_region, self.bedrock_model)
        except Exception as e:
            logger.warning("AWSBedrockService init failed region=%s model=%s error=%s", self.aws_region, self.bedrock_model, e)
            self._llm = None

    def _test_connection_on_init(self) -> bool:
        try:
            bedrock_client = self._create_bedrock_client()
            bedrock_client.list_foundation_models(byOutputModality='TEXT')
            return True
        except Exception:
            return False

    def _create_session(self) -> boto3.Session:
        if self.aws_profile:
            return boto3.Session(profile_name=self.aws_profile)
        return boto3.Session()

    def _bedrock_config(self) -> Config:
        read_timeout = int(os.environ.get("QA_BEDROCK_READ_TIMEOUT", "120"))
        connect_timeout = int(os.environ.get("QA_BEDROCK_CONNECT_TIMEOUT", "10"))
        return Config(read_timeout=read_timeout, connect_timeout=connect_timeout)

    def _create_bedrock_runtime_client(self):
        cfg = self._bedrock_config()
        if self._session and self.aws_profile:
            return self._session.client(service_name='bedrock-runtime', region_name=self.aws_region, config=cfg)
        return boto3.client(service_name='bedrock-runtime', region_name=self.aws_region, config=cfg)

    def _create_bedrock_client(self):
        cfg = self._bedrock_config()
        if self._session and self.aws_profile:
            return self._session.client(service_name='bedrock', region_name=self.aws_region, config=cfg)
        return boto3.client(service_name='bedrock', region_name=self.aws_region, config=cfg)

    def _supports_sampling_params(self) -> bool:
        model = self.bedrock_model or ""
        return model not in MODELS_WITHOUT_SAMPLING_PARAMS

    def _create_llm(self) -> Optional[ChatBedrock]:
        if not self._bedrock_runtime_client:
            return None
        kwargs: dict = {"max_tokens": self.max_tokens}
        if self._supports_sampling_params():
            kwargs["temperature"] = self.temperature
        return ChatBedrock(
            client=self._bedrock_runtime_client,
            model_id=self.bedrock_model,
            model_kwargs=kwargs,
        )

    @property
    def llm(self) -> Optional[ChatBedrock]:
        return self._llm

    @property
    def is_initialized(self) -> bool:
        return self._llm is not None

    def get_model_provider(self) -> str:
        return self.bedrock_model.split('.')[0].title()

    def test_connection(self) -> bool:
        try:
            bedrock_client = self._create_bedrock_client()
            bedrock_client.list_foundation_models(byOutputModality='TEXT')
            return True
        except Exception:
            return False

    def list_available_models(self) -> list:
        try:
            bedrock_client = self._create_bedrock_client()
            response = bedrock_client.list_foundation_models(byInferenceType='ON_DEMAND')
            return response.get('modelSummaries', [])
        except Exception:
            return []

    @staticmethod
    def _normalize_foundation_display_name(display_name: str) -> Optional[str]:
        if not display_name:
            return None
        m = re.match(r"^(.+?)\s*\([^)]+\)(?:\s*-\s*\d+K)?\s*$", display_name.strip())
        return m.group(1).strip() if m else display_name.strip()

    @staticmethod
    def _normalize_model_name_for_profile_match(profile_name: str) -> Optional[str]:
        if not profile_name:
            return None
        s = profile_name.strip()
        if re.match(r"^(US|EU|AP)\s+", s, re.I):
            parts = s.split(None, 2)
            return parts[2].strip() if len(parts) >= 3 else s
        return s

    def _list_system_inference_profiles(self) -> List[Tuple[str, str]]:
        out: List[Tuple[str, str]] = []
        try:
            bedrock_client = self._create_bedrock_client()
            next_token = None
            while True:
                kwargs = {"typeEquals": "SYSTEM_DEFINED", "maxResults": 100}
                if next_token:
                    kwargs["nextToken"] = next_token
                response = bedrock_client.list_inference_profiles(**kwargs)
                for p in response.get("inferenceProfileSummaries", []):
                    if p.get("status") != "ACTIVE":
                        continue
                    name = (p.get("inferenceProfileName") or "").strip()
                    profile_id = p.get("inferenceProfileId") or p.get("inferenceProfileArn") or ""
                    if name and profile_id:
                        out.append((name, profile_id))
                next_token = response.get("nextToken")
                if not next_token:
                    break
        except Exception:
            pass
        return out

    def fetch_available_models_for_ui(self) -> dict:
        try:
            model_summaries = self.list_available_models()
            models = build_models_from_api_response(model_summaries) if model_summaries else {}
            for display_name, model_id in list(models.items()):
                if model_id in BEDROCK_INFERENCE_PROFILE_OVERRIDES:
                    models[display_name] = BEDROCK_INFERENCE_PROFILE_OVERRIDES[model_id]
            profile_key_to_id = {}
            for name, profile_id in self._list_system_inference_profiles():
                key = self._normalize_model_name_for_profile_match(name)
                if key:
                    profile_key_to_id[key] = profile_id
                if name not in models:
                    models[name] = profile_id
            for display_name in list(models.keys()):
                key = self._normalize_foundation_display_name(display_name)
                if key and key in profile_key_to_id:
                    models[display_name] = profile_key_to_id[key]
            if models:
                return dict(sorted(models.items(), key=lambda x: x[0].lower()))
        except Exception:
            pass
        return FALLBACK_MODELS.copy()

    def update_model_config(
        self,
        bedrock_model: Optional[str] = None,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> bool:
        old_model = self.bedrock_model
        old_temp = self.temperature
        old_max = self.max_tokens
        if bedrock_model is not None:
            self.bedrock_model = bedrock_model
        if temperature is not None:
            self.temperature = temperature
        if max_tokens is not None:
            self.max_tokens = max_tokens
        try:
            new_llm = self._create_llm()
            if new_llm is None:
                raise RuntimeError("LLM creation returned None")
            self._llm = new_llm
            if not self._test_connection_on_init():
                raise RuntimeError("Connection test failed for new model")
            return True
        except Exception as e:
            logger.warning("update_model_config failed, rolling back: %s", e)
            self.bedrock_model = old_model
            self.temperature = old_temp
            self.max_tokens = old_max
            try:
                self._llm = self._create_llm()
            except Exception:
                self._llm = None
            return False
