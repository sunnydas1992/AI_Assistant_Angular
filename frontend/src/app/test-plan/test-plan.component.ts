import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
      <div class="card">
        <h2>Test Plan</h2>
        <pre class="plan-content">{{ plan }}</pre>
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
    .plan-content { white-space: pre-wrap; font-size: 0.9rem; max-height: 420px; overflow-y: auto; }
    .refine-section { margin-top: var(--space-md); }
    .publish-section { margin-top: var(--space-lg); padding-top: var(--space-md); border-top: 1px solid var(--app-card-title-border); }
    .publish-section h3 { font-size: 0.95rem; margin-bottom: var(--space-sm); }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); margin-bottom: var(--space-sm); }
    .form-group label { display: block; margin-bottom: var(--space-xs); font-weight: 600; font-size: 0.85rem; }
    .success-msg { margin-top: var(--space-sm); font-size: 0.9rem; color: var(--hyland-teal); }
    .draft-actions { display: flex; gap: var(--space-sm); margin-bottom: var(--space-md); }
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

  constructor(private api: ApiService, private toast: ToastService) {}

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
    try {
      const draft = localStorage.getItem(TEST_PLAN_DRAFT_KEY);
      if (draft) {
        this.plan = draft;
        this.toast.info('Draft restored.');
      }
    } catch {
      // ignore
    }
  }

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
        this.messageOk = true;
        this.message = this.plan ? 'Test plan generated.' : 'No content.';
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
        this.feedback = '';
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
