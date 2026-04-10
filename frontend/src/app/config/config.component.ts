import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BehaviorSubject, Observable, Subject, combineLatest, debounceTime, finalize, map, switchMap } from 'rxjs';
import { RouterLink } from '@angular/router';
import { AiThinkingOverlayComponent } from '../ai-thinking-overlay/ai-thinking-overlay.component';
import { ApiService } from '../api.service';
import { InitService } from '../init.service';
import { LoggerService } from '../logger.service';
import { ToastService } from '../toast.service';

@Component({
  selector: 'app-config',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, AiThinkingOverlayComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">Configuration</h1>
      <p class="page-subtitle">Configure Jira, Confluence, and AWS Bedrock. Click Initialize to start. Advanced settings unlock after initialization.</p>
    </header>

    <div class="config-grid">
      <section class="card config-card">
        <h2>Connection Settings</h2>
        <div class="form-group">
          <label>Jira / Confluence URL</label>
          <input [(ngModel)]="jiraServer" placeholder="https://your-domain.atlassian.net" />
        </div>
        <div class="form-group">
          <label>Atlassian Username (Email)</label>
          <input [(ngModel)]="jiraUsername" type="text" placeholder="user@company.com" />
        </div>
        <div class="form-group">
          <label>Atlassian API Token</label>
          <input [(ngModel)]="jiraApiToken" type="password" placeholder="API token" />
        </div>

        <h3>AWS Bedrock</h3>
        <div class="form-group">
          <label title="CLI profile name from aws configure or SSO (e.g. aws sso login --profile name)">AWS Profile</label>
          <input [(ngModel)]="awsProfile" placeholder="e.g. default" (ngModelChange)="onAwsConnectionFieldsChange()" title="AWS CLI profile name" />
        </div>
        @if (awsProfile) {
          <p class="hint">Run <code>aws sso login --profile {{ awsProfile }}</code> in terminal first.</p>
        }

        <div class="form-actions">
          <button type="button" class="secondary" (click)="testConnection()" [disabled]="testingConnection || !canTestConnection()">
            {{ testingConnection ? 'Testing…' : 'Test Connection' }}
          </button>
          <button class="primary" (click)="init()" [disabled]="loading || !canInit()">
            {{ loading ? 'Initializing…' : 'Initialize' }}
          </button>
          @if (message && !messageOk) {
            <button type="button" class="secondary" (click)="init()" [disabled]="loading">Retry</button>
          }
        </div>
        @if (testResult !== null) {
          <div class="test-result" [class.all-ok]="testResult.jira && testResult.confluence && testResult.bedrock">
            <span>Jira: {{ testResult.jira ? 'OK' : 'Failed' }}</span>
            <span>Confluence: {{ testResult.confluence ? 'OK' : 'Failed' }}</span>
            <span>Bedrock: {{ testResult.bedrock ? 'OK' : 'Failed' }}</span>
          </div>
        }
        @if (message) {
          <div class="message" [class.success]="messageOk" [class.error]="!messageOk">{{ message }}</div>
        }
      </section>

      @if (advancedPanel$ | async; as ctx) {
        <section class="card config-card" [class.card-disabled]="!ctx.unlocked">
          <div class="advanced-settings-header">
            <h2>Advanced Settings</h2>
            <p class="advanced-help-link">
              <a routerLink="/help/advanced-settings" class="link-inline advanced-help-anchor">
                <svg
                  class="advanced-help-info-icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="1.75" />
                  <circle cx="12" cy="8" r="1.35" fill="currentColor" />
                  <path d="M12 11.25v6" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" />
                </svg>
                <span>What do these settings mean?</span>
              </a>
            </p>
          </div>
          @if (!ctx.unlocked) {
            <div class="disabled-overlay">
              <p>Initialize the system first to access advanced settings.</p>
            </div>
          }
          <div class="form-group">
            <label title="Local path where ChromaDB stores embeddings">Vector Store Directory</label>
            <input [(ngModel)]="persistDirectory" placeholder="data/chroma" [disabled]="!ctx.unlocked" />
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Chunk Size</label>
              <input type="number" [(ngModel)]="chunkSize" min="300" max="3000" step="50" [disabled]="!ctx.unlocked" />
            </div>
            <div class="form-group">
              <label>Chunk Overlap</label>
              <input type="number" [(ngModel)]="chunkOverlap" min="0" max="500" step="10" [disabled]="!ctx.unlocked" />
            </div>
          </div>
          <div class="form-group">
            <label title="Number of similar chunks to retrieve from the knowledge base when generating">Top-K (Retrieval)</label>
            <input type="number" [(ngModel)]="topK" min="1" max="10" [disabled]="!ctx.unlocked" />
          </div>

          @if (ctx.initialized) {
            <p class="hint reinit-hint">Selecting a different model will re-initialize the system automatically. Please wait until initialization completes.</p>
          } @else if (ctx.unlocked) {
            <p class="hint reinit-hint model-select-prompt">Select a model below to complete setup. Other pages will unlock once a model is active.</p>
          }
          <h3>LLM Model</h3>
          <div class="form-group">
            <label>Model</label>
            <select [(ngModel)]="bedrockModel" [disabled]="!ctx.unlocked || loading" (ngModelChange)="onModelChange()">
              @if (!bedrockModel) {
                <option value="" disabled>-- Select a model --</option>
              }
              @for (opt of modelOptions; track opt.value) {
                <option [value]="opt.value">{{ opt.label }}</option>
              }
            </select>
            @if (modelsLoading) { <span class="hint">Loading models…</span> }
            @if (loading && reinitMessage) { <span class="hint reinit-wait">{{ reinitMessage }}</span> }
            <button type="button" class="link-btn" (click)="loadModels(true)" [disabled]="!ctx.unlocked">Refresh Models</button>
          </div>
          <div class="form-group">
            <label>Temperature</label>
            <input type="number" [(ngModel)]="temperature" min="0" max="1" step="0.05" [disabled]="!ctx.unlocked" />
          </div>
          <div class="form-group">
            <label>Inference Profile ID (Optional)</label>
            <input [(ngModel)]="inferenceProfileId" placeholder="For on-demand not supported" [disabled]="!ctx.unlocked" />
          </div>
        </section>
      }
    </div>

    <app-ai-thinking-overlay
      [open]="configThinkingOpen"
      [title]="configThinkingTitle"
      [subtitle]="configThinkingSubtitle"
      [stepLabels]="configThinkingSteps"
    />
  `,
  styles: [`
    .page-header .page-title { margin-bottom: var(--space-xs); }
    .page-header .page-subtitle { margin: 0; font-size: 0.9rem; }
    .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-lg); }
    @media (max-width: 900px) { .config-grid { grid-template-columns: 1fr; } }
    .config-card {
      max-width: 100%; padding: var(--space-lg) var(--space-xl);
      animation: cfgCardEnter 0.4s cubic-bezier(0.22,1,0.36,1) both;
    }
    .config-grid .config-card:nth-child(1) { animation-delay: 0.04s; }
    .config-grid .config-card:nth-child(2) { animation-delay: 0.1s; }
    @keyframes cfgCardEnter {
      from { opacity: 0; transform: translateY(14px) scale(0.98); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .config-card h2 { margin-top: 0; margin-bottom: var(--space-md); font-size: 1rem; }
    .advanced-settings-header {
      position: relative;
      z-index: 2;
      margin-bottom: var(--space-md);
    }
    .config-card .advanced-settings-header h2 {
      margin-top: 0;
      margin-bottom: var(--space-xs);
    }
    .config-card h3 { margin: var(--space-md) 0 var(--space-sm); font-size: 0.95rem; }
    .form-group { margin-bottom: var(--space-md); }
    .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 600; font-size: 0.9rem; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-md); }
    .form-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-md); flex-wrap: wrap; }
    .hint { font-size: 0.8rem; color: var(--app-text-muted); margin-top: var(--space-xs); }
    .hint code { background: var(--app-code-bg); padding: 0.1rem 0.3rem; border-radius: 3px; }
    .message { margin-top: var(--space-md); padding: var(--space-md); border-radius: var(--radius-sm); font-size: 0.9rem; }
    .message.success { background: rgba(19,234,193,0.15); border-left: 4px solid var(--hyland-teal); }
    .message.error { background: rgba(200,0,0,0.08); border-left: 4px solid #c00; }
    .test-result { margin-top: var(--space-sm); padding: var(--space-sm); font-size: 0.85rem; display: flex; gap: var(--space-md); flex-wrap: wrap; }
    .test-result.all-ok { color: var(--hyland-teal); }
    .test-result:not(.all-ok) { color: var(--app-text-muted); }
    .reinit-hint { margin-bottom: var(--space-sm); }
    .model-select-prompt { color: var(--hyland-teal); font-weight: 600; }
    .config-card.card-disabled { position: relative; }
    .disabled-overlay {
      position: absolute;
      inset: 0;
      background: var(--app-overlay-bg);
      border-radius: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
    }
    .disabled-overlay p { margin: 0; font-weight: 600; color: var(--app-text-muted); font-size: 0.95rem; }
    .advanced-help-link { margin: 0; font-size: 0.85rem; }
    .link-inline { color: var(--hyland-blue); font-weight: 600; text-decoration: none; }
    .link-inline:hover { text-decoration: underline; }
    .advanced-help-anchor {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .advanced-help-info-icon {
      width: 1.05rem;
      height: 1.05rem;
      flex-shrink: 0;
      opacity: 0.92;
    }
    .advanced-help-anchor:hover .advanced-help-info-icon,
    .advanced-help-anchor:focus-visible .advanced-help-info-icon {
      opacity: 1;
    }
    .link-btn { background: none; border: none; color: var(--hyland-blue); cursor: pointer; font-size: 0.9rem; padding: 0.25rem 0; }
    .link-btn:hover { text-decoration: underline; }
    .reinit-wait { display: block; margin-top: 0.25rem; color: var(--hyland-teal); }
  `],
})
export class ConfigComponent implements OnInit {
  jiraServer = '';
  jiraUsername = '';
  jiraApiToken = '';
  awsProfile = '';
  awsRegion = 'us-east-1';
  /** Preferred model when resolving from the fetched list (not pre-selected on first init). */
  static readonly PREFERRED_MODEL_ID = 'us.anthropic.claude-sonnet-4-5-v1';
  bedrockModel = '';
  /** Jira/Confluence/AWS connections established (Phase 1 init). Advanced settings unlock but nav stays gated until a model is set. */
  private readonly _jiraConnected$ = new BehaviorSubject<boolean>(false);
  get jiraConnected(): boolean { return this._jiraConnected$.value; }
  set jiraConnected(v: boolean) { this._jiraConnected$.next(v); }
  persistDirectory = 'data/chroma';
  chunkSize = 1000;
  chunkOverlap = 150;
  topK = 4;
  temperature = 0.8;
  inferenceProfileId = '';
  modelOptions: { label: string; value: string }[] = [];
  modelsLoading = false;
  /** After first Bedrock list fetch, show overlay on subsequent reloads (e.g. profile change), not on initial page load. */
  bedrockModelsListLoadedOnce = false;
  /** Debounce delay for profile/region typing so each keystroke does not call the API. */
  private static readonly BEDROCK_MODELS_DEBOUNCE_MS = 800;
  private readonly awsConnectionFieldsChange$ = new Subject<void>();
  /** Count in-flight Bedrock model list requests so parallel loads do not clear `modelsLoading` early. */
  private bedrockModelsInFlight = 0;
  loading = false;
  testingConnection = false;
  message = '';
  messageOk = false;
  /** Model currently in use by the backend (from init-status). Used to detect model change and show in-use on return. */
  currentModelInUse: string | null = null;
  /** Shown when re-initializing after model change. */
  reinitMessage = '';
  /** Result of last Test connection: null = not run, else { jira, confluence, bedrock }. */
  testResult: { jira: boolean; confluence: boolean; bedrock: boolean } | null = null;

  /**
   * Wrapped init flag so @if(async) stays truthy when initialized is false (Angular @if treats false as hidden).
   * `unlocked` = connections established (advanced settings interactable).
   * `initialized` = fully ready (model set, nav unlocked).
   */
  readonly advancedPanel$: Observable<{ initialized: boolean; unlocked: boolean }>;

  constructor(
    private api: ApiService,
    public initService: InitService,
    private logger: LoggerService,
    private toast: ToastService,
    private destroyRef: DestroyRef,
  ) {
    this.advancedPanel$ = combineLatest([this.initService.initialized$, this._jiraConnected$]).pipe(
      map(([initialized, connected]) => ({ initialized, unlocked: initialized || connected })),
    );
  }

  get configThinkingOpen(): boolean {
    return (
      this.loading ||
      this.testingConnection ||
      (this.modelsLoading && this.bedrockModelsListLoadedOnce && (this.initService.initialized || this.jiraConnected))
    );
  }

  get configThinkingTitle(): string {
    if (this.loading) return 'Initializing system';
    if (this.testingConnection) return 'Testing connection';
    return 'Loading Bedrock models';
  }

  get configThinkingSubtitle(): string {
    if (this.loading) return 'Connecting Jira, Confluence, and AWS Bedrock…';
    if (this.testingConnection) return 'Verifying Jira, Confluence, and Bedrock…';
    return 'Fetching available models for your region…';
  }

  get configThinkingSteps(): string[] {
    if (this.loading) {
      return ['Validating credentials', 'Connecting to Atlassian', 'Starting Bedrock client', 'Finalizing session'];
    }
    if (this.testingConnection) {
      return ['Checking Jira API', 'Checking Confluence API', 'Checking AWS Bedrock', 'Summarizing results'];
    }
    return ['Querying AWS', 'Resolving model catalog', 'Applying filters', 'Updating the list'];
  }

  ngOnInit(): void {
    this.awsConnectionFieldsChange$
      .pipe(
        debounceTime(ConfigComponent.BEDROCK_MODELS_DEBOUNCE_MS),
        switchMap(() => this.fetchBedrockModels$()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (res) => this.applyBedrockModelsResponse(res),
        error: (err) => this.applyBedrockModelsError(err),
      });

    this.initService.initialized$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((init) => {
      if (!init) {
        this.jiraConnected = false;
        this.currentModelInUse = null;
      }
    });

    this.loadConnectionSettings();
    this.initService.checkInitStatus();
  }

  /** User edited AWS profile or region — debounced + prior request cancelled via switchMap. */
  onAwsConnectionFieldsChange(): void {
    this.awsConnectionFieldsChange$.next();
  }

  /** Pre-fill connection fields and in-use model when returning to Config (API token is never restored for security). */
  loadConnectionSettings(): void {
    this.logger.debug('Loading connection settings');
    this.api.get<{ jira_server?: string; jira_username?: string; aws_region?: string; aws_profile?: string }>('/connection-settings').subscribe({
      next: (res) => {
        if (res?.jira_server) this.jiraServer = res.jira_server;
        if (res?.jira_username) this.jiraUsername = res.jira_username;
        if (res?.aws_region) this.awsRegion = res.aws_region;
        if (res?.aws_profile) this.awsProfile = res.aws_profile;
        this.loadInitStatusThenModels();
      },
      error: (err) => {
        this.logger.warn('Connection settings load failed', err);
        this.loadModels();
      },
    });
  }

  /** Load init-status; if initialized, set bedrockModel to current in-use model. Restore jiraConnected on refresh. Then load model list. */
  loadInitStatusThenModels(): void {
    this.api.get<{ initialized?: boolean; connected?: boolean; current_model_id?: string | null }>('/init-status').subscribe({
      next: (res) => {
        if (res?.connected) {
          this.jiraConnected = true;
        }
        const inUse = (res?.current_model_id ?? '').toString().trim();
        if (res?.initialized && inUse) {
          this.currentModelInUse = inUse;
          this.bedrockModel = inUse;
        } else {
          this.currentModelInUse = null;
        }
        this.loadModels();
      },
      error: () => {
        this.currentModelInUse = null;
        this.loadModels();
      },
    });
  }

  canInit(): boolean {
    return !!(
      this.jiraServer?.trim() &&
      this.jiraUsername?.trim() &&
      this.jiraApiToken?.trim() &&
      this.awsProfile?.trim()
    );
  }

  /** Can run Test connection with URL, username, and token (AWS optional for partial check). */
  canTestConnection(): boolean {
    return !!(this.jiraServer?.trim() && this.jiraUsername?.trim() && this.jiraApiToken?.trim());
  }

  testConnection(): void {
    if (!this.canTestConnection() || this.testingConnection) return;
    this.testingConnection = true;
    this.testResult = null;
    this.api.postForm('/test-connection-with-config', {
      jira_server: this.jiraServer,
      jira_username: this.jiraUsername,
      jira_api_token: this.jiraApiToken,
      aws_region: this.awsRegion,
      aws_profile: this.awsProfile || '',
    }).subscribe({
      next: (res: unknown) => {
        this.testingConnection = false;
        const r = res as { jira?: boolean; confluence?: boolean; bedrock?: boolean };
        this.testResult = {
          jira: !!r?.jira,
          confluence: !!r?.confluence,
          bedrock: !!r?.bedrock,
        };
      },
      error: () => {
        this.testingConnection = false;
        this.testResult = { jira: false, confluence: false, bedrock: false };
      },
    });
  }

  /** Load Bedrock models immediately (page load, init success, Refresh models). */
  loadModels(showToast = false): void {
    this.fetchBedrockModels$().subscribe({
      next: (res) => {
        this.applyBedrockModelsResponse(res);
        if (showToast) this.toast.success(`Model list updated — ${this.modelOptions.length} model${this.modelOptions.length !== 1 ? 's' : ''} available.`);
      },
      error: (err) => {
        this.applyBedrockModelsError(err);
        if (showToast) this.toast.error('Failed to refresh model list.');
      },
    });
  }

  private beginBedrockModelsLoad(): void {
    this.bedrockModelsInFlight++;
    this.modelsLoading = true;
  }

  private endBedrockModelsLoad(): void {
    this.bedrockModelsInFlight = Math.max(0, this.bedrockModelsInFlight - 1);
    if (this.bedrockModelsInFlight === 0) {
      this.modelsLoading = false;
    }
  }

  private fetchBedrockModels$() {
    this.beginBedrockModelsLoad();
    this.logger.debug('Loading Bedrock models', { region: this.awsRegion, profile: this.awsProfile });
    return this.api
      .get<{ models: Record<string, string>; ok?: boolean }>('/bedrock-models', {
        aws_region: this.awsRegion,
        aws_profile: this.awsProfile,
      })
      .pipe(finalize(() => this.endBedrockModelsLoad()));
  }

  private applyBedrockModelsResponse(res: { models?: Record<string, string>; ok?: boolean }): void {
    this.bedrockModelsListLoadedOnce = true;
    const models = res?.models ?? {};
    this.modelOptions = Object.entries(models).map(([label, value]) => ({ label, value }));
    if (this.modelOptions.length && this.bedrockModel && !this.modelOptions.some(o => o.value === this.bedrockModel)) {
      this.bedrockModel = this.pickDefaultModelFromList(this.modelOptions);
    }
    this.logger.debug('Bedrock models loaded', this.modelOptions.length);
  }

  private applyBedrockModelsError(err: unknown): void {
    this.bedrockModelsListLoadedOnce = true;
    this.modelOptions = [];
    this.logger.warn('Bedrock models load failed', err);
  }

  init(): void {
    this.loading = true;
    this.message = '';
    this.logger.info('Initialize requested', { server: this.jiraServer?.slice(0, 40), region: this.awsRegion });
    this.api.postForm('/init', {
      jira_server: this.jiraServer,
      jira_username: this.jiraUsername,
      jira_api_token: this.jiraApiToken,
      aws_region: this.awsRegion,
      aws_profile: this.awsProfile,
      persist_directory: this.persistDirectory,
      chunk_size: this.chunkSize,
      chunk_overlap: this.chunkOverlap,
      top_k: this.topK,
      bedrock_model: this.bedrockModel,
      temperature: this.temperature,
      inference_profile_id: this.inferenceProfileId,
    }).subscribe({
      next: (res: unknown) => {
        const r = res as { ok?: boolean; detail?: string; bedrock_initialized?: boolean };
        this.loading = false;
        const fullSuccess = !!r?.ok && r?.bedrock_initialized === true;
        this.messageOk = fullSuccess;
        if (fullSuccess) {
          this.logger.info('Initialize success');
          this.jiraConnected = true;
          this.currentModelInUse = this.bedrockModel;
          this.reinitMessage = '';
          this.testResult = null;
          this.initService.setInitialized(true);
          this.loadModels();
          this.message = 'Initialized successfully.';
          this.toast.success('System initialized successfully.');
        } else if (r?.ok && !r?.bedrock_initialized) {
          this.jiraConnected = true;
          this.reinitMessage = '';
          if (!this.bedrockModel) {
            this.messageOk = true;
            this.message = 'Connected. Select a model in Advanced Settings to continue.';
            this.toast.success('Connected. Now select a model to complete setup.');
          } else {
            this.messageOk = false;
            this.message = 'Connected, but the selected model could not be initialized. Choose a different model in Advanced Settings.';
          }
          this.loadModels();
        } else {
          this.reinitMessage = '';
          this.message = r?.detail || 'Init failed.';
          this.logger.warn('Initialize failure', r);
          // If user was already initialized (e.g. re-init after model change failed), keep them
          // initialized so they can still use Ticket Analyzer / Test Cases with the previous model.
          if (!this.initService.initialized) {
            this.initService.setInitialized(false);
          }
        }
      },
      error: (err) => {
        this.loading = false;
        this.reinitMessage = '';
        this.messageOk = false;
        const status = err?.status;
        const detail = err?.error?.detail ?? err?.error?.message ?? err?.message;
        if (status === 0 || err?.message?.includes('ECONNREFUSED') || err?.message?.includes('Failed to fetch')) {
          this.message = 'Cannot reach the server. Start the backend (e.g. run.bat or: cd backend && uvicorn main:app --reload --port 8000).';
        } else {
          this.message = typeof detail === 'string' ? detail : (detail?.message || JSON.stringify(detail) || 'Request failed.');
        }
        this.logger.error('Initialize failed', err);
        this.initService.setInitialized(false);
      },
    });
  }

  /** Prefer Claude Sonnet 4.5 when current selection is not in the list; otherwise first option. */
  private pickDefaultModelFromList(options: { label: string; value: string }[]): string {
    const preferredId = ConfigComponent.PREFERRED_MODEL_ID;
    const byValue = options.find(o => o.value === preferredId);
    if (byValue) return byValue.value;
    const byLabel = options.find(o => /claude\s+sonnet\s+4\.5/i.test(o.label));
    if (byLabel) return byLabel.value;
    return options[0].value;
  }

  /** Called when the user changes the model dropdown. Uses lightweight switch when credentials are unavailable (page revisit). */
  onModelChange(): void {
    if (!(this.initService.initialized || this.jiraConnected) || this.loading) return;
    const selected = this.bedrockModel?.trim();
    if (!selected) return;
    if (selected === this.currentModelInUse) return;

    if (this.canInit()) {
      this.reinitMessage = this.currentModelInUse
        ? 'Re-initializing with new model, please wait…'
        : 'Setting up model, please wait…';
      this.init();
    } else {
      this.switchModelOnly(selected);
    }
  }

  /** Lightweight model switch via session-scoped endpoint (no credentials needed). */
  private switchModelOnly(modelId: string): void {
    this.loading = true;
    this.reinitMessage = 'Switching model, please wait…';
    this.message = '';
    this.api.postForm('/chat/switch-model', { model_id: modelId }).subscribe({
      next: (res: unknown) => {
        const r = res as { ok?: boolean };
        this.loading = false;
        this.reinitMessage = '';
        if (r?.ok) {
          this.currentModelInUse = modelId;
          this.initService.setInitialized(true);
          const opt = this.modelOptions.find(o => o.value === modelId);
          const label = opt?.label ?? modelId;
          this.message = `Switched to ${label}.`;
          this.messageOk = true;
          this.toast.success(`Now using ${label}.`);
        } else {
          this.message = 'Failed to switch model. Try re-initializing with full credentials.';
          this.messageOk = false;
        }
      },
      error: (err: unknown) => {
        this.loading = false;
        this.reinitMessage = '';
        const e = err as { error?: { detail?: string; message?: string }; message?: string };
        const detail = e?.error?.detail ?? e?.error?.message ?? e?.message;
        this.message = typeof detail === 'string' ? detail : 'Failed to switch model.';
        this.messageOk = false;
      },
    });
  }

}
