"""
FastAPI backend for QA Assistant - Hyland.
Session-scoped initialization: each browser/session must initialize to use the app.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Body, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.sessions import SessionMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Tuple
from concurrent.futures import ThreadPoolExecutor
import asyncio
import hashlib
import json
import logging
import os
import threading
import time
import uuid

from app.config.logging_config import setup_logging

logger = logging.getLogger("qa_assistant")


class ExportExcelBody(BaseModel):
    output_text: str = ""
    output_format: str = "BDD (Gherkin)"

from jira import JIRA
from atlassian import Confluence
import boto3
from botocore.exceptions import NoCredentialsError

from app.services.jira_rag import JiraRAG
from app.services.xray_manual_fields import XRAY_PUBLISH_FORMAT, content_looks_like_xray_manual
from app.services.chat_service import ChatService
from app.services.conversation_store import ConversationStore
from app.services.aws_bedrock_service import fetch_bedrock_models_for_ui
from app.services.embedding_service import EmbeddingService
from app.export.export_service import ExportService
from app.config.settings import FALLBACK_MODELS

# Session-scoped state (per browser/session)
_rag_by_sid: Dict[str, JiraRAG] = {}
_chat_by_sid: Dict[str, ChatService] = {}
_conversation_store_by_sid: Dict[str, ConversationStore] = {}
_data_dir = os.path.join(os.path.dirname(__file__), "..", "data")
_conversations_dir = os.path.join(_data_dir, "conversations")

_DEFAULT_SESSION_SECRET = "qa-assistant-dev-secret-change-in-production"
SESSION_SECRET = os.environ.get("SESSION_SECRET_KEY", _DEFAULT_SESSION_SECRET)

# Custom thread pool for blocking work (larger than default for ~100 users)
_THREAD_POOL: Optional[ThreadPoolExecutor] = None
# Limit concurrent heavy operations (init, chat, test-case gen, kb populate) to avoid overloading Bedrock/Jira
_HEAVY_SEMAPHORE: Optional[asyncio.Semaphore] = None

# Bedrock model list cache: (region, profile) -> (expiry_ts, result)
_BEDROCK_MODELS_CACHE: Dict[Tuple[str, str], Tuple[float, dict]] = {}
_BEDROCK_MODELS_CACHE_TTL = int(os.environ.get("QA_BEDROCK_MODELS_CACHE_TTL", "300"))  # seconds

# Session last-activity for eviction
_session_last_used: Dict[str, float] = {}
_SESSION_TTL = int(os.environ.get("QA_SESSION_TTL", "14400"))  # 4 hours
_SESSION_MAX_COUNT = int(os.environ.get("QA_SESSION_MAX_COUNT", "150"))

# Rate limit: (sid -> (count, window_start))
_rate_limit: Dict[str, Tuple[int, float]] = {}
_rate_limit_lock = threading.Lock()
_RATE_LIMIT_REQUESTS = int(os.environ.get("QA_RATE_LIMIT_REQUESTS", "60"))
_RATE_LIMIT_WINDOW = int(os.environ.get("QA_RATE_LIMIT_WINDOW", "60"))


# --- Input size guardrails ---
MAX_CHAT_MESSAGE_LEN = 10_000       # Characters
MAX_FEEDBACK_LEN = 5_000
MAX_JIRA_COMMENT_LEN = 50_000
MAX_TEST_PLAN_LEN = 200_000
MAX_UPLOAD_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


def _validate_length(value: str, max_len: int, field_name: str = "input") -> None:
    """Raise HTTP 400 if value exceeds allowed length."""
    if value and len(value) > max_len:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} is too long ({len(value)} chars). Maximum allowed: {max_len}.",
        )


def _check_heavy_rate_limit(sid: str) -> bool:
    """Return True if request is allowed, False if over limit (caller should return 429)."""
    with _rate_limit_lock:
        now = time.time()
        if sid not in _rate_limit:
            _rate_limit[sid] = (1, now)
            return True
        count, start = _rate_limit[sid]
        if now - start >= _RATE_LIMIT_WINDOW:
            _rate_limit[sid] = (1, now)
            return True
        if count >= _RATE_LIMIT_REQUESTS:
            return False
        _rate_limit[sid] = (count + 1, start)
        return True


def _get_heavy_semaphore() -> asyncio.Semaphore:
    global _HEAVY_SEMAPHORE
    if _HEAVY_SEMAPHORE is None:
        n = int(os.environ.get("QA_HEAVY_CONCURRENCY", "30"))
        _HEAVY_SEMAPHORE = asyncio.Semaphore(max(1, min(n, 128)))
    return _HEAVY_SEMAPHORE


async def run_sync(func, *args, **kwargs):
    """Run a blocking sync function in the app thread pool (or default) so the event loop stays responsive."""
    pool = _THREAD_POOL
    loop = asyncio.get_event_loop()
    if pool is not None:
        return await loop.run_in_executor(pool, lambda: func(*args, **kwargs))
    return await asyncio.to_thread(func, *args, **kwargs)


def get_session_id(request: Request) -> str:
    """Ensure request has a session id (create one if new session)."""
    if "sid" not in request.session:
        request.session["sid"] = str(uuid.uuid4())
    return request.session["sid"]


def resolve_user_id(jira_username: str) -> str:
    """Derive a stable user identity from the Jira username (email).

    Today this hashes the email; when SSO/OAuth is added, swap this to
    derive the identity from the auth token instead.
    """
    normalized = jira_username.strip().lower()
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def get_user_id(request: Request) -> str:
    """Return the user_id stored in the session cookie, or raise if not initialized."""
    uid = request.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=400, detail="Not initialized. Go to Configuration and click Initialize.")
    return uid


def get_session_rag(request: Request) -> JiraRAG:
    """Return RAG for the current session or raise if not initialized."""
    sid = get_session_id(request)
    if sid not in _rag_by_sid:
        raise HTTPException(status_code=400, detail="Not initialized. Go to Configuration and click Initialize.")
    _session_last_used[sid] = time.time()
    return _rag_by_sid[sid]


def get_session_chat(request: Request) -> ChatService:
    """Return chat service for the current session or raise if not initialized."""
    sid = get_session_id(request)
    if sid not in _chat_by_sid:
        raise HTTPException(status_code=400, detail="Not initialized. Go to Configuration and click Initialize.")
    _session_last_used[sid] = time.time()
    return _chat_by_sid[sid]


def get_session_conversation_store(request: Request) -> ConversationStore:
    """Return conversation store for the current session or raise if not initialized."""
    sid = get_session_id(request)
    if sid not in _conversation_store_by_sid:
        raise HTTPException(status_code=400, detail="Not initialized. Go to Configuration and click Initialize.")
    _session_last_used[sid] = time.time()
    return _conversation_store_by_sid[sid]


def _run_init_sync(
    persist_path: str,
    jira_server: str,
    jira_username: str,
    jira_api_token: str,
    aws_region: str,
    aws_profile: str,
    chunk_size: int,
    chunk_overlap: int,
    top_k: int,
    bedrock_model: str,
    temperature: float,
    inference_profile_id: Optional[str],
    conversations_dir: str,
    user_id: str,
    shared_embedding_fn=None,
) -> Tuple[JiraRAG, ChatService, ConversationStore]:
    """
    Run blocking initialization in a thread (JiraRAG uses shared embedding when provided;
    Bedrock and other services are created per session).
    """
    rag = JiraRAG(
        jira_server=jira_server,
        jira_username=jira_username,
        jira_api_token=jira_api_token,
        aws_region=aws_region,
        aws_profile=aws_profile,
        persist_directory=persist_path,
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        top_k=top_k,
        bedrock_model=bedrock_model,
        temperature=temperature,
        inference_profile_id=inference_profile_id,
        shared_embedding_function=shared_embedding_fn,
    )
    chat = ChatService(
        aws_service=rag.aws_service,
        vector_store=rag.vector_store,
        use_rag=False,
    )
    user_conversations_dir = os.path.join(conversations_dir, user_id)
    os.makedirs(user_conversations_dir, exist_ok=True)
    store = ConversationStore(user_conversations_dir)
    return (rag, chat, store)


def _evict_idle_sessions() -> None:
    """Remove sessions that have exceeded TTL or when over max count. Run from event loop."""
    now = time.time()
    to_evict = []
    for sid in list(_rag_by_sid.keys()):
        last = _session_last_used.get(sid, 0)
        if now - last > _SESSION_TTL:
            to_evict.append(sid)
    if len(_rag_by_sid) > _SESSION_MAX_COUNT:
        by_age = sorted(
            (sid for sid in _rag_by_sid if sid not in to_evict),
            key=lambda s: _session_last_used.get(s, 0),
        )
        for sid in by_age[: len(_rag_by_sid) - _SESSION_MAX_COUNT]:
            if sid not in to_evict:
                to_evict.append(sid)
    for sid in to_evict:
        _rag_by_sid.pop(sid, None)
        _chat_by_sid.pop(sid, None)
        _conversation_store_by_sid.pop(sid, None)
        _session_last_used.pop(sid, None)
        _rate_limit.pop(sid, None)
    if to_evict:
        logger.info("Evicted %s idle/over-capacity session(s)", len(to_evict))


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _THREAD_POOL
    log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
    setup_logging(log_dir=log_dir, log_level=os.environ.get("LOG_LEVEL", "INFO"))
    os.makedirs(_data_dir, exist_ok=True)
    os.makedirs(_conversations_dir, exist_ok=True)
    app.state.embedding_service = EmbeddingService.get_instance()
    max_workers = int(os.environ.get("QA_THREAD_POOL_SIZE", "64"))
    _THREAD_POOL = ThreadPoolExecutor(max_workers=max(4, min(max_workers, 128)), thread_name_prefix="qa_")
    logger.info("Application startup: data_dir=%s thread_pool=%s", _data_dir, max_workers)
    if SESSION_SECRET == _DEFAULT_SESSION_SECRET:
        logger.warning(
            "SESSION_SECRET_KEY is using the default dev value! "
            "Set SESSION_SECRET_KEY env var to a strong random string in production."
        )

    eviction_interval = int(os.environ.get("QA_SESSION_EVICTION_INTERVAL", "300"))  # 5 min
    eviction_task: Optional[asyncio.Task] = None

    async def _eviction_loop() -> None:
        while True:
            await asyncio.sleep(eviction_interval)
            _evict_idle_sessions()

    eviction_task = asyncio.create_task(_eviction_loop())

    yield
    if eviction_task is not None:
        eviction_task.cancel()
        try:
            await eviction_task
        except asyncio.CancelledError:
            pass
    if _THREAD_POOL is not None:
        _THREAD_POOL.shutdown(wait=False)
        _THREAD_POOL = None
    logger.info("Application shutdown")


app = FastAPI(title="QA Assistant API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    session_cookie="qa_session",
    same_site="lax",
    max_age=14 * 24 * 3600,  # 14 days
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class FileLike:
    """Adapter so DocumentProcessor can use FastAPI UploadFile."""
    def __init__(self, name: str, content_type: str, data: bytes):
        self.name = name
        self.type = content_type
        self._data = data
    def getvalue(self):
        return self._data


# --- Pydantic models (minimal for now) ---
# Init body: jira_server, jira_username, jira_api_token, aws_region?, aws_profile?, persist_directory?, chunk_size?, chunk_overlap?, top_k?, bedrock_model?, temperature?, inference_profile_id?


_startup_time = time.time()

@app.get("/api/health")
def health():
    uptime_s = int(time.time() - _startup_time)
    return {
        "status": "ok",
        "uptime_seconds": uptime_s,
        "active_sessions": len(_rag_by_sid),
        "session_limit": _SESSION_MAX_COUNT,
        "thread_pool_alive": _THREAD_POOL is not None,
    }


@app.get("/api/init-status")
def api_init_status(request: Request):
    """Return whether the current session is fully initialized (RAG + LLM ready)."""
    sid = get_session_id(request)
    user_id = request.session.get("user_id", "")
    rag = _rag_by_sid.get(sid)
    if rag is None:
        return {"initialized": False, "reason": "not_initialized", "user_id": user_id}
    if not rag.aws_service.is_initialized:
        return {"initialized": False, "reason": "llm_not_ready", "connected": True, "user_id": user_id}
    return {
        "initialized": True,
        "connected": True,
        "current_model_id": getattr(rag.aws_service, "bedrock_model", None),
        "user_id": user_id,
    }


@app.post("/api/disconnect")
def api_disconnect(request: Request):
    """Clear server-side session state for the current session. Client should then set initialized to false and navigate to config."""
    sid = get_session_id(request)
    _rag_by_sid.pop(sid, None)
    _chat_by_sid.pop(sid, None)
    _conversation_store_by_sid.pop(sid, None)
    _session_last_used.pop(sid, None)
    _rate_limit.pop(sid, None)
    logger.info("Disconnect session_id=%s", sid[:8])
    return {"ok": True}


@app.get("/api/connection-settings")
def api_connection_settings(request: Request):
    """Return current connection settings for the Config UI (no API token). When not initialized, returns empty strings."""
    sid = get_session_id(request)
    user_id = request.session.get("user_id", "")
    rag = _rag_by_sid.get(sid)
    if rag is None:
        return {"jira_server": "", "jira_username": "", "aws_region": "us-east-1", "aws_profile": "", "user_id": user_id}
    settings = rag.get_connection_settings()
    settings["user_id"] = user_id
    return settings


@app.get("/api/jira/ticket-info")
def api_jira_ticket_info(request: Request, ticket_id: str = ""):
    rag = get_session_rag(request)
    tid = ticket_id.strip()
    if not tid:
        raise HTTPException(status_code=400, detail="ticket_id is required")
    data = rag.atlassian.get_jira_ticket_structured(tid)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Could not fetch ticket {tid}")
    return data


@app.post("/api/init")
async def api_init(
    request: Request,
    jira_server: str = Form(...),
    jira_username: str = Form(...),
    jira_api_token: str = Form(...),
    aws_region: str = Form("us-east-1"),
    aws_profile: str = Form(""),
    persist_directory: str = Form("data/chroma"),
    chunk_size: int = Form(1000),
    chunk_overlap: int = Form(150),
    top_k: int = Form(4),
    bedrock_model: str = Form(""),
    temperature: float = Form(0.8),
    inference_profile_id: str = Form(""),
):
    sid = get_session_id(request)
    if not _check_heavy_rate_limit(sid):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    logger.info("Init requested session_id=%s jira_user=%s aws_region=%s", sid[:8], (jira_username or "").strip()[:30], aws_region)
    jira_server = (jira_server or "").strip()
    jira_username = (jira_username or "").strip()
    jira_api_token = (jira_api_token or "").strip()
    aws_profile = (aws_profile or "").strip()
    if not jira_server:
        raise HTTPException(status_code=400, detail="Jira / Confluence URL is required.")
    if not jira_username:
        raise HTTPException(status_code=400, detail="Atlassian username (email) is required.")
    if not jira_api_token:
        raise HTTPException(status_code=400, detail="Atlassian API token is required.")
    if not aws_profile:
        raise HTTPException(status_code=400, detail="AWS profile is required.")
    user_id = resolve_user_id(jira_username)
    request.session["user_id"] = user_id
    base_persist = os.path.join(os.path.dirname(__file__), "..", persist_directory) if not os.path.isabs(persist_directory) else persist_directory
    persist_path = os.path.join(base_persist, user_id)
    inference_profile_id_val = inference_profile_id.strip() or None
    try:
        async with _get_heavy_semaphore():
            shared_embedding_fn = (
                getattr(request.app.state, "embedding_service", None)
                and request.app.state.embedding_service.get_embedding_function()
            )
            rag, chat, store = await asyncio.to_thread(
                _run_init_sync,
                persist_path,
                jira_server,
                jira_username,
                jira_api_token,
                aws_region,
                aws_profile,
                chunk_size,
                chunk_overlap,
                top_k,
                bedrock_model,
                temperature,
                inference_profile_id_val,
                _conversations_dir,
                user_id,
                shared_embedding_fn,
            )
        # If re-init (session already had RAG) but new Bedrock failed, keep the previous RAG so user can still use the app.
        existing = _rag_by_sid.get(sid)
        if (
            existing is not None
            and not rag.aws_service.is_initialized
            and existing.aws_service.is_initialized
        ):
            logger.warning(
                "Init session_id=%s: new model/config left Bedrock uninitialized; keeping previous RAG",
                sid[:8],
            )
            rag, chat, store = existing, _chat_by_sid[sid], _conversation_store_by_sid[sid]
        else:
            _rag_by_sid[sid] = rag
            _chat_by_sid[sid] = chat
            _conversation_store_by_sid[sid] = store
        _session_last_used[sid] = time.time()
        logger.info(
            "Init success session_id=%s user_id=%s bedrock_initialized=%s jira_connected=%s confluence_connected=%s",
            sid[:8], user_id[:8], rag.aws_service.is_initialized, rag.atlassian.is_jira_connected, rag.atlassian.is_confluence_connected,
        )
        return {
            "ok": True,
            "message": "Initialized",
            "bedrock_initialized": rag.aws_service.is_initialized,
            "jira_connected": rag.atlassian.is_jira_connected,
            "confluence_connected": rag.atlassian.is_confluence_connected,
        }
    except Exception as e:
        logger.exception("Init failed session_id=%s error=%s", sid[:8], e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-connection")
async def api_test_connection(rag: JiraRAG = Depends(get_session_rag)):
    def _test():
        return (
            rag.atlassian.test_jira_connection(),
            rag.atlassian.test_confluence_connection(),
            rag.aws_service.test_connection(),
        )
    jira_ok, conf_ok, bedrock_ok = await run_sync(_test)
    return {"jira": jira_ok, "confluence": conf_ok, "bedrock": bedrock_ok}


@app.post("/api/test-connection-with-config")
async def api_test_connection_with_config(
    jira_server: str = Form(...),
    jira_username: str = Form(...),
    jira_api_token: str = Form(...),
    aws_region: str = Form("us-east-1"),
    aws_profile: str = Form(""),
):
    """Test Jira, Confluence, and Bedrock with provided credentials (no init required)."""
    jira_ok = conf_ok = bedrock_ok = False
    try:
        jira = JIRA(server=jira_server, basic_auth=(jira_username, jira_api_token))
        jira.myself()
        jira_ok = True
    except Exception:
        pass
    try:
        conf = Confluence(url=jira_server, username=jira_username, password=jira_api_token)
        conf.get_all_spaces(limit=1)
        conf_ok = True
    except Exception:
        pass
    try:
        if aws_profile:
            session = boto3.Session(profile_name=aws_profile)
            bc = session.client("bedrock", region_name=aws_region)
        else:
            bc = boto3.client("bedrock", region_name=aws_region)
        bc.list_foundation_models(byOutputModality="TEXT")
        bedrock_ok = True
    except NoCredentialsError:
        pass
    except Exception:
        pass
    return {"jira": jira_ok, "confluence": conf_ok, "bedrock": bedrock_ok}


@app.get("/api/bedrock-models")
async def api_bedrock_models(request: Request, aws_region: str = None, aws_profile: str = None):
    """List Bedrock models. When system is initialized and region/profile not given, uses session's AWS config and returns default_model_id. Results cached by (region, profile) with TTL."""
    region = (aws_region or "").strip() or None
    profile = (aws_profile or "").strip() or None
    sid = get_session_id(request)
    rag = _rag_by_sid.get(sid)
    use_session_config = rag is not None and (region is None or region == "")
    if use_session_config:
        region = getattr(rag.aws_service, "aws_region", None) or "us-east-1"
        profile = getattr(rag.aws_service, "aws_profile", None)
    if not region:
        region = "us-east-1"
    cache_key = (region, profile or "")
    now = time.time()
    if cache_key in _BEDROCK_MODELS_CACHE:
        expiry, cached = _BEDROCK_MODELS_CACHE[cache_key]
        if now < expiry:
            out = dict(cached)
            if use_session_config and rag is not None:
                current = getattr(rag.aws_service, "bedrock_model", None)
                out["default_model_id"] = current if current is not None else ""
            return out
    try:
        models = await run_sync(fetch_bedrock_models_for_ui, region, profile or None)
        out = {"models": models, "ok": True}
        if len(_BEDROCK_MODELS_CACHE) >= 64:
            oldest_key = min(_BEDROCK_MODELS_CACHE, key=lambda k: _BEDROCK_MODELS_CACHE[k][0])
            _BEDROCK_MODELS_CACHE.pop(oldest_key, None)
        _BEDROCK_MODELS_CACHE[cache_key] = (now + _BEDROCK_MODELS_CACHE_TTL, out.copy())
        if use_session_config and rag is not None:
            current = getattr(rag.aws_service, "bedrock_model", None)
            out["default_model_id"] = current if current is not None else ""
        return out
    except Exception as e:
        logger.warning("bedrock-models failed region=%s profile=%s error=%s", region, profile, e)
        out = {"models": FALLBACK_MODELS, "ok": False, "error": str(e)}
        if use_session_config and rag is not None:
            current = getattr(rag.aws_service, "bedrock_model", None)
            out["default_model_id"] = current if current is not None else ""
        return out


@app.post("/api/kb/populate")
async def api_kb_populate(
    request: Request,
    rag: JiraRAG = Depends(get_session_rag),
    ticket_ids: str = Form(""),
    confluence_urls: str = Form(""),
    files: List[UploadFile] = File(default=[]),
):
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    ticket_list = [t.strip() for t in ticket_ids.split(",") if t.strip()]
    confluence_list = [u.strip() for u in confluence_urls.split(",") if u.strip()]
    uploaded = []
    for f in files or []:
        data = await f.read()
        uploaded.append(FileLike(f.filename or "file", f.content_type or "application/octet-stream", data))
    try:
        async with _get_heavy_semaphore():
            chunks_added = await run_sync(rag.populate_vector_db, ticket_list, confluence_list, uploaded)
        logger.info(
            "kb/populate success tickets=%s confluence_urls=%s files=%s chunks_added=%s",
            len(ticket_list), len(confluence_list), len(uploaded), chunks_added,
        )
        return {"ok": True, "message": "Knowledge base populated", "chunks_added": chunks_added}
    except Exception as e:
        logger.exception("kb/populate failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/kb")
async def api_kb_clear(rag: JiraRAG = Depends(get_session_rag)):
    await run_sync(rag.clear_kb)
    return {"ok": True}


@app.get("/api/kb/sources")
async def api_kb_sources(rag: JiraRAG = Depends(get_session_rag)):
    """Return list of unique sources (source_type, title, url) in the knowledge base."""
    sources = await run_sync(rag.get_kb_sources)
    return {"sources": sources, "ok": True}


@app.post("/api/chat/message")
async def api_chat_message(request: Request, chat: ChatService = Depends(get_session_chat), message: str = Form(...)):
    _validate_length(message, MAX_CHAT_MESSAGE_LEN, "Message")
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    try:
        async with _get_heavy_semaphore():
            response = await run_sync(chat.send_message, message)
        return {"response": response, "ok": True}
    except Exception as e:
        logger.exception("chat/message failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/quick-action")
async def api_chat_quick_action(request: Request, chat: ChatService = Depends(get_session_chat), action: str = Form(...)):
    if action not in chat.QUICK_ACTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    try:
        async with _get_heavy_semaphore():
            response = await run_sync(chat.send_quick_action, action)
        return {"response": response, "ok": True}
    except Exception as e:
        logger.exception("chat/quick-action failed action=%s error=%s", action, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/chat/add-ticket")
async def api_chat_add_ticket(rag: JiraRAG = Depends(get_session_rag), chat: ChatService = Depends(get_session_chat), ticket_id: str = Form(...)):
    details = await run_sync(rag.get_jira_ticket_details, ticket_id)
    if not details:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} not found")
    chat.add_ticket(ticket_id, details)
    return {"ok": True}


@app.get("/api/chat/state")
async def api_chat_state(chat: ChatService = Depends(get_session_chat)):
    """Return current chat state: tickets, attachments, messages (for UI)."""
    state = chat.to_dict()
    state["current_model"] = chat.get_current_model()
    state["use_rag"] = chat.use_rag
    return state


@app.post("/api/chat/clear")
async def api_chat_clear(chat: ChatService = Depends(get_session_chat)):
    chat.clear_all()
    return {"ok": True}


@app.post("/api/chat/use-rag")
async def api_chat_use_rag(chat: ChatService = Depends(get_session_chat), use_rag: str = Form("false")):
    chat.use_rag = use_rag.lower() in ("true", "1", "yes")
    return {"ok": True}


@app.post("/api/chat/add-attachment")
async def api_chat_add_attachment(chat: ChatService = Depends(get_session_chat), file: UploadFile = File(...), name: Optional[str] = Form(None)):
    data = await file.read()
    if len(data) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail=f"File too large ({len(data)} bytes). Maximum: {MAX_UPLOAD_SIZE_BYTES // (1024*1024)} MB.")
    fname = name or (file.filename or "attachment")
    chat.add_attachment(fname, data, file.content_type or "application/octet-stream")
    return {"ok": True, "name": fname}


@app.post("/api/chat/remove-attachment")
async def api_chat_remove_attachment(chat: ChatService = Depends(get_session_chat), name: str = Form(...)):
    ok = chat.remove_attachment(name)
    return {"ok": ok}


@app.post("/api/chat/remove-ticket")
async def api_chat_remove_ticket(chat: ChatService = Depends(get_session_chat), ticket_id: str = Form(...), clear_history: bool = Form(True)):
    ok = chat.remove_ticket(ticket_id, clear_history=clear_history)
    return {"ok": ok}


@app.get("/api/conversations")
async def api_conversations_list(store: ConversationStore = Depends(get_session_conversation_store), limit: int = 10):
    convos = await run_sync(store.list_conversations, limit)
    return {"conversations": convos}


@app.post("/api/conversations/save")
async def api_conversations_save(chat: ChatService = Depends(get_session_chat), store: ConversationStore = Depends(get_session_conversation_store), title: Optional[str] = Form(None)):
    data = chat.to_dict()
    conv_id = await run_sync(store.save, data, title)
    return {"ok": True, "id": conv_id}


@app.get("/api/conversations/{conversation_id}")
async def api_conversations_load(conversation_id: str, chat: ChatService = Depends(get_session_chat), store: ConversationStore = Depends(get_session_conversation_store)):
    data = await run_sync(store.load, conversation_id)
    if not data:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    chat.load_from_dict(data)
    return {"ok": True, "state": chat.to_dict()}


@app.delete("/api/conversations/{conversation_id}")
async def api_conversations_delete(conversation_id: str, store: ConversationStore = Depends(get_session_conversation_store)):
    ok = await run_sync(store.delete, conversation_id)
    return {"ok": ok}


@app.post("/api/chat/switch-model")
async def api_chat_switch_model(rag: JiraRAG = Depends(get_session_rag), model_id: str = Form(...)):
    ok = await run_sync(rag.switch_model, model_id)
    return {"ok": ok}


def _markdown_to_jira_wiki(text: str) -> str:
    """Convert common Markdown syntax to Jira wiki notation."""
    import re as _re
    t = text
    t = _re.sub(r'^###\s+(.+)$', r'h3. \1', t, flags=_re.MULTILINE)
    t = _re.sub(r'^##\s+(.+)$', r'h2. \1', t, flags=_re.MULTILINE)
    t = _re.sub(r'^#\s+(.+)$', r'h1. \1', t, flags=_re.MULTILINE)
    t = _re.sub(r'\*\*(.+?)\*\*', r'*\1*', t)
    t = _re.sub(r'`([^`]+)`', r'{{\1}}', t)
    t = _re.sub(r'^- ', r'* ', t, flags=_re.MULTILINE)
    t = _re.sub(r'^\d+\.\s+', r'# ', t, flags=_re.MULTILINE)
    return t


@app.post("/api/chat/post-to-jira")
async def api_chat_post_to_jira(rag: JiraRAG = Depends(get_session_rag), chat: ChatService = Depends(get_session_chat), content: str = Form(...), ticket_id: str = Form("")):
    _validate_length(content, MAX_JIRA_COMMENT_LEN, "Comment")
    if not chat.tickets:
        raise HTTPException(status_code=400, detail="No ticket loaded.")
    tid = ticket_id.strip() if ticket_id else ""
    if tid and tid not in chat.tickets:
        raise HTTPException(status_code=400, detail=f"Ticket {tid} is not loaded in the current session.")
    if not tid:
        tid = list(chat.tickets.keys())[0]
    wiki_content = _markdown_to_jira_wiki(content)
    comment = f"*AI Analysis:*\n\n{wiki_content}\n\n_Posted via QA Assistant_"
    await run_sync(rag.atlassian.add_comment, tid, comment)
    return {"ok": True, "ticket_id": tid}


@app.get("/api/export/conversation")
async def api_export_conversation(chat: ChatService = Depends(get_session_chat), format: str = "markdown"):
    out = await run_sync(chat.export_conversation, format)
    media_type = "application/json" if format == "json" else "text/markdown"
    return Response(content=out, media_type=media_type)


@app.get("/api/kb/count")
async def api_kb_count(rag: JiraRAG = Depends(get_session_rag)):
    try:
        n = await run_sync(rag.collection.count)
        return {"count": n, "ok": True}
    except Exception:
        return {"count": 0, "ok": True}


@app.post("/api/test-cases/generate")
async def api_test_cases_generate(
    request: Request,
    rag: JiraRAG = Depends(get_session_rag),
    source_type: str = Form("jira"),
    target_id: str = Form(...),
    output_format: str = Form("BDD (Gherkin)"),
    use_knowledge_base: bool = Form(False),
    user_instructions: str = Form(""),
):
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    def _generate():
        text = rag.generate_test_cases(
            target_id,
            output_format,
            use_knowledge_base=use_knowledge_base,
            source_type=source_type,
            user_instructions=user_instructions.strip() or None,
        )
        parsed = rag.parse_test_cases(text, output_format)
        parsed = rag.test_parser.drop_truncated_tail(parsed, output_format)
        sources = []
        if use_knowledge_base and rag.vector_store.count() > 0:
            ret = rag.vector_store.retrieve(target_id, n_results=4)
            sources = ret.get("metadatas", [])
        return {"text": text, "parsed": parsed, "sources": sources}
    try:
        async with _get_heavy_semaphore():
            out = await run_sync(_generate)
        logger.info("test-cases/generate success target_id=%s format=%s parsed_count=%s", target_id, output_format, len(out.get("parsed", [])))
        return {"generated_text": out["text"], "parsed": out["parsed"], "sources": out["sources"], "ok": True}
    except Exception as e:
        logger.exception("test-cases/generate failed target_id=%s error=%s", target_id, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-cases/refine")
async def api_test_cases_refine(
    rag: JiraRAG = Depends(get_session_rag),
    current_tests: str = Form(...),
    output_format: str = Form(...),
    feedback: str = Form(...),
):
    _validate_length(feedback, MAX_FEEDBACK_LEN, "Feedback")
    def _refine():
        refined = rag.refine_test_cases(current_tests, output_format, feedback)
        parsed = rag.parse_test_cases(refined, output_format)
        return refined, parsed
    try:
        refined, parsed = await run_sync(_refine)
        logger.info("test-cases/refine success parsed_count=%s", len(parsed))
        return {"generated_text": refined, "parsed": parsed, "ok": True}
    except Exception as e:
        logger.exception("test-cases/refine failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-cases/refine-single")
async def api_test_cases_refine_single(
    rag: JiraRAG = Depends(get_session_rag),
    test_case_content: str = Form(...),
    output_format: str = Form(...),
    feedback: str = Form(...),
):
    try:
        result = await run_sync(rag.refine_single_test_case, test_case_content, output_format, feedback)
        logger.info("test-cases/refine-single success confidence=%s", result.get("confidence"))
        return {
            "refined_content": result["refined_content"],
            "confidence": result.get("confidence"),
            "confidence_reason": result.get("confidence_reason"),
            "ok": True,
        }
    except Exception as e:
        logger.exception("test-cases/refine-single failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-cases/quality-review")
async def api_test_cases_quality_review(
    request: Request,
    rag: JiraRAG = Depends(get_session_rag),
    body: dict = Body(...),
):
    """Score one or more test cases on clarity, completeness, edge-case coverage, and structure."""
    test_cases = body.get("test_cases", [])
    output_format = body.get("output_format", "BDD (Gherkin)")
    if not test_cases:
        raise HTTPException(status_code=400, detail="No test cases provided.")
    results = []
    for tc in test_cases:
        title = tc.get("title", "")
        content = tc.get("content", "")
        tc_id = tc.get("id", "")
        try:
            score = await run_sync(rag.review_test_case_quality, title, content, output_format)
        except Exception as e:
            logger.warning("quality-review failed for id=%s error=%s", tc_id, e)
            score = {"overall": 0, "error": str(e)}
        results.append({"id": tc_id, **score})
    logger.info("test-cases/quality-review completed count=%s", len(results))
    return {"results": results, "ok": True}


@app.post("/api/test-plan/generate")
async def api_test_plan_generate(
    request: Request,
    rag: JiraRAG = Depends(get_session_rag),
    initiative_urls: str = Form(""),
    design_urls: str = Form(""),
    other_urls: str = Form(""),
    jira_ticket_ids: str = Form(""),
    plan_prompt: str = Form(""),
    sample_template_url: str = Form(""),
    files: List[UploadFile] = File(default=[]),
):
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    init_list = [u.strip() for u in initiative_urls.split(",") if u.strip()]
    design_list = [u.strip() for u in design_urls.split(",") if u.strip()]
    other_list = [u.strip() for u in other_urls.split(",") if u.strip()]
    ticket_list = [t.strip() for t in jira_ticket_ids.split(",") if t.strip()]
    uploaded = []
    for f in files or []:
        data = await f.read()
        uploaded.append(FileLike(f.filename or "file", f.content_type or "application/octet-stream", data))
    try:
        async with _get_heavy_semaphore():
            plan = await run_sync(
                rag.generate_test_plan,
                init_list, design_list, other_list,
                ticket_list, uploaded,
                sample_template_url.strip() or None,
                plan_prompt.strip() or None,
            )
        logger.info("test-plan/generate success")
        return {"plan": plan, "ok": True}
    except Exception as e:
        logger.exception("test-plan/generate failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-plan/refine")
async def api_test_plan_refine(request: Request, rag: JiraRAG = Depends(get_session_rag), current_plan: str = Form(...), feedback: str = Form(...)):
    _validate_length(feedback, MAX_FEEDBACK_LEN, "Feedback")
    _validate_length(current_plan, MAX_TEST_PLAN_LEN, "Current plan")
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    try:
        async with _get_heavy_semaphore():
            refined = await run_sync(rag.refine_test_plan, current_plan, feedback)
        logger.info("test-plan/refine success")
        return {"plan": refined, "ok": True}
    except Exception as e:
        logger.exception("test-plan/refine failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-plan/publish")
async def api_test_plan_publish(
    rag: JiraRAG = Depends(get_session_rag),
    space_key: str = Form(...),
    title: str = Form(...),
    plan: str = Form(...),
):
    try:
        url = await run_sync(rag.publish_test_plan_to_confluence, space_key.strip(), title.strip(), plan)
        logger.info("test-plan/publish success space_key=%s url=%s", space_key, url)
        return {"ok": True, "url": url}
    except Exception as e:
        logger.exception("test-plan/publish failed error=%s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/export/excel")
async def api_export_excel(body: ExportExcelBody):
    def _excel():
        exporter = ExportService()
        return exporter.to_excel(body.output_text, body.output_format)
    buf = await run_sync(_excel)
    return Response(
        content=buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=test-cases.xlsx"}
    )


class WriteToXrayBody(BaseModel):
    output_text: str = ""
    output_format: str = "Xray Jira Test Format"
    project_key: str = ""
    skip_if_duplicate: bool = True


class TestCaseItem(BaseModel):
    id: str = ""
    title: str = ""
    content: str = ""


class WriteSelectedToXrayBody(BaseModel):
    project_key: str = ""
    output_format: str = "BDD (Gherkin)"
    test_cases: List[TestCaseItem] = []
    skip_if_duplicate: bool = True


class CheckXrayDuplicatesBody(BaseModel):
    project_key: str = ""
    output_format: str = "BDD (Gherkin)"
    test_cases: List[TestCaseItem] = []


@app.post("/api/test-cases/check-xray-duplicates")
async def api_check_xray_duplicates(
    request: Request,
    rag: JiraRAG = Depends(get_session_rag),
    body: CheckXrayDuplicatesBody = Body(...),
):
    if not _check_heavy_rate_limit(get_session_id(request)):
        raise HTTPException(status_code=429, detail="Too many requests. Try again later.")
    if not body.project_key or not body.project_key.strip():
        raise HTTPException(status_code=400, detail="project_key is required")
    if not body.test_cases:
        raise HTTPException(status_code=400, detail="No test cases to check.")
    payload = [{"id": (tc.id or "").strip(), "title": tc.title, "content": tc.content} for tc in body.test_cases]

    def _check():
        return rag.check_xray_duplicates(body.project_key.strip(), payload, body.output_format)

    try:
        async with _get_heavy_semaphore():
            results = await run_sync(_check)
        logger.info(
            "check-xray-duplicates project_key=%s cases=%s dups=%s",
            body.project_key.strip(),
            len(results),
            sum(1 for r in results if r.get("is_duplicate")),
        )
        return {"ok": True, "results": results}
    except Exception as e:
        logger.exception("check-xray-duplicates failed project_key=%s error=%s", body.project_key, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-cases/write-to-xray")
async def api_write_to_xray(rag: JiraRAG = Depends(get_session_rag), body: WriteToXrayBody = Body(...)):
    if not body.project_key or not body.project_key.strip():
        raise HTTPException(status_code=400, detail="project_key is required")
    if not body.output_text or not body.output_text.strip():
        raise HTTPException(status_code=400, detail="output_text is required")
    try:
        def _write():
            raw = body.output_text.strip()
            declared = (body.output_format or "").strip()
            # UI often leaves "BDD (Gherkin)" while the blob is Xray markdown — parse with the right splitter.
            parse_fmt = (
                XRAY_PUBLISH_FORMAT
                if declared == XRAY_PUBLISH_FORMAT or content_looks_like_xray_manual(raw)
                else declared
            )
            parsed = rag.parse_test_cases(raw, parse_fmt)
            if not parsed:
                raise HTTPException(status_code=400, detail="No test cases could be parsed from the provided text.")
            return rag.atlassian.bulk_create_xray_tests(
                parsed,
                body.project_key.strip(),
                parse_fmt,
                body.skip_if_duplicate,
            )

        result = await run_sync(_write)
        created = result.get("created_keys") or []
        skipped = result.get("skipped_duplicates") or []
        per_item = result.get("per_item") or []
        logger.info(
            "write-to-xray success project_key=%s created=%s skipped=%s keys=%s",
            body.project_key.strip(),
            len(created),
            len(skipped),
            created[:5] if len(created) > 5 else created,
        )
        return {
            "ok": True,
            "created_keys": created,
            "count": len(created),
            "skipped_duplicates": skipped,
            "skipped_count": len(skipped),
            "per_item": per_item,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("write-to-xray failed project_key=%s error=%s", body.project_key, e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/test-cases/write-to-xray-selected")
async def api_write_selected_to_xray(rag: JiraRAG = Depends(get_session_rag), body: WriteSelectedToXrayBody = Body(...)):
    """Publish only selected (and optionally edited) test cases to Xray."""
    if not body.project_key or not body.project_key.strip():
        raise HTTPException(status_code=400, detail="project_key is required")
    if not body.test_cases:
        raise HTTPException(status_code=400, detail="No test cases selected.")
    payload = [
        {"id": tc.id or "", "title": tc.title, "content": tc.content}
        for tc in body.test_cases
        if (tc.title or tc.content)
    ]
    if not payload:
        raise HTTPException(status_code=400, detail="No valid test cases to publish.")
    try:

        def _write_sel():
            return rag.atlassian.bulk_create_xray_tests(
                payload,
                body.project_key.strip(),
                body.output_format,
                body.skip_if_duplicate,
            )

        result = await run_sync(_write_sel)
        created = result.get("created_keys") or []
        skipped = result.get("skipped_duplicates") or []
        per_item = result.get("per_item") or []
        logger.info(
            "write-to-xray-selected success project_key=%s created=%s skipped=%s",
            body.project_key.strip(),
            len(created),
            len(skipped),
        )
        return {
            "ok": True,
            "created_keys": created,
            "count": len(created),
            "skipped_duplicates": skipped,
            "skipped_count": len(skipped),
            "per_item": per_item,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("write-to-xray-selected failed project_key=%s error=%s", body.project_key, e)
        raise HTTPException(status_code=500, detail=str(e))
