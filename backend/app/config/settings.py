"""
Configuration Settings Module

This module provides dataclass-based configuration objects for the QA Assistant application.
Using dataclasses ensures type safety, default values, and easy configuration management.

Classes:
    - RAGConfig: Configuration for RAG (Retrieval-Augmented Generation) settings
    - AWSConfig: Configuration for AWS Bedrock service
    - AtlassianConfig: Configuration for Jira and Confluence connections
"""

import os
import re
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class RAGConfig:
    """Configuration for RAG settings."""
    chunk_size: int = 1000
    chunk_overlap: int = 150
    top_k: int = 4
    persist_directory: str = "data/chroma"
    embedding_model: str = "all-MiniLM-L6-v2"
    collection_name: str = "jira_rag"

    def __post_init__(self):
        if self.chunk_size < 100:
            raise ValueError("chunk_size must be at least 100 characters")
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError("chunk_overlap must be less than chunk_size")
        if self.top_k < 1:
            raise ValueError("top_k must be at least 1")


@dataclass
class AWSConfig:
    """Configuration for AWS Bedrock service."""
    region: str = "us-east-1"
    profile: Optional[str] = None
    model_id: str = ""
    inference_profile_id: Optional[str] = None
    temperature: float = 0.8
    max_tokens: int = 16384

    def __post_init__(self):
        if not 0.0 <= self.temperature <= 1.0:
            raise ValueError("temperature must be between 0.0 and 1.0")
        if self.max_tokens < 100:
            raise ValueError("max_tokens must be at least 100")


@dataclass
class AtlassianConfig:
    """Configuration for Atlassian (Jira and Confluence) connections."""
    server_url: str = ""
    username: str = ""
    api_token: str = ""
    acceptance_criteria_field: str = "customfield_10020"
    steps_to_reproduce_field: str = "customfield_10038"
    #: Jira issue type name for Xray tests. On Jira Cloud, "Test" often resolves to native Jira Tests — use
    #: XRAY_TEST_ISSUE_TYPE_ID with the id from Project settings → Issue types or createmeta.
    xray_test_issue_type_name: str = field(
        default_factory=lambda: (os.environ.get("XRAY_TEST_ISSUE_TYPE_NAME", "Test") or "Test").strip()
    )
    #: When set, create/search duplicates using this issue type id (disambiguates Xray Test vs Jira Test).
    xray_test_issue_type_id: str = field(
        default_factory=lambda: (os.environ.get("XRAY_TEST_ISSUE_TYPE_ID", "") or "").strip()
    )
    #: Xray Cloud API (Jira Cloud): client id/secret from Xray global settings → API keys. Used to push manual steps.
    xray_cloud_client_id: str = field(
        default_factory=lambda: (os.environ.get("XRAY_CLOUD_CLIENT_ID", "") or "").strip()
    )
    xray_cloud_client_secret: str = field(
        default_factory=lambda: (os.environ.get("XRAY_CLOUD_CLIENT_SECRET", "") or "").strip()
    )
    #: GraphQL + authenticate base. US tenants sometimes need https://us.xray.cloud.getxray.app
    xray_cloud_base_url: str = field(
        default_factory=lambda: (
            os.environ.get("XRAY_CLOUD_BASE_URL", "https://xray.cloud.getxray.app") or ""
        ).strip()
        or "https://xray.cloud.getxray.app"
    )
    #: auto | server | cloud | off — how to push manual steps after creating the Jira Test issue.
    xray_step_push_mode: str = field(
        default_factory=lambda: (os.environ.get("XRAY_STEP_PUSH_MODE", "auto") or "auto")
        .strip()
        .lower()
    )

    def is_configured(self) -> bool:
        return bool(self.server_url and self.username and self.api_token)


BEDROCK_INFERENCE_PROFILE_OVERRIDES = {
    "anthropic.claude-opus-4-7": "us.anthropic.claude-opus-4-7",
    "anthropic.claude-opus-4-6-v1": "us.anthropic.claude-opus-4-6-v1",
    "anthropic.claude-opus-4-5-20251101-v1:0": "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "anthropic.claude-opus-4-1-20250805-v1:0": "us.anthropic.claude-opus-4-1-20250805-v1:0",
    "anthropic.claude-sonnet-4-6-v1": "us.anthropic.claude-sonnet-4-6-v1",
    "anthropic.claude-sonnet-4-5-v1": "us.anthropic.claude-sonnet-4-5-v1",
    "anthropic.claude-haiku-4-5-v1": "us.anthropic.claude-haiku-4-5-v1",
    "anthropic.claude-3-opus-20240229-v1:0": "us.anthropic.claude-3-opus-20240229-v1:0",
    "anthropic.claude-3-5-sonnet-20241022-v2:0": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-7-sonnet-20250219-v1:0": "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
}

MODEL_METADATA = {
    "anthropic.claude-opus-4-7": {"context_window": "1M"},
    "anthropic.claude-opus-4-6-v1": {"context_window": "200K"},
    "anthropic.claude-opus-4-5-20251101-v1:0": {"context_window": "200K"},
    "anthropic.claude-opus-4-1-20250805-v1:0": {"context_window": "200K"},
    "anthropic.claude-sonnet-4-6-v1": {"context_window": "200K"},
    "anthropic.claude-sonnet-4-5-v1": {"context_window": "200K"},
    "anthropic.claude-haiku-4-5-v1": {"context_window": "200K"},
    "anthropic.claude-3-5-sonnet-20241022-v2:0": {"context_window": "200K"},
    "anthropic.claude-3-5-sonnet-20240620-v1:0": {"context_window": "200K"},
    "anthropic.claude-3-5-haiku-20241022-v1:0": {"context_window": "200K"},
    "anthropic.claude-3-sonnet-20240229-v1:0": {"context_window": "200K"},
    "anthropic.claude-3-haiku-20240307-v1:0": {"context_window": "200K"},
    "anthropic.claude-3-opus-20240229-v1:0": {"context_window": "200K"},
    "cohere.command-r-plus-v1:0": {"context_window": "128K"},
    "cohere.command-r-v1:0": {"context_window": "128K"},
    "mistral.mistral-large-2402-v1:0": {"context_window": "32K"},
    "mistral.mistral-large-2407-v1:0": {"context_window": "128K"},
    "mistral.mixtral-8x7b-instruct-v0:1": {"context_window": "32K"},
    "mistral.mistral-7b-instruct-v0:2": {"context_window": "32K"},
    "mistral.mistral-small-2402-v1:0": {"context_window": "32K"},
    "meta.llama3-1-70b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-1-8b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-1-405b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-2-90b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-2-11b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-2-3b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-2-1b-instruct-v1:0": {"context_window": "128K"},
    "meta.llama3-70b-instruct-v1:0": {"context_window": "8K"},
    "meta.llama3-8b-instruct-v1:0": {"context_window": "8K"},
    "ai21.jamba-1-5-large-v1:0": {"context_window": "256K"},
    "ai21.jamba-1-5-mini-v1:0": {"context_window": "256K"},
    "ai21.jamba-instruct-v1:0": {"context_window": "256K"},
    "amazon.titan-text-premier-v1:0": {"context_window": "32K"},
    "amazon.titan-text-express-v1": {"context_window": "8K"},
    "amazon.titan-text-lite-v1": {"context_window": "4K"},
}

FALLBACK_MODELS = {
    # Claude 4 family (use inference profile IDs for cross-region; may be overwritten by API)
    "Claude Opus 4.7 (Anthropic) - 1M": "us.anthropic.claude-opus-4-7",
    "Claude Opus 4.6 (Anthropic) - 200K": "us.anthropic.claude-opus-4-6-v1",
    "Claude Opus 4.5 (Anthropic) - 200K": "us.anthropic.claude-opus-4-5-20251101-v1:0",
    "Claude Opus 4.1 (Anthropic) - 200K": "us.anthropic.claude-opus-4-1-20250805-v1:0",
    "Claude Sonnet 4.6 (Anthropic) - 200K": "us.anthropic.claude-sonnet-4-6-v1",
    "Claude Sonnet 4.5 (Anthropic) - 200K": "us.anthropic.claude-sonnet-4-5-v1",
    "Claude Haiku 4.5 (Anthropic) - 200K": "us.anthropic.claude-haiku-4-5-v1",
    # Claude 3 family
    "Claude 3.7 Sonnet (Anthropic) - 200K": "anthropic.claude-3-7-sonnet-20250219-v1:0",
    "Claude 3.5 Sonnet (Anthropic) - 200K": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "Claude 3 Sonnet (Anthropic) - 200K": "anthropic.claude-3-sonnet-20240229-v1:0",
    "Claude 3 Haiku (Anthropic) - 200K": "anthropic.claude-3-haiku-20240307-v1:0",
    "Claude 3 Opus (Anthropic) - 200K": "anthropic.claude-3-opus-20240229-v1:0",
    # Others
    "Command R+ (Cohere) - 128K": "cohere.command-r-plus-v1:0",
    "Llama 3.1 70B Instruct (Meta) - 128K": "meta.llama3-1-70b-instruct-v1:0",
    "Mistral Large (Mistral) - 32K": "mistral.mistral-large-2402-v1:0",
}

BEDROCK_MODELS = FALLBACK_MODELS.copy()

# Models that do not support sampling parameters (temperature, top_p, top_k).
# Requests including these params will be rejected with a 400 ValidationException.
MODELS_WITHOUT_SAMPLING_PARAMS = {
    "anthropic.claude-opus-4-7",
    "us.anthropic.claude-opus-4-7",
}


def format_model_display_name(model_id: str, model_name: str, provider_name: str) -> str:
    metadata = MODEL_METADATA.get(model_id, {})
    context_window = metadata.get("context_window", "")
    clean_name = model_name
    if clean_name.lower().startswith(provider_name.lower()):
        clean_name = clean_name[len(provider_name):].strip()
    if context_window:
        return f"{clean_name} ({provider_name}) - {context_window}"
    return f"{clean_name} ({provider_name})"


def build_models_from_api_response(model_summaries: list) -> dict:
    models = {}
    for model in model_summaries:
        model_id = model.get("modelId", "")
        model_name = model.get("modelName", "")
        provider_name = model.get("providerName", "")
        if not model_id or not model_name:
            continue
        output_modalities = model.get("outputModalities", []) or []
        if output_modalities and "TEXT" not in output_modalities and "TEXT_VISION" not in output_modalities:
            continue
        display_name = format_model_display_name(model_id, model_name, provider_name)
        models[display_name] = model_id

    def sort_key(item):
        display_name, model_id = item
        context_match = re.search(r'(\d+)K', display_name)
        context_size = int(context_match.group(1)) if context_match else 0
        provider_match = re.search(r'\(([^)]+)\)', display_name)
        provider = provider_match.group(1) if provider_match else ""
        return (provider, -context_size, display_name)

    return dict(sorted(models.items(), key=sort_key))


def get_provider_from_display_name(display_name: str) -> str:
    raw = ""
    match = re.search(r"\s*\(([^)]+)\)", display_name)
    if match:
        raw = match.group(1).strip()
    elif display_name.startswith(("US ", "EU ", "AP ")):
        parts = display_name.split(None, 2)
        if len(parts) >= 2:
            raw = parts[1]
    else:
        return "Other"
    if raw and raw.lower() == "claude":
        return "Anthropic"
    return raw or "Other"


def get_model_display_names() -> list:
    return list(FALLBACK_MODELS.keys())


def get_model_id(display_name: str) -> str:
    return FALLBACK_MODELS.get(display_name, "anthropic.claude-3-sonnet-20240229-v1:0")


def get_display_name_for_model_id(model_id: str, models_dict: dict) -> str:
    for display_name, mid in models_dict.items():
        if mid == model_id:
            return display_name
    return model_id
