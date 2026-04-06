"""
Vector Store Service - ChromaDB document storage and retrieval.
Supports an optional shared embedding function (for scaling) or creates its own.
"""

import os
from typing import List, Dict, Any, Optional, Set

import chromadb
from langchain_community.embeddings import SentenceTransformerEmbeddings

from app.config.settings import RAGConfig


class VectorStoreService:
    """ChromaDB vector store for RAG."""

    def __init__(
        self,
        config: Optional[RAGConfig] = None,
        embedding_function: Optional[Any] = None,
    ):
        """
        Args:
            config: RAG config (persist path, top_k, etc.). If None, uses RAGConfig().
            embedding_function: Optional shared embedding object with embed_documents and embed_query.
                When provided, avoids loading a per-session model. When None, creates
                SentenceTransformerEmbeddings internally (backward compatible).
        """
        self.config = config or RAGConfig()
        os.makedirs(self.config.persist_directory, exist_ok=True)
        if embedding_function is not None:
            self.embedding_function = embedding_function
        else:
            self.embedding_function = SentenceTransformerEmbeddings(model_name=self.config.embedding_model)
        self._chroma_client = chromadb.PersistentClient(path=self.config.persist_directory)
        self.collection = self._chroma_client.get_or_create_collection(name=self.config.collection_name)

    def add_documents(
        self,
        documents: List[str],
        metadatas: List[Dict[str, Any]],
        ids: List[str],
        skip_duplicates: bool = True
    ) -> int:
        if not documents:
            return 0
        if skip_duplicates:
            documents, metadatas, ids = self._filter_existing(documents, metadatas, ids)
        if not documents:
            return 0
        embeddings = self.embedding_function.embed_documents(documents)
        self.collection.add(
            embeddings=embeddings,
            documents=documents,
            metadatas=metadatas,
            ids=ids
        )
        return len(documents)

    def _filter_existing(
        self,
        documents: List[str],
        metadatas: List[Dict[str, Any]],
        ids: List[str]
    ) -> tuple:
        try:
            existing = self.collection.get(ids=ids)
            existing_ids: Set[str] = set(existing.get("ids", []))
        except Exception:
            existing_ids = set()
        filtered_docs, filtered_metas, filtered_ids = [], [], []
        for doc, meta, doc_id in zip(documents, metadatas, ids):
            if doc_id not in existing_ids:
                filtered_docs.append(doc)
                filtered_metas.append(meta)
                filtered_ids.append(doc_id)
        return filtered_docs, filtered_metas, filtered_ids

    def retrieve(self, query: str, n_results: Optional[int] = None) -> Dict[str, Any]:
        if self.collection.count() == 0:
            return {"documents": [], "metadatas": [], "distances": []}
        n = n_results or self.config.top_k
        query_embedding = self.embedding_function.embed_query(query)
        results = self.collection.query(query_embeddings=[query_embedding], n_results=n)
        return {
            "documents": results.get('documents', [[]])[0],
            "metadatas": results.get('metadatas', [[]])[0],
            "distances": results.get('distances', [[]])[0]
        }

    def retrieve_as_context(
        self,
        query: str,
        n_results: Optional[int] = None,
        separator: str = "\n---\n"
    ) -> str:
        """Retrieve documents as a single context string (no session state)."""
        if self.collection.count() == 0:
            return "No context available in the database."
        results = self.retrieve(query, n_results)
        documents = results.get('documents', [])
        return separator.join(documents)

    def clear(self) -> None:
        try:
            self._chroma_client.delete_collection(self.config.collection_name)
        except Exception:
            pass
        self.collection = self._chroma_client.get_or_create_collection(name=self.config.collection_name)

    def count(self) -> int:
        return self.collection.count()

    def get_stats(self) -> Dict[str, Any]:
        return {
            "collection_name": self.config.collection_name,
            "document_count": self.count(),
            "persist_directory": self.config.persist_directory,
            "embedding_model": self.config.embedding_model
        }

    def get_all_metadatas(self) -> List[Dict[str, Any]]:
        if self.count() == 0:
            return []
        results = self.collection.get()
        return results.get('metadatas', [])
