# QA Assistant – Architecture Diagram

The diagrams below are written in **Mermaid**. To see them as pictures instead of code:

1. **VS Code / Cursor**  
   - Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`), run **“Markdown: Open Preview”** to open the preview for this file.  
   - If you still only see code, install the extension **“Markdown Preview Mermaid Support”** (by Matt Bierner), then open the preview again. The diagrams will render in the preview pane.

2. **GitHub**  
   - Push this repo and open `docs/architecture-diagram.md` on GitHub. Mermaid is rendered automatically in markdown files.

3. **Online editor**  
   - Copy the contents of a ` ```mermaid ` block (without the backticks) into [mermaid.live](https://mermaid.live) to view or export the diagram.

## System overview

```mermaid
flowchart TB
  subgraph browser [Browser]
    Angular["Angular 18 SPA (port 4200)"]
    Config[Config]
    KB[Knowledge Base]
    TA[Ticket Analyzer]
    TC[Test Cases]
    TP[Test Plan]
    Angular --> Config
    Angular --> KB
    Angular --> TA
    Angular --> TC
    Angular --> TP
  end

  subgraph frontend_services [Frontend services]
    ApiService[ApiService]
    InitService[InitService]
  end

  Angular --> ApiService
  Config --> InitService
  ApiService -->|"GET/POST /api/* withCredentials"| Backend

  subgraph backend ["FastAPI Backend (port 8000)"]
    Middleware[SessionMiddleware + CORS]
    Routes[API Routes]
    SessionState["Per-session state - sid"]
    ThreadPool[Thread pool + semaphore]
    Middleware --> Routes
    Routes --> SessionState
    Routes --> ThreadPool
  end

  SessionState --> RAG[JiraRAG]
  SessionState --> Chat[ChatService]
  SessionState --> ConvStore[ConversationStore]

  subgraph jira_rag [JiraRAG orchestrator]
    RAG --> Atlassian[AtlassianService]
    RAG --> Bedrock[AWSBedrockService]
    RAG --> VectorStore[VectorStoreService]
    RAG --> DocProc[DocumentProcessor]
    RAG --> Parser[TestCaseParser]
  end

  Chat --> Bedrock
  Chat --> VectorStore

  subgraph shared [Shared]
    EmbeddingService[EmbeddingService]
  end

  VectorStore --> EmbeddingService

  Atlassian -->|"REST"| JiraAPI[Jira API]
  Atlassian -->|"REST"| ConfluenceAPI[Confluence API]
  Bedrock -->|"invoke"| AWSBedrock[AWS Bedrock LLM]
  VectorStore -->|"persist"| ChromaDB[(ChromaDB per session)]
  ConvStore -->|"JSON files"| FS["data/conversations/sid/"]
```

## Request flow (API groups → external systems)

```mermaid
flowchart TB
  subgraph api_groups [API groups]
    Health["Health / init"]
    ConfigAPI["Config / test connection"]
    KBAPI["Knowledge base"]
    ChatAPI[Chat]
    ConvoAPI[Conversations]
    TestCaseAPI["Test cases"]
    TestPlanAPI["Test plan"]
    ExportAPI[Export]
  end

  subgraph external [External systems]
    Jira[Jira / Confluence]
    BedrockExt[AWS Bedrock]
    Chroma[ChromaDB]
  end

  Health --> SessionStore["Session store"]
  ConfigAPI --> SessionStore
  KBAPI --> Jira
  KBAPI --> BedrockExt
  KBAPI --> Chroma
  ChatAPI --> BedrockExt
  ChatAPI --> Chroma
  ConvoAPI --> SessionStore
  TestCaseAPI --> Jira
  TestCaseAPI --> BedrockExt
  TestCaseAPI --> Chroma
  TestPlanAPI --> Jira
  TestPlanAPI --> BedrockExt
  ExportAPI --> BedrockExt
```

## Test cases: Xray duplicate check and publish

```mermaid
sequenceDiagram
  participant UI as TestCasesComponent
  participant API as FastAPI
  participant RAG as JiraRAG
  participant Atl as AtlassianService
  participant Jira as Jira REST

  UI->>API: POST /api/test-cases/check-xray-duplicates
  API->>RAG: check_xray_duplicates(project, cases, format)
  RAG->>Atl: find_existing_xray_test (per case)
  Atl->>Jira: search_issues (JQL + normalized summary match)
  Jira-->>Atl: candidates
  Atl-->>RAG: existing key or none
  RAG-->>API: results[]
  API-->>UI: is_duplicate, existing_issue_key, summary_used

  UI->>API: POST write-to-xray-selected (skip_if_duplicate true)
  API->>RAG: bulk_create_xray_tests(...)
  RAG->>Atl: skip or create_issue
  Atl->>Jira: create issue (if not duplicate)
```

## Frontend: shared thinking overlay

```mermaid
flowchart LR
  subgraph pages [Routes using AiThinkingOverlay]
    TC[Test Cases]
    TP[Test Plan]
    TA[Ticket Analyzer]
    KB[Knowledge Base]
    CFG[Config]
    DASH[Dashboard]
  end
  OV[app-ai-thinking-overlay]
  TC --> OV
  TP --> OV
  TA --> OV
  KB --> OV
  CFG --> OV
  DASH --> OV
```
