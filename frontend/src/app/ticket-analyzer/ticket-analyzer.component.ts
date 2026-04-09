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

    <div class="analyzer-layout">
      <aside class="context-panel card">
        <h2 class="panel-section-title">Load Tickets</h2>
        <div class="form-section">
          <span class="form-section-label">Ticket IDs</span>
          <div class="input-with-btn">
            <input [(ngModel)]="ticketIdToAdd" placeholder="PROJ-123, PROJ-456" (keyup.enter)="addTicket()" />
            <button class="primary" (click)="addTicket()" [disabled]="loadingTicket">Load</button>
          </div>
        </div>
        @if (tickets.length) {
          <p class="label">Loaded Tickets</p>
          @for (t of tickets; track t.ticket_id) {
            <div class="ticket-chip">
              <span>{{ t.ticket_id }}</span>
              <button type="button" class="link-btn view-details-link" (click)="viewTicketDetails(t.ticket_id)">View Details</button>
              @if (jiraServerUrl) {
                <a [href]="jiraServerUrl + '/browse/' + t.ticket_id" target="_blank" rel="noopener" class="open-jira-link" title="Open in Jira">Open in Jira</a>
              }
              <button type="button" class="icon-btn" (click)="removeTicket(t.ticket_id)" title="Remove">×</button>
            </div>
          }
          <button type="button" class="secondary gen-tc-btn" (click)="goToGenerateTestCases()">
            Generate Test Cases from Ticket
          </button>
        }

        <h2 class="panel-section-title">Attachments</h2>
        <div class="form-section">
          <span class="form-section-label">Files</span>
          <div class="file-upload-wrap">
            <input type="file" #fileInput multiple (change)="onFileSelect($event)" class="file-input-hidden" accept="image/*,.pdf,.doc,.docx,.txt" />
            <button type="button" class="secondary attach-files-btn" (click)="fileInput.click()">
              Choose File
            </button>
          </div>
          <p class="hint-inline">Or paste an image (Ctrl+V) in the chat box below.</p>
        </div>
        @if (attachments.length) {
          @for (a of attachments; track a.name) {
            <div class="attachment-chip">
              <span>{{ a.name }}</span>
              <button type="button" class="icon-btn" (click)="removeAttachment(a.name)">×</button>
            </div>
          }
        }

        <h2 class="panel-section-title">AI Model</h2>
        <div class="form-section">
          <span class="form-section-label">Model</span>
          <select [(ngModel)]="selectedModelId" (ngModelChange)="switchModel()" class="model-select" [disabled]="switchingModel" title="{{ modelOptions.length }} models – scroll to see all">
            @for (opt of modelOptions; track opt.value) {
              <option [value]="opt.value">{{ opt.label }}</option>
            }
          </select>
          @if (switchingModel) {
            <span class="hint switching-hint">Switching to selected model, please wait…</span>
          }
          <button type="button" class="link-btn refresh-models" (click)="loadModels()" [disabled]="switchingModel">Refresh Models</button>
        </div>
        <label class="checkbox-label">
          <input type="checkbox" [(ngModel)]="useRag" (ngModelChange)="toggleRag()" />
          Use Knowledge Base
        </label>

        <h2 class="panel-section-title">Conversation</h2>
        <div class="form-section">
          <span class="form-section-label">Title (Optional)</span>
          <input [(ngModel)]="conversationTitle" placeholder="e.g. PROJ-123 summary" class="convo-title-input" />
        </div>
        <div class="form-actions">
          <button class="secondary" (click)="saveConversation()" [disabled]="!messages.length">Save</button>
          <button class="secondary" (click)="clearChat()" [disabled]="!messages.length && !tickets.length">Clear</button>
        </div>
        @if (conversations.length) {
          <p class="label">Previous Sessions</p>
          @for (c of conversations; track c.id) {
            <div class="convo-row">
              <span class="convo-title">{{ c.title || c.id }}</span>
              <button type="button" class="link-btn" (click)="loadConversation(c.id)">Load</button>
              <button type="button" class="link-btn danger-link" (click)="deleteConversation(c.id)">Delete</button>
            </div>
          }
        }
      </aside>

      <main class="chat-main card">
        @if (!tickets.length && !attachments.length) {
          <p class="hint empty-hint">Load a Jira ticket or add attachments to start. Then ask a question or use a quick action below.</p>
        } @else if (!messages.length) {
          <p class="hint empty-hint">No messages yet. Ask a question or use a quick action (e.g. Summarize, Find Gaps).</p>
        }
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
      </main>
    </div>

    <!-- Post to Jira Preview Overlay -->
    @if (postToJiraOverlayOpen) {
      <div class="overlay-backdrop" (click)="cancelPostToJira()">
        <div class="overlay-panel overlay-panel--post-jira" (click)="$event.stopPropagation()">
          <div class="overlay-header">
            <h2 class="overlay-title">Post Comment to Jira</h2>
            <button type="button" class="overlay-close" (click)="cancelPostToJira()" aria-label="Close">&times;</button>
          </div>
          <div class="overlay-body">
            <p class="overlay-hint">Review and edit the comment before posting. It will be added to
              @if (tickets.length === 1) {
                <strong>{{ tickets[0].ticket_id }}</strong>.
              } @else {
                <strong>{{ tickets.length }} loaded tickets</strong>.
              }
            </p>
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
                  <pre class="td-section-body">{{ ticketDetailData.description }}</pre>
                </div>
              }
              @if (ticketDetailData.acceptance_criteria) {
                <div class="td-section">
                  <h4 class="td-section-title">Acceptance Criteria</h4>
                  <pre class="td-section-body">{{ ticketDetailData.acceptance_criteria }}</pre>
                </div>
              }
              @if (ticketDetailData.steps_to_reproduce) {
                <div class="td-section">
                  <h4 class="td-section-title">Steps to Reproduce</h4>
                  <pre class="td-section-body">{{ ticketDetailData.steps_to_reproduce }}</pre>
                </div>
              }
              @if (ticketDetailData.environment) {
                <div class="td-section">
                  <h4 class="td-section-title">Environment</h4>
                  <pre class="td-section-body">{{ ticketDetailData.environment }}</pre>
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
                        <pre class="td-comment-body">{{ c.body }}</pre>
                      </div>
                    }
                  }
                </div>
              }
            </div>
            <div class="overlay-footer">
              @if (jiraServerUrl && ticketDetailData.ticket_id) {
                <a [href]="jiraServerUrl + '/browse/' + ticketDetailData.ticket_id" target="_blank" rel="noopener" class="primary">Open in Jira</a>
              }
              <button class="secondary" (click)="closeTicketDetails()">Close</button>
            </div>
          }
        </div>
      </div>
    }

    <app-ai-thinking-overlay
      [open]="loading || loadingTicket || switchingModel"
      [title]="analyzerThinkingTitle"
      [subtitle]="analyzerThinkingSubtitle"
    />
  `,
  styles: [`
    .page-header { margin-bottom: var(--space-lg); }
    .page-subtitle { margin: 0; font-size: 0.9rem; }
    .analyzer-layout { display: flex; gap: var(--space-lg); align-items: flex-start; }
    .context-panel {
      width: 240px; flex-shrink: 0; padding: var(--space-lg) var(--space-xl);
      animation: panelSlideIn 0.45s cubic-bezier(0.22,1,0.36,1) both;
    }
    .chat-main {
      flex: 1; min-width: 360px; display: flex; flex-direction: column; padding: var(--space-lg) var(--space-xl);
      animation: panelSlideIn 0.45s cubic-bezier(0.22,1,0.36,1) 0.08s both;
    }
    @keyframes panelSlideIn {
      from { opacity: 0; transform: translateY(14px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .panel-section-title { font-size: 0.9rem; font-weight: 700; margin: var(--space-md) 0 var(--space-sm); color: var(--app-text); padding-bottom: var(--space-xs); border-bottom: 1px solid var(--app-card-title-border); }
    .context-panel .panel-section-title:first-child { margin-top: 0; }
    .form-section { margin-bottom: var(--space-md); }
    .form-section-label { font-size: 0.75rem; margin-bottom: var(--space-xs); }
    .input-with-btn { display: flex; gap: var(--space-sm); align-items: stretch; }
    .input-with-btn input[type="text"] { flex: 1; margin: 0; }
    .file-upload-wrap { position: relative; }
    .file-input-hidden { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
    .attach-files-btn { min-width: 100px; }
    .hint-inline { font-size: 0.75rem; color: var(--app-text-muted); margin: var(--space-xs) 0 0; }
    .input-with-btn button { flex-shrink: 0; }
    .label { font-size: 0.75rem; font-weight: 600; margin: var(--space-sm) 0 var(--space-xs); color: var(--app-text-muted); }
    .ticket-chip, .attachment-chip {
      padding: var(--space-xs) var(--space-sm); font-size: 0.85rem; margin-bottom: var(--space-xs);
      display: flex; align-items: center; gap: var(--space-xs); flex-wrap: wrap;
      animation: chipSlideIn 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    @keyframes chipSlideIn {
      from { opacity: 0; transform: translateX(-8px) scale(0.95); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    .ticket-chip span { flex: 1; min-width: 0; }
    .open-jira-link { font-size: 0.75rem; color: var(--hyland-blue); }
    .gen-tc-btn { margin-top: var(--space-sm); width: 100%; }
    .convo-title-input { width: 100%; margin: 0; font-size: 0.9rem; }
    .icon-btn { background: none; border: none; cursor: pointer; font-size: 1rem; line-height: 1; padding: 0 var(--space-xs); color: var(--app-icon-muted); }
    .icon-btn:hover { color: #c00; }
    .model-select { min-height: 2.25rem; }
    .refresh-models { margin-top: var(--space-xs); font-size: 0.8rem; }
    .checkbox-label { display: flex; align-items: center; gap: var(--space-sm); margin: var(--space-md) 0 0; font-size: 0.85rem; cursor: pointer; font-weight: 500; }
    .form-actions { display: flex; gap: var(--space-sm); margin-top: var(--space-sm); }
    .convo-row { display: flex; align-items: center; gap: var(--space-sm); margin-bottom: var(--space-xs); font-size: 0.85rem; }
    .convo-title { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .link-btn { background: none; border: none; color: var(--hyland-blue); cursor: pointer; font-size: 0.8rem; padding: 0; }
    .link-btn:hover { text-decoration: underline; }
    .danger-link { color: #c00; }
    .quick-actions {
      display: flex; flex-wrap: wrap; gap: var(--space-sm); margin-bottom: var(--space-md);
    }
    .quick-actions button {
      transition: all 0.25s cubic-bezier(0.22,1,0.36,1);
      animation: qaBtnEnter 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    .quick-actions button:nth-child(1) { animation-delay: 0.02s; }
    .quick-actions button:nth-child(2) { animation-delay: 0.05s; }
    .quick-actions button:nth-child(3) { animation-delay: 0.08s; }
    .quick-actions button:nth-child(4) { animation-delay: 0.11s; }
    .quick-actions button:nth-child(5) { animation-delay: 0.14s; }
    .quick-actions button:nth-child(6) { animation-delay: 0.17s; }
    .quick-actions button:nth-child(7) { animation-delay: 0.20s; }
    .quick-actions button:nth-child(8) { animation-delay: 0.23s; }
    @keyframes qaBtnEnter {
      from { opacity: 0; transform: scale(0.9); }
      to   { opacity: 1; transform: scale(1); }
    }
    .quick-actions button:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 2px 10px rgba(82,161,255,0.15);
    }
    .chat-messages { flex: 1; max-height: 380px; overflow-y: auto; margin-bottom: var(--space-md); padding-right: var(--space-sm); }
    .msg {
      margin-bottom: var(--space-md); padding: var(--space-md); border-radius: var(--radius-sm); font-size: 0.9rem;
      animation: msgAppear 0.35s cubic-bezier(0.22,1,0.36,1) both;
    }
    .msg.user {
      background: var(--app-chat-user-bg); margin-left: var(--space-md);
      animation-name: msgSlideRight;
    }
    .msg.assistant {
      background: var(--app-surface-muted); margin-right: var(--space-md);
      animation-name: msgSlideLeft;
    }
    @keyframes msgSlideRight {
      from { opacity: 0; transform: translateX(12px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes msgSlideLeft {
      from { opacity: 0; transform: translateX(-12px); }
      to   { opacity: 1; transform: translateX(0); }
    }
    @keyframes msgAppear {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
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
    .switching-hint { display: block; margin-top: 0.25rem; color: var(--hyland-teal, #13eac1); }
    .empty-hint { padding: var(--space-md); }
    .error-banner { display: flex; align-items: center; justify-content: space-between; padding: var(--space-sm); background: rgba(200,0,0,0.08); border-left: 4px solid #c00; margin-bottom: var(--space-sm); font-size: 0.9rem; }
    .msg-content-md { white-space: pre-wrap; margin-top: var(--space-xs); font-size: 0.9rem; }
    .msg-content-md ::ng-deep p { margin: var(--space-xs) 0; }
    .msg-content-md ::ng-deep ul, .msg-content-md ::ng-deep ol { margin: 0.25rem 0; padding-left: 1.25rem; }
    .msg-content-md ::ng-deep code { background: var(--app-code-bg); padding: 0.1rem 0.3rem; border-radius: 3px; }
    .msg.msg-error .msg-content-md { color: #c00; }

    /* ---- Post-to-Jira overlay ---- */
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
      padding: 1rem 1.25rem; border-bottom: 1px solid var(--app-card-border);
    }
    .overlay-title { font-size: 1.1rem; font-weight: 700; margin: 0; }
    .overlay-close {
      background: none; border: none; font-size: 1.5rem; cursor: pointer;
      color: var(--app-text-muted); line-height: 1; padding: 0 0.25rem;
    }
    .overlay-close:hover { color: var(--app-text); }
    .overlay-body { padding: 1rem 1.25rem; overflow-y: auto; flex: 1; min-height: 0; }
    .overlay-hint { font-size: 0.85rem; color: var(--app-text-muted); margin: 0 0 0.75rem; }
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
    .overlay-footer {
      display: flex; justify-content: flex-end; gap: var(--space-sm);
      padding: 0.75rem 1.25rem; border-top: 1px solid var(--app-card-border);
    }
    .view-details-link { font-size: 0.75rem; font-weight: 600; }

    /* Ticket Detail Overlay */
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
    .td-comment-body { white-space: pre-wrap; word-break: break-word; font-size: 0.83rem; line-height: 1.5; margin: 0.25rem 0 0; font-family: inherit; }

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
  lastError = '';
  conversationTitle = '';
  jiraServerUrl = '';
  copiedIndex: number | null = null;
  private copiedTimer: any = null;
  postToJiraOverlayOpen = false;
  postToJiraDraft = '';
  postingToJira = false;
  ticketDetailOverlayOpen = false;
  ticketDetailData: any = null;
  loadingTicketDetails = false;
  commentsExpanded = false;
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
    if (this.loadingTicket && !this.loading) return 'Loading tickets';
    if (this.switchingModel) return 'Switching model';
    return 'Assistant is thinking';
  }

  get analyzerThinkingSubtitle(): string {
    if (this.loadingTicket && !this.loading) return 'Fetching ticket details from Jira…';
    if (this.switchingModel) return 'Updating the chat session with your selected model…';
    return 'Processing your message or quick action…';
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.ticketDetailOverlayOpen) { this.closeTicketDetails(); return; }
    if (this.postToJiraOverlayOpen) { this.cancelPostToJira(); }
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
    if (this.tickets.length) {
      const ticketId = this.tickets[0].ticket_id;
      this.testCasePrefill.setPrefill('jira', ticketId);
      this.router.navigate(['/test-cases']);
    }
  }

  ngOnDestroy(): void {}

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

  loadModels(): void {
    const applyModels = (defaultId: string) => {
      this.api.get<{ models: Record<string, string>; default_model_id?: string | null }>('/bedrock-models').subscribe({
        next: (res) => {
          const models = res?.models ?? {};
          const fromApi = (res?.default_model_id ?? '').toString().trim();
          this.modelOptions = Object.entries(models).map(([label, value]) => ({ label: String(label), value: String(value) }));
          if (this.modelOptions.length) {
            this.selectedModelId = this.pickModelIdFromList(this.modelOptions, defaultId || fromApi);
          }
        },
        error: () => {},
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
    ids.forEach(id => {
      this.api.postForm('/chat/add-ticket', { ticket_id: id }).subscribe({
        next: () => { done++; if (done === ids.length) { this.loadingTicket = false; this.loadState(); } this.ticketIdToAdd = ''; },
        error: () => { done++; if (done === ids.length) this.loadingTicket = false; },
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
    files.forEach(file => {
      this.api.postFile('/chat/add-attachment', file).subscribe({
        next: () => { this.loadState(); input.value = ''; },
        error: () => {},
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
        this.api.postFile('/chat/add-attachment', file).subscribe({
          next: () => this.loadState(),
          error: () => {},
        });
        return;
      }
    }
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
    this.postToJiraOverlayOpen = true;
  }

  confirmPostToJira(): void {
    const content = this.postToJiraDraft.trim();
    if (!content) return;
    this.postingToJira = true;
    this.api.postForm('/chat/post-to-jira', { content }).subscribe({
      next: () => {
        this.postingToJira = false;
        this.postToJiraOverlayOpen = false;
        this.postToJiraDraft = '';
        this.toast.success('Comment posted to Jira.');
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
