# QA Assistant – Hyland (Angular + FastAPI)

AI-powered QA Assistant for Jira with **Hyland branding**: analyze tickets, generate test plans, and create test cases using RAG and AWS Bedrock. This repo contains a **FastAPI backend** and an **Angular 18** frontend.

## Features

- **Configuration**: Jira/Confluence URL, credentials, AWS profile and region. **Session-scoped**: each browser or device must initialize with its own credentials; access from another system or browser requires initializing again.
- **Knowledge base**: Populate from Jira tickets, Confluence URLs, and uploaded files (PDF, DOCX, TXT, MD).
- **Ticket analyzer**: Load tickets and chat with AI (quick actions: summarize, find gaps, risk analysis, test suggestions). AI model defaults to the one selected in Configuration.
- **Test cases**: Generate from a Jira ticket or Confluence page (BDD Gherkin or Xray format). You can provide **optional instructions** before generating (e.g. consider accessibility tests, performance, edge cases). Optional RAG; **refine all** test cases with global feedback or **refine a single** test case with per-item feedback; **AI confidence scores** (1–5) per test case with a **human-in-the-loop guardrail**: cases with confidence below 3 are flagged "Needs Review" and must be explicitly approved by the user before they can be published; **Check Xray for duplicates** — two-pass detection: (1) exact normalized match, (2) **semantic similarity** via sentence embeddings (cosine similarity ≥ 80%) with match type and similarity score badges; publish skips duplicate summaries by default; edit and select which to publish; write selected or all test cases to **Jira Xray**; export to Excel. Long-running actions show a shared **thinking** overlay (progress steps) across Test Cases, Test Plan, Ticket Analyzer, Knowledge Base, Configuration, and Home.
- **Test plan**: Generate from Confluence URLs, Jira tickets, and uploads; refine with feedback; publish to Confluence.

## Tech stack

- **Backend**: Python 3.9+, FastAPI, Starlette session middleware, JiraRAG, ChromaDB, LangChain, AWS Bedrock.
- **Frontend**: Angular 18, standalone components, Hyland theme (Figtree, Source Sans 3, brand colors).

## Prerequisites

- Python 3.9+
- Node.js 18+
- **Jira and Confluence** API access (URL, username, API token).
- **AWS**: CLI configured with a **profile** (e.g. `aws sso login --profile your-profile`). AWS profile is required for initialization.

## Setup

### One-time setup

**Backend**
```bash
cd backend
python -m venv venv
venv\Scripts\activate   # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

**Frontend**
```bash
cd frontend
npm install
```

### Run both together

From the project root (`AI_Assistant_Angular`):

| Method | Command |
|--------|--------|
| **PowerShell** | `.\run.ps1` |
| **Command Prompt** | `run.bat` |
| **npm (root)** | `npm install` then `npm start` |

- Backend runs on port 8000; frontend on 4200 and proxies `/api` to the backend.
- Open **http://localhost:4200**. Go to **Configuration**, enter Jira/Confluence URL, username, API token, and **AWS profile**, then click **Initialize**. A success popup confirms when the system is ready.

### Run separately

**Backend**
```bash
cd backend
venv\Scripts\activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend** (in another terminal)
```bash
cd frontend
npm start
```

Open http://localhost:4200. The dev server proxies `/api` to http://localhost:8000.

### Accessing from another machine

To use the app from a different computer on the same network (e.g. another laptop or desktop):

1. **On the machine that runs the app (host):**
   - **Backend:** Start with `uvicorn main:app --reload --host 0.0.0.0 --port 8000` so it listens on all interfaces (not only localhost).
   - **Frontend:** Start with `npm run start:network` (from the `frontend` folder), which runs `ng serve --host 0.0.0.0` so the dev server accepts connections from other machines.
   - Find the host’s IP address:
     - **Windows:** `ipconfig` → use the **IPv4 Address** (e.g. `192.168.1.100`) of the adapter used for your network (Wi‑Fi or Ethernet).
     - **macOS/Linux:** `ip addr` or `ifconfig` → use the inet address of your LAN interface.

2. **On the other machine:**  
   In a browser, open **http://\<host-IP\>:4200** (e.g. `http://192.168.1.100:4200`).  
   The frontend will load from the host; `/api` requests are proxied to the backend on the host, so no extra configuration is needed.

3. **Firewall (required for “other machine” access):** Windows Firewall often blocks inbound connections. On the **host** (machine running the app), run in **PowerShell as Administrator**:
   ```powershell
   cd AI_Assistant_Angular\scripts
   .\allow-ports-firewall.ps1
   ```
   Or add rules manually: allow **inbound TCP** on ports **4200** and **8000** (e.g. Windows Defender Firewall → Advanced settings → Inbound Rules → New Rule → Port → TCP, 4200 and 8000 → Allow).

Each user (each browser/machine) has its own session and must complete **Configuration → Initialize** with their own credentials.

### Production

- **Backend**: run `uvicorn main:app --host 0.0.0.0 --port 8000` (no `--reload`). Set **`SESSION_SECRET_KEY`** in the environment to a strong secret for session cookie signing.
- **Frontend**: run `npm run build` and serve the `dist/frontend` output; set the API base URL to your backend (e.g. via environment or `ApiService`’s `API_BASE`).

### Performance and scaling (~100 concurrent users)

For ~100 concurrent users on a **single host**, the backend uses a **shared embedding model**, a **custom thread pool** (env: `QA_THREAD_POOL_SIZE`, default 64), a **semaphore** for heavy endpoints (`QA_HEAVY_CONCURRENCY`, default 30), **session eviction** (TTL `QA_SESSION_TTL`, max count `QA_SESSION_MAX_COUNT`), **Bedrock model list cache** (`QA_BEDROCK_MODELS_CACHE_TTL`), **rate limiting** per session (`QA_RATE_LIMIT_REQUESTS` / `QA_RATE_LIMIT_WINDOW`), and **Bedrock timeouts** (`QA_BEDROCK_READ_TIMEOUT`, `QA_BEDROCK_CONNECT_TIMEOUT`). Use **one Uvicorn worker** with in-memory sessions; for multiple workers/nodes, add an external session store first. Recommended minimum host: 4 GB RAM, 2 CPU.

## Session management

- Initialization is **per session** (per browser/device). A session is identified by a cookie (`qa_session`).
- If you open the app in a **different browser or on another machine**, you must go to Configuration and **Initialize** again with the required details; that session will then have its own RAG, chat, and conversation store.
- Knowledge Base, Ticket Analyzer, Test Cases, and Test Plan are disabled until the current session is initialized; the app redirects to Configuration when needed.

## Configuration

On the **Configuration** page you must provide:

- **Jira / Confluence URL** (e.g. `https://your-domain.atlassian.net`)
- **Atlassian username** (email) and **API token**
- **AWS profile** (e.g. `default`) and **AWS region**

After a successful init, **Advanced settings** unlock (vector store path, chunk size, **LLM model**, temperature, etc.). The model chosen there is used as the default on the Ticket Analyzer page.

## Hyland branding

- **Typography**: Figtree (headings), Source Sans 3 (body), from Google Fonts.
- **Colors**: Hyland Dark Blue, Blue, Purple, Teal, Yellow, Grey (see `frontend/src/styles.scss`).
- **Logo**: Place Hyland logos in `frontend/src/assets/images/`; the app uses the horizontal dark blue logo when available.

## Auth

SSO (e.g. Atlassian) is planned; there is no user authentication today. Session cookies only scope initialization per browser. Do not expose the backend without proper auth in production.

## Logging

- **Backend**: Logs are written to **`backend/logs/qa_assistant.log`** and to the console. Events logged include startup/shutdown, init requests (success/failure), API errors (with tracebacks), and key operations (knowledge base populate, test case generate/refine, write-to-Xray, test plan generate/publish). Set **`LOG_LEVEL`** (e.g. `DEBUG`) in the environment to increase verbosity. The `logs/` directory is listed in `.gitignore`.
- **Frontend**: The app uses a `LoggerService` that writes to the browser console with a `[QA Assistant]` prefix (debug, info, warn, error). Use DevTools → Console to inspect init, API, and navigation events when debugging.

## Testing (backend)

```bash
cd backend
python -m pytest tests/ -v
```

Includes unit tests for Xray duplicate summary logic and semantic similarity (`tests/test_xray_duplicate.py`).

## Project layout

```
AI_Assistant_Angular/
├── backend/
│   ├── main.py           # FastAPI app, session middleware, API routes
│   ├── requirements.txt
│   ├── tests/            # e.g. test_xray_duplicate.py (pytest)
│   ├── logs/             # qa_assistant.log (created at runtime; in .gitignore)
│   └── app/
│       ├── config/       # RAG, AWS, Atlassian config, logging
│       ├── prompts/      # LLM templates
│       ├── services/     # JiraRAG, chat, vector store, Atlassian, xray_duplicate, etc.
│       └── export/       # Excel, JSON, Markdown export
├── docs/
│   ├── ARCHITECTURE.md           # System architecture (frontend, backend, sessions, services)
│   ├── architecture-diagram.md   # Mermaid diagrams (see also diagram.md)
│   └── diagram.md                # Diagram index / Xray flow
├── frontend/
│   ├── src/
│   │   ├── app/          # Components, routes, API service, init guard, ai-thinking-overlay
│   │   ├── assets/       # Images (e.g. Hyland logos)
│   │   └── styles.scss   # Hyland theme
│   ├── angular.json
│   └── package.json
└── README.md
```

## License

Internal use; follow your organization’s policies.
