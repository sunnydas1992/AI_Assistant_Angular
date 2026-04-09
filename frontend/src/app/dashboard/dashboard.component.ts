import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AiThinkingOverlayComponent } from '../ai-thinking-overlay/ai-thinking-overlay.component';
import { ApiService } from '../api.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, AiThinkingOverlayComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">Home</h1>
      <p class="page-subtitle">Quick access to QA Assistant workflows.</p>
      @if (sessionInitialized) {
        <div class="current-model-strip" [attr.title]="modelId || null">
          <span class="model-strip-label">LLM In Use</span>
          @if (modelLoading) {
            <span class="model-strip-value model-strip-loading">Loading…</span>
          } @else {
            <span class="model-strip-value">{{ modelDisplay }}</span>
          }
        </div>
      } @else {
        <p class="init-model-hint"><a routerLink="/config">Initialize</a> in Configuration to connect Jira, Confluence, and your LLM.</p>
      }
    </header>

    <div class="dashboard-cards">
      @if (modelLoading) {
        @for (i of [1,2,3,4]; track i) {
          <div class="card shortcut-card skeleton-card-wrap">
            <div class="skeleton skeleton-line medium"></div>
            <div class="skeleton skeleton-line"></div>
            <div class="skeleton skeleton-line short"></div>
          </div>
        }
      } @else {
        <a routerLink="/ticket-analyzer" class="card shortcut-card">
          <h2>Ticket Analyzer</h2>
          <p>Load Jira tickets, chat with AI, and use quick actions (summarize, gaps, risks, test ideas).</p>
          <span class="card-link">Open Ticket Analyzer →</span>
        </a>
        <a routerLink="/test-cases" class="card shortcut-card">
          <h2>Generate Test Cases</h2>
          <p>Generate test cases from a Jira ticket or Confluence page. Edit, refine, and publish to Xray.</p>
          <span class="card-link">Open Test Cases →</span>
        </a>
        <a routerLink="/test-plan" class="card shortcut-card">
          <h2>Test Plan</h2>
          <p>Create a test plan from Confluence pages, Jira tickets, and uploads. Publish to Confluence.</p>
          <span class="card-link">Open Test Plan →</span>
        </a>
        <a routerLink="/knowledge-base" class="card shortcut-card">
          <h2>Knowledge Base</h2>
          <p>Add Jira tickets, Confluence pages, and documents to improve RAG context for generation.</p>
          @if (kbCount !== null) {
            <p class="kb-badge">KB: {{ kbCount }} chunks</p>
          }
          <span class="card-link">Open Knowledge Base →</span>
        </a>
      }
    </div>

    <div class="dashboard-footer">
      <p>To change connection settings or model, go to <a routerLink="/config">Configuration</a>.</p>
    </div>

    <app-ai-thinking-overlay
      [open]="modelLoading"
      title="Loading Model Details"
      subtitle="Resolving your current LLM name…"
      [stepLabels]="dashboardModelSteps"
    />
  `,
  styles: [`
    .page-header { margin-bottom: var(--space-lg); }
    .page-title { margin: 0 0 var(--space-xs); }
    .page-subtitle { margin: 0; font-size: 0.9rem; color: var(--app-text-muted); }
    .current-model-strip {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 0.5rem 0.75rem;
      margin-top: var(--space-md);
      padding: 0.55rem 0.85rem;
      background: var(--app-surface-muted);
      border: 1px solid var(--app-card-border);
      border-radius: var(--radius-md);
      max-width: 42rem;
      animation: stripSlideIn 0.4s cubic-bezier(0.22,1,0.36,1) 0.1s both;
    }
    @keyframes stripSlideIn {
      from { opacity: 0; transform: translateX(-12px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    .model-strip-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--app-text-muted);
    }
    .model-strip-value {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--app-text);
      word-break: break-word;
    }
    .model-strip-loading { color: var(--app-text-muted); font-weight: 500; }
    .init-model-hint {
      margin: var(--space-md) 0 0;
      font-size: 0.88rem;
      color: var(--app-text-muted);
    }
    .init-model-hint a { font-weight: 600; }
    .dashboard-cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: var(--space-lg);
      margin-bottom: var(--space-xl);
    }
    .shortcut-card {
      display: block;
      padding: var(--space-lg);
      text-decoration: none;
      color: inherit;
      border-radius: var(--radius-md);
      border: 1px solid var(--app-card-border);
      transition: box-shadow 0.35s cubic-bezier(0.22,1,0.36,1),
                  border-color 0.3s ease,
                  transform 0.35s cubic-bezier(0.22,1,0.36,1);
      animation: dashCardEnter 0.45s cubic-bezier(0.22,1,0.36,1) both;
      position: relative;
      overflow: hidden;
    }
    .shortcut-card::before {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(135deg, transparent 60%, rgba(19,234,193,0.06) 100%);
      opacity: 0;
      transition: opacity 0.3s ease;
      pointer-events: none;
    }
    .shortcut-card:hover::before { opacity: 1; }
    .shortcut-card:hover {
      box-shadow: var(--shadow-card-hover), 0 0 24px rgba(82,161,255,0.08);
      border-color: rgba(82,161,255,0.35);
      transform: translateY(-3px);
    }
    .dashboard-cards .shortcut-card:nth-child(1) { animation-delay: 0.05s; }
    .dashboard-cards .shortcut-card:nth-child(2) { animation-delay: 0.12s; }
    .dashboard-cards .shortcut-card:nth-child(3) { animation-delay: 0.19s; }
    .dashboard-cards .shortcut-card:nth-child(4) { animation-delay: 0.26s; }
    @keyframes dashCardEnter {
      from { opacity: 0; transform: translateY(16px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .shortcut-card h2 { font-size: 1rem; margin: 0 0 var(--space-sm); color: var(--app-text); }
    .shortcut-card p { font-size: 0.9rem; margin: 0 0 var(--space-sm); color: var(--app-text-muted); line-height: 1.4; }
    .kb-badge { font-size: 0.8rem; color: var(--app-text-muted); margin-bottom: var(--space-xs) !important; }
    .card-link {
      font-size: 0.85rem; font-weight: 600; color: var(--hyland-blue);
      transition: letter-spacing 0.3s ease, color 0.2s ease;
    }
    .shortcut-card:hover .card-link { letter-spacing: 0.03em; color: var(--hyland-teal); }
    .skeleton-card-wrap { padding: var(--space-lg); min-height: 100px; cursor: default; }
    .skeleton-card-wrap:hover { transform: none; box-shadow: var(--shadow-card); }
    .dashboard-footer { font-size: 0.9rem; color: var(--app-text-muted); }
    .dashboard-footer a { color: var(--hyland-blue); }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-delay: 0s !important;
        transition-duration: 0.01ms !important;
      }
    }
  `],
})
export class DashboardComponent implements OnInit {
  readonly dashboardModelSteps = [
    'Reading session',
    'Fetching Bedrock catalog',
    'Matching your model',
    'Almost done',
  ];

  kbCount: number | null = null;
  sessionInitialized = false;
  modelLoading = false;
  /** Friendly name from Bedrock list, or raw model id. */
  modelDisplay = '';
  /** Raw model id for tooltip when resolved name differs or for power users. */
  modelId = '';

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.get<{ count?: number }>('/kb/count').subscribe({
      next: (res) => { this.kbCount = res?.count ?? 0; },
      error: () => { this.kbCount = null; },
    });

    this.api.get<{ initialized?: boolean; current_model_id?: string | null }>('/init-status').subscribe({
      next: (res) => {
        this.sessionInitialized = !!res?.initialized;
        const id = (res?.current_model_id ?? '').toString().trim();
        this.modelId = id;
        if (!this.sessionInitialized) {
          return;
        }
        if (!id) {
          this.modelDisplay = 'Not set — choose a model in Configuration';
          return;
        }
        this.modelLoading = true;
        this.api.get<{ models: Record<string, string> }>('/bedrock-models').subscribe({
          next: (bm) => {
            const models = bm?.models ?? {};
            const found = Object.entries(models).find(([, v]) => String(v) === id);
            this.modelDisplay = found ? String(found[0]) : id;
            this.modelLoading = false;
          },
          error: () => {
            this.modelDisplay = id;
            this.modelLoading = false;
          },
        });
      },
      error: () => {
        this.sessionInitialized = false;
      },
    });
  }
}
