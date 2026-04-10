"""
Chat Service Module

This module provides conversational AI capabilities for analyzing Jira tickets.
It manages conversation state, context (tickets, attachments), and LLM interactions.

The ChatService class handles:
- Conversation history management
- Multi-ticket context loading
- Attachment processing (text, images, logs)
- Model switching during conversation
- RAG integration for knowledge base retrieval
- Conversation export

Classes:
    - ChatMessage: Dataclass for chat messages
    - ChatService: Main service for chat functionality

Example Usage:
    ```python
    from src.services.chat_service import ChatService
    
    # Initialize
    chat = ChatService(aws_service, vector_store)
    
    # Load ticket context
    chat.add_ticket("PROJ-123", ticket_details)
    
    # Add attachment
    chat.add_attachment("error.log", log_content, "text/plain")
    
    # Send message
    response = chat.send_message("What's causing the error?")
    
    # Export conversation
    markdown = chat.export_conversation()
    ```
"""

import base64
import hashlib
import json
import logging
import os
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import List, Dict, Any, Optional, Literal, Set
from pathlib import Path

import chromadb
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.services.aws_bedrock_service import AWSBedrockService
from app.services.document_processor import extract_text_for_chat_attachment
from app.services.vector_store_service import VectorStoreService

logger = logging.getLogger(__name__)

LARGE_ATTACHMENT_THRESHOLD = 30_000
ATTACHMENT_CHUNK_SIZE = 1500
ATTACHMENT_CHUNK_OVERLAP = 200
ATTACHMENT_RETRIEVAL_K = 8


@dataclass
class ChatAttachment:
    """Represents an attachment in the chat context."""
    name: str
    content: str  # Text content or base64 for images
    content_type: str  # MIME type
    is_image: bool = False
    added_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ChatAttachment':
        return cls(**data)


@dataclass
class ChatMessage:
    """Represents a single message in the conversation."""
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: str = field(default_factory=lambda: datetime.now().isoformat())
    model_used: Optional[str] = None
    attachments: List[str] = field(default_factory=list)  # Attachment names
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'ChatMessage':
        return cls(**data)


@dataclass
class TicketContext:
    """Represents a Jira ticket in the conversation context."""
    ticket_id: str
    summary: str
    description: str
    content: str  # Full formatted content
    metadata: Dict[str, Any] = field(default_factory=dict)
    added_at: str = field(default_factory=lambda: datetime.now().isoformat())
    
    def to_dict(self) -> dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: dict) -> 'TicketContext':
        return cls(**data)


class ChatService:
    """
    Service for managing conversational AI interactions for ticket analysis.
    
    This service provides:
    - Multi-turn conversation management
    - Multi-ticket context support
    - Attachment handling (text and images)
    - Dynamic model switching
    - RAG integration for knowledge base queries
    - Conversation persistence and export
    
    Attributes:
        aws_service: AWS Bedrock service for LLM access
        vector_store: Vector store service for RAG (optional)
        messages: List of conversation messages
        tickets: Dict of loaded tickets by ID
        attachments: List of attachments
        use_rag: Whether to use RAG for context retrieval
    """
    
    # System prompt for ticket analysis
    SYSTEM_PROMPT = """You are an expert technical analyst helping team members understand and analyze Jira tickets. Your role is to:

1. **For Developers**: Provide technical breakdowns, identify edge cases, suggest implementation approaches, and highlight potential issues.

2. **For QA Engineers**: Identify test scenarios, risk areas, and validation points.

3. **For Tech Leads**: Assess complexity, identify dependencies, and spot gaps in requirements.

4. **For Product Owners**: Summarize technical implications and clarify requirements.

You have access to:
- Jira ticket details (summary, description, acceptance criteria, comments)
- Any attached files (logs, documents, code, images)
- Knowledge base context (if available)

Guidelines:
- Be specific and actionable in your responses
- Reference specific parts of tickets or attachments when relevant
- Ask clarifying questions if needed
- Highlight risks, edge cases, and missing information
- Format responses clearly with markdown

{context}"""

    QUICK_ACTIONS = {
        "summarize": "Provide a concise summary of this ticket for a developer, highlighting the key technical requirements and acceptance criteria.",
        "find_gaps": "Analyze this ticket and identify what information is missing, unclear, or ambiguous. What questions should be asked before starting work?",
        "risk_analysis": "What are the potential risks, challenges, and things that could go wrong with this ticket? Consider technical debt, dependencies, and edge cases.",
        "technical_details": "Break down the technical requirements and implementation considerations for this ticket. What components are affected? What's the suggested approach?",
        "test_suggestions": "What test scenarios should be covered for this ticket? Include happy path, negative cases, and edge cases.",
        "clarify_ac": "Expand and clarify the acceptance criteria. What specific behaviors should be verified? What are the boundary conditions?",
        "definition_of_done": "Provide a Definition of Done checklist for this ticket: what must be true before it can be considered complete? Include code, tests, docs, and review criteria.",
        "dependencies_blockers": "Identify dependencies (other tickets, systems, or teams) and potential blockers for this ticket. What needs to be in place before or during work?",
    }

    def __init__(
        self,
        aws_service: AWSBedrockService,
        vector_store: Optional[VectorStoreService] = None,
        use_rag: bool = True,
        embedding_function: Any = None,
    ):
        """
        Initialize the ChatService.
        
        Args:
            aws_service: AWS Bedrock service for LLM access
            vector_store: Optional vector store for RAG
            use_rag: Whether to use RAG for context retrieval
            embedding_function: Shared embedding function for indexing large attachments
        """
        self.aws_service = aws_service
        self.vector_store = vector_store
        self.use_rag = use_rag and vector_store is not None
        
        self.messages: List[ChatMessage] = []
        self.tickets: Dict[str, TicketContext] = {}
        self.attachments: List[ChatAttachment] = []
        self.conversation_id: str = datetime.now().strftime("%Y%m%d_%H%M%S")

        self._embedding_function = embedding_function
        self._indexed_attachments: Set[str] = set()
        self._attachment_splitter = RecursiveCharacterTextSplitter(
            chunk_size=ATTACHMENT_CHUNK_SIZE,
            chunk_overlap=ATTACHMENT_CHUNK_OVERLAP,
        )
        self._attachment_chroma_client: Optional[Any] = None
        self._attachment_collection: Optional[Any] = None
        if embedding_function is not None:
            self._init_attachment_store()

    def _init_attachment_store(self) -> None:
        """Create an ephemeral in-memory ChromaDB collection for large attachment chunks."""
        try:
            self._attachment_chroma_client = chromadb.Client()
            col_name = f"att_{self.conversation_id}"[:63]
            self._attachment_collection = self._attachment_chroma_client.get_or_create_collection(name=col_name)
        except Exception as exc:
            logger.warning("Could not create in-memory attachment store: %s", exc)
            self._attachment_collection = None

    def _index_attachment(self, name: str, text: str) -> bool:
        """Chunk, embed, and store a large attachment for semantic retrieval."""
        if self._attachment_collection is None or self._embedding_function is None:
            return False
        try:
            chunks = self._attachment_splitter.split_text(text)
            if not chunks:
                return False
            ids = [
                hashlib.sha256(f"{name}::{i}::{c[:64]}".encode()).hexdigest()[:24]
                for i, c in enumerate(chunks)
            ]
            metas = [{"attachment": name, "chunk_index": i} for i in range(len(chunks))]
            embeddings = self._embedding_function.embed_documents(chunks)
            self._attachment_collection.add(
                embeddings=embeddings,
                documents=chunks,
                metadatas=metas,
                ids=ids,
            )
            self._indexed_attachments.add(name)
            logger.info("Indexed attachment '%s': %d chunks", name, len(chunks))
            return True
        except Exception as exc:
            logger.warning("Failed to index attachment '%s': %s", name, exc)
            return False

    def _remove_indexed_attachment(self, name: str) -> None:
        """Remove all chunks for a given attachment from the store."""
        if name not in self._indexed_attachments or self._attachment_collection is None:
            return
        try:
            self._attachment_collection.delete(where={"attachment": name})
        except Exception:
            pass
        self._indexed_attachments.discard(name)

    def _query_attachment_store(self, query: str, n_results: int = ATTACHMENT_RETRIEVAL_K) -> str:
        """Retrieve the most relevant attachment chunks for a given query."""
        if self._attachment_collection is None or self._embedding_function is None:
            return ""
        try:
            if self._attachment_collection.count() == 0:
                return ""
            query_embedding = self._embedding_function.embed_query(query)
            results = self._attachment_collection.query(
                query_embeddings=[query_embedding],
                n_results=min(n_results, self._attachment_collection.count()),
            )
            docs = results.get("documents", [[]])[0]
            metas = results.get("metadatas", [[]])[0]
            if not docs:
                return ""
            sections: List[str] = []
            for doc, meta in zip(docs, metas):
                att_name = meta.get("attachment", "")
                sections.append(f"[From: {att_name}]\n{doc}")
            return "\n---\n".join(sections)
        except Exception as exc:
            logger.warning("Attachment store query failed: %s", exc)
            return ""

    # ==========================================================================
    # CONTEXT MANAGEMENT
    # ==========================================================================
    
    def add_ticket(self, ticket_id: str, ticket_details: Dict[str, Any]) -> None:
        """
        Add a Jira ticket to the conversation context.
        
        Args:
            ticket_id: Jira ticket ID (e.g., "PROJ-123")
            ticket_details: Ticket details dict with 'text' and 'meta' keys
        """
        context = TicketContext(
            ticket_id=ticket_id,
            summary=ticket_details.get('meta', {}).get('title', ''),
            description=ticket_details.get('text', ''),
            content=ticket_details.get('text', ''),
            metadata=ticket_details.get('meta', {})
        )
        self.tickets[ticket_id] = context
        
        # Add system notification
        self._add_system_message(f"Loaded ticket {ticket_id}: {context.summary}")
    
    def remove_ticket(self, ticket_id: str, clear_history: bool = False) -> bool:
        """
        Remove a ticket from the conversation context.
        
        Args:
            ticket_id: Ticket ID to remove
            clear_history: If True, clears conversation history related to this ticket
            
        Returns:
            True if ticket was removed, False if not found
        """
        if ticket_id in self.tickets:
            del self.tickets[ticket_id]
            
            if clear_history:
                # Clear all conversation history when removing ticket
                self.messages.clear()
                self._add_system_message(
                    f"🔄 Ticket {ticket_id} removed and conversation cleared. "
                    "Ready for new context."
                )
            else:
                # Add explicit instruction for LLM to ignore old ticket
                self._add_system_message(
                    f"⚠️ IMPORTANT: Ticket {ticket_id} has been REMOVED from context. "
                    "Do NOT reference or use any information from this ticket in future responses. "
                    "Only use currently loaded tickets."
                )
            return True
        return False
    
    def add_attachment(
        self,
        name: str,
        content: Any,
        content_type: str
    ) -> ChatAttachment:
        """
        Add an attachment to the conversation context.
        
        Args:
            name: Filename
            content: File content (bytes or string)
            content_type: MIME type
            
        Returns:
            Created ChatAttachment object
        """
        is_image = content_type.startswith('image/')
        
        if is_image:
            # Encode image as base64
            if isinstance(content, bytes):
                content_str = base64.b64encode(content).decode('utf-8')
            else:
                content_str = content
        else:
            if isinstance(content, bytes):
                extracted, used = extract_text_for_chat_attachment(name, content, content_type)
                content_str = extracted if used else content.decode('utf-8', errors='replace')
            else:
                content_str = str(content)
        
        attachment = ChatAttachment(
            name=name,
            content=content_str,
            content_type=content_type,
            is_image=is_image
        )
        self.attachments.append(attachment)

        if not is_image and len(content_str) > LARGE_ATTACHMENT_THRESHOLD:
            indexed = self._index_attachment(name, content_str)
            if indexed:
                self._add_system_message(
                    f"Added attachment: {name} ({len(content_str):,} chars, indexed for smart retrieval)"
                )
            else:
                self._add_system_message(f"Added attachment: {name}")
        else:
            self._add_system_message(f"Added attachment: {name}")
        return attachment
    
    def remove_attachment(self, name: str) -> bool:
        """Remove an attachment by name."""
        for i, att in enumerate(self.attachments):
            if att.name == name:
                self.attachments.pop(i)
                self._remove_indexed_attachment(name)
                self._add_system_message(f"Removed attachment: {name}")
                return True
        return False
    
    def clear_context(self) -> None:
        """Clear all tickets and attachments."""
        self.tickets.clear()
        self.attachments.clear()
        self._indexed_attachments.clear()
        if self._attachment_collection is not None:
            try:
                self._attachment_collection.delete(where={})
            except Exception:
                pass
        self._add_system_message("Cleared all context (tickets and attachments)")
    
    # ==========================================================================
    # CONVERSATION MANAGEMENT
    # ==========================================================================
    
    def send_message(
        self,
        user_message: str,
        include_attachments: Optional[List[str]] = None
    ) -> str:
        """
        Send a message and get AI response.
        
        Args:
            user_message: User's message
            include_attachments: Optional list of attachment names to include
            
        Returns:
            AI response text
        """
        # Record user message
        user_msg = ChatMessage(
            role="user",
            content=user_message,
            attachments=include_attachments or []
        )
        self.messages.append(user_msg)
        
        # Check if LLM is initialized
        if not self.aws_service.llm:
            error_msg = "⚠️ **Error:** LLM not initialized. Please check AWS configuration:\n\n1. Enter your AWS Profile name in the sidebar\n2. Or set AWS credentials via environment variables\n3. Click **Initialize** to reconnect"
            error_response = ChatMessage(
                role="assistant",
                content=error_msg
            )
            self.messages.append(error_response)
            return error_msg
        
        # Build context
        context_parts = self._build_context(include_attachments, user_query=user_message)
        
        # Get RAG context if enabled
        rag_context = ""
        if self.use_rag and self.vector_store:
            rag_context = self._get_rag_context(user_message)
            if rag_context:
                context_parts.append(f"\n**Knowledge Base Context:**\n{rag_context}")
        
        # Build system message with context
        system_content = self.SYSTEM_PROMPT.format(
            context="\n".join(context_parts) if context_parts else "No specific context loaded."
        )
        
        # Build message history for LLM
        llm_messages = [SystemMessage(content=system_content)]
        
        # Add conversation history (excluding system messages)
        for msg in self.messages:
            if msg.role == "user":
                llm_messages.append(HumanMessage(content=msg.content))
            elif msg.role == "assistant":
                llm_messages.append(AIMessage(content=msg.content))
        
        # Attach images to the last HumanMessage as multimodal content blocks
        image_attachments = [a for a in self.attachments if a.is_image]
        if image_attachments and llm_messages and isinstance(llm_messages[-1], HumanMessage):
            last_human = llm_messages[-1]
            content_blocks: list = [{"type": "text", "text": last_human.content}]
            for img_att in image_attachments:
                content_blocks.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{img_att.content_type};base64,{img_att.content}"
                    },
                })
            llm_messages[-1] = HumanMessage(content=content_blocks)
        
        try:
            # Get response from LLM
            response = self.aws_service.llm.invoke(llm_messages)
            response_text = response.content
            
            # Record assistant message
            assistant_msg = ChatMessage(
                role="assistant",
                content=response_text,
                model_used=self.aws_service.bedrock_model
            )
            self.messages.append(assistant_msg)
            
            return response_text
            
        except Exception as e:
            error_msg = f"⚠️ **Error generating response:**\n\n`{str(e)}`\n\nPlease check your AWS credentials and try again."
            # Add error as assistant message so it shows in chat
            error_response = ChatMessage(
                role="assistant",
                content=error_msg
            )
            self.messages.append(error_response)
            return error_msg
    
    def send_quick_action(self, action: str) -> str:
        """
        Send a pre-defined quick action prompt.
        
        Args:
            action: Action key from QUICK_ACTIONS
            
        Returns:
            AI response text
        """
        if action not in self.QUICK_ACTIONS:
            return f"Unknown action: {action}"
        
        prompt = self.QUICK_ACTIONS[action]
        return self.send_message(prompt)
    
    def _add_system_message(self, content: str) -> None:
        """Add a system notification message."""
        msg = ChatMessage(role="system", content=content)
        self.messages.append(msg)
    
    def _build_context(
        self,
        include_attachments: Optional[List[str]] = None,
        user_query: str = "",
    ) -> List[str]:
        """Build context string from tickets and attachments.

        Large text attachments that have been indexed are not included inline.
        Instead, the most relevant chunks are retrieved using *user_query*.
        """
        parts = []
        
        # Clearly state currently loaded tickets
        if self.tickets:
            ticket_ids = list(self.tickets.keys())
            parts.append(f"**⚠️ CURRENTLY LOADED TICKETS (ONLY use these):** {', '.join(ticket_ids)}")
            parts.append("Do NOT reference any tickets that are not in this list.\n")
            
            for ticket_id, ticket in self.tickets.items():
                parts.append(f"\n--- Ticket: {ticket_id} ---")
                parts.append(ticket.content)
        else:
            parts.append("**No tickets currently loaded.** Do not reference any previous tickets.")
        
        # Add text attachments — small ones inline, large indexed ones via retrieval
        text_attachments = [a for a in self.attachments if not a.is_image]
        inline_attachments = [
            a for a in text_attachments
            if a.name not in self._indexed_attachments
            and (include_attachments is None or a.name in include_attachments)
        ]
        indexed_names = [
            a.name for a in text_attachments
            if a.name in self._indexed_attachments
            and (include_attachments is None or a.name in include_attachments)
        ]

        if inline_attachments:
            parts.append("\n**Attached Documents:**")
            for att in inline_attachments:
                parts.append(f"\n--- {att.name} ({att.content_type}) ---")
                parts.append(att.content)

        if indexed_names and user_query:
            retrieved = self._query_attachment_store(user_query)
            if retrieved:
                parts.append(
                    f"\n**Relevant sections from large attached documents "
                    f"({', '.join(indexed_names)}):**"
                )
                parts.append(retrieved)
            else:
                parts.append(
                    f"\n**Large attached documents ({', '.join(indexed_names)}) "
                    f"are indexed but no sections matched the current query.**"
                )
        elif indexed_names:
            parts.append(
                f"\n**Large attached documents ({', '.join(indexed_names)}) are indexed. "
                f"Ask a question to retrieve relevant sections.**"
            )

        # Note image attachments so the LLM knows they exist
        image_attachments = [a for a in self.attachments if a.is_image]
        if image_attachments:
            names = ", ".join(a.name for a in image_attachments)
            parts.append(f"\n**Attached Images (included in the next user message):** {names}")

        return parts
    
    def _get_rag_context(self, query: str, n_results: int = 3) -> str:
        """Get relevant context from the knowledge base."""
        if not self.vector_store or self.vector_store.count() == 0:
            return ""
        
        results = self.vector_store.retrieve(query, n_results=n_results)
        documents = results.get('documents', [])
        
        if not documents:
            return ""
        
        return "\n---\n".join(documents)
    
    # ==========================================================================
    # MODEL MANAGEMENT
    # ==========================================================================
    
    def switch_model(self, model_id: str) -> bool:
        """
        Switch to a different LLM model.
        
        Args:
            model_id: New model ID
            
        Returns:
            True if switch was successful
        """
        success = self.aws_service.update_model_config(bedrock_model=model_id)
        if success:
            self._add_system_message(f"Switched to model: {model_id}")
        return success
    
    def get_current_model(self) -> str:
        """Get the current model ID."""
        return self.aws_service.bedrock_model
    
    # ==========================================================================
    # CONVERSATION HISTORY
    # ==========================================================================
    
    def clear_messages(self) -> None:
        """Clear conversation history but keep context."""
        self.messages.clear()
    
    def clear_all(self) -> None:
        """Clear everything - messages, tickets, and attachments."""
        self.messages.clear()
        self.tickets.clear()
        self.attachments.clear()
        self._indexed_attachments.clear()
        if self._attachment_collection is not None:
            try:
                self._attachment_collection.delete(where={})
            except Exception:
                pass
        self.conversation_id = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    def get_messages(self, include_system: bool = False) -> List[ChatMessage]:
        """Get conversation messages."""
        if include_system:
            return self.messages
        return [m for m in self.messages if m.role != "system"]
    
    def get_context_summary(self) -> Dict[str, Any]:
        """Get a summary of the current context."""
        return {
            "tickets": list(self.tickets.keys()),
            "attachments": [a.name for a in self.attachments],
            "message_count": len([m for m in self.messages if m.role != "system"]),
            "model": self.get_current_model(),
            "rag_enabled": self.use_rag
        }
    
    # ==========================================================================
    # EXPORT AND PERSISTENCE
    # ==========================================================================
    
    def export_conversation(self, format: Literal["markdown", "json"] = "markdown") -> str:
        """
        Export the conversation.
        
        Args:
            format: Export format ("markdown" or "json")
            
        Returns:
            Exported conversation as string
        """
        if format == "json":
            return self._export_json()
        return self._export_markdown()
    
    def _export_markdown(self) -> str:
        """Export conversation as markdown."""
        lines = [f"# Ticket Analysis Conversation\n"]
        lines.append(f"**Date:** {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        lines.append(f"**Conversation ID:** {self.conversation_id}\n")
        
        # Tickets
        if self.tickets:
            lines.append("\n## Loaded Tickets\n")
            for ticket_id, ticket in self.tickets.items():
                lines.append(f"- **{ticket_id}**: {ticket.summary}")
        
        # Attachments
        if self.attachments:
            lines.append("\n## Attachments\n")
            for att in self.attachments:
                lines.append(f"- {att.name} ({att.content_type})")
        
        # Conversation
        lines.append("\n## Conversation\n")
        for msg in self.messages:
            if msg.role == "system":
                lines.append(f"\n*[System: {msg.content}]*\n")
            elif msg.role == "user":
                lines.append(f"\n**User** ({msg.timestamp[:16].replace('T', ' ')}):\n")
                lines.append(msg.content)
                if msg.attachments:
                    lines.append(f"\n*Attached: {', '.join(msg.attachments)}*")
            else:
                model = f" [{msg.model_used}]" if msg.model_used else ""
                lines.append(f"\n**Assistant**{model} ({msg.timestamp[:16].replace('T', ' ')}):\n")
                lines.append(msg.content)
        
        return "\n".join(lines)
    
    def _export_json(self) -> str:
        """Export conversation as JSON."""
        data = {
            "conversation_id": self.conversation_id,
            "exported_at": datetime.now().isoformat(),
            "tickets": {k: v.to_dict() for k, v in self.tickets.items()},
            "attachments": [a.to_dict() for a in self.attachments],
            "messages": [m.to_dict() for m in self.messages],
            "model": self.get_current_model()
        }
        return json.dumps(data, indent=2)
    
    def to_dict(self) -> Dict[str, Any]:
        """Serialize the chat service state to a dictionary."""
        return {
            "conversation_id": self.conversation_id,
            "tickets": {k: v.to_dict() for k, v in self.tickets.items()},
            "attachments": [a.to_dict() for a in self.attachments],
            "messages": [m.to_dict() for m in self.messages],
            "use_rag": self.use_rag
        }
    
    def load_from_dict(self, data: Dict[str, Any]) -> None:
        """Load chat service state from a dictionary."""
        self.conversation_id = data.get("conversation_id", self.conversation_id)
        self.use_rag = data.get("use_rag", self.use_rag)
        
        self.tickets = {
            k: TicketContext.from_dict(v) 
            for k, v in data.get("tickets", {}).items()
        }
        self.attachments = [
            ChatAttachment.from_dict(a) 
            for a in data.get("attachments", [])
        ]
        self.messages = [
            ChatMessage.from_dict(m) 
            for m in data.get("messages", [])
        ]

        self._indexed_attachments.clear()
        if self._attachment_collection is not None:
            try:
                self._attachment_collection.delete(where={})
            except Exception:
                pass
        for att in self.attachments:
            if not att.is_image and len(att.content) > LARGE_ATTACHMENT_THRESHOLD:
                self._index_attachment(att.name, att.content)
