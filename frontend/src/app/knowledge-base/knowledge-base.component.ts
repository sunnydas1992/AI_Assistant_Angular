import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AiThinkingOverlayComponent } from '../ai-thinking-overlay/ai-thinking-overlay.component';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';

@Component({
  selector: 'app-knowledge-base',
  standalone: true,
  imports: [CommonModule, FormsModule, AiThinkingOverlayComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">Knowledge Base</h1>
      <p class="page-subtitle">Add Jira tickets, Confluence pages, and documents to the RAG knowledge base.</p>
    </header>

    <div class="card kb-card">
      <div class="form-group">
        <label>Jira Ticket IDs (Comma-Separated)</label>
        <input [(ngModel)]="ticketIds" placeholder="PROJ-123, PROJ-456" />
      </div>
      <div class="form-group">
        <label>Confluence Page URLs (Comma-Separated)</label>
        <input [(ngModel)]="confluenceUrls" placeholder="https://.../wiki/..." />
      </div>
      <div class="form-group">
        <label>Upload Files (PDF, DOCX, TXT, MD)</label>
        <input type="file" multiple accept=".pdf,.txt,.md,.docx" (change)="onFiles($event)" #fileInput />
        <p class="hint">Accepted: PDF, DOCX, TXT, MD. Keep files under 20MB for best performance.</p>
        @if (selectedFiles.length) {
          <ul class="file-list">
            @for (f of selectedFiles; track f.name) { <li>{{ f.name }}</li> }
          </ul>
        }
      </div>

      <p class="hint add-hint">Populate <strong>adds</strong> to the existing knowledge base; it does not replace existing content. Use Clear KB to start over.</p>

      <div class="form-actions">
        <button class="primary" (click)="populate()" [disabled]="loading">
          {{ loading ? 'Populating…' : 'Populate Knowledge Base' }}
        </button>
        <button class="secondary" (click)="showClearConfirm = true" [disabled]="loading">Clear KB</button>
        <button type="button" class="secondary" (click)="loadSources()" [disabled]="loadingSources || kbCount === 0">
          {{ loadingSources ? 'Loading…' : 'View Contents' }}
        </button>
      </div>

      @if (kbCount !== null) {
        <p class="kb-size" title="Number of text chunks stored for RAG retrieval">KB size: <strong>{{ kbCount }}</strong> chunks</p>
      }
      @if (sources.length) {
        <div class="sources-list">
          <h3>Sources in Knowledge Base</h3>
          <ul>
            @for (s of sources; track s.title + s.source_type) {
              <li><span class="source-type">{{ s.source_type }}</span> {{ s.title }}{{ s.url ? ' — ' + s.url : '' }}</li>
            }
          </ul>
        </div>
      }
      @if (message) {
        <div class="message" [class.success]="messageOk" [class.error]="!messageOk">{{ message }}</div>
      }
    </div>

    @if (showClearConfirm) {
      <div class="card danger-zone">
        <h3>Clear Knowledge Base</h3>
        <p>This will permanently delete all vectors in the current collection. This action cannot be undone.</p>
        <label class="checkbox-label">
          <input type="checkbox" [(ngModel)]="clearConfirmed" />
          I understand this action cannot be undone.
        </label>
        <div class="form-actions">
          <button class="secondary" (click)="showClearConfirm = false; clearConfirmed = false">Cancel</button>
          <button class="danger" (click)="clear()" [disabled]="!clearConfirmed || loading">
            {{ loading ? 'Clearing…' : 'Clear Knowledge Base' }}
          </button>
        </div>
      </div>
    }

    <app-ai-thinking-overlay
      [open]="loading || loadingSources"
      [title]="kbThinkingTitle"
      [subtitle]="kbThinkingSubtitle"
      [stepLabels]="kbThinkingSteps"
    />
  `,
  styles: [`
    .page-header { margin-bottom: var(--space-lg); }
    .kb-card { max-width: 640px; padding: var(--space-lg) var(--space-xl); }
    .form-group label { display: block; font-weight: 600; }
    .hint { font-size: 0.8rem; color: var(--app-text-muted); margin-top: 0.25rem; }
    .add-hint { margin: 0.5rem 0 1rem; }
    .file-list { margin-top: var(--space-sm); padding-left: 1.25rem; font-size: 0.9rem; }
    .kb-size { margin-top: var(--space-md); font-size: 0.9rem; color: var(--app-text-muted); }
    .sources-list { margin-top: var(--space-md); padding: var(--space-md); background: var(--hyland-grey); border-radius: var(--radius-sm); }
    .sources-list h3 { font-size: 0.95rem; margin: 0 0 0.5rem; }
    .sources-list ul { margin: 0; padding-left: 1.25rem; font-size: 0.9rem; }
    .sources-list .source-type { font-weight: 600; margin-right: 0.5rem; }
    .message { margin-top: 1rem; padding: 0.75rem; border-radius: 6px; font-size: 0.95rem; }
    .message.success { background: rgba(19,234,193,0.15); border-left: 4px solid var(--hyland-teal); }
    .message.error { background: rgba(200,0,0,0.08); border-left: 4px solid #c00; }
    .danger-zone { max-width: 640px; margin-top: 1rem; border: 1px solid rgba(200,0,0,0.3); }
    .danger-zone h3 { color: #c00; margin-top: 0; }
    .checkbox-label { display: flex; align-items: center; gap: 0.5rem; margin: 0.75rem 0; cursor: pointer; }
    .danger { background: #c00; color: white; }
    .danger:hover:not(:disabled) { filter: brightness(1.1); }
    .danger:disabled { opacity: 0.6; }
  `],
})
export class KnowledgeBaseComponent implements OnInit {
  ticketIds = '';
  confluenceUrls = '';
  selectedFiles: File[] = [];
  loading = false;
  message = '';
  messageOk = false;
  kbCount: number | null = null;
  showClearConfirm = false;
  clearConfirmed = false;
  sources: { source_type: string; title: string; url: string }[] = [];
  loadingSources = false;

  constructor(private api: ApiService, private toast: ToastService) {}

  get kbThinkingTitle(): string {
    return this.loadingSources ? 'Loading knowledge base contents' : 'Updating knowledge base';
  }

  get kbThinkingSubtitle(): string {
    return this.loadingSources ? 'Fetching the source list from the server…' : 'Indexing documents and embeddings…';
  }

  get kbThinkingSteps(): string[] {
    if (this.loadingSources) {
      return ['Connecting to server', 'Loading source metadata', 'Building the list', 'Almost done'];
    }
    return ['Uploading and parsing files', 'Chunking text', 'Updating vector index', 'Refreshing counts'];
  }

  ngOnInit(): void {
    this.loadKbCount();
  }

  loadSources(): void {
    this.loadingSources = true;
    this.sources = [];
    this.api.get<{ sources?: { source_type: string; title: string; url: string }[] }>('/kb/sources').subscribe({
      next: (res) => {
        this.loadingSources = false;
        this.sources = res?.sources ?? [];
      },
      error: () => { this.loadingSources = false; },
    });
  }

  loadKbCount(): void {
    this.api.get<{ count?: number }>('/kb/count').subscribe({
      next: (res) => { this.kbCount = res?.count ?? 0; },
      error: () => { this.kbCount = null; },
    });
  }

  onFiles(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.selectedFiles = input.files ? Array.from(input.files) : [];
  }

  populate(): void {
    this.loading = true;
    this.message = '';
    const body: Record<string, unknown> = {
      ticket_ids: this.ticketIds,
      confluence_urls: this.confluenceUrls,
    };
    this.api.postFormWithFiles('/kb/populate', body, this.selectedFiles).subscribe({
      next: () => {
        this.loading = false;
        this.messageOk = true;
        this.message = 'Knowledge base populated.';
        this.toast.success('Knowledge base populated successfully.');
        this.loadKbCount();
      },
      error: (err) => {
        this.loading = false;
        this.toast.error(err?.error?.detail || 'Failed to populate.');
        this.message = err?.error?.detail || 'Failed.';
      },
    });
  }

  clear(): void {
    if (!this.clearConfirmed) return;
    this.loading = true;
    this.api.delete('/kb').subscribe({
      next: () => {
        this.loading = false;
        this.messageOk = true;
        this.message = 'KB cleared.';
        this.sources = [];
        this.toast.success('Knowledge base cleared.');
        this.showClearConfirm = false;
        this.clearConfirmed = false;
        this.loadKbCount();
      },
      error: (e) => {
        this.loading = false;
        this.toast.error(e?.error?.detail || 'Failed to clear.');
        this.message = e?.error?.detail || 'Failed.';
      },
    });
  }
}
