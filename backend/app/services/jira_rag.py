"""
JiraRAG - Main Orchestrator Module

This module provides the JiraRAG class, which serves as the main orchestrator
for the QA Assistant application. It coordinates all the individual services
to provide RAG-powered test case and test plan generation.

The JiraRAG class integrates:
    - AtlassianService: For Jira/Confluence operations
    - AWSBedrockService: For LLM-powered generation
    - VectorStoreService: For document storage and retrieval
    - DocumentProcessor: For processing uploaded files
    - TestCaseParser: For parsing generated test cases

Architecture:
    ```
    JiraRAG (Orchestrator)
        ├── AtlassianService (Jira + Confluence)
        ├── AWSBedrockService (LLM)
        ├── VectorStoreService (ChromaDB)
        ├── DocumentProcessor (File parsing)
        └── TestCaseParser (Test case parsing)
    ```

Example Usage:
    ```python
    from src.services.jira_rag import JiraRAG
    
    # Initialize with configuration
    rag = JiraRAG(
        jira_server="https://company.atlassian.net",
        jira_username="user@company.com",
        jira_api_token="your-api-token",
        aws_region="us-east-1"
    )
    
    # Populate knowledge base
    rag.populate_vector_db(ticket_ids, confluence_urls, uploaded_files)
    
    # Generate test cases
    test_cases = rag.generate_test_cases("PROJ-123", "BDD (Gherkin)")
    ```
"""

import json
import logging
import re
from typing import List, Optional, Dict, Any

from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

from app.config.settings import RAGConfig, AWSConfig, AtlassianConfig
from app.services.aws_bedrock_service import AWSBedrockService
from app.services.atlassian_service import AtlassianService
from app.services.vector_store_service import VectorStoreService
from app.services.document_processor import DocumentProcessor
from app.services.test_case_parser import TestCaseParser
from app.prompts.templates import PromptTemplates

logger = logging.getLogger(__name__)


class JiraRAG:
    """
    Main orchestrator class for RAG-powered QA Assistant.
    
    This class coordinates all service components to provide:
    - Test case generation from Jira tickets
    - Test plan generation from multiple sources
    - Knowledge base management
    - Document processing and retrieval
    
    The class follows the Facade pattern, providing a simple interface
    while delegating to specialized services internally.
    
    Attributes:
        atlassian (AtlassianService): Service for Jira/Confluence operations
        aws_service (AWSBedrockService): Service for LLM operations
        vector_store (VectorStoreService): Service for document storage
        doc_processor (DocumentProcessor): Service for file processing
        test_parser (TestCaseParser): Service for test case parsing
    """

    def __init__(
        self,
        jira_server: str,
        jira_username: str,
        jira_api_token: str,
        aws_region: str = "us-east-1",
        aws_profile: str = None,
        persist_directory: str = "data/chroma",
        chunk_size: int = 1000,
        chunk_overlap: int = 150,
        top_k: int = 4,
        bedrock_model: str = "anthropic.claude-3-sonnet-20240229-v1:0",
        temperature: float = 0.8,
        inference_profile_id: Optional[str] = None,
        shared_embedding_function: Optional[Any] = None,
    ):
        """
        Initialize the JiraRAG orchestrator with all required services.
        
        Args:
            jira_server: Atlassian server URL (e.g., "https://company.atlassian.net")
            jira_username: Atlassian username (email)
            jira_api_token: Atlassian API token
            aws_region: AWS region for Bedrock (default: "us-east-1")
            aws_profile: AWS CLI profile name (optional)
            persist_directory: Directory for vector store persistence
            chunk_size: Size of text chunks for embedding
            chunk_overlap: Overlap between adjacent chunks
            top_k: Number of similar documents to retrieve
            bedrock_model: AWS Bedrock model ID
            temperature: LLM temperature setting
            inference_profile_id: Optional inference profile ID/ARN (use when model does not support on-demand)
            shared_embedding_function: Optional shared embedding (embed_documents, embed_query) for scaling.
        """
        self._shared_embedding_function = shared_embedding_function
        # Create configuration objects
        self._atlassian_config = AtlassianConfig(
            server_url=jira_server,
            username=jira_username,
            api_token=jira_api_token
        )
        
        self._aws_config = AWSConfig(
            region=aws_region,
            profile=aws_profile,
            model_id=bedrock_model,
            temperature=temperature,
            inference_profile_id=inference_profile_id.strip() if inference_profile_id else None,
        )
        
        self._rag_config = RAGConfig(
            chunk_size=int(chunk_size),
            chunk_overlap=int(chunk_overlap),
            top_k=int(top_k),
            persist_directory=persist_directory
        )
        
        # Initialize all services
        self._init_services()
    
    def _init_services(self) -> None:
        """Initialize all service components."""
        # Atlassian service (Jira + Confluence)
        self.atlassian = AtlassianService(self._atlassian_config)
        
        # AWS Bedrock service (LLM). Use inference profile ID when set (for models that require it).
        effective_model = self._aws_config.inference_profile_id or self._aws_config.model_id
        self._aws_service = AWSBedrockService(
            aws_region=self._aws_config.region,
            aws_profile=self._aws_config.profile,
            bedrock_model=effective_model,
            temperature=self._aws_config.temperature,
            max_tokens=self._aws_config.max_tokens
        )
        
        # Vector store service (ChromaDB); use shared embedding when provided for scaling
        self.vector_store = VectorStoreService(
            self._rag_config,
            embedding_function=self._shared_embedding_function,
        )
        
        # Document processor
        self.doc_processor = DocumentProcessor(self._rag_config)
        
        # Test case parser
        self.test_parser = TestCaseParser()
        logger.info(
            "JiraRAG initialized region=%s model=%s persist=%s",
            self._aws_config.region, self._aws_config.model_id, self._rag_config.persist_directory,
        )

    # ==========================================================================
    # PROPERTIES FOR BACKWARD COMPATIBILITY
    # ==========================================================================
    
    @property
    def llm(self):
        """Get the LLM instance from the AWS Bedrock service."""
        return self._aws_service.llm if self._aws_service else None
    
    @property
    def aws_service(self) -> AWSBedrockService:
        """Get the AWS Bedrock service instance."""
        return self._aws_service

    @property
    def current_bedrock_model_id(self) -> Optional[str]:
        """Return the model ID or inference profile ID currently used for Bedrock."""
        return self._aws_service.bedrock_model if self._aws_service else None

    def switch_model(self, model_id: str) -> bool:
        """
        Switch the Bedrock model without re-initializing the whole RAG instance.
        Returns True if the switch succeeded.
        """
        if not self._aws_service:
            return False
        return self._aws_service.update_model_config(bedrock_model=model_id)

    @property
    def jira_client(self):
        """Get the Jira client (backward compatibility)."""
        return self.atlassian.jira_client
    
    @property
    def confluence_client(self):
        """Get the Confluence client (backward compatibility)."""
        return self.atlassian.confluence_client

    def get_connection_settings(self) -> dict:
        """Return current connection settings for UI pre-fill (no API token)."""
        return {
            "jira_server": getattr(self._atlassian_config, "server_url", "") or "",
            "jira_username": getattr(self._atlassian_config, "username", "") or "",
            "aws_region": getattr(self._aws_config, "region", "") or "us-east-1",
            "aws_profile": getattr(self._aws_config, "profile", "") or "",
        }
    
    @property
    def collection(self):
        """Get the ChromaDB collection (backward compatibility)."""
        return self.vector_store.collection
    
    # ==========================================================================
    # KNOWLEDGE BASE OPERATIONS
    # ==========================================================================
    
    def populate_vector_db(
        self,
        example_ticket_ids: List[str],
        confluence_page_urls: List[str],
        uploaded_files
    ) -> None:
        """
        Populate the vector database from multiple sources.
        
        This method gathers documents from:
        - Uploaded files (PDF, DOCX, TXT, MD)
        - Jira tickets
        - Confluence pages
        
        Args:
            example_ticket_ids: List of Jira ticket IDs or URLs
            confluence_page_urls: List of Confluence page URLs
            uploaded_files: Streamlit uploaded file objects
        """
        source_docs = []
        
        # Process uploaded files
        source_docs.extend(self.doc_processor.process_uploaded_files(uploaded_files))
        
        # Fetch Jira tickets
        for ticket_id in example_ticket_ids:
            if ticket_id:
                clean_id = AtlassianService.extract_ticket_id_from_url(ticket_id)
                details = self.atlassian.get_jira_ticket_details(clean_id)
                if details:
                    source_docs.append(details)
        
        # Fetch Confluence pages
        for url in confluence_page_urls:
            if url:
                page_id = AtlassianService.extract_page_id_from_url(url)
                if page_id:
                    content = self.atlassian.get_confluence_page_content(page_id)
                    if content:
                        source_docs.append(content)
                else:
                    pass  # Could not extract page ID from URL
        
        if not source_docs:
            return
        
        # Prepare chunks and add to vector store
        chunks, metas, ids = self.doc_processor.prepare_chunks_for_storage(source_docs)
        self.vector_store.add_documents(chunks, metas, ids)
    
    def clear_kb(self) -> None:
        """Clear the entire knowledge base."""
        self.vector_store.clear()

    def get_kb_sources(self) -> List[Dict[str, str]]:
        """Return unique sources (source_type, title, url) currently in the knowledge base."""
        metadatas = self.vector_store.get_all_metadatas()
        seen: set = set()
        sources: List[Dict[str, str]] = []
        for m in metadatas:
            if not m:
                continue
            st = (m.get("source_type") or "unknown")
            title = (m.get("title") or "").strip() or "Untitled"
            url = (m.get("url") or "") or ""
            key = (st, title, url)
            if key not in seen:
                seen.add(key)
                sources.append({"source_type": st, "title": title, "url": url})
        return sources

    def retrieve_context(self, query_text: str) -> str:
        """
        Retrieve relevant context from the vector database.
        
        Args:
            query_text: Query text to search for
            
        Returns:
            Concatenated relevant documents
        """
        return self.vector_store.retrieve_as_context(
            query_text,
            n_results=self._rag_config.top_k
        )
    
    # ==========================================================================
    # JIRA/CONFLUENCE DELEGATIONS (Backward Compatibility)
    # ==========================================================================
    
    def get_jira_ticket_details(self, ticket_id: str):
        """Fetch Jira ticket details (delegates to AtlassianService)."""
        return self.atlassian.get_jira_ticket_details(ticket_id)
    
    def get_confluence_page_content(self, page_id: str):
        """Fetch Confluence page content (delegates to AtlassianService)."""
        return self.atlassian.get_confluence_page_content(page_id)
    
    def create_xray_test(
        self,
        test_case: dict,
        project_key: str,
        output_format: str = "Xray Jira Test Format",
    ) -> Optional[str]:
        """Create a test in Jira Xray (delegates to AtlassianService)."""
        return self.atlassian.create_xray_test(test_case, project_key, output_format)

    @property
    def _embed_fn(self):
        """Return the shared embedding function for semantic duplicate matching, or None."""
        if self._shared_embedding_function is not None:
            return self._shared_embedding_function.embed_documents
        return None

    def find_existing_xray_test(
        self,
        project_key: str,
        test_case: dict,
        output_format: str,
    ) -> dict:
        return self.atlassian.find_existing_xray_test(
            project_key, test_case, output_format, embed_fn=self._embed_fn,
        )

    def check_xray_duplicates(
        self,
        project_key: str,
        test_cases: List[dict],
        output_format: str,
    ) -> List[dict]:
        return self.atlassian.check_xray_duplicates(
            project_key, test_cases, output_format, embed_fn=self._embed_fn,
        )

    def bulk_create_xray_tests(
        self,
        test_cases: List[dict],
        project_key: str,
        output_format: str = "Xray Jira Test Format",
        skip_if_duplicate: bool = False,
    ) -> dict:
        """Returns ``created_keys`` and ``skipped_duplicates``."""
        return self.atlassian.bulk_create_xray_tests(
            test_cases, project_key, output_format, skip_if_duplicate,
            embed_fn=self._embed_fn,
        )
    
    def publish_test_plan_to_confluence(self, space_key: str, title: str, markdown_body: str) -> str:
        """Publish test plan to Confluence (delegates to AtlassianService)."""
        return self.atlassian.publish_to_confluence(space_key, title, markdown_body)
    
    # ==========================================================================
    # TEST CASE GENERATION
    # ==========================================================================
    
    def generate_test_cases(
        self,
        ticket_id: str,
        output_format: str,
        use_knowledge_base: bool = True,
        source_type: str = "jira",
        user_instructions: Optional[str] = None,
    ) -> str:
        """
        Generate test cases from a Jira ticket or a Confluence page, optionally using RAG context.

        Args:
            ticket_id: Jira ticket ID/URL, or Confluence page ID/URL (depending on source_type)
            output_format: Output format ('BDD (Gherkin)' or 'Xray Jira Test Format')
            use_knowledge_base: If True, retrieve context from the knowledge base. If False,
                generate from the requirement source only.
            source_type: 'jira' (default) or 'confluence'. When 'confluence', ticket_id is
                interpreted as Confluence page ID or page URL.
            user_instructions: Optional instructions to follow when generating (e.g. consider
                accessibility, performance, edge cases). Ignored if empty.

        Returns:
            Generated test cases as text
        """
        if not self.llm:
            return "LLM not initialized."

        if source_type == "confluence":
            page_id = AtlassianService.extract_page_id_from_url(ticket_id) or ticket_id.strip()
            details_obj = self.atlassian.get_confluence_page_content(page_id)
            if not details_obj:
                return "Could not fetch Confluence page content."
        else:
            details_obj = self.atlassian.get_jira_ticket_details(ticket_id)
            if not details_obj:
                return "Could not fetch Jira ticket details."

        requirement_text = details_obj["text"]
        instructions_text = (user_instructions or "").strip() or "None"

        # Get the appropriate prompt template (includes {user_instructions})
        template = PromptTemplates.get_test_case_prompt(output_format)
        prompt = PromptTemplate(
            template=template,
            input_variables=["context", "jira_ticket", "user_instructions"],
        )

        if use_knowledge_base:
            rag_chain = (
                {
                    "context": lambda x: self.retrieve_context(x["jira_ticket"]),
                    "jira_ticket": lambda x: x["jira_ticket"],
                    "user_instructions": lambda x: x["user_instructions"],
                }
                | prompt
                | self.llm
                | StrOutputParser()
            )
        else:
            no_context = "None. Generate test cases based only on the requirement source below."
            rag_chain = (
                {
                    "context": lambda _: no_context,
                    "jira_ticket": lambda x: x["jira_ticket"],
                    "user_instructions": lambda x: x["user_instructions"],
                }
                | prompt
                | self.llm
                | StrOutputParser()
            )

        return rag_chain.invoke({
            "jira_ticket": requirement_text,
            "user_instructions": instructions_text,
        })
    
    def parse_test_cases(self, test_cases_text: str, output_format: str) -> List[dict]:
        """
        Parse generated test cases into structured objects.
        
        Args:
            test_cases_text: Raw generated text
            output_format: Format of the test cases
            
        Returns:
            List of test case dictionaries
        """
        return self.test_parser.parse(test_cases_text, output_format)
    
    def refine_single_test_case(self, test_case: str, output_format: str, feedback: str) -> dict:
        """
        Refine a single test case based on user feedback.
        
        Args:
            test_case: Current test case content
            output_format: Format of the test case
            feedback: User feedback for refinement
            
        Returns:
            Dict with 'refined_content' and optional 'confidence' score
        """
        if not self.llm:
            return {"refined_content": test_case, "confidence": None}
        
        prompt = PromptTemplate(
            template=PromptTemplates.SINGLE_TEST_CASE_REFINEMENT,
            input_variables=["test_case", "feedback"]
        )
        
        refine_chain = prompt | self.llm | StrOutputParser()
        raw = refine_chain.invoke({"test_case": test_case, "feedback": feedback})

        content, confidence, reason = self._extract_single_confidence(raw)
        return {
            "refined_content": content,
            "confidence": confidence,
            "confidence_reason": reason,
        }

    @staticmethod
    def _extract_single_confidence(raw: str):
        """Extract a trailing CONFIDENCE: N (reason) line from single-test refinement output."""
        pattern = re.compile(
            r'(?m)^\s*\*{0,2}\s*CONFIDENCE\s*:?\s*\*{0,2}\s*:?\s*(\d)\s*(?:\(([^)]*)\))?\s*$'
        )
        lines = raw.rstrip().split('\n')
        confidence = None
        reason = None
        cut_index = len(lines)
        for i in range(len(lines) - 1, max(len(lines) - 6, -1), -1):
            m = pattern.match(lines[i])
            if m:
                score = int(m.group(1))
                confidence = max(1, min(5, score))
                reason = (m.group(2) or "").strip() or None
                cut_index = i
                break
        content = '\n'.join(lines[:cut_index]).rstrip()
        return content, confidence, reason

    def review_test_case_quality(self, title: str, content: str, output_format: str) -> Dict[str, Any]:
        """Score a single test case on clarity, completeness, edge_cases, structure (1–5 each + overall)."""
        if not self.llm:
            return {"overall": 0, "error": "LLM not initialized"}
        prompt = PromptTemplate(
            template=PromptTemplates.QUALITY_REVIEW_TEMPLATE,
            input_variables=["title", "content", "output_format"],
        )
        chain = prompt | self.llm | StrOutputParser()
        raw = chain.invoke({"title": title, "content": content, "output_format": output_format})
        # Strip markdown fences if the model wraps the JSON
        cleaned = re.sub(r"^```(?:json)?\s*", "", raw.strip())
        cleaned = re.sub(r"\s*```$", "", cleaned)
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            logger.warning("Quality review returned non-JSON: %s", raw[:200])
            return {"overall": 0, "error": "Failed to parse quality review", "raw": raw[:500]}

    def refine_test_cases(self, current_tests: str, output_format: str, feedback: str) -> str:
        """
        Refine all test cases based on user feedback.
        
        Args:
            current_tests: Current test cases content
            output_format: Format of the test cases
            feedback: User feedback for refinement
            
        Returns:
            Refined test cases content
        """
        if not self.llm:
            return current_tests
        
        format_guard = PromptTemplates.get_format_guard(output_format)
        
        prompt = PromptTemplate(
            template=PromptTemplates.BULK_REFINEMENT_TEMPLATE,
            input_variables=["system", "current", "feedback", "guard"]
        )
        
        chain = prompt | self.llm | StrOutputParser()
        return chain.invoke({
            "system": PromptTemplates.BULK_TEST_CASE_REFINEMENT_SYSTEM,
            "current": current_tests,
            "feedback": feedback,
            "guard": format_guard,
        })
    
    def split_xray_test_cases(self, text: str) -> List[tuple]:
        """
        Split Xray formatted text into individual test cases.
        
        Args:
            text: Xray format text
            
        Returns:
            List of (title, content) tuples
        """
        return self.test_parser.split_xray_test_cases(text)
    
    # ==========================================================================
    # TEST PLAN GENERATION
    # ==========================================================================
    
    def generate_test_plan(
        self,
        initiative_pages: List[str],
        design_pages: List[str],
        other_req_pages: List[str],
        jira_ticket_ids: List[str],
        uploaded_files,
        sample_template_page_url: Optional[str],
        plan_prompt: Optional[str],
    ) -> str:
        """
        Generate a comprehensive test plan using provided sources.
        
        Args:
            initiative_pages: Confluence URLs for initiative requirements
            design_pages: Confluence URLs for design documents
            other_req_pages: Confluence URLs for other requirements
            jira_ticket_ids: Related Jira ticket IDs
            uploaded_files: Uploaded documentation files
            sample_template_page_url: Optional sample template URL for style guidance
            plan_prompt: Optional additional instructions
            
        Returns:
            Generated test plan as markdown
        """
        if not self.llm:
            return "LLM not initialized."
        
        # Populate knowledge base with provided sources
        all_pages = initiative_pages + design_pages + other_req_pages
        self.populate_vector_db(jira_ticket_ids, all_pages, uploaded_files)
        
        # Build style hint from sample template
        style_hint = self._get_style_hint(sample_template_page_url)
        
        user_requirements = plan_prompt or ""
        
        # Get prompt template
        template = PromptTemplates.get_test_plan_prompt(style_hint)
        prompt = PromptTemplate(template=template, input_variables=["context", "user_requirements"])
        
        # Build and execute chain
        chain = (
            {
                "context": lambda x: self.retrieve_context(x),
                "user_requirements": RunnablePassthrough()
            }
            | prompt
            | self.llm
            | StrOutputParser()
        )
        
        return chain.invoke(user_requirements)
    
    def _get_style_hint(self, sample_template_page_url: Optional[str]) -> str:
        """Get style hint from sample template page."""
        if not sample_template_page_url:
            return ""
        
        try:
            page_id = AtlassianService.extract_page_id_from_url(sample_template_page_url)
            if page_id:
                title = self.atlassian.get_confluence_page_title(page_id)
                return PromptTemplates.get_style_hint_from_title(title or "")
            return PromptTemplates.get_style_hint_from_title("")
        except Exception:
            return PromptTemplates.get_style_hint_from_title("")
    
    def refine_test_plan(self, current_plan: str, feedback: str) -> str:
        """
        Refine a test plan based on user feedback.
        
        Args:
            current_plan: Current test plan content
            feedback: User feedback for refinement
            
        Returns:
            Refined test plan content
        """
        if not self.llm:
            return current_plan
        
        prompt = PromptTemplate(
            template=PromptTemplates.TEST_PLAN_REFINEMENT_TEMPLATE,
            input_variables=["system", "current", "feedback"]
        )
        
        chain = prompt | self.llm | StrOutputParser()
        return chain.invoke({
            "system": PromptTemplates.TEST_PLAN_REFINEMENT_SYSTEM,
            "current": current_plan,
            "feedback": feedback,
        })
