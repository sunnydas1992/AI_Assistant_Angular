import { Component, OnInit, OnDestroy, ViewChild, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { AiThinkingOverlayComponent } from '../ai-thinking-overlay/ai-thinking-overlay.component';
import { ApiService } from '../api.service';
import { TestCasePrefillService } from '../test-case-prefill.service';
import { ToastService } from '../toast.service';

interface ChatMsg {
  role: string;
  content: string;
  timestamp?: string;
  attachments?: string[];
}

interface TicketInfo {
  ticket_id: string;
  summary: string;
  content?: string;
}

@Component({
  selector: 'app-ticket-analyzer',
  standalone: true,
  imports: [CommonModule, FormsModule, AiThinkingOverlayComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">Analyze Jira Ticket</h1>
      <p class="page-subtitle">Chat with AI to understand tickets, analyze logs, and get technical insights.</p>
    </header>

    <!-- ── Context Toolbar ── -->
    <div class="context-toolbar card">
      <div class="toolbar-group toolbar-tickets">
        <label class="toolbar-label">Tickets</label>
        <div class="input-with-btn">
          <input [(ngModel)]="ticketIdToAdd" placeholder="PROJ-123, PROJ-456" (keyup.enter)="addTicket()" />
          <button class="primary" (click)="addTicket()" [disabled]="loadingTicket">Load</button>
        </div>
      </div>

      <span class="toolbar-divider"></span>

      <div class="toolbar-group toolbar-attach">
        <input type="file" #fileInput multiple (change)="onFileSelect($event)" class="file-input-hidden" accept="image/*,.pdf,.doc,.docx,.txt" />
        <button type="button" class="secondary toolbar-attach-btn" (click)="fileInput.click()" [disabled]="uploadingAttachment" title="Attach files or paste images in the chat">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>
          {{ uploadingAttachment ? 'Uploading…' : 'Attach' }}
        </button>
      </div>

      <span class="toolbar-divider"></span>

      <div class="toolbar-group toolbar-model">
        <label class="toolbar-label">Model</label>
        <select [(ngModel)]="selectedModelId" (ngModelChange)="switchModel()" class="model-select" [disabled]="switchingModel" title="{{ modelOptions.length }} models available">
          @for (opt of modelOptions; track opt.value) {
            <option [value]="opt.value">{{ opt.label }}</option>
          }
        </select>
        <button type="button" class="icon-btn-sm" (click)="loadModels(true)" [disabled]="switchingModel" title="Refresh model list">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
        </button>
      </div>

      <label class="toolbar-kb-toggle" title="Use Knowledge Base as additional context">
        <input type="checkbox" [(ngModel)]="useRag" (ngModelChange)="toggleRag()" />
        <span>KB</span>
      </label>

      <span class="toolbar-spacer"></span>

      <div class="toolbar-group toolbar-convo">
        <input [(ngModel)]="conversationTitle" placeholder="Session title" class="convo-title-input" title="Optional title for saving" />
        <button class="secondary toolbar-sm-btn" (click)="saveConversation()" [disabled]="!messages.length" title="Save conversation">Save</button>
        <button class="secondary toolbar-sm-btn" (click)="clearChat()" [disabled]="!messages.length && !tickets.length" title="Clear chat and tickets">Clear</button>
        <div class="history-wrap">
          <button type="button" class="secondary toolbar-sm-btn" (click)="historyOpen = !historyOpen; $event.stopPropagation()" title="Previous sessions">
            History
            @if (conversations.length) { <span class="history-badge">{{ conversations.length }}</span> }
          </button>
          @if (historyOpen) {
            <div class="history-dropdown" (click)="$event.stopPropagation()">
              <div class="history-dropdown-header">
                <span>Previous Sessions</span>
                <button type="button" class="icon-btn" (click)="historyOpen = false">&times;</button>
              </div>
              @if (conversations.length) {
                @for (c of conversations; track c.id) {
                  <div class="convo-row">
                    <span class="convo-title">{{ c.title || c.id }}</span>
                    <button type="button" class="link-btn" (click)="loadConversation(c.id); historyOpen = false">Load</button>
                    <button type="button" class="link-btn danger-link" (click)="deleteConversation(c.id)">Delete</button>
                  </div>
                }
              } @else {
                <p class="history-empty">No saved sessions yet.</p>
              }
            </div>
          }
        </div>
      </div>
    </div>
    @if (switchingModel) {
      <p class="switching-hint">Switching to selected model, please wait…</p>
    }

    <!-- ── Ticket / Attachment Strip ── -->
    @if (tickets.length || attachments.length) {
      <div class="ticket-strip">
        @for (t of tickets; track t.ticket_id) {
          <div class="ticket-chip">
            <span class="chip-id">{{ t.ticket_id }}</span>
            <button type="button" class="link-btn view-details-link" (click)="viewTicketDetails(t.ticket_id)">View Details</button>
            @if (jiraServerUrl) {
              <a [href]="jiraServerUrl + '/browse/' + t.ticket_id" target="_blank" rel="noopener" class="open-jira-link" title="Open in Jira">Open in Jira</a>
            }
            <button type="button" class="icon-btn chip-remove" (click)="removeTicket(t.ticket_id)" title="Remove">&times;</button>
          </div>
        }
        @for (a of attachments; track a.name) {
          <div class="attachment-chip">
            <span class="chip-id">{{ a.name }}</span>
            <button type="button" class="icon-btn chip-remove" (click)="removeAttachment(a.name)" title="Remove">&times;</button>
          </div>
        }
        @if (tickets.length) {
          <button type="button" class="secondary gen-tc-btn" (click)="goToGenerateTestCases()">Generate Test Cases</button>
        }
      </div>
    }

    <!-- ── Empty State ── -->
    @if (!tickets.length && !attachments.length) {
      <div class="empty-state">
        <svg class="empty-icon" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
        </svg>
        <h3 class="empty-title">Load a Jira ticket to get started</h3>
        <p class="empty-text">Enter one or more ticket IDs in the toolbar above and click <strong>Load</strong>. You can also attach files for analysis.</p>
      </div>
    }

    <!-- ── Chat Area ── -->
    @if (tickets.length || attachments.length) {
      <div class="chat-area card">
        @if (lastError) {
          <div class="error-banner">
            <span>{{ lastError }}</span>
            <button type="button" class="link-btn" (click)="lastError = ''">Dismiss</button>
          </div>
        }

        <div class="quick-actions">
          <button class="secondary" (click)="quickAction('summarize')" [disabled]="loading || !tickets.length">Summarize</button>
          <button class="secondary" (click)="quickAction('find_gaps')" [disabled]="loading || !tickets.length">Find Gaps</button>
          <button class="secondary" (click)="quickAction('risk_analysis')" [disabled]="loading || !tickets.length">Risks</button>
          <button class="secondary" (click)="quickAction('technical_details')" [disabled]="loading || !tickets.length">Technical</button>
          <button class="secondary" (click)="quickAction('test_suggestions')" [disabled]="loading || !tickets.length">Test Ideas</button>
          <button class="secondary" (click)="quickAction('clarify_ac')" [disabled]="loading || !tickets.length">Clarify AC</button>
          <button class="secondary" (click)="quickAction('definition_of_done')" [disabled]="loading || !tickets.length">DoD Checklist</button>
          <button class="secondary" (click)="quickAction('dependencies_blockers')" [disabled]="loading || !tickets.length">Dependencies</button>
        </div>

        @if (!messages.length && !loading) {
          <p class="hint chat-hint">No messages yet. Ask a question or use a quick action above.</p>
        }

        <div class="chat-messages" #messagesEl>
          @if (loading && !messages.length) {
            <div class="skeleton-chat-placeholder">
              <div class="skeleton skeleton-bubble wide"></div>
              <div class="skeleton skeleton-bubble narrow"></div>
              <div class="skeleton skeleton-bubble wide"></div>
            </div>
          }
          @for (msg of messages; track $index) {
            <div class="msg" [class.user]="msg.role === 'user'" [class.assistant]="msg.role === 'assistant'" [class.msg-error]="msg.role === 'assistant' && msg.content.startsWith('Error:')">
              <strong>{{ msg.role === 'user' ? 'You' : 'Assistant' }}</strong>
              @if (msg.role === 'assistant') {
                <div class="msg-content msg-content-md" [innerHTML]="formatMessageContent(msg.content)"></div>
                <div class="msg-actions">
                  <button type="button" class="link-btn copy-btn" (click)="copyToClipboard(msg.content, $index)">
                    {{ copiedIndex === $index ? '✓ Copied' : 'Copy' }}
                  </button>
                  @if (tickets.length && !msg.content.startsWith('Error:')) {
                    <button type="button" class="link-btn post-jira-btn" (click)="postToJira(msg.content)">Post to Jira</button>
                  }
                  @if (msg.content.startsWith('Error:')) {
                    <button type="button" class="link-btn" (click)="retryLastAction()">Retry</button>
                  }
                </div>
              } @else {
                <pre class="msg-content">{{ msg.content }}</pre>
              }
            </div>
          }
        </div>

        <div class="chat-input-row">
          <textarea #inputEl [(ngModel)]="userMessage" placeholder="Ask about the ticket... (Ctrl+V to paste screenshot)" rows="2"
            (keydown.enter)="$event.preventDefault(); send()"
            (paste)="onChatPaste($event)"></textarea>
          <button class="primary" (click)="send()" [disabled]="loading || !userMessage.trim() || (!tickets.length && !attachments.length)">Send</button>
        </div>

        @if (messages.length) {
          <div class="export-row">
            <button class="secondary" (click)="exportMarkdown()">Export Markdown</button>
            <button class="secondary" (click)="exportJson()">Export JSON</button>
          </div>
        }
      </div>
    }

    <!-- ── Overlays ── -->
    @if (postToJiraOverlayOpen) {
      <div class="overlay-backdrop" (click)="cancelPostToJira()">
        <div class="overlay-panel overlay-panel--post-jira" (click)="$event.stopPropagation()">
          <div class="overlay-header">
            <h2 class="overlay-title">Post Comment to Jira</h2>
            <button type="button" class="overlay-close" (click)="cancelPostToJira()" aria-label="Close">&times;</button>
          </div>
          <div class="overlay-body">
            @if (tickets.length > 1) {
              <div class="post-jira-target">
                <span class="form-section-label">Post to ticket</span>
                <select [(ngModel)]="postToJiraTargetTicket" class="target-ticket-select">
                  @for (t of tickets; track t.ticket_id) {
                    <option [value]="t.ticket_id">{{ t.ticket_id }} — {{ t.summary || t.ticket_id }}</option>
                  }
                </select>
              </div>
            } @else {
              <p class="overlay-hint">This comment will be posted to <strong>{{ tickets[0].ticket_id }}</strong>.</p>
            }
            <div class="post-jira-preview">
              <span class="form-section-label">Comment</span>
              <textarea class="post-jira-textarea" [(ngModel)]="postToJiraDraft" rows="14" placeholder="Comment to post…"></textarea>
            </div>
            <div class="post-jira-preview-rendered">
              <span class="form-section-label">Preview</span>
              <div class="preview-pane msg-content-md" [innerHTML]="formatMessageContent(postToJiraDraft)"></div>
            </div>
          </div>
          <div class="overlay-footer">
            <button class="secondary" (click)="cancelPostToJira()">Cancel</button>
            <button class="primary" (click)="confirmPostToJira()" [disabled]="postingToJira || !postToJiraDraft.trim()">
              {{ postingToJira ? 'Posting…' : 'Post to Jira' }}
            </button>
          </div>
        </div>
      </div>
    }

    @if (genTcOverlayOpen) {
      <div class="overlay-backdrop" (click)="cancelGenTc()">
        <div class="overlay-panel overlay-panel--gen-tc" (click)="$event.stopPropagation()">
          <div class="overlay-header">
            <h2 class="overlay-title">Select a ticket</h2>
            <button class="overlay-close" (click)="cancelGenTc()">&times;</button>
          </div>
          <div class="overlay-body">
            <p class="gen-tc-hint">Choose which ticket to generate test cases for:</p>
            <div class="gen-tc-radio-list">
              @for (t of tickets; track t.ticket_id) {
                <label class="gen-tc-radio-item" [class.selected]="genTcSelectedTicket === t.ticket_id">
                  <input type="radio" name="genTcTicket" [value]="t.ticket_id" [(ngModel)]="genTcSelectedTicket" />
                  <span class="gen-tc-radio-id">{{ t.ticket_id }}</span>
                  @if (t.summary) {
                    <span class="gen-tc-radio-summary">{{ t.summary }}</span>
                  }
                </label>
              }
            </div>
          </div>
          <div class="overlay-footer">
            <button class="secondary" (click)="cancelGenTc()">Cancel</button>
            <button class="primary" (click)="confirmGenTc()" [disabled]="!genTcSelectedTicket">Continue</button>
          </div>
        </div>
      </div>
    }

    @if (ticketDetailOverlayOpen) {
      <div class="overlay-backdrop" (click)="closeTicketDetails()">
        <div class="overlay-panel overlay-panel--ticket-detail" (click)="$event.stopPropagation()">
          @if (loadingTicketDetails) {
            <div class="overlay-body" style="padding:2rem;text-align:center">
              <span class="loading-spinner"></span> Loading ticket details…
            </div>
          } @else if (ticketDetailData) {
            <div class="overlay-header">
              <h2 class="overlay-title">{{ ticketDetailData.ticket_id }} — {{ ticketDetailData.summary }}</h2>
              <button class="overlay-close" (click)="closeTicketDetails()">&times;</button>
            </div>
            <div class="overlay-body ticket-detail-body">
              <div class="td-meta-grid">
                <div class="td-meta-item"><span class="td-meta-label">Status</span><span class="td-meta-value td-badge">{{ ticketDetailData.status || '—' }}</span></div>
                <div class="td-meta-item"><span class="td-meta-label">Priority</span><span class="td-meta-value">{{ ticketDetailData.priority || '—' }}</span></div>
                <div class="td-meta-item"><span class="td-meta-label">Type</span><span class="td-meta-value">{{ ticketDetailData.issue_type || '—' }}</span></div>
                <div class="td-meta-item"><span class="td-meta-label">Assignee</span><span class="td-meta-value">{{ ticketDetailData.assignee || 'Unassigned' }}</span></div>
                <div class="td-meta-item"><span class="td-meta-label">Reporter</span><span class="td-meta-value">{{ ticketDetailData.reporter || '—' }}</span></div>
                @if (ticketDetailData.labels?.length) {
                  <div class="td-meta-item"><span class="td-meta-label">Labels</span><span class="td-meta-value">{{ ticketDetailData.labels.join(', ') }}</span></div>
                }
                @if (ticketDetailData.components?.length) {
                  <div class="td-meta-item"><span class="td-meta-label">Components</span><span class="td-meta-value">{{ ticketDetailData.components.join(', ') }}</span></div>
                }
              </div>

              @if (ticketDetailData.description) {
                <div class="td-section">
                  <h4 class="td-section-title">Description</h4>
                  <div class="td-section-body td-rendered" [innerHTML]="trustHtml(ticketDetailData.description)"></div>
                </div>
              }
              @if (ticketDetailData.acceptance_criteria) {
                <div class="td-section">
                  <h4 class="td-section-title">Acceptance Criteria</h4>
                  <div class="td-section-body td-rendered" [innerHTML]="trustHtml(ticketDetailData.acceptance_criteria)"></div>
                </div>
              }
              @if (ticketDetailData.steps_to_reproduce) {
                <div class="td-section">
                  <h4 class="td-section-title">Steps to Reproduce</h4>
                  <div class="td-section-body td-rendered" [innerHTML]="trustHtml(ticketDetailData.steps_to_reproduce)"></div>
                </div>
              }
              @if (ticketDetailData.environment) {
                <div class="td-section">
                  <h4 class="td-section-title">Environment</h4>
                  <div class="td-section-body td-rendered" [innerHTML]="trustHtml(ticketDetailData.environment)"></div>
                </div>
              }
              @if (ticketDetailData.linked_issues?.length) {
                <div class="td-section">
                  <h4 class="td-section-title">Linked Issues</h4>
                  <ul class="td-list">
                    @for (li of ticketDetailData.linked_issues; track li.key) {
                      <li><strong>{{ li.relationship }}</strong>: {{ li.key }} — {{ li.summary }}</li>
                    }
                  </ul>
                </div>
              }
              @if (ticketDetailData.subtasks?.length) {
                <div class="td-section">
                  <h4 class="td-section-title">Subtasks</h4>
                  <ul class="td-list">
                    @for (st of ticketDetailData.subtasks; track st.key) {
                      <li>{{ st.key }} — {{ st.summary }} <span class="td-badge">{{ st.status }}</span></li>
                    }
                  </ul>
                </div>
              }
              @if (ticketDetailData.attachments?.length) {
                <div class="td-section">
                  <h4 class="td-section-title">Attachments</h4>
                  <ul class="td-list">
                    @for (att of ticketDetailData.attachments; track att.filename) {
                      <li>{{ att.filename }} ({{ att.size_kb }} KB)</li>
                    }
                  </ul>
                </div>
              }
              @if (ticketDetailData.comments?.length) {
                <div class="td-section">
                  <h4 class="td-section-title">
                    Comments ({{ ticketDetailData.comments.length }})
                    <button type="button" class="link-btn" (click)="commentsExpanded = !commentsExpanded">
                      {{ commentsExpanded ? 'Hide' : 'Show' }}
                    </button>
                  </h4>
                  @if (commentsExpanded) {
                    @for (c of ticketDetailData.comments; track c.date + c.author) {
                      <div class="td-comment">
                        <span class="td-comment-meta">{{ c.author }} · {{ c.date }}</span>
                        <div class="td-comment-body td-rendered" [innerHTML]="trustHtml(c.body)"></div>
                      </div>
                    }
                  }
                </div>
              }
            </div>
            <div class="overlay-footer overlay-footer--spaced">
              <div>
                @if (jiraServerUrl && ticketDetailData.ticket_id) {
                  <a [href]="jiraServerUrl + '/browse/' + ticketDetailData.ticket_id" target="_blank" rel="noopener" class="primary">Open in Jira</a>
                }
              </div>
              <button class="secondary" (click)="closeTicketDetails()">Close</button>
            </div>
          }
        </div>
      </div>
    }

    <app-ai-thinking-overlay
      [open]="loading || loadingTicket || switchingModel || uploadingAttachment"
      [title]="analyzerThinkingTitle"
      [subtitle]="analyzerThinkingSubtitle"
    />
  `,
  styles: [`
    /* ── Page header ── */
    .page-header { margin-bottom: var(--space-md); }
    .page-subtitle { margin: 0; font-size: 0.9rem; }

    /* ── Animations ── */
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes chipSlideIn {
      from { opacity: 0; transform: translateX(-6px) scale(0.96); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes qaBtnEnter {
      from { opacity: 0; transform: scale(0.92); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes msgSlideRight {
      from { opacity: 0; transform: translateX(10px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes msgSlideLeft {
      from { opacity: 0; transform: translateX(-10px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes emptyFadeIn {
      from { opacity: 0; transform: translateY(18px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    /* ── Context Toolbar ── */
    .context-toolbar {
      display: flex; flex-wrap: wrap; align-items: center;
      gap: 0.5rem 0.75rem;
      padding: 0.65rem 1rem;
      animation: slideIn 0.35s cubic-bezier(0.22,1,0.36,1) both;
    }
    .toolbar-group { display: flex; align-items: center; gap: 0.4rem; }
    .toolbar-label {
      font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--app-text-muted); white-space: nowrap;
    }
    .toolbar-tickets .input-with-btn { display: flex; gap: 0.35rem; align-items: stretch; }
    .toolbar-tickets .input-with-btn input { width: 190px; margin: 0; font-size: 0.85rem; padding: 0.35rem 0.55rem; }
    .toolbar-tickets .input-with-btn button { flex-shrink: 0; }
    .toolbar-divider {
      width: 1px; height: 1.6rem; background: var(--app-card-border); flex-shrink: 0;
    }
    .file-input-hidden { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    .toolbar-attach { position: relative; }
    .toolbar-attach-btn {
      display: flex; align-items: center; gap: 0.3rem; font-size: 0.82rem; padding: 0.35rem 0.65rem;
    }
    .toolbar-model .model-select {
      min-height: 1.9rem; font-size: 0.82rem; max-width: 220px; padding: 0.2rem 0.35rem;
    }
    .icon-btn-sm {
      background: none; border: 1px solid var(--app-input-border); border-radius: 5px;
      cursor: pointer; padding: 0.3rem; color: var(--app-text-muted); display: flex;
      transition: color 0.15s, border-color 0.15s;
    }
    .icon-btn-sm:hover { color: var(--hyland-blue); border-color: var(--hyland-blue); }
    .icon-btn-sm:disabled { opacity: 0.4; cursor: not-allowed; }
    .toolbar-kb-toggle {
      display: flex; align-items: center; gap: 0.3rem;
      font-size: 0.82rem; font-weight: 600; cursor: pointer; white-space: nowrap;
      color: var(--app-text);
    }
    .toolbar-kb-toggle input { margin: 0; }
    .toolbar-spacer { flex: 1; min-width: 0.5rem; }
    .toolbar-convo { gap: 0.35rem; }
    .convo-title-input { width: 130px; margin: 0; font-size: 0.82rem; padding: 0.35rem 0.5rem; }
    .toolbar-sm-btn { font-size: 0.78rem; padding: 0.3rem 0.55rem; white-space: nowrap; }
    .switching-hint {
      font-size: 0.8rem; color: var(--hyland-teal, #13eac1); text-align: center;
      margin: 0.35rem 0 0; font-weight: 600;
    }

    /* ── History Dropdown ── */
    .history-wrap { position: relative; }
    .history-badge {
      font-size: 0.65rem; font-weight: 700; background: var(--hyland-blue); color: #fff;
      padding: 0.05rem 0.35rem; border-radius: 8px; margin-left: 0.2rem; vertical-align: top;
    }
    .history-dropdown {
      position: absolute; top: calc(100% + 6px); right: 0; z-index: 500;
      width: 300px; max-height: 280px; overflow-y: auto;
      background: var(--app-card-bg); border: 1px solid var(--app-card-border);
      border-radius: var(--radius-sm, 8px);
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      padding: 0.5rem;
      animation: slideIn 0.2s ease both;
    }
    .history-dropdown-header {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: 0.35rem; margin-bottom: 0.35rem;
      border-bottom: 1px solid var(--app-card-border);
      font-size: 0.78rem; font-weight: 700; color: var(--app-text-muted);
      text-transform: uppercase; letter-spacing: 0.04em;
    }
    .convo-row {
      display: flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.15rem;
      font-size: 0.83rem; border-radius: 4px;
    }
    .convo-row:hover { background: var(--app-surface-muted); }
    .convo-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--app-text); }
    .history-empty { font-size: 0.82rem; color: var(--app-text-muted); text-align: center; padding: 0.5rem; margin: 0; }

    /* ── Ticket / Attachment Strip ── */
    .ticket-strip {
      display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem;
      margin-top: var(--space-sm);
      animation: slideIn 0.3s cubic-bezier(0.22,1,0.36,1) 0.05s both;
    }
    .ticket-chip, .attachment-chip {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.3rem 0.6rem;
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border);
      border-radius: var(--radius-sm, 6px); font-size: 0.82rem;
      animation: chipSlideIn 0.25s cubic-bezier(0.22,1,0.36,1) both;
    }
    .chip-id { font-weight: 700; color: var(--app-text); white-space: nowrap; }
    .view-details-link { font-size: 0.75rem; font-weight: 600; }
    .open-jira-link { font-size: 0.75rem; color: var(--hyland-blue); font-weight: 600; white-space: nowrap; }
    .open-jira-link:hover { text-decoration: underline; }
    .chip-remove {
      background: none; border: none; cursor: pointer; font-size: 1rem; line-height: 1;
      padding: 0 0.15rem; color: var(--app-icon-muted);
    }
    .chip-remove:hover { color: #c00; }
    .gen-tc-btn { font-size: 0.8rem; padding: 0.3rem 0.7rem; white-space: nowrap; }

    /* ── Empty State ── */
    .empty-state {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      padding: 3.5rem 2rem; text-align: center;
      animation: emptyFadeIn 0.5s cubic-bezier(0.22,1,0.36,1) 0.1s both;
    }
    .empty-icon { color: var(--app-text-muted); opacity: 0.35; margin-bottom: 1rem; }
    .empty-title { font-size: 1.15rem; font-weight: 700; color: var(--app-text); margin: 0 0 0.5rem; }
    .empty-text { font-size: 0.9rem; color: var(--app-text-muted); max-width: 440px; margin: 0; line-height: 1.5; }

    /* ── Chat Area ── */
    .chat-area {
      margin-top: var(--space-sm);
      padding: var(--space-lg) var(--space-xl);
      display: flex; flex-direction: column;
      animation: slideIn 0.4s cubic-bezier(0.22,1,0.36,1) 0.08s both;
    }
    .quick-actions {
      display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md);
    }
    .quick-actions button {
      transition: all 0.25s cubic-bezier(0.22,1,0.36,1);
      animation: qaBtnEnter 0.25s cubic-bezier(0.22,1,0.36,1) both;
    }
    .quick-actions button:nth-child(1) { animation-delay: 0.02s; }
    .quick-actions button:nth-child(2) { animation-delay: 0.04s; }
    .quick-actions button:nth-child(3) { animation-delay: 0.06s; }
    .quick-actions button:nth-child(4) { animation-delay: 0.08s; }
    .quick-actions button:nth-child(5) { animation-delay: 0.10s; }
    .quick-actions button:nth-child(6) { animation-delay: 0.12s; }
    .quick-actions button:nth-child(7) { animation-delay: 0.14s; }
    .quick-actions button:nth-child(8) { animation-delay: 0.16s; }
    .quick-actions button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 2px 10px rgba(82,161,255,0.15);
    }
    .chat-hint { text-align: center; padding: var(--space-lg) 0; }
    .chat-messages {
      flex: 1; max-height: 56vh; overflow-y: auto;
      margin-bottom: var(--space-md); padding-right: var(--space-sm);
    }
    .msg {
      margin-bottom: var(--space-md); padding: var(--space-md);
      border-radius: var(--radius-sm); font-size: 0.9rem;
    }
    .msg.user {
      background: var(--app-chat-user-bg); margin-left: var(--space-xl);
      animation: msgSlideRight 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    .msg.assistant {
      background: var(--app-surface-muted); margin-right: var(--space-xl);
      animation: msgSlideLeft 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    .msg-content { white-space: pre-wrap; margin-top: var(--space-xs); font-size: 0.9rem; }
    .msg-content ::ng-deep p { margin: var(--space-xs) 0; }
    .msg-actions { display: flex; gap: var(--space-md); margin-top: var(--space-sm); align-items: center; }
    .copy-btn { font-size: 0.85rem; transition: color 0.2s; }
    .copy-btn:hover { color: var(--hyland-blue); }
    .post-jira-btn { font-size: 0.85rem; }
    .chat-input-row { display: flex; gap: var(--space-sm); align-items: flex-end; }
    .chat-input-row textarea { flex: 1; min-height: 48px; resize: vertical; font-size: 0.9rem; }
    .export-row { display: flex; gap: var(--space-sm); margin-top: var(--space-md); }
    .hint { color: var(--app-text-muted); font-size: 0.85rem; margin: var(--space-sm) 0; }
    .error-banner {
      display: flex; align-items: center; justify-content: space-between;
      padding: var(--space-sm); background: rgba(200,0,0,0.08);
      border-left: 4px solid #c00; margin-bottom: var(--space-sm); font-size: 0.9rem;
    }
    .msg-content-md { white-space: pre-wrap; margin-top: var(--space-xs); font-size: 0.9rem; }
    .msg-content-md ::ng-deep p { margin: var(--space-xs) 0; }
    .msg-content-md ::ng-deep ul, .msg-content-md ::ng-deep ol { margin: 0.25rem 0; padding-left: 1.25rem; }
    .msg-content-md ::ng-deep code { background: var(--app-code-bg); padding: 0.1rem 0.3rem; border-radius: 3px; }
    .msg.msg-error .msg-content-md { color: #c00; }

    /* ── Shared btn / link ── */
    .link-btn { background: none; border: none; color: var(--hyland-blue); cursor: pointer; font-size: 0.8rem; padding: 0; }
    .link-btn:hover { text-decoration: underline; }
    .danger-link { color: #c00; }
    .icon-btn { background: none; border: none; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 0.2rem; color: var(--app-icon-muted); }
    .icon-btn:hover { color: #c00; }
    .form-section-label { font-size: 0.75rem; margin-bottom: var(--space-xs); }

    /* ── Overlay base ── */
    .overlay-backdrop {
      position: fixed; inset: 0; background: rgba(0,0,0,0.45); z-index: 1000;
      display: flex; align-items: center; justify-content: center;
      animation: overlayFadeIn 0.2s ease-out both;
    }
    .overlay-panel {
      background: var(--app-card-bg); border-radius: var(--radius-md, 12px);
      box-shadow: 0 12px 48px rgba(0,0,0,0.25);
      max-height: 88vh; display: flex; flex-direction: column;
      border: 1px solid var(--app-card-border);
      animation: overlaySlideUp 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    .overlay-panel--post-jira { width: 720px; max-width: 92vw; }
    .overlay-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem; border-bottom: 1px solid var(--app-card-border); flex-shrink: 0;
    }
    .overlay-title { font-size: 1.1rem; font-weight: 700; margin: 0; }
    .overlay-close {
      background: none; border: none; font-size: 1.5rem; cursor: pointer;
      color: var(--app-text-muted); line-height: 1; padding: 0 0.25rem;
      border-radius: 4px; transition: color 0.15s, background 0.15s;
    }
    .overlay-close:hover { color: var(--app-text); background: rgba(82,161,255,0.12); }
    .overlay-body { padding: 1rem 1.25rem; overflow-y: auto; flex: 1; min-height: 0; }
    .overlay-hint { font-size: 0.85rem; color: var(--app-text-muted); margin: 0 0 0.75rem; }
    .overlay-footer {
      display: flex; justify-content: flex-end; gap: var(--space-sm);
      padding: 0.75rem 1.25rem; border-top: 1px solid var(--app-card-border); flex-shrink: 0;
      align-items: center;
    }
    .overlay-footer--spaced { justify-content: space-between; }
    .post-jira-target { margin-bottom: 0.75rem; }
    .target-ticket-select {
      width: 100%; margin-top: 0.25rem; font-size: 0.88rem; padding: 0.4rem 0.5rem;
      border-radius: var(--radius-sm, 6px); border: 1px solid var(--app-input-border);
      background: var(--app-input-bg); color: var(--app-text);
    }
    .post-jira-preview { margin-bottom: 1rem; }
    .post-jira-textarea {
      width: 100%; font-family: 'Source Sans 3', sans-serif; font-size: 0.9rem;
      padding: 0.6rem 0.75rem; border: 1px solid var(--app-input-border);
      border-radius: var(--radius-sm, 6px); background: var(--app-input-bg);
      color: var(--app-text); resize: vertical; min-height: 120px;
    }
    .post-jira-textarea:focus { outline: none; border-color: var(--hyland-blue); box-shadow: 0 0 0 2px rgba(0,99,177,0.12); }
    .post-jira-preview-rendered { margin-bottom: 0.5rem; }
    .preview-pane {
      border: 1px solid var(--app-card-border); border-radius: var(--radius-sm, 6px);
      padding: 0.75rem; min-height: 80px; max-height: 200px; overflow-y: auto;
      background: var(--app-surface-muted); font-size: 0.9rem; white-space: pre-wrap;
    }

    /* ── Generate Test Cases Picker Overlay ── */
    .overlay-panel--gen-tc { width: 480px; max-width: 92vw; }
    .gen-tc-hint { font-size: 0.88rem; color: var(--app-text-muted); margin: 0 0 0.75rem; }
    .gen-tc-radio-list { display: flex; flex-direction: column; gap: 0.4rem; }
    .gen-tc-radio-item {
      display: flex; align-items: center; gap: 0.6rem; cursor: pointer;
      padding: 0.55rem 0.75rem; border-radius: var(--radius-sm, 6px);
      border: 1px solid var(--app-card-border); background: var(--app-surface-muted);
      font-size: 0.88rem; transition: border-color 0.15s, background 0.15s;
    }
    .gen-tc-radio-item:hover { border-color: var(--hyland-blue); }
    .gen-tc-radio-item.selected { border-color: var(--hyland-blue); background: rgba(0,99,177,0.08); }
    .gen-tc-radio-item input[type="radio"] { accent-color: var(--hyland-blue); margin: 0; width: auto; flex: 0 0 auto; }
    .gen-tc-radio-id { font-weight: 700; color: var(--app-text); white-space: nowrap; }
    .gen-tc-radio-summary { color: var(--app-text-muted); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* ── Ticket Detail Overlay ── */
    .overlay-panel--ticket-detail {
      width: 780px; max-width: 94vw; max-height: 88vh;
      display: flex; flex-direction: column;
    }
    .ticket-detail-body { overflow-y: auto; padding: 1.25rem 1.5rem; flex: 1; }
    .td-meta-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.6rem 1.2rem; margin-bottom: 1.25rem;
    }
    .td-meta-item { display: flex; flex-direction: column; gap: 0.15rem; }
    .td-meta-label { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--app-text-muted); }
    .td-meta-value { font-size: 0.88rem; color: var(--app-text); }
    .td-badge {
      display: inline-block; font-size: 0.78rem; font-weight: 700;
      padding: 0.15rem 0.5rem; border-radius: 6px;
      background: var(--hyland-blue); color: #fff;
    }
    .td-section { margin-bottom: 1rem; }
    .td-section-title { font-size: 0.88rem; font-weight: 700; margin-bottom: 0.35rem; color: var(--app-text); display: flex; align-items: center; gap: 0.5rem; }
    .td-section-body {
      white-space: pre-wrap; word-break: break-word; font-size: 0.85rem; line-height: 1.55;
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border);
      border-radius: var(--radius-sm); padding: 0.75rem 1rem; max-height: 300px; overflow-y: auto;
      font-family: inherit; margin: 0;
    }
    .td-list { margin: 0.25rem 0 0 1.2rem; font-size: 0.85rem; line-height: 1.6; }
    .td-comment { margin-top: 0.5rem; padding: 0.5rem 0.75rem; background: var(--app-surface-muted); border-radius: var(--radius-sm); border: 1px solid var(--app-card-border); }
    .td-comment-meta { font-size: 0.76rem; font-weight: 600; color: var(--app-text-muted); }
    .td-comment-body { word-break: break-word; font-size: 0.83rem; line-height: 1.5; margin: 0.25rem 0 0; font-family: inherit; }
    .td-rendered { white-space: normal; }
    .td-rendered ::ng-deep p { margin: 0.3rem 0; }
    .td-rendered ::ng-deep ul, .td-rendered ::ng-deep ol { margin: 0.3rem 0 0.3rem 1.2rem; padding: 0; }
    .td-rendered ::ng-deep li { margin: 0.15rem 0; }
    .td-rendered ::ng-deep a { color: var(--hyland-blue); text-decoration: underline; }
    .td-rendered ::ng-deep a:hover { opacity: 0.85; }
    .td-rendered ::ng-deep blockquote {
      border-left: 3px solid var(--app-card-border); margin: 0.4rem 0; padding: 0.3rem 0.75rem;
      color: var(--app-text-muted); font-style: italic;
    }
    .td-rendered ::ng-deep pre {
      background: rgba(0,0,0,0.15); border-radius: 4px; padding: 0.5rem 0.75rem;
      font-size: 0.82rem; overflow-x: auto; white-space: pre-wrap; margin: 0.4rem 0;
    }
    .td-rendered ::ng-deep code { font-size: 0.82rem; }
    .td-rendered ::ng-deep h1, .td-rendered ::ng-deep h2, .td-rendered ::ng-deep h3,
    .td-rendered ::ng-deep h4, .td-rendered ::ng-deep h5, .td-rendered ::ng-deep h6 {
      margin: 0.5rem 0 0.25rem; font-weight: 700;
    }
    .td-rendered ::ng-deep strong { font-weight: 700; }
    .td-rendered ::ng-deep em { font-style: italic; }
    .td-rendered ::ng-deep u { text-decoration: underline; }
    .td-rendered ::ng-deep del { text-decoration: line-through; opacity: 0.7; }
    .td-rendered ::ng-deep table {
      border-collapse: collapse; margin: 0.4rem 0; font-size: 0.83rem; width: 100%;
    }
    .td-rendered ::ng-deep th, .td-rendered ::ng-deep td {
      border: 1px solid var(--app-card-border); padding: 0.3rem 0.5rem; text-align: left;
    }
    .td-rendered ::ng-deep th { font-weight: 700; background: rgba(0,0,0,0.06); }
    .td-rendered ::ng-deep img { max-width: 100%; height: auto; border-radius: 4px; }

    /* ── Responsive ── */
    @media (max-width: 700px) {
      .context-toolbar { flex-direction: column; align-items: stretch; }
      .toolbar-divider { width: 100%; height: 1px; }
      .toolbar-spacer { display: none; }
      .toolbar-tickets .input-with-btn input { width: 100%; }
      .toolbar-convo { flex-wrap: wrap; }
      .convo-title-input { flex: 1; min-width: 80px; }
      .history-dropdown { right: auto; left: 0; }
      .overlay-panel--post-jira, .overlay-panel--ticket-detail, .overlay-panel--gen-tc { width: 98vw; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-delay: 0s !important;
        transition-duration: 0.01ms !important;
      }
    }
  `],
})
export class TicketAnalyzerComponent implements OnInit, OnDestroy {
  @ViewChild('messagesEl') messagesEl?: ElementRef<HTMLDivElement>;
  @ViewChild('inputEl') inputEl?: ElementRef<HTMLTextAreaElement>;

  ticketIdToAdd = '';
  userMessage = '';
  tickets: TicketInfo[] = [];
  attachments: { name: string; content_type?: string }[] = [];
  messages: ChatMsg[] = [];
  conversations: { id: string; title?: string }[] = [];
  modelOptions: { label: string; value: string }[] = [];
  selectedModelId = '';
  useRag = false;
  loading = false;
  loadingTicket = false;
  switchingModel = false;
  uploadingAttachment = false;
  lastError = '';
  conversationTitle = '';
  jiraServerUrl = '';
  copiedIndex: number | null = null;
  private copiedTimer: any = null;
  postToJiraOverlayOpen = false;
  postToJiraDraft = '';
  postingToJira = false;
  postToJiraTargetTicket = '';
  genTcOverlayOpen = false;
  genTcSelectedTicket = '';
  ticketDetailOverlayOpen = false;
  ticketDetailData: any = null;
  loadingTicketDetails = false;
  commentsExpanded = false;
  historyOpen = false;
  private lastSentMessage = '';
  private lastQuickActionKey = '';

  constructor(
    private api: ApiService,
    private router: Router,
    private testCasePrefill: TestCasePrefillService,
    private toast: ToastService,
    private sanitizer: DomSanitizer,
  ) {}

  get analyzerThinkingTitle(): string {
    if (this.uploadingAttachment) return 'Uploading attachment';
    if (this.loadingTicket && !this.loading) return 'Loading tickets';
    if (this.switchingModel) return 'Switching model';
    return 'Assistant is thinking';
  }

  get analyzerThinkingSubtitle(): string {
    if (this.uploadingAttachment) return 'Processing and indexing the file — large documents may take a moment…';
    if (this.loadingTicket && !this.loading) return 'Fetching ticket details from Jira…';
    if (this.switchingModel) return 'Updating the chat session with your selected model…';
    return 'Processing your message or quick action…';
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.genTcOverlayOpen) { this.cancelGenTc(); return; }
    if (this.ticketDetailOverlayOpen) { this.closeTicketDetails(); return; }
    if (this.postToJiraOverlayOpen) { this.cancelPostToJira(); return; }
    if (this.historyOpen) { this.historyOpen = false; }
  }

  ngOnInit(): void {
    this.loadModelsWithConfigDefault();
    this.loadState();
    this.loadConversations();
    this.loadConnectionSettings();
  }

  loadConnectionSettings(): void {
    this.api.get<{ jira_server?: string }>('/connection-settings').subscribe({
      next: (res) => { this.jiraServerUrl = (res?.jira_server || '').replace(/\/$/, ''); },
      error: () => {},
    });
  }

  goToGenerateTestCases(): void {
    if (!this.tickets.length) return;
    if (this.tickets.length === 1) {
      this.testCasePrefill.setPrefill('jira', this.tickets[0].ticket_id);
      this.router.navigate(['/test-cases']);
      return;
    }
    this.genTcSelectedTicket = this.tickets[0].ticket_id;
    this.genTcOverlayOpen = true;
  }

  confirmGenTc(): void {
    if (!this.genTcSelectedTicket) return;
    this.testCasePrefill.setPrefill('jira', this.genTcSelectedTicket);
    this.genTcOverlayOpen = false;
    this.genTcSelectedTicket = '';
    this.router.navigate(['/test-cases']);
  }

  cancelGenTc(): void {
    this.genTcOverlayOpen = false;
    this.genTcSelectedTicket = '';
  }

  ngOnDestroy(): void {
    if (this.copiedTimer) {
      clearTimeout(this.copiedTimer);
      this.copiedTimer = null;
    }
  }

  /** Load model list and set default to the model from Configuration (same session). Prefer init-status current_model_id so Ticket Analyzer always matches Config. */
  loadModelsWithConfigDefault(): void {
    const setModelsAndDefault = (defaultId: string) => {
      this.api.get<{ models: Record<string, string>; default_model_id?: string | null }>('/bedrock-models').subscribe({
        next: (res) => {
          const models = res?.models ?? {};
          const fromApi = (res?.default_model_id ?? '').toString().trim();
          this.modelOptions = Object.entries(models).map(([label, value]) => ({ label: String(label), value: String(value) }));
          if (this.modelOptions.length) {
            const chosen = this.pickModelIdFromList(this.modelOptions, defaultId || fromApi);
            this.selectedModelId = chosen;
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

  /** Pick the best matching option value for the config default; always returns a value from the list when list is non-empty. */
  private pickModelIdFromList(options: { label: string; value: string }[], defaultId: string): string {
    if (!options.length) return '';
    const trim = (s: string) => (s || '').trim();
    const d = trim(defaultId);
    if (!d) return options[0].value;
    const matchByValue = options.find(o => trim(o.value) === d);
    if (matchByValue) return matchByValue.value;
    const matchByLabel = options.find(o => trim(o.label) === d);
    if (matchByLabel) return matchByLabel.value;
    const matchByValueContains = options.find(o => trim(o.value).includes(d) || d.includes(trim(o.value)));
    if (matchByValueContains) return matchByValueContains.value;
    return options[0].value;
  }

  loadModels(showToast = false): void {
    const applyModels = (defaultId: string) => {
      this.api.get<{ models: Record<string, string>; default_model_id?: string | null }>('/bedrock-models').subscribe({
        next: (res) => {
          const models = res?.models ?? {};
          const fromApi = (res?.default_model_id ?? '').toString().trim();
          this.modelOptions = Object.entries(models).map(([label, value]) => ({ label: String(label), value: String(value) }));
          if (this.modelOptions.length) {
            this.selectedModelId = this.pickModelIdFromList(this.modelOptions, defaultId || fromApi);
          }
          if (showToast) this.toast.success(`Model list updated — ${this.modelOptions.length} model${this.modelOptions.length !== 1 ? 's' : ''} available.`);
        },
        error: () => { this.toast.error('Failed to load model list.'); },
      });
    };
    this.api.get<{ initialized?: boolean; current_model_id?: string | null }>('/init-status').subscribe({
      next: (res) => {
        const inUse = (res?.current_model_id ?? '').toString().trim();
        applyModels(inUse);
      },
      error: () => applyModels(''),
    });
  }

  loadState(): void {
    this.api.get<{
      tickets?: Record<string, TicketInfo>;
      attachments?: { name: string; content_type?: string }[];
      messages?: ChatMsg[];
      current_model?: string;
      use_rag?: boolean;
    }>('/chat/state').subscribe({
      next: (res) => {
        this.tickets = res?.tickets ? Object.values(res.tickets) : [];
        this.attachments = res?.attachments ?? [];
        this.messages = (res?.messages ?? []).filter((m: ChatMsg) => m.role !== 'system');
        // Keep default model from Configuration (init-status); do not overwrite with chat's current_model
        if (res?.use_rag !== undefined) this.useRag = res.use_rag;
      },
      error: () => {},
    });
  }

  loadConversations(): void {
    this.api.get<{ conversations: { id: string; title?: string }[] }>('/conversations', { limit: '10' }).subscribe({
      next: (res) => { this.conversations = res?.conversations ?? []; },
      error: () => {},
    });
  }

  addTicket(): void {
    const raw = this.ticketIdToAdd.trim();
    if (!raw) return;
    const ids = raw.split(',').map(s => s.trim().split('/').pop() || s.trim()).filter(Boolean);
    this.loadingTicket = true;
    let done = 0;
    const failed: string[] = [];
    ids.forEach(id => {
      this.api.postForm('/chat/add-ticket', { ticket_id: id }).subscribe({
        next: () => {
          done++;
          this.ticketIdToAdd = '';
          if (done === ids.length) { this.loadingTicket = false; this.loadState(); if (failed.length) this.toast.error(`Could not load ticket${failed.length > 1 ? 's' : ''}: ${failed.join(', ')}`); }
        },
        error: (err: any) => {
          done++;
          const detail = err?.error?.detail || `Ticket ${id} not found or could not be loaded.`;
          failed.push(id);
          if (done === ids.length) { this.loadingTicket = false; this.loadState(); this.toast.error(failed.length > 1 ? `Could not load tickets: ${failed.join(', ')}` : detail); }
        },
      });
    });
    if (ids.length === 0) this.loadingTicket = false;
  }

  removeTicket(ticketId: string): void {
    this.api.postForm('/chat/remove-ticket', { ticket_id: ticketId, clear_history: 'true' }).subscribe({
      next: () => this.loadState(),
      error: () => {},
    });
  }

  viewTicketDetails(ticketId: string): void {
    this.loadingTicketDetails = true;
    this.ticketDetailOverlayOpen = true;
    this.ticketDetailData = null;
    this.commentsExpanded = false;
    this.api.get<any>(`/jira/ticket-info?ticket_id=${encodeURIComponent(ticketId)}`).subscribe({
      next: (data) => {
        this.ticketDetailData = data;
        this.loadingTicketDetails = false;
      },
      error: () => {
        this.toast.error(`Could not load details for ${ticketId}`);
        this.ticketDetailOverlayOpen = false;
        this.loadingTicketDetails = false;
      },
    });
  }

  closeTicketDetails(): void {
    this.ticketDetailOverlayOpen = false;
    this.ticketDetailData = null;
  }

  onFileSelect(e: Event): void {
    const input = e.target as HTMLInputElement;
    const files = input.files ? Array.from(input.files) : [];
    if (!files.length) return;
    this.uploadingAttachment = true;
    let done = 0;
    const failed: string[] = [];
    files.forEach(file => {
      this.api.postFile('/chat/add-attachment', file).subscribe({
        next: () => {
          done++;
          input.value = '';
          if (done === files.length) { this.uploadingAttachment = false; this.loadState(); if (failed.length) this.toast.error(`Failed to attach: ${failed.join(', ')}`); }
        },
        error: () => {
          done++;
          failed.push(file.name);
          if (done === files.length) { this.uploadingAttachment = false; this.loadState(); this.toast.error(`Failed to attach: ${failed.join(', ')}`); }
        },
      });
    });
  }

  /** Handle paste in chat input: if clipboard contains an image, attach it and prevent default. */
  onChatPaste(e: ClipboardEvent): void {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return;
        const ext = item.type === 'image/png' ? 'png' : 'jpg';
        const file = new File([blob], `pasted_${Date.now()}.${ext}`, { type: item.type });
        this.uploadingAttachment = true;
        this.api.postFile('/chat/add-attachment', file).subscribe({
          next: () => { this.uploadingAttachment = false; this.loadState(); },
          error: () => { this.uploadingAttachment = false; this.toast.error('Failed to attach pasted image.'); },
        });
        return;
      }
    }
  }

  trustHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html || '');
  }

  /** Render assistant message as markdown (headings, bold, lists, code) for display. */
  formatMessageContent(content: string): SafeHtml {
    if (!content?.trim()) return this.sanitizer.bypassSecurityTrustHtml('');
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    let html = esc(content);
    html = html.replace(/^###\s+(.+)$/gm, '</p><h4 class="chat-h4">$1</h4><p class="chat-p">');
    html = html.replace(/^##\s+(.+)$/gm, '</p><h3 class="chat-h3">$1</h3><p class="chat-p">');
    html = html.replace(/^#\s+(.+)$/gm, '</p><h2 class="chat-h2">$1</h2><p class="chat-p">');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\n/g, '<br>');
    html = '<p class="chat-p">' + html + '</p>';
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  retryLastAction(): void {
    this.lastError = '';
    if (this.lastQuickActionKey) {
      this.quickAction(this.lastQuickActionKey);
    } else if (this.lastSentMessage) {
      this.userMessage = this.lastSentMessage;
      this.send();
    }
  }

  /** Scroll chat messages to bottom (e.g. after new response). */
  scrollToBottom(): void {
    setTimeout(() => {
      const el = this.messagesEl?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    }, 0);
  }

  removeAttachment(name: string): void {
    this.api.postForm('/chat/remove-attachment', { name }).subscribe({ next: () => this.loadState(), error: () => {} });
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
        this.toast.success('The application will now use ' + modelLabel + '.');
      },
      error: () => {
        this.switchingModel = false;
        this.toast.error('Failed to switch model. Please try again or re-initialize from Configuration.');
      },
    });
  }

  toggleRag(): void {
    this.api.postForm('/chat/use-rag', { use_rag: this.useRag }).subscribe({ error: () => {} });
  }

  send(): void {
    const text = this.userMessage.trim();
    if (!text || this.loading) return;
    this.lastQuickActionKey = '';
    this.lastSentMessage = text;
    this.messages.push({ role: 'user', content: text });
    this.userMessage = '';
    this.loading = true;
    this.lastError = '';
    this.scrollToBottom();
    this.api.postForm('/chat/message', { message: text }).subscribe({
      next: (res: unknown) => {
        this.loading = false;
        this.messages.push({ role: 'assistant', content: (res as { response?: string })?.response ?? '' });
        this.scrollToBottom();
      },
      error: (err) => {
        this.loading = false;
        const errMsg = 'Error: ' + (err?.error?.detail || err?.message || 'Request failed.');
        this.messages.push({ role: 'assistant', content: errMsg });
        this.lastError = errMsg;
        this.scrollToBottom();
      },
    });
  }

  quickAction(action: string): void {
    if (this.loading) return;
    this.lastSentMessage = '';
    this.lastQuickActionKey = action;
    this.loading = true;
    this.lastError = '';
    this.api.postForm('/chat/quick-action', { action }).subscribe({
      next: (res: unknown) => {
        this.loading = false;
        this.messages.push({ role: 'assistant', content: (res as { response?: string })?.response ?? '' });
        this.scrollToBottom();
      },
      error: (err) => {
        this.loading = false;
        const errMsg = 'Error: ' + (err?.error?.detail || err?.message || 'Request failed.');
        this.messages.push({ role: 'assistant', content: errMsg });
        this.lastError = errMsg;
        this.scrollToBottom();
      },
    });
  }

  clearChat(): void {
    this.api.postForm('/chat/clear', {}).subscribe({
      next: () => { this.loadState(); this.loadConversations(); this.toast.success('Conversation cleared.'); },
      error: () => { this.toast.error('Failed to clear.'); },
    });
  }

  saveConversation(): void {
    const title = this.conversationTitle?.trim() || undefined;
    this.api.postForm('/conversations/save', title !== undefined ? { title } : {}).subscribe({
      next: () => {
        this.loadConversations();
        this.toast.success('Conversation saved.');
        this.conversationTitle = '';
      },
      error: () => { this.toast.error('Failed to save.'); },
    });
  }

  loadConversation(id: string): void {
    this.api.get<{ state?: { messages?: ChatMsg[]; tickets?: Record<string, TicketInfo>; attachments?: unknown[] } }>(`/conversations/${id}`).subscribe({
      next: (res) => {
        const state = res?.state;
        if (state) {
          this.messages = (state.messages ?? []).filter((m: ChatMsg) => m.role !== 'system');
          this.tickets = state.tickets ? Object.values(state.tickets) : [];
          this.attachments = (state.attachments as { name: string }[]) ?? [];
          this.toast.info('Conversation loaded.');
        }
      },
      error: () => { this.toast.error('Failed to load conversation.'); },
    });
  }

  deleteConversation(id: string): void {
    this.api.delete(`/conversations/${id}`).subscribe({
      next: () => { this.loadConversations(); this.toast.success('Conversation deleted.'); },
      error: () => { this.toast.error('Failed to delete.'); },
    });
  }

  copyToClipboard(content: string, index: number): void {
    navigator.clipboard.writeText(content).then(() => {
      if (this.copiedTimer) clearTimeout(this.copiedTimer);
      this.copiedIndex = index;
      this.copiedTimer = setTimeout(() => { this.copiedIndex = null; }, 2000);
      this.toast.success('Copied to clipboard.');
    }).catch(() => {
      this.toast.error('Failed to copy.');
    });
  }

  postToJira(content: string): void {
    this.postToJiraDraft = content;
    this.postToJiraTargetTicket = this.tickets.length ? this.tickets[0].ticket_id : '';
    this.postToJiraOverlayOpen = true;
  }

  confirmPostToJira(): void {
    const content = this.postToJiraDraft.trim();
    if (!content) return;
    this.postingToJira = true;
    const payload: Record<string, string> = { content };
    if (this.postToJiraTargetTicket) {
      payload['ticket_id'] = this.postToJiraTargetTicket;
    }
    this.api.postForm('/chat/post-to-jira', payload).subscribe({
      next: (res: any) => {
        this.postingToJira = false;
        this.postToJiraOverlayOpen = false;
        this.postToJiraDraft = '';
        const tid = res?.ticket_id || this.postToJiraTargetTicket || '';
        this.toast.success(tid ? `Comment posted to ${tid}.` : 'Comment posted to Jira.');
      },
      error: () => {
        this.postingToJira = false;
        this.toast.error('Failed to post to Jira.');
      },
    });
  }

  cancelPostToJira(): void {
    this.postToJiraOverlayOpen = false;
    this.postToJiraDraft = '';
    this.postToJiraTargetTicket = '';
    this.postingToJira = false;
  }

  exportMarkdown(): void {
    this.api.getBlob('/export/conversation', { format: 'markdown' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'conversation.md'; a.click();
        URL.revokeObjectURL(url);
        this.toast.success('Markdown exported.');
      },
      error: () => { this.toast.error('Export failed.'); },
    });
  }

  exportJson(): void {
    this.api.getBlob('/export/conversation', { format: 'json' }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'conversation.json'; a.click();
        URL.revokeObjectURL(url);
        this.toast.success('JSON exported.');
      },
      error: () => { this.toast.error('Export failed.'); },
    });
  }
}
