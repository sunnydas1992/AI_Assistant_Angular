"""
Shared embedding service - single in-process model for all sessions.
Reduces memory and init cost when scaling to many concurrent users.
Uses a lock so concurrent embed_documents/embed_query from the thread pool are serialized.
"""

import logging
import os
import threading
from typing import Optional, Any, List

from langchain_community.embeddings import SentenceTransformerEmbeddings

logger = logging.getLogger(__name__)

# Default model from RAGConfig
DEFAULT_EMBEDDING_MODEL = os.environ.get("QA_EMBEDDING_MODEL", "all-MiniLM-L6-v2")


class _ThreadSafeEmbeddings:
    """Wraps SentenceTransformerEmbeddings with a lock for concurrent use."""

    def __init__(self, inner: SentenceTransformerEmbeddings):
        self._inner = inner
        self._lock = threading.Lock()

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        with self._lock:
            return self._inner.embed_documents(texts)

    def embed_query(self, text: str) -> List[float]:
        with self._lock:
            return self._inner.embed_query(text)


class EmbeddingService:
    """
    Singleton-style service that loads one SentenceTransformer model and exposes
    it for use by all VectorStoreService instances. Thread-safe via a lock.
    """

    _instance: Optional["EmbeddingService"] = None

    def __init__(self, model_name: str = DEFAULT_EMBEDDING_MODEL):
        self._model_name = model_name
        self._embeddings: Optional[_ThreadSafeEmbeddings] = None

    def get_embedding_function(self) -> _ThreadSafeEmbeddings:
        """Return the shared, thread-safe embedding function (lazy load on first use)."""
        if self._embeddings is None:
            logger.info("Loading shared embedding model: %s", self._model_name)
            inner = SentenceTransformerEmbeddings(model_name=self._model_name)
            self._embeddings = _ThreadSafeEmbeddings(inner)
        return self._embeddings

    @classmethod
    def get_instance(cls, model_name: str = DEFAULT_EMBEDDING_MODEL) -> "EmbeddingService":
        """Return the process-wide singleton instance."""
        if cls._instance is None:
            cls._instance = cls(model_name=model_name)
        return cls._instance
