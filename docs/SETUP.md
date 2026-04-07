# Fresh Machine Setup Guide

Step-by-step instructions to set up and run the QA Assistant on a brand-new machine (Windows, macOS, or Linux).

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the Repository](#2-clone-the-repository)
3. [Backend Setup](#3-backend-setup)
4. [Frontend Setup](#4-frontend-setup)
5. [AWS CLI Configuration](#5-aws-cli-configuration)
6. [Atlassian API Token](#6-atlassian-api-token)
7. [Start the Application](#7-start-the-application)
8. [First-Time App Configuration](#8-first-time-app-configuration)
9. [Verify Everything Works](#9-verify-everything-works)
10. [Environment Variables Reference](#10-environment-variables-reference)
11. [Accessing from Another Machine on the Network](#11-accessing-from-another-machine-on-the-network)
12. [Production Deployment](#12-production-deployment)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Prerequisites

Install the following software before proceeding.

| Software | Version | Purpose | Installation |
|----------|---------|---------|-------------|
| **Python** | 3.9 or higher | Backend (FastAPI) | [python.org/downloads](https://www.python.org/downloads/) — check "Add to PATH" during install |
| **Node.js** | 18 or higher | Frontend (Angular 18) | [nodejs.org](https://nodejs.org/) — LTS recommended |
| **npm** | Bundled with Node.js | Package management | Comes with Node.js |
| **Git** | Any recent version | Clone the repository | [git-scm.com](https://git-scm.com/) |
| **AWS CLI** | v2 | Authenticate with AWS Bedrock | [AWS CLI install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) |

### Verify installations

Open a terminal and run:

```bash
python --version    # Should print Python 3.9+
node --version      # Should print v18+
npm --version       # Should print 8+
git --version       # Should print git version 2.x+
aws --version       # Should print aws-cli/2.x+
```

> **Windows note:** If `python` is not recognized, try `python3` or `py`. Ensure Python is on your system PATH.

---

## 2. Clone the Repository

```bash
git clone https://github.com/sunnydas1992/AI_Assistant_Angular.git
cd AI_Assistant_Angular
```

---

## 3. Backend Setup

### 3.1 Create a Python virtual environment

```bash
cd backend
python -m venv venv
```

### 3.2 Activate the virtual environment

| OS | Command |
|----|---------|
| **Windows (CMD)** | `venv\Scripts\activate` |
| **Windows (PowerShell)** | `venv\Scripts\Activate.ps1` |
| **macOS / Linux** | `source venv/bin/activate` |

You should see `(venv)` in your terminal prompt.

### 3.3 Install Python dependencies

```bash
pip install -r requirements.txt
```

This installs FastAPI, Uvicorn, LangChain, ChromaDB, boto3, Jira/Confluence clients, sentence-transformers, and other required packages. The first run will also download the default embedding model (`all-MiniLM-L6-v2`, ~90 MB).

### 3.4 Go back to the project root

```bash
cd ..
```

---

## 4. Frontend Setup

### 4.1 Install Angular dependencies

```bash
cd frontend
npm install
```

### 4.2 (Optional) Install root-level dependencies

If you want to use the combined `npm start` command from the project root:

```bash
cd ..
npm install
```

This installs `concurrently`, which runs the backend and frontend together.

---

## 5. AWS CLI Configuration

AWS Bedrock is used for LLM-powered test generation. You need an AWS CLI profile with access to Bedrock.

### 5.1 Configure an AWS profile

If you haven't already set one up:

```bash
aws configure --profile your-profile-name
```

Enter your AWS Access Key ID, Secret Access Key, default region (e.g. `us-east-1`), and output format when prompted.

### 5.2 If using AWS SSO

```bash
aws configure sso --profile your-profile-name
```

Follow the prompts to complete SSO setup.

### 5.3 Login before using the app

Every time your session expires, re-authenticate:

```bash
aws sso login --profile your-profile-name
```

> **Important:** The AWS profile name you configure here is what you'll enter in the app's Configuration page. The profile must have permissions to invoke Amazon Bedrock models (e.g. `bedrock:InvokeModel`, `bedrock:ListFoundationModels`).

---

## 6. Atlassian API Token

The app connects to Jira and Confluence to read tickets, pages, and publish test cases/plans.

### 6.1 Generate an API token

1. Go to [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Give it a label (e.g. "QA Assistant")
4. Click **Create** and **copy the token** — you won't see it again

### 6.2 What you'll need for the app

| Field | Example |
|-------|---------|
| **Jira / Confluence URL** | `https://your-domain.atlassian.net` |
| **Atlassian Username** | Your email (e.g. `user@company.com`) |
| **API Token** | The token you copied above |

---

## 7. Start the Application

Choose one of three methods. All start the backend on **port 8000** and the frontend on **port 4200**.

### Option A: Combined start from project root (recommended)

```bash
# From the project root (AI_Assistant_Angular/)
npm start
```

This uses `concurrently` to run both the backend and frontend in one terminal. Requires root-level `npm install` to have been done (Step 4.2).

### Option B: Windows batch files

Two batch files are provided at the project root:

| File | What it does |
|------|-------------|
| `run-backend-only.bat` | Starts **only the backend** in the current window so you can see startup logs and errors directly. Use this first if `run.bat` results in `ECONNREFUSED` — wait for "Uvicorn running", then start the frontend manually. |
| `run.bat` | Starts **both** backend and frontend in two separate windows. The backend launches first, waits 5 seconds, then the frontend starts. |

**Recommended approach:** Run both files in this order:

1. **Double-click `run-backend-only.bat`** — watch the terminal until you see `Uvicorn running on http://0.0.0.0:8000`. This confirms the backend is ready and lets you see any errors immediately.
2. **Double-click `run.bat`** — this opens two more windows (a second backend instance + frontend). Since port 8000 is already taken by step 1, the second backend will fail harmlessly, and the frontend window will start on port 4200 connected to the backend from step 1.

Alternatively, use **just `run.bat`** on its own — it starts both in separate windows automatically. Use `run-backend-only.bat` only when you need to debug backend startup issues.

### Option C: Start each manually (in separate terminals)

**Terminal 1 — Backend:**

```bash
cd backend
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS/Linux
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Wait until you see: `Uvicorn running on http://0.0.0.0:8000`

**Terminal 2 — Frontend:**

```bash
cd frontend
npm start
```

Wait until you see: `Compiled successfully` or `Angular Live Development Server is listening on localhost:4200`

### Verify servers are running

- Backend health check: open [http://localhost:8000/api/health](http://localhost:8000/api/health) — should return `{"status":"ok"}`
- Frontend: open [http://localhost:4200](http://localhost:4200)

The Angular dev server automatically proxies all `/api` requests to the backend at `http://localhost:8000` (configured in `frontend/proxy.conf.json`).

---

## 8. First-Time App Configuration

When you open `http://localhost:4200` for the first time, you'll be redirected to the **Configuration** page. All other pages are locked until initialization is complete.

### 8.1 Enter connection settings

Fill in the following fields:

| Field | What to enter |
|-------|---------------|
| **Jira / Confluence URL** | Your Atlassian instance URL (e.g. `https://your-domain.atlassian.net`) |
| **Atlassian Username (Email)** | Your Atlassian account email |
| **Atlassian API Token** | The API token generated in Step 6 |
| **AWS Profile** | The AWS CLI profile name from Step 5 (e.g. `default` or `your-profile-name`) |

### 8.2 Test the connection (optional but recommended)

Click **Test Connection**. The app will check connectivity to:
- **Jira** — verifies the URL and credentials
- **Confluence** — verifies Confluence access via the same URL
- **Bedrock** — verifies the AWS profile can reach Bedrock

All three should show **OK**. If Bedrock fails, ensure you ran `aws sso login --profile <name>` recently.

### 8.3 Initialize

Click **Initialize**. This:
1. Connects to Jira and Confluence with your credentials
2. Sets up the RAG pipeline (ChromaDB vector store, embedding model)
3. Initializes the AWS Bedrock LLM client
4. Creates a session-scoped data directory for conversations and vector storage

A success message confirms when the system is ready.

### 8.4 Select an AI model (Advanced Settings)

After successful initialization, **Advanced Settings** unlock on the Configuration page:

| Setting | Default | Description |
|---------|---------|-------------|
| **Vector Store Directory** | `data/chroma` | Where ChromaDB stores embeddings |
| **Chunk Size** | 1000 | Document chunk size for RAG |
| **Chunk Overlap** | 150 | Overlap between chunks |
| **Top-K Results** | 4 | Number of similar documents to retrieve |
| **Bedrock Model** | (dropdown) | Choose the LLM model (e.g. Claude Sonnet) |
| **Temperature** | 0.8 | LLM creativity (0 = deterministic, 1 = creative) |
| **Inference Profile ID** | (optional) | For custom Bedrock inference profiles |

Select a **Bedrock Model** from the dropdown. This model will be used across the entire app (test case generation, ticket analysis, test plans).

### 8.5 Navigate to the app

Once initialized, the sidebar navigation unlocks:
- **Home** — Dashboard with quick links
- **Knowledge Base** — Add Jira tickets, Confluence pages, and files for RAG context
- **Ticket Analyzer** — Load a ticket and chat with AI
- **Test Cases** — Generate, refine, and publish test cases
- **Test Plan** — Generate and publish test plans

---

## 9. Verify Everything Works

Run through this quick smoke test:

1. **Knowledge Base**: Click "Knowledge Base" in the sidebar. Try adding a Jira ticket ID — the app should fetch and index it.
2. **Test Cases**: Click "Test Cases". Enter a Jira ticket ID, choose an output format (BDD or Xray), and click "Generate Test Cases". You should see generated test cases with confidence scores.
3. **Ticket Analyzer**: Click "Ticket Analyzer". Enter a ticket ID, click "Load". Use quick actions like "Summarize" to verify the AI chat works. Each assistant response has a **Copy** button (copies content to clipboard) and a **Post to Jira** button (opens a preview overlay where you can review and edit the comment before posting it to the Jira ticket).

---

## 10. Environment Variables Reference

All environment variables are optional — sensible defaults are built in. Set these in your terminal or a `.env` file in the `backend/` directory before starting the backend.

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `SESSION_SECRET_KEY` | Dev fallback string | **Set in production.** Secret for signing session cookies |
| `LOG_LEVEL` | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

### Performance and Scaling

| Variable | Default | Description |
|----------|---------|-------------|
| `QA_THREAD_POOL_SIZE` | `64` | Worker threads for async operations |
| `QA_HEAVY_CONCURRENCY` | `30` | Max concurrent heavy API calls (generation, refinement) |
| `QA_SESSION_TTL` | `14400` (4h) | Idle session time-to-live in seconds |
| `QA_SESSION_MAX_COUNT` | `150` | Maximum concurrent sessions |
| `QA_SESSION_EVICTION_INTERVAL` | `300` | Session cleanup interval in seconds |
| `QA_RATE_LIMIT_REQUESTS` | `60` | Max requests per rate-limit window per session |
| `QA_RATE_LIMIT_WINDOW` | `60` | Rate-limit window in seconds |

### AWS Bedrock

| Variable | Default | Description |
|----------|---------|-------------|
| `QA_BEDROCK_READ_TIMEOUT` | `120` | Bedrock API read timeout in seconds |
| `QA_BEDROCK_CONNECT_TIMEOUT` | `10` | Bedrock API connect timeout in seconds |
| `QA_BEDROCK_MODELS_CACHE_TTL` | `300` | Cache TTL for Bedrock model list in seconds |

### Embeddings

| Variable | Default | Description |
|----------|---------|-------------|
| `QA_EMBEDDING_MODEL` | `all-MiniLM-L6-v2` | SentenceTransformer model for document embeddings |

### Xray and Duplicate Detection

| Variable | Default | Description |
|----------|---------|-------------|
| `XRAY_TEST_ISSUE_TYPE_NAME` | `Test` | Jira issue type name for Xray tests |
| `XRAY_TEST_ISSUE_TYPE_ID` | (none) | Jira issue type ID (overrides name lookup) |
| `XRAY_CLOUD_CLIENT_ID` | (none) | Xray Cloud API client ID |
| `XRAY_CLOUD_CLIENT_SECRET` | (none) | Xray Cloud API client secret |
| `XRAY_CLOUD_BASE_URL` | (none) | Xray Cloud API base URL |
| `XRAY_STEP_PUSH_MODE` | (none) | How test steps are pushed to Xray |

> **Duplicate detection** uses a two-pass strategy: (1) exact normalized match (casefold + whitespace collapse), (2) semantic similarity using the same sentence-transformer embedding model (`all-MiniLM-L6-v2`) with a default cosine similarity threshold of **0.80** (80%). This threshold is defined in `backend/app/services/xray_duplicate.py` as `SEMANTIC_SIMILARITY_THRESHOLD` and can be adjusted to be more or less strict. The UI shows "Duplicate" for exact matches and "Similar (N%)" for semantic matches.

---

## 11. Accessing from Another Machine on the Network

To use the app from a different computer on the same network:

### On the host machine (running the app)

1. Start the backend with network binding:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

2. Start the frontend with network binding:
   ```bash
   cd frontend
   npm run start:network
   ```

3. Find your IP address:
   - **Windows:** Run `ipconfig` — look for the **IPv4 Address** (e.g. `192.168.1.100`)
   - **macOS/Linux:** Run `ip addr` or `ifconfig`

4. **Open firewall ports** (Windows). Run PowerShell as Administrator:
   ```powershell
   cd AI_Assistant_Angular\scripts
   .\allow-ports-firewall.ps1
   ```
   Or manually allow inbound TCP on ports **4200** and **8000**.

### On the other machine

Open a browser and go to `http://<host-IP>:4200` (e.g. `http://192.168.1.100:4200`).

Each user/browser must complete their own **Configuration → Initialize** — sessions are independent.

---

## 12. Production Deployment

| Concern | Recommendation |
|---------|---------------|
| **Session secret** | Set `SESSION_SECRET_KEY` to a strong random string |
| **Backend** | `uvicorn main:app --host 0.0.0.0 --port 8000` (no `--reload`) |
| **Frontend** | `cd frontend && npm run build` — serve `dist/frontend/` via Nginx, Apache, or a CDN |
| **API base URL** | Update `API_BASE` in `frontend/src/app/api.service.ts` if the backend is on a different origin |
| **Authentication** | There is no built-in auth. Place a reverse proxy or SSO gateway in front of the app |
| **HTTPS** | Use a reverse proxy (Nginx, Caddy) with TLS certificates |
| **Workers** | Use one Uvicorn worker (sessions are in-memory); for multi-worker scaling, add an external session store first |
| **Recommended host** | Minimum 4 GB RAM, 2 CPU cores for ~100 concurrent users |

---

## 13. Troubleshooting

### Backend won't start

- **`ModuleNotFoundError`**: Virtual environment not activated. Run `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (macOS/Linux) first.
- **Port 8000 in use**: Another process is using the port. Kill it or use a different port: `uvicorn main:app --port 8001`.

### Frontend won't start

- **`ng: command not found`**: Run `npm install` in the `frontend/` folder first.
- **Port 4200 in use**: Angular will prompt to use a different port, or kill the existing process.

### "Initialize" fails

- **Jira/Confluence fails**: Verify the URL format is `https://your-domain.atlassian.net` (no trailing slash). Confirm the API token is correct and not expired.
- **Bedrock fails**: Run `aws sso login --profile <name>` in your terminal. Ensure the profile has Bedrock permissions in the configured region.
- **Timeout**: The first initialization downloads the embedding model (~90 MB). This may take a minute on slow connections.

### Test Connection shows Bedrock "Failed"

- Your AWS SSO session likely expired. Run `aws sso login --profile <name>` and retry.
- Confirm your AWS account/region has Bedrock model access enabled (some models require opt-in in the AWS Console under Bedrock → Model access).

### Other machines can't connect

- Ensure both backend and frontend are started with `--host 0.0.0.0`.
- Check that Windows Firewall allows inbound TCP on ports 4200 and 8000.
- Verify both machines are on the same network and can ping each other.

### Logs

- **Backend logs**: `backend/logs/qa_assistant.log` and terminal output.
- **Frontend logs**: Open browser DevTools → Console. Look for entries prefixed with `[QA Assistant]`.
