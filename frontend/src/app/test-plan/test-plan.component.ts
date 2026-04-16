import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AiThinkingOverlayComponent } from '../ai-thinking-overlay/ai-thinking-overlay.component';
import { ApiService } from '../api.service';
import { ToastService } from '../toast.service';

const TEST_PLAN_DRAFT_KEY = 'qa_assistant_test_plan_draft';

@Component({
  selector: 'app-test-plan',
  standalone: true,
  imports: [CommonModule, FormsModule, AiThinkingOverlayComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">Generate Test Plan</h1>
      <p class="page-subtitle">Create a test plan from Confluence pages, Jira tickets, and uploaded docs.</p>
      @if (modelOptions.length) {
        <div class="model-switcher-strip" [class.model-switching]="switchingModel">
          <span class="model-strip-label">AI Model</span>
          <select [(ngModel)]="selectedModelId" (ngModelChange)="switchModel()" class="model-select" [disabled]="switchingModel">
            @for (opt of modelOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
          @if (switchingModel) {
            <span class="loading-spinner switching-spinner"></span>
            <span class="switching-hint">Switching model…</span>
          }
          <button type="button" class="link-btn refresh-models-btn" (click)="loadModels(true)" [disabled]="switchingModel">Refresh</button>
        </div>
      } @else if (currentModelDisplay) {
        <div class="current-model-strip" [attr.title]="currentModelId || null">
          <span class="model-strip-label">LLM In Use</span>
          <span class="model-strip-value">{{ currentModelDisplay }}</span>
        </div>
      }
    </header>

    <div class="card test-plan-card">
      <label title="Confluence pages that describe initiatives or high-level requirements">Initiative / Requirement Confluence URLs (Comma-Separated)</label>
      <input [(ngModel)]="initiativeUrls" placeholder="https://.../wiki/..." />
      <label title="Design or technical spec Confluence pages">Design Doc URLs</label>
      <input [(ngModel)]="designUrls" placeholder="https://.../wiki/..." />
      <label title="Any other requirement or reference URLs">Other Requirement URLs</label>
      <input [(ngModel)]="otherUrls" placeholder="https://.../wiki/..." />
      <label>Jira Ticket IDs (Comma-Separated)</label>
      <input [(ngModel)]="jiraTicketIds" placeholder="PROJ-1, PROJ-2" />
      <label>Additional Instructions</label>
      <textarea [(ngModel)]="planPrompt" rows="3" placeholder="Optional instructions for the plan"></textarea>
      <label>Sample Template Confluence URL (Structure Only)</label>
      <input [(ngModel)]="sampleTemplateUrl" placeholder="Optional" />
      <label>Upload Files</label>
      <input type="file" multiple (change)="onFiles($event)" />
      <div style="margin-top: 1rem;">
        <button class="primary" (click)="generate()" [disabled]="loading">{{ loading ? 'Generating…' : 'Generate Test Plan' }}</button>
      </div>
      @if (message) { <div class="message" [class.error]="!messageOk">{{ message }}</div> }
    </div>

    @if (plan) {
      <div class="card plan-result-card">
        <div class="plan-header">
          <h2>Test Plan</h2>
          <div class="plan-view-actions">
            <div class="view-toggle">
              <button type="button" class="toggle-btn" [class.active]="viewMode === 'preview'" (click)="viewMode = 'preview'; exitEditMode()">Preview</button>
              <button type="button" class="toggle-btn" [class.active]="viewMode === 'raw'" (click)="viewMode = 'raw'; exitEditMode()">Markdown</button>
              <button type="button" class="toggle-btn" [class.active]="viewMode === 'edit'" (click)="enterEditMode()">Edit</button>
            </div>
          </div>
        </div>

        @if (viewMode === 'preview') {
          <div class="plan-preview" [innerHTML]="renderedPlan"></div>
        } @else if (viewMode === 'raw') {
          <pre class="plan-content">{{ plan }}</pre>
        } @else if (viewMode === 'edit') {
          <textarea class="plan-editor" [(ngModel)]="editBuffer" rows="20"></textarea>
          <div class="edit-actions">
            <button type="button" class="primary" (click)="saveEdit()" [disabled]="editBuffer === plan">Save Changes</button>
            <button type="button" class="secondary" (click)="exitEditMode()">Cancel</button>
            @if (editBuffer !== plan) {
              <span class="unsaved-hint">Unsaved changes</span>
            }
          </div>
        }

        <div class="draft-actions">
          <button type="button" class="secondary" (click)="saveDraft()" [disabled]="!plan.trim()">Save Draft</button>
          <button type="button" class="link-btn" (click)="clearDraft()">Clear Draft</button>
        </div>
        <div class="refine-section">
          <label>Refine With Feedback</label>
          <textarea [(ngModel)]="feedback" rows="2" placeholder="What to change..."></textarea>
          <button class="secondary" (click)="refine()" [disabled]="!feedback.trim() || loading">Apply Feedback</button>
        </div>
        <div class="publish-section">
          <h3>Publish to Confluence</h3>
          <div class="form-row">
            <div class="form-group">
              <label>Space Key</label>
              <input [(ngModel)]="spaceKey" placeholder="e.g. ENG" />
            </div>
            <div class="form-group">
              <label>Page Title</label>
              <input [(ngModel)]="pageTitle" placeholder="Test Plan" />
            </div>
          </div>
          <button class="primary" (click)="publish()" [disabled]="!spaceKey.trim() || !pageTitle.trim() || publishing">
            {{ publishing ? 'Publishing…' : 'Publish to Confluence' }}
          </button>
          @if (publishUrl) {
            <p class="success-msg">Published. <a [href]="publishUrl" target="_blank" rel="noopener">{{ publishUrl }}</a></p>
            <a [href]="publishUrl" target="_blank" rel="noopener" class="secondary view-published-btn">View Published Page</a>
          }
        </div>
      </div>
    }

    <app-ai-thinking-overlay
      [open]="loading || publishing"
      [title]="planThinkingTitle"
      [subtitle]="planThinkingSubtitle"
      [stepLabels]="planThinkingSteps"
    />
  `,
  styles: [`
    .test-plan-card { max-width: 720px; padding: var(--space-lg) var(--space-xl); }
    label { display: block; margin-top: var(--space-md); font-weight: 600; font-size: 0.85rem; }
    input, textarea, select { margin-top: var(--space-xs); }
    .message { margin-top: var(--space-md); padding: var(--space-md); border-radius: var(--radius-sm); }
    .message.error { background: rgba(200,0,0,0.08); border-left: 4px solid #c00; }

    /* ── Model switcher ── */
    .current-model-strip {
      display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem 0.75rem;
      margin-top: var(--space-sm); padding: 0.45rem 0.75rem;
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border); border-radius: var(--radius-sm);
      max-width: 42rem; animation: modelStripIn 0.35s ease both;
    }
    @keyframes modelStripIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: translateX(0); } }
    .model-strip-label { font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--app-text-muted); }
    .model-strip-value { font-size: 0.88rem; font-weight: 600; color: var(--app-text); word-break: break-word; }
    .model-switcher-strip {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem;
      margin-top: var(--space-sm); padding: 0.45rem 0.75rem;
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border); border-radius: var(--radius-sm);
      max-width: 42rem; animation: modelStripIn 0.35s ease both;
    }
    .model-select { min-height: 2rem; font-size: 0.88rem; padding: 0.2rem 0.4rem; border-radius: 6px; border: 1px solid var(--app-input-border); background: var(--app-input-bg); color: var(--app-text); }
    .model-switching { border-color: var(--hyland-teal, #13eac1); animation: modelSwitchPulse 1.2s ease-in-out infinite; }
    @keyframes modelSwitchPulse { 0%, 100% { border-color: var(--hyland-teal, #13eac1); } 50% { border-color: var(--app-card-border); } }
    .switching-spinner { width: 0.9rem; height: 0.9rem; margin-right: 0; }
    .switching-hint { font-size: 0.78rem; font-weight: 600; color: var(--hyland-teal, #13eac1); }
    .refresh-models-btn { font-size: 0.78rem; }

    /* ── Plan result card ── */
    .plan-result-card { max-width: 960px; }
    .plan-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-sm); margin-bottom: var(--space-md); }
    .plan-header h2 { margin: 0; }

    /* ── View toggle (Preview / Markdown / Edit) ── */
    .view-toggle {
      display: inline-flex; border: 1px solid var(--app-card-border); border-radius: var(--radius-sm); overflow: hidden;
    }
    .toggle-btn {
      padding: 0.35rem 0.85rem; font-size: 0.8rem; font-weight: 600;
      background: var(--app-surface-muted); color: var(--app-text-muted);
      border: none; cursor: pointer; transition: background 0.15s, color 0.15s;
    }
    .toggle-btn:not(:last-child) { border-right: 1px solid var(--app-card-border); }
    .toggle-btn.active { background: var(--hyland-teal, #13eac1); color: #000; }
    .toggle-btn:hover:not(.active) { background: var(--app-input-bg); color: var(--app-text); }

    /* ── Preview pane ── */
    .plan-preview {
      max-height: 520px; overflow-y: auto; padding: var(--space-md);
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border); border-radius: var(--radius-sm);
      font-size: 0.9rem; line-height: 1.6;
    }
    .plan-preview :first-child { margin-top: 0; }
    .plan-preview h1, .plan-preview h2, .plan-preview h3, .plan-preview h4 { margin-top: 1.2em; margin-bottom: 0.4em; }
    .plan-preview ul, .plan-preview ol { padding-left: 1.5em; }
    .plan-preview code { background: rgba(0,0,0,0.06); padding: 0.15em 0.35em; border-radius: 3px; font-size: 0.88em; }
    .plan-preview pre { background: rgba(0,0,0,0.06); padding: 0.75rem; border-radius: var(--radius-sm); overflow-x: auto; }
    .plan-preview pre code { background: none; padding: 0; }
    .plan-preview table { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
    .plan-preview th, .plan-preview td { border: 1px solid var(--app-card-border); padding: 0.4em 0.7em; text-align: left; font-size: 0.88rem; }
    .plan-preview th { background: var(--app-surface-muted); font-weight: 700; }
    .plan-preview blockquote { border-left: 3px solid var(--hyland-teal, #13eac1); margin: 0.75em 0; padding: 0.3em 0.75em; color: var(--app-text-muted); }
    .plan-preview hr { border: none; border-top: 1px solid var(--app-card-border); margin: 1em 0; }

    /* ── Raw markdown ── */
    .plan-content { white-space: pre-wrap; font-size: 0.9rem; max-height: 520px; overflow-y: auto; padding: var(--space-md); background: var(--app-surface-muted); border: 1px solid var(--app-card-border); border-radius: var(--radius-sm); }

    /* ── Edit mode ── */
    .plan-editor {
      width: 100%; min-height: 360px; max-height: 600px; font-family: 'Fira Code', 'Consolas', monospace; font-size: 0.88rem;
      line-height: 1.55; padding: var(--space-md); border: 1px solid var(--app-input-border); border-radius: var(--radius-sm);
      background: var(--app-input-bg); color: var(--app-text); resize: vertical;
    }
    .edit-actions { display: flex; align-items: center; gap: var(--space-sm); margin-top: var(--space-sm); margin-bottom: var(--space-md); }
    .unsaved-hint { font-size: 0.78rem; color: #e0a800; font-weight: 600; }

    .refine-section { margin-top: var(--space-md); }
    .publish-section { margin-top: var(--space-lg); padding-top: var(--space-md); border-top: 1px solid var(--app-card-title-border); }
    .publish-section h3 { font-size: 0.95rem; margin-bottom: var(--space-sm); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-sm); }
    .form-group label { display: block; margin-bottom: var(--space-xs); font-weight: 600; font-size: 0.85rem; }
    .success-msg { margin-top: var(--space-sm); font-size: 0.9rem; color: var(--hyland-teal); }
    .draft-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-md); margin-bottom: var(--space-md); }
    .view-published-btn { display: inline-block; margin-top: var(--space-sm); text-decoration: none; }
  `],
})
export class TestPlanComponent implements OnInit {
  initiativeUrls = '';
  designUrls = '';
  otherUrls = '';
  jiraTicketIds = '';
  planPrompt = '';
  sampleTemplateUrl = '';
  selectedFiles: File[] = [];
  loading = false;
  message = '';
  messageOk = false;
  plan = '';
  feedback = '';
  spaceKey = '';
  pageTitle = 'Test Plan';
  publishing = false;
  publishUrl = '';

  /* ── Model selector state ── */
  modelOptions: { label: string; value: string }[] = [];
  selectedModelId = '';
  currentModelDisplay = '';
  currentModelId = '';
  switchingModel = false;

  /* ── View / edit state ── */
  viewMode: 'preview' | 'raw' | 'edit' = 'preview';
  editBuffer = '';
  renderedPlan: SafeHtml = '';

  constructor(
    private api: ApiService,
    private toast: ToastService,
    private sanitizer: DomSanitizer,
  ) {}

  get planThinkingTitle(): string {
    if (this.publishing) return 'Publishing to Confluence';
    return 'Working on your test plan';
  }

  get planThinkingSubtitle(): string {
    if (this.publishing) return 'Creating your Confluence page…';
    return 'Gathering sources and running the AI…';
  }

  get planThinkingSteps(): string[] {
    if (this.publishing) {
      return ['Preparing page content', 'Connecting to Confluence', 'Publishing page', 'Finishing up'];
    }
    return ['Collecting URLs and uploads', 'Building context', 'Generating the plan', 'Formatting output'];
  }

  ngOnInit(): void {
    this.loadModelsWithConfigDefault();
    try {
      const draft = localStorage.getItem(TEST_PLAN_DRAFT_KEY);
      if (draft) {
        this.plan = draft;
        this.updateRenderedPlan();
        this.toast.info('Draft restored.');
      }
    } catch {
      // ignore
    }
  }

  /* ── Model management (same pattern as Test Cases / Ticket Analyzer) ── */

  loadModelsWithConfigDefault(): void {
    const setModelsAndDefault = (defaultId: string) => {
      this.api.get<{ models: Record<string, string>; default_model_id?: string | null }>('/bedrock-models').subscribe({
        next: (res) => {
          const models = res?.models ?? {};
          const fromApi = (res?.default_model_id ?? '').toString().trim();
          this.modelOptions = Object.entries(models).map(([label, value]) => ({ label: String(label), value: String(value) }));
          if (this.modelOptions.length) {
            this.selectedModelId = this.pickModelIdFromList(this.modelOptions, defaultId || fromApi);
            const opt = this.modelOptions.find(o => o.value === this.selectedModelId);
            this.currentModelDisplay = opt?.label ?? this.selectedModelId;
            this.currentModelId = this.selectedModelId;
          } else {
            this.currentModelDisplay = defaultId;
            this.currentModelId = defaultId;
          }
        },
        error: () => this.loadModels(),
      });
    };
    this.api.get<{ initialized?: boolean; current_model_id?: string | null }>('/init-status').subscribe({
      next: (res) => {
        const inUse = (res?.current_model_id ?? '').toString().trim();
        setModelsAndDefault(inUse);
      },
      error: () => setModelsAndDefault(''),
    });
  }

  private pickModelIdFromList(options: { label: string; value: string }[], defaultId: string): string {
    if (!options.length) return '';
    const trim = (s: string) => (s || '').trim();
    const d = trim(defaultId);
    if (!d) return options[0].value;
    const matchByValue = options.find(o => trim(o.value) === d);
    if (matchByValue) return matchByValue.value;
    const matchByLabel = options.find(o => trim(o.label) === d);
    if (matchByLabel) return matchByLabel.value;
    const matchByContains = options.find(o => trim(o.value).includes(d) || d.includes(trim(o.value)));
    if (matchByContains) return matchByContains.value;
    return options[0].value;
  }

  loadModels(showToast = false): void {
    this.api.get<{ initialized?: boolean; current_model_id?: string | null }>('/init-status').subscribe({
      next: (res) => {
        const inUse = (res?.current_model_id ?? '').toString().trim();
        this.api.get<{ models: Record<string, string>; default_model_id?: string | null }>('/bedrock-models').subscribe({
          next: (bm) => {
            const models = bm?.models ?? {};
            this.modelOptions = Object.entries(models).map(([label, value]) => ({ label: String(label), value: String(value) }));
            if (this.modelOptions.length) {
              this.selectedModelId = this.pickModelIdFromList(this.modelOptions, inUse || (bm?.default_model_id ?? '').toString().trim());
              const opt = this.modelOptions.find(o => o.value === this.selectedModelId);
              this.currentModelDisplay = opt?.label ?? this.selectedModelId;
              this.currentModelId = this.selectedModelId;
            }
            if (showToast) this.toast.success(`Model list updated — ${this.modelOptions.length} model${this.modelOptions.length !== 1 ? 's' : ''} available.`);
          },
          error: () => { if (showToast) this.toast.error('Failed to refresh model list.'); },
        });
      },
      error: () => { if (showToast) this.toast.error('Failed to refresh model list.'); },
    });
  }

  switchModel(): void {
    const modelId = this.selectedModelId?.trim();
    if (!modelId || this.switchingModel) return;
    this.switchingModel = true;
    this.api.postForm('/chat/switch-model', { model_id: modelId }).subscribe({
      next: () => {
        this.switchingModel = false;
        const opt = this.modelOptions.find(o => o.value === modelId);
        const modelLabel = opt?.label ?? modelId;
        this.currentModelDisplay = modelLabel;
        this.currentModelId = modelId;
        this.toast.success('Now using ' + modelLabel + '.');
      },
      error: () => {
        this.switchingModel = false;
        this.toast.error('Failed to switch model. Please try again or re-initialize from Configuration.');
      },
    });
  }

  /* ── Markdown rendering ── */

  private updateRenderedPlan(): void {
    this.renderedPlan = this.renderMarkdown(this.plan);
  }

  private renderMarkdown(md: string): SafeHtml {
    if (!md?.trim()) return this.sanitizer.bypassSecurityTrustHtml('');
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let html = '';
    const lines = md.split('\n');
    let inCodeBlock = false;
    let codeBuffer: string[] = [];
    let inTable = false;
    let tableRows: string[] = [];

    const flushTable = () => {
      if (!tableRows.length) return;
      html += '<table>';
      tableRows.forEach((row, i) => {
        const sep = row.replace(/^\|/, '').replace(/\|$/, '');
        if (/^[\s\-:|]+$/.test(sep)) return;
        const tag = i === 0 ? 'th' : 'td';
        const cells = row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
        html += '<tr>' + cells.map(c => `<${tag}>${inlineFormat(c)}</${tag}>`).join('') + '</tr>';
      });
      html += '</table>';
      tableRows = [];
      inTable = false;
    };

    const inlineFormat = (s: string): string => {
      let r = esc(s);
      r = r.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      r = r.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      r = r.replace(/`([^`]+)`/g, '<code>$1</code>');
      r = r.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      return r;
    };

    for (const line of lines) {
      if (line.startsWith('```')) {
        if (inCodeBlock) {
          html += '<pre><code>' + esc(codeBuffer.join('\n')) + '</code></pre>';
          codeBuffer = [];
          inCodeBlock = false;
        } else {
          if (inTable) flushTable();
          inCodeBlock = true;
        }
        continue;
      }
      if (inCodeBlock) { codeBuffer.push(line); continue; }

      if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
        inTable = true;
        tableRows.push(line.trim());
        continue;
      }
      if (inTable) flushTable();

      if (/^####\s+(.+)$/.test(line)) { html += '<h4>' + inlineFormat(line.replace(/^####\s+/, '')) + '</h4>'; continue; }
      if (/^###\s+(.+)$/.test(line)) { html += '<h3>' + inlineFormat(line.replace(/^###\s+/, '')) + '</h3>'; continue; }
      if (/^##\s+(.+)$/.test(line)) { html += '<h2>' + inlineFormat(line.replace(/^##\s+/, '')) + '</h2>'; continue; }
      if (/^#\s+(.+)$/.test(line)) { html += '<h1>' + inlineFormat(line.replace(/^#\s+/, '')) + '</h1>'; continue; }
      if (/^---+$/.test(line.trim())) { html += '<hr>'; continue; }
      if (/^>\s?(.*)$/.test(line)) { html += '<blockquote>' + inlineFormat(line.replace(/^>\s?/, '')) + '</blockquote>'; continue; }
      if (/^[\-*]\s+(.+)$/.test(line)) { html += '<ul><li>' + inlineFormat(line.replace(/^[\-*]\s+/, '')) + '</li></ul>'; continue; }
      if (/^\d+\.\s+(.+)$/.test(line)) { html += '<ol><li>' + inlineFormat(line.replace(/^\d+\.\s+/, '')) + '</li></ol>'; continue; }
      if (!line.trim()) { html += '<br>'; continue; }
      html += '<p>' + inlineFormat(line) + '</p>';
    }
    if (inCodeBlock && codeBuffer.length) {
      html += '<pre><code>' + esc(codeBuffer.join('\n')) + '</code></pre>';
    }
    if (inTable) flushTable();

    html = html.replace(/<\/ul><ul>/g, '').replace(/<\/ol><ol>/g, '');

    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /* ── Edit mode ── */

  enterEditMode(): void {
    this.editBuffer = this.plan;
    this.viewMode = 'edit';
  }

  exitEditMode(): void {
    if (this.viewMode === 'edit') {
      this.viewMode = 'preview';
    }
  }

  saveEdit(): void {
    this.plan = this.editBuffer;
    this.updateRenderedPlan();
    this.viewMode = 'preview';
    this.toast.success('Test plan updated.');
  }

  /* ── Draft management ── */

  saveDraft(): void {
    if (!this.plan.trim()) return;
    try {
      localStorage.setItem(TEST_PLAN_DRAFT_KEY, this.plan);
      this.toast.success('Draft saved locally.');
    } catch {
      this.toast.error('Could not save draft.');
    }
  }

  clearDraft(): void {
    try {
      localStorage.removeItem(TEST_PLAN_DRAFT_KEY);
      this.toast.info('Draft cleared.');
    } catch {
      // ignore
    }
  }

  onFiles(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.selectedFiles = input.files ? Array.from(input.files) : [];
  }

  generate(): void {
    this.loading = true;
    this.message = '';
    this.api.postFormWithFiles('/test-plan/generate', {
      initiative_urls: this.initiativeUrls,
      design_urls: this.designUrls,
      other_urls: this.otherUrls,
      jira_ticket_ids: this.jiraTicketIds,
      plan_prompt: this.planPrompt,
      sample_template_url: this.sampleTemplateUrl,
    }, this.selectedFiles).subscribe({
      next: (res: any) => {
        this.loading = false;
        this.plan = res?.plan || '';
        this.updateRenderedPlan();
        this.messageOk = true;
        this.message = this.plan ? 'Test plan generated.' : 'No content.';
        this.viewMode = 'preview';
        if (this.plan) this.toast.success('Test plan generated.');
      },
      error: (err) => {
        this.loading = false;
        this.message = err?.error?.detail || 'Failed.';
        this.toast.error(err?.error?.detail || 'Failed to generate.');
      },
    });
  }

  refine(): void {
    if (!this.feedback.trim() || !this.plan) return;
    this.loading = true;
    this.api.postForm('/test-plan/refine', { current_plan: this.plan, feedback: this.feedback }).subscribe({
      next: (res: unknown) => {
        const r = res as { plan?: string };
        this.loading = false;
        this.plan = r?.plan || this.plan;
        this.updateRenderedPlan();
        this.feedback = '';
        this.viewMode = 'preview';
        this.toast.success('Plan updated with feedback.');
      },
      error: () => {
        this.loading = false;
        this.toast.error('Failed to apply feedback.');
      },
    });
  }

  publish(): void {
    if (!this.spaceKey.trim() || !this.pageTitle.trim() || !this.plan) return;
    this.publishing = true;
    this.publishUrl = '';
    this.api.postForm('/test-plan/publish', {
      space_key: this.spaceKey.trim(),
      title: this.pageTitle.trim(),
      plan: this.plan,
    }).subscribe({
      next: (res: unknown) => {
        this.publishing = false;
        this.publishUrl = (res as { url?: string })?.url || '';
        this.toast.success('Test plan published to Confluence.');
      },
      error: (err) => {
        this.publishing = false;
        this.message = err?.error?.detail || 'Publish failed.';
        this.toast.error(err?.error?.detail || 'Publish failed.');
      },
    });
  }
}
