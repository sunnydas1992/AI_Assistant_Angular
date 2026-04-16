import { Component, HostListener, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AiThinkingOverlayComponent } from '../ai-thinking-overlay/ai-thinking-overlay.component';
import { ApiService } from '../api.service';
import { TestCasePrefillService } from '../test-case-prefill.service';
import { ToastService } from '../toast.service';

export interface QualityDimension {
  score: number;
  reason: string;
}

export interface QualityScore {
  overall: number;
  clarity?: QualityDimension;
  completeness?: QualityDimension;
  edge_cases?: QualityDimension;
  structure?: QualityDimension;
  error?: string;
}

/** Minimum confidence score required to auto-approve a test case for publishing. */
export const CONFIDENCE_APPROVAL_THRESHOLD = 3;

export interface TestCaseItem {
  id: string;
  title: string;
  content: string;
  confidence?: number;
  selected: boolean;
  feedback?: string;
  /** Set after "Check Xray for duplicates" when a Test with the same summary exists. */
  isDuplicate?: boolean;
  existingXrayKey?: string;
  duplicateChecked?: boolean;
  /** Summary string used for matching (from API, for transparency). */
  summaryUsed?: string;
  /** Cosine similarity score (0–1) when detected as duplicate. 1.0 = exact match. */
  similarity?: number;
  /** How the duplicate was detected: "exact" or "semantic". */
  matchType?: string;
  /** AI quality review score. */
  quality?: QualityScore;
  /** Snapshot of content before the last refinement, for diff display. */
  previousContent?: string;
  /** Whether the diff panel is expanded for this item. */
  showDiff?: boolean;
  /**
   * Human-in-the-loop approval gate. Auto-set to true when confidence >= CONFIDENCE_APPROVAL_THRESHOLD.
   * Low-confidence cases require explicit user approval before they can be published.
   */
  approved?: boolean;
  _exiting?: boolean;
  /** Jira issue key assigned after successful publish to Xray. */
  publishedKey?: string;
}

@Component({
  selector: 'app-test-cases',
  standalone: true,
  imports: [CommonModule, FormsModule, AiThinkingOverlayComponent],
  template: `
    <header class="page-header">
      <h1 class="page-title">Generate Test Cases</h1>
      <p class="page-subtitle">Generate test cases from a Jira ticket or Confluence page. Edit, select, and publish only what you need to Xray.</p>
      @if (sourceLoaded && sourceInfo) {
        <p class="context-line">Source: {{ sourceType === 'jira' ? 'Jira' : 'Confluence' }} — {{ sourceInfo.ticket_id }}</p>
      }
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

    <div class="card form-card">
      <h3 class="card-title">Source &amp; Format</h3>

      <!-- Phase 1: select source and load -->
      @if (!sourceLoaded) {
        <div class="form-grid source-phase">
          <div class="form-section">
            <span class="form-section-label">Source type</span>
            <select [(ngModel)]="sourceType" (ngModelChange)="changeSource()">
              <option value="jira">Jira ticket</option>
              <option value="confluence">Confluence page</option>
            </select>
          </div>
          <div class="form-section form-section-wide">
            <span class="form-section-label">{{ sourceType === 'jira' ? 'Ticket ID or URL' : 'Confluence page URL or ID' }}</span>
            <div class="input-with-btn">
              <input [(ngModel)]="targetId" [placeholder]="sourceType === 'jira' ? 'e.g. PROJ-123 or full URL' : 'Page URL or ID'" (keyup.enter)="loadSource()" />
              <button class="primary" (click)="loadSource()" [disabled]="loadingSource || !targetId.trim()">
                @if (loadingSource) { <span class="loading-spinner"></span> }
                Load
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Info strip: shown after source loads successfully -->
      @if (sourceLoaded && sourceInfo) {
        <div class="source-info-strip">
          <span class="strip-id">{{ sourceInfo.ticket_id }}</span>
          <span class="strip-summary">{{ sourceInfo.summary }}</span>
          @if (sourceType === 'jira') {
            <button type="button" class="link-btn view-details-link" (click)="viewTicketDetails(sourceInfo.ticket_id)">View Details</button>
          }
          @if (sourceType === 'jira' && jiraServerUrl) {
            <a [href]="jiraBrowseUrl(sourceInfo.ticket_id)" target="_blank" rel="noopener" class="open-jira-link">Open in Jira</a>
          }
          <button type="button" class="link-btn change-source-btn" (click)="changeSource()">Change</button>
        </div>
      }

      <!-- Phase 2: configure and generate (only after source loaded) -->
      @if (sourceLoaded) {
        <div class="form-grid config-phase">
          <div class="form-section">
            <span class="form-section-label" title="BDD: Gherkin (Feature/Scenario). Xray: Test Summary and steps table for Jira.">Output format</span>
            <select [(ngModel)]="outputFormat">
              <option value="BDD (Gherkin)">BDD (Gherkin)</option>
              <option value="Xray Jira Test Format">Xray Jira Test Format</option>
            </select>
          </div>
          <div class="form-section">
            <span class="form-section-label">Xray project key</span>
            <input [(ngModel)]="xrayProjectKey" placeholder="e.g. PROJ" class="project-input" />
          </div>
        </div>
        <div class="form-section form-section-full">
          <span class="form-section-label">Instructions for Generation (Optional)</span>
          <div class="preset-chips">
            @for (p of instructionPresets; track p.label) {
              <button type="button" class="chip" (click)="applyInstructionPreset(p.value)">{{ p.label }}</button>
            }
          </div>
          <textarea [(ngModel)]="userInstructions" placeholder="e.g. Consider accessibility tests; include performance scenarios; focus on edge cases; add security checks…" rows="3" class="instructions-input"></textarea>
          <p class="hint">These instructions are followed when generating test cases. Leave empty for default behavior.</p>
          <p class="hint xray-dup-hint">With a project key set, use <strong>Check Xray for duplicates</strong> on the results to find existing Jira Tests with the same summary before publishing.</p>
        </div>
        <label class="checkbox-label" title="When enabled, similar tickets and docs from the KB are used as context when generating test cases">
          <input type="checkbox" [(ngModel)]="useKnowledgeBase" />
          Use Knowledge Base When Generating
        </label>
        <div class="form-actions">
          <button class="primary" (click)="generate()" [disabled]="loading">
            @if (loading) { <span class="loading-spinner"></span> }
            {{ loading ? 'Generating…' : 'Generate Test Cases' }}
          </button>
          <button class="secondary" (click)="clearAll()" [disabled]="loading">Clear</button>
        </div>
        @if (message) {
          <div class="message" [class.error]="!messageOk" [class.success]="messageOk">{{ message }}</div>
        }
      }
    </div>

    @if (loading && !items.length) {
      <div class="card results-card skeleton-results">
        @for (i of [1,2,3]; track i) {
          <div class="skeleton skeleton-card" style="height: 72px"></div>
        }
      </div>
    }

    @if (items.length) {
      <div class="card results-card">
        <div class="refine-all-section">
          <h3 class="refine-heading">Apply Feedback to All Test Cases</h3>
          <p class="refine-hint">Re-generate all test cases incorporating your feedback (e.g. add more edge cases, simplify steps).</p>
          <div class="refine-all-row">
            <textarea [(ngModel)]="globalFeedback" placeholder="Feedback to apply to all test cases…" rows="3" class="refine-textarea"></textarea>
            <button type="button" class="secondary" (click)="applyFeedbackToAll()" [disabled]="refiningAll || !globalFeedback.trim()">
              @if (refiningAll) { <span class="loading-spinner"></span> }
              Apply Feedback to All
            </button>
          </div>
        </div>
        <div class="results-header">
          <h2 class="card-title">Generated Test Cases <span class="badge">{{ items.length }}</span></h2>
          <div class="results-toolbar">
            <span class="select-links">
              <button type="button" class="link-btn" (click)="selectAll()">Select All</button>
              <span class="sep">|</span>
              <button type="button" class="link-btn" (click)="deselectAll()">Deselect All</button>
              <span class="sep">|</span>
              <button type="button" class="link-btn danger-link" (click)="deleteSelected()" [disabled]="selectedCount === 0">Delete Selected</button>
              @if (unapprovedCount > 0) {
                <span class="sep">|</span>
                <button type="button" class="link-btn approve-all-link" (click)="approveAll()" title="Approve all low-confidence test cases for publishing">Approve All ({{ unapprovedCount }})</button>
              }
            </span>
            <div class="actions-row">
              <button class="secondary" (click)="exportExcel()">Download Excel</button>
              <button
                type="button"
                class="secondary"
                (click)="reviewQuality()"
                [disabled]="reviewingQuality || !items.length"
                title="AI reviews each test case on clarity, completeness, edge cases, and structure"
              >
                @if (reviewingQuality) { <span class="loading-spinner"></span> }
                {{ reviewingQuality ? 'Scoring…' : 'AI Quality Review' }}
              </button>
              <button
                type="button"
                class="secondary"
                (click)="checkXrayDuplicates()"
                [disabled]="checkingXrayDuplicates || writingToXray || !xrayProjectKey.trim() || !items.length"
                title="Search the Xray project for existing Tests with the same summary"
              >
                @if (checkingXrayDuplicates) { <span class="loading-spinner"></span> }
                Check Xray for Duplicates
              </button>
              <button class="secondary" (click)="openPublishReview('all')" [disabled]="writingToXray || !xrayProjectKey.trim()">
                Publish All to Xray
              </button>
              <button class="primary" (click)="openPublishReview('selected')" [disabled]="writingToXray || !xrayProjectKey.trim() || selectedPublishableCount === 0">
                Publish Selected ({{ selectedPublishableCount }}) to Jira
              </button>
            </div>
          </div>
        </div>

        @for (tc of items; track tc.id; let i = $index) {
          <section class="tc-section" [class.tc-selected]="tc.selected" [class.tc-needs-review]="tc.approved === false" [class.tc-exiting]="tc._exiting">
            <div class="tc-section-header">
              <label class="tc-checkbox">
                <input type="checkbox" [(ngModel)]="tc.selected" />
                <span class="tc-num">#{{ i + 1 }}</span>
              </label>
              <div class="tc-move-btns">
                <button type="button" class="icon-btn" (click)="moveTestCase(tc, -1)" [disabled]="i === 0" title="Move up">↑</button>
                <button type="button" class="icon-btn" (click)="moveTestCase(tc, 1)" [disabled]="i === items.length - 1" title="Move down">↓</button>
              </div>
              <input class="tc-title-input" [(ngModel)]="tc.title" placeholder="Test case title" />
              <button type="button" class="link-btn copy-tc-btn" (click)="copyTestCase(tc)" title="Copy to clipboard">Copy</button>
              @if (tc.confidence !== undefined) {
                <span class="confidence" [class.confidence-low]="tc.confidence < 3">Confidence: {{ tc.confidence }}/5</span>
              }
              @if (tc.approved === false) {
                <span class="tc-review-badge" title="Low confidence — review and approve before publishing">Needs Review</span>
                <button type="button" class="tc-approve-btn" (click)="approveTestCase(tc)" title="Approve this test case for publishing">Approve</button>
              }
              @if (tc.approved === true && tc.confidence !== undefined && tc.confidence < 3) {
                <span class="tc-approved-badge">Approved</span>
              }
              @if (tc.quality) {
                <span
                  class="quality-badge"
                  [class.quality-high]="tc.quality.overall >= 4"
                  [class.quality-mid]="tc.quality.overall === 3"
                  [class.quality-low]="tc.quality.overall <= 2"
                  [title]="qualityTooltip(tc.quality)"
                >
                  Quality: {{ tc.quality.overall }}/5
                </span>
              }
              @if (tc.isDuplicate && tc.existingXrayKey) {
                <span class="tc-dup-badge" [title]="duplicateTooltip(tc)">
                  {{ tc.matchType === 'semantic' ? 'Similar' : 'Duplicate' }}
                  @if (tc.matchType === 'semantic' && tc.similarity != null) {
                    <span class="dup-sim-score">({{ (tc.similarity * 100).toFixed(0) }}%)</span>
                  }
                  :
                  @if (jiraServerUrl) {
                    <a [href]="jiraBrowseUrl(tc.existingXrayKey)" target="_blank" rel="noopener" class="dup-jira-link">{{ tc.existingXrayKey }}</a>
                  } @else {
                    <span class="dup-key">{{ tc.existingXrayKey }}</span>
                  }
                </span>
              }
              @if (tc.publishedKey) {
                <span class="tc-published-badge" title="Published to Jira/Xray">
                  @if (jiraServerUrl) {
                    <svg class="published-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    <a [href]="jiraBrowseUrl(tc.publishedKey)" target="_blank" rel="noopener" class="published-link">{{ tc.publishedKey }}</a>
                  } @else {
                    <svg class="published-icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
                    <span class="published-key-text">{{ tc.publishedKey }}</span>
                  }
                </span>
              }
              <button type="button" class="icon-btn tc-delete-btn" (click)="removeTestCase(tc)" title="Delete this test case" aria-label="Delete">×</button>
            </div>
            <div class="tc-content-wrap">
              <div class="tc-content-preview" [innerHTML]="formatContent(tc.content)"></div>
              <button type="button" class="link-btn tc-view-toggle" (click)="openEditOverlay(tc)">Edit Content</button>
            </div>
            @if (tc.previousContent) {
              <div class="tc-diff-section">
                <button type="button" class="link-btn tc-diff-toggle" (click)="tc.showDiff = !tc.showDiff">
                  {{ tc.showDiff ? 'Hide Changes' : 'Show Changes from Last Refinement' }}
                </button>
                @if (tc.showDiff) {
                  <div class="tc-diff-panel">
                    <div class="tc-diff-col">
                      <span class="tc-diff-label tc-diff-label--before">Before</span>
                      <div class="tc-diff-content tc-diff-before" [innerHTML]="formatDiffRemoved(tc.previousContent, tc.content)"></div>
                    </div>
                    <div class="tc-diff-col">
                      <span class="tc-diff-label tc-diff-label--after">After</span>
                      <div class="tc-diff-content tc-diff-after" [innerHTML]="formatDiffAdded(tc.previousContent, tc.content)"></div>
                    </div>
                  </div>
                }
              </div>
            }
            <div class="tc-refine-section">
              <span class="form-section-label">Refine This Test Case</span>
              <div class="tc-refine-row">
                <textarea [(ngModel)]="tc.feedback" placeholder="Feedback for this test case…" rows="2" class="tc-feedback-input"></textarea>
                <button type="button" class="secondary tc-apply-btn" (click)="applyFeedbackToOne(tc)" [disabled]="refiningId === tc.id || !(tc.feedback && tc.feedback.trim())">
                  @if (refiningId === tc.id) { <span class="loading-spinner"></span> }
                  Apply Feedback
                </button>
              </div>
            </div>
          </section>
        }

        @if (xrayMessage) {
          <div class="message" [class.success]="xrayOk" [class.error]="!xrayOk">{{ xrayMessage }}</div>
        }
      </div>
    }

    <!-- Edit Content Overlay -->
    @if (editOverlayTc) {
      <div class="overlay-backdrop" (click)="cancelEditOverlay()">
        <div class="overlay-panel overlay-panel--edit" (click)="$event.stopPropagation()">
          <div class="overlay-header">
            <h2 class="overlay-title">Edit Test Case #{{ editOverlayIndex }}</h2>
            <button type="button" class="overlay-close" (click)="cancelEditOverlay()" aria-label="Close">&times;</button>
          </div>
          <div class="edit-overlay-body">
            <div class="edit-title-section">
              <span class="form-section-label">Title</span>
              <input class="edit-title-input" [(ngModel)]="editOverlayTc.title" placeholder="Test case title" />
            </div>
            <div class="edit-columns">
              <div class="edit-col">
                <span class="form-section-label">Content</span>
                <textarea class="edit-content-textarea" [(ngModel)]="editOverlayTc.content" placeholder="Test case content" rows="18"></textarea>
              </div>
              <div class="edit-col">
                <span class="form-section-label">Preview</span>
                <div class="tc-content-preview edit-preview-pane" [innerHTML]="formatContent(editOverlayTc.content)"></div>
              </div>
            </div>
          </div>
          <div class="overlay-footer">
            <button type="button" class="secondary" (click)="cancelEditOverlay()">Cancel</button>
            <button type="button" class="primary" (click)="saveEditOverlay()">Save Changes</button>
          </div>
        </div>
      </div>
    }

    <!-- Publish Review Overlay -->
    @if (publishReviewOpen) {
      <div class="overlay-backdrop" (click)="cancelPublishReview()">
        <div class="overlay-panel overlay-panel--publish" (click)="$event.stopPropagation()">
          <div class="overlay-header">
            <h2 class="overlay-title">Review Before Publishing</h2>
            <button type="button" class="overlay-close" (click)="cancelPublishReview()" aria-label="Close">&times;</button>
          </div>
          <div class="publish-overlay-body">
            <p class="publish-summary">
              <strong>{{ publishReviewItems.length }}</strong> test case{{ publishReviewItems.length === 1 ? '' : 's' }}
              will be published to project <strong>{{ xrayProjectKey }}</strong>.
              Remove any you do not want to publish.
            </p>
            @if (publishReviewItems.length === 0) {
              <p class="publish-empty">No test cases remaining. Add test cases back or cancel.</p>
            }
            <div class="publish-list">
              @for (tc of publishReviewItems; track tc.id; let i = $index) {
                <div class="publish-row">
                  <div class="publish-row-header">
                    <span class="publish-row-num">#{{ i + 1 }}</span>
                    <span class="publish-row-title">{{ tc.title }}</span>
                    @if (tc.confidence !== undefined) {
                      <span class="confidence" [class.confidence-low]="tc.confidence < 3">{{ tc.confidence }}/5</span>
                    }
                    @if (tc.quality) {
                      <span
                        class="quality-badge"
                        [class.quality-high]="tc.quality.overall >= 4"
                        [class.quality-mid]="tc.quality.overall === 3"
                        [class.quality-low]="tc.quality.overall <= 2"
                      >Q: {{ tc.quality.overall }}/5</span>
                    }
                    <button type="button" class="link-btn publish-row-toggle" (click)="publishReviewExpandedId = publishReviewExpandedId === tc.id ? null : tc.id">
                      {{ publishReviewExpandedId === tc.id ? 'Hide' : 'Preview' }}
                    </button>
                    <button type="button" class="icon-btn tc-delete-btn" (click)="removeFromPublishReview(tc)" title="Remove from publish" aria-label="Remove">&times;</button>
                  </div>
                  @if (publishReviewExpandedId === tc.id) {
                    <div class="tc-content-preview publish-row-preview" [innerHTML]="formatContent(tc.content)"></div>
                  }
                </div>
              }
            </div>
          </div>
          <div class="overlay-footer">
            <button type="button" class="secondary" (click)="cancelPublishReview()">Cancel</button>
            <button type="button" class="primary" (click)="confirmPublish()" [disabled]="publishReviewItems.length === 0 || writingToXray">
              @if (writingToXray) { <span class="loading-spinner"></span> }
              {{ writingToXray ? 'Publishing…' : 'Confirm and Publish (' + publishReviewItems.length + ')' }}
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
                  <a [href]="jiraBrowseUrl(ticketDetailData.ticket_id)" target="_blank" rel="noopener" class="primary">Open in Jira</a>
                }
              </div>
              <button class="secondary" (click)="closeTicketDetails()">Close</button>
            </div>
          }
        </div>
      </div>
    }

    <app-ai-thinking-overlay
      [open]="aiBusyOpen"
      [title]="aiBusyTitle"
      [subtitle]="aiBusySubtitle"
      [stepLabels]="aiBusySteps"
      [showStop]="loading"
      stopButtonText="Stop generation"
      (stopped)="stopGeneration()"
    />
  `,
  styles: [`
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
    .form-card { max-width: 720px; }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem 1.25rem;
      margin-bottom: 1rem;
    }
    .form-section-wide { grid-column: 1 / -1; }
    .form-section-full { grid-column: 1 / -1; margin-bottom: 1rem; }
    .instructions-input { width: 100%; margin-top: 0.35rem; resize: vertical; min-height: 4rem; font-family: inherit; font-size: 0.95rem; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--app-input-border); background: var(--app-input-bg); color: var(--app-text); }
    .refine-all-section { margin-bottom: 1.5rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--app-border-subtle); }
    .refine-heading { font-size: 1rem; margin: 0 0 0.25rem; color: var(--app-text); }
    .refine-hint { font-size: 0.85rem; color: var(--app-text-muted); margin: 0 0 0.5rem; }
    .refine-all-row { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
    .refine-textarea { flex: 1; min-width: 200px; resize: vertical; min-height: 4rem; font-family: inherit; font-size: 0.9rem; padding: 0.5rem; border-radius: 6px; border: 1px solid var(--app-input-border); background: var(--app-input-bg); color: var(--app-text); }
    .form-section-label { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); margin-bottom: 0.35rem; display: block; }
    .form-actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; flex-wrap: wrap; align-items: center; }
    .project-input { max-width: 10rem; }
    .checkbox-label { display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 0.5rem; cursor: pointer; font-size: 0.95rem; font-weight: 500; color: var(--app-text); }
    .xray-dup-hint { margin-top: 0.5rem; max-width: 40rem; }

    .results-card { margin-top: 1rem; }
    .skeleton-results { padding: 1.25rem; }
    .results-header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.25rem; }
    .results-header .card-title { margin: 0; padding: 0; border: none; }
    .results-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0.75rem; width: 100%; }
    .select-links { font-size: 0.9rem; }
    .link-btn { background: none; border: none; color: var(--hyland-blue); cursor: pointer; font-size: 0.9rem; padding: 0; font-weight: 600; }
    .link-btn:hover { text-decoration: underline; }
    .sep { color: var(--app-sep); margin: 0 0.35rem; }
    .badge { display: inline-block; background: var(--hyland-teal); color: var(--hyland-dark-blue); font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.5rem; border-radius: 6px; margin-left: 0.5rem; vertical-align: middle; }
    .actions-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }

    .tc-section {
      margin-bottom: 1.25rem;
      padding: 1.1rem 1.25rem;
      background: var(--app-surface-muted);
      border-radius: 10px;
      border: 2px solid var(--app-card-border);
      transition: border-color 0.3s ease, box-shadow 0.3s ease, transform 0.3s cubic-bezier(0.22,1,0.36,1);
      animation: tcItemEnter 0.35s cubic-bezier(0.22,1,0.36,1) both;
    }
    .tc-section:hover { transform: translateY(-1px); box-shadow: 0 4px 16px rgba(25,31,94,0.06); }
    .tc-section.tc-exiting { animation: itemFadeOut 0.28s ease forwards; pointer-events: none; }
    .tc-section.tc-selected { border-color: rgba(19, 234, 193, 0.5); box-shadow: 0 0 0 1px rgba(19, 234, 193, 0.2), 0 0 12px rgba(19,234,193,0.06); }
    .tc-section:last-child { margin-bottom: 0; }
    @keyframes tcItemEnter {
      from { opacity: 0; transform: translateY(10px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .preset-chips { display: flex; flex-wrap: wrap; gap: var(--space-xs); margin-bottom: var(--space-sm); }
    .chip {
      padding: 0.25rem 0.6rem; font-size: 0.8rem; border-radius: 999px;
      border: 1px solid var(--app-chip-border); background: var(--app-chip-bg);
      cursor: pointer; color: var(--app-text);
      transition: all 0.25s cubic-bezier(0.22,1,0.36,1);
    }
    .chip:hover { background: var(--app-surface-muted); transform: translateY(-1px); box-shadow: 0 2px 8px rgba(82,161,255,0.1); }
    .tc-section-header { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; margin-bottom: 0.6rem; }
    .tc-checkbox { display: inline-flex; align-items: center; gap: 0.5rem; cursor: pointer; margin: 0; font-weight: 600; }
    .tc-move-btns { display: flex; gap: 0; }
    .tc-move-btns .icon-btn { padding: 0.2rem 0.4rem; font-size: 0.9rem; border: none; background: transparent; cursor: pointer; }
    .tc-move-btns .icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .tc-num { font-size: 0.8rem; color: var(--app-text-muted); }
    .tc-title-input { flex: 1; min-width: 120px; margin: 0; font-weight: 600; font-size: 1rem; color: var(--app-text); background: var(--app-input-bg); border: 1px solid var(--app-input-border); border-radius: 6px; padding: 0.25rem 0.5rem; }
    .copy-tc-btn { flex-shrink: 0; font-size: 0.85rem; }
    .context-line { font-size: 0.85rem; color: var(--app-text-muted); margin-top: var(--space-xs); }
    .confidence { font-size: 0.8rem; color: var(--app-text-muted); margin-left: auto; }
    .confidence-low { color: #d97706; font-weight: 600; }
    .tc-needs-review {
      border-color: rgba(217, 119, 6, 0.5) !important;
      box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.15), 0 0 12px rgba(217, 119, 6, 0.06) !important;
    }
    .tc-review-badge {
      font-size: 0.75rem;
      font-weight: 700;
      color: #d97706;
      background: rgba(217, 119, 6, 0.12);
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      white-space: nowrap;
      animation: reviewPulse 2s ease-in-out 1;
    }
    @keyframes reviewPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }
    .tc-approve-btn {
      font-size: 0.78rem;
      font-weight: 700;
      color: #fff;
      background: linear-gradient(135deg, #059669 0%, #10b981 100%);
      border: none;
      padding: 0.22rem 0.65rem;
      border-radius: 6px;
      cursor: pointer;
      white-space: nowrap;
      transition: opacity 0.2s, transform 0.15s;
    }
    .tc-approve-btn:hover { opacity: 0.88; transform: translateY(-1px); }
    .tc-approved-badge {
      font-size: 0.75rem;
      font-weight: 700;
      color: #059669;
      background: rgba(5, 150, 105, 0.12);
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      white-space: nowrap;
    }
    .approve-all-link { color: #059669; font-weight: 600; }
    .approve-all-link:hover { text-decoration: underline; }
    .tc-dup-badge {
      font-size: 0.78rem;
      font-weight: 700;
      color: #b45309;
      background: rgba(180, 83, 9, 0.12);
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      white-space: nowrap;
    }
    .dup-sim-score { font-weight: 600; opacity: 0.85; }
    .dup-jira-link { color: var(--hyland-blue); font-weight: 700; }
    .tc-published-badge {
      display: inline-flex; align-items: center; gap: 0.3rem;
      font-size: 0.78rem; font-weight: 700;
      color: #0d7c5f;
      background: rgba(19, 234, 193, 0.15);
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      white-space: nowrap;
      animation: badgePop 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
    }
    .published-icon { width: 0.85rem; height: 0.85rem; flex-shrink: 0; }
    .published-link {
      color: var(--hyland-blue); font-weight: 700; text-decoration: none;
      transition: color 0.15s;
    }
    .published-link:hover { color: var(--hyland-teal); text-decoration: underline; }
    .published-key-text { font-weight: 700; }
    .dup-key { font-weight: 700; }
    .tc-delete-btn { margin-left: auto; font-size: 1.25rem; line-height: 1; padding: 0.2rem 0.4rem; color: var(--app-icon-delete); border-radius: 4px; }
    .tc-delete-btn:hover { color: #c00; background: rgba(200,0,0,0.08); }
    .danger-link { color: #c00; }
    .danger-link:hover { text-decoration: underline; }
    .tc-content-wrap { position: relative; }
    .tc-content-edit { width: 100%; margin: 0; resize: vertical; min-height: 120px; font-family: inherit; font-size: 0.9rem; line-height: 1.5; background: var(--app-input-bg); color: var(--app-text); border: 1px solid var(--app-input-border); border-radius: 6px; padding: 0.5rem; }
    .tc-content-preview { margin-top: 0.5rem; padding: 0.75rem; background: var(--app-code-bg); border-radius: 6px; font-size: 0.85rem; line-height: 1.5; color: var(--app-text); border: 1px solid var(--app-card-border); }
    .tc-content-preview .tc-preview-h3 { font-size: 1rem; margin: 0.5rem 0 0.25rem; color: var(--app-text); }
    .tc-content-preview .tc-preview-h4 { font-size: 0.95rem; margin: 0.4rem 0 0.2rem; color: var(--app-heading-sub); }
    .tc-content-preview .tc-preview-p { margin: 0.25rem 0; }
    .tc-content-preview .xray-steps-table {
      width: 100%;
      border-collapse: collapse;
      margin: 0.6rem 0;
      font-size: 0.85rem;
      line-height: 1.5;
    }
    .tc-content-preview .xray-steps-table th,
    .tc-content-preview .xray-steps-table td {
      border: 1px solid var(--app-card-border);
      padding: 0.45rem 0.7rem;
      text-align: left;
      vertical-align: top;
    }
    .tc-content-preview .xray-steps-table th {
      background: rgba(82, 161, 255, 0.08);
      font-weight: 700;
      text-transform: uppercase;
      font-size: 0.78rem;
      letter-spacing: 0.03em;
      color: var(--app-text-muted);
      white-space: nowrap;
    }
    .tc-content-preview .xray-steps-table tbody tr:nth-child(even) td {
      background: rgba(255, 255, 255, 0.02);
    }
    .tc-content-preview .xray-steps-table tbody tr:hover td {
      background: rgba(82, 161, 255, 0.06);
    }
    .tc-view-toggle { font-size: 0.85rem; margin-top: 0.35rem; display: inline-block; }
    .tc-refine-section { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--app-border-subtle); }
    .tc-refine-row { display: flex; gap: 0.75rem; align-items: flex-start; flex-wrap: wrap; margin-top: 0.35rem; }
    .tc-feedback-input { flex: 1; min-width: 160px; resize: vertical; min-height: 2.5rem; font-family: inherit; font-size: 0.85rem; padding: 0.4rem; border-radius: 6px; border: 1px solid var(--app-input-border); background: var(--app-input-bg); color: var(--app-text); }
    .tc-apply-btn { flex-shrink: 0; }

    .quality-badge {
      font-size: 0.78rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      white-space: nowrap;
    }
    .quality-high { color: #166534; background: rgba(22, 101, 52, 0.12); }
    .quality-mid { color: #92400e; background: rgba(146, 64, 14, 0.10); }
    .quality-low { color: #991b1b; background: rgba(153, 27, 27, 0.10); }

    .tc-diff-section { margin-top: 0.75rem; }
    .tc-diff-toggle { font-size: 0.84rem; }
    .tc-diff-panel {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
      margin-top: 0.5rem;
    }
    @media (max-width: 700px) { .tc-diff-panel { grid-template-columns: 1fr; } }
    .tc-diff-col { min-width: 0; }
    .tc-diff-label {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      margin-bottom: 0.35rem;
    }
    .tc-diff-label--before { color: #991b1b; background: rgba(153, 27, 27, 0.10); }
    .tc-diff-label--after { color: #166534; background: rgba(22, 101, 52, 0.10); }
    .tc-diff-content {
      font-size: 0.82rem;
      line-height: 1.55;
      padding: 0.6rem 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--app-card-border);
      background: var(--app-code-bg);
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 320px;
      overflow-y: auto;
    }
    .tc-diff-content .diff-del { background: rgba(220, 38, 38, 0.15); text-decoration: line-through; }
    .tc-diff-content .diff-ins { background: rgba(22, 163, 74, 0.15); }

    /* ---- Shared overlay styles ---- */
    .overlay-backdrop {
      position: fixed; inset: 0; z-index: 900;
      background: var(--app-overlay-bg, rgba(18, 22, 48, 0.92));
      backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      animation: overlayFadeIn 0.25s ease both;
    }
    .overlay-panel {
      background: var(--app-card-bg); border-radius: var(--radius-lg, 10px);
      box-shadow: 0 12px 48px rgba(0,0,0,0.25); border: 1px solid var(--app-card-border);
      display: flex; flex-direction: column; max-height: 90vh;
      animation: overlaySlideUp 0.3s cubic-bezier(0.22,1,0.36,1) both;
    }
    .overlay-panel--edit { width: 92vw; max-width: 960px; }
    .overlay-panel--publish { width: 92vw; max-width: 1040px; }
    .overlay-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 1.25rem; border-bottom: 1px solid var(--app-card-border);
      flex-shrink: 0;
    }
    .overlay-title { font-size: 1.1rem; margin: 0; color: var(--app-text); }
    .overlay-close {
      background: none; border: none; font-size: 1.5rem; line-height: 1;
      cursor: pointer; color: var(--app-text-muted); padding: 0.2rem 0.5rem;
      border-radius: 4px; transition: color 0.15s, background 0.15s;
    }
    .overlay-close:hover { color: var(--app-text); background: rgba(82,161,255,0.12); }
    .overlay-footer {
      display: flex; align-items: center; justify-content: flex-end; gap: 0.75rem;
      padding: 0.85rem 1.25rem; border-top: 1px solid var(--app-card-border);
      flex-shrink: 0;
    }
    .overlay-footer--spaced { justify-content: space-between;
    }

    /* ---- Edit overlay ---- */
    .edit-overlay-body { padding: 1rem 1.25rem; overflow-y: auto; flex: 1; min-height: 0; }
    .edit-title-section { margin-bottom: 1rem; }
    .edit-title-input {
      width: 100%; font-weight: 600; font-size: 1rem; padding: 0.4rem 0.6rem;
      border-radius: 6px; border: 1px solid var(--app-input-border);
      background: var(--app-input-bg); color: var(--app-text);
    }
    .edit-columns { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    @media (max-width: 700px) { .edit-columns { grid-template-columns: 1fr; } }
    .edit-col { min-width: 0; display: flex; flex-direction: column; }
    .edit-content-textarea {
      flex: 1; min-height: 320px; resize: vertical; font-family: inherit;
      font-size: 0.9rem; line-height: 1.55; padding: 0.6rem;
      border-radius: 6px; border: 1px solid var(--app-input-border);
      background: var(--app-input-bg); color: var(--app-text);
    }
    .edit-preview-pane {
      flex: 1; min-height: 320px; overflow-y: auto;
      margin-top: 0; padding: 0.75rem;
    }

    /* ---- Publish review overlay ---- */
    .publish-overlay-body { padding: 1rem 1.25rem; overflow-y: auto; flex: 1; min-height: 0; }
    .publish-summary { font-size: 0.92rem; color: var(--app-text-muted); margin: 0 0 1rem; }
    .publish-empty { font-size: 0.9rem; color: var(--app-text-muted); text-align: center; padding: 2rem 0; }
    .publish-list { display: flex; flex-direction: column; gap: 0.5rem; }
    .publish-row {
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border);
      border-radius: 8px; padding: 0.65rem 0.85rem;
      animation: tcItemEnter 0.25s cubic-bezier(0.22,1,0.36,1) both;
    }
    .publish-row-header {
      display: flex; align-items: center; gap: 0.5rem 0.75rem; flex-wrap: wrap;
    }
    .publish-row-num { font-size: 0.78rem; font-weight: 700; color: var(--app-text-muted); min-width: 2rem; }
    .publish-row-title { flex: 1; min-width: 0; font-weight: 600; font-size: 0.92rem; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .publish-row-toggle { font-size: 0.82rem; flex-shrink: 0; }
    .publish-row-preview { margin-top: 0.5rem; max-height: 200px; overflow-y: auto; font-size: 0.82rem; }

    /* Source phase input row */
    .source-phase .input-with-btn { display: flex; gap: 0.5rem; }
    .source-phase .input-with-btn input { flex: 1; }

    /* Source info strip */
    .source-info-strip {
      display: flex; align-items: center; flex-wrap: wrap; gap: 0.4rem 0.75rem;
      padding: 0.55rem 0.85rem; margin-bottom: 0.75rem;
      background: var(--app-surface-muted); border: 1px solid var(--app-card-border);
      border-radius: var(--radius-sm); font-size: 0.88rem;
      animation: fadeSlideIn 0.25s ease-out;
    }
    .strip-id { font-weight: 700; color: var(--app-text); }
    .strip-summary { color: var(--app-text-muted); flex: 1; min-width: 80px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .view-details-link { font-size: 0.8rem; font-weight: 600; }
    .open-jira-link { font-size: 0.8rem; color: var(--hyland-blue); font-weight: 600; }
    .open-jira-link:hover { text-decoration: underline; }
    .change-source-btn { font-size: 0.8rem; font-weight: 600; color: var(--app-text-muted); }
    .change-source-btn:hover { color: var(--app-text); }
    @keyframes fadeSlideIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }

    /* Config phase spacing */
    .config-phase { margin-top: 0; }

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

    @media (max-width: 600px) {
      .form-grid { grid-template-columns: 1fr; }
      .results-toolbar { flex-direction: column; align-items: flex-start; }
      .overlay-panel--edit, .overlay-panel--publish, .overlay-panel--ticket-detail { width: 98vw; }
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
export class TestCasesComponent implements OnInit, OnDestroy {
  sourceType: 'jira' | 'confluence' = 'jira';
  targetId = '';
  outputFormat = 'BDD (Gherkin)';
  useKnowledgeBase = false;
  loading = false;
  message = '';
  messageOk = false;
  generatedText = '';
  items: TestCaseItem[] = [];
  xrayProjectKey = '';
  writingToXray = false;
  xrayMessage = '';
  xrayOk = false;
  userInstructions = '';
  globalFeedback = '';
  refiningAll = false;
  refiningId: string | null = null;
  editOverlayTc: { id: string; title: string; content: string } | null = null;
  editOverlayIndex = 0;
  publishReviewOpen = false;
  publishReviewItems: TestCaseItem[] = [];
  publishReviewMode: 'all' | 'selected' = 'all';
  publishReviewExpandedId: string | null = null;
  checkingXrayDuplicates = false;
  reviewingQuality = false;
  jiraServerUrl = '';
  currentModelDisplay = '';
  currentModelId = '';
  modelOptions: { label: string; value: string }[] = [];
  selectedModelId = '';
  switchingModel = false;

  sourceLoaded = false;
  sourceInfo: { ticket_id: string; summary: string; _detail?: any } | null = null;
  loadingSource = false;
  ticketDetailOverlayOpen = false;
  ticketDetailData: any = null;
  loadingTicketDetails = false;
  commentsExpanded = false;

  private generateAbort: AbortController | null = null;
  private userCancelledGeneration = false;

  instructionPresets: { label: string; value: string }[] = [
    { label: 'Accessibility', value: 'Consider accessibility tests (keyboard, screen reader, contrast).' },
    { label: 'Performance', value: 'Include performance and load scenarios where relevant.' },
    { label: 'Security', value: 'Add security checks and negative cases for inputs.' },
    { label: 'Edge Cases Only', value: 'Focus on edge cases and boundary conditions.' },
    { label: 'Happy Path Only', value: 'Focus on happy path scenarios only.' },
  ];

  constructor(
    private api: ApiService,
    private prefill: TestCasePrefillService,
    private toast: ToastService,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit(): void {
    const hasPrefill = this.prefill.hasPrefill();
    if (hasPrefill) {
      const { sourceType, targetId } = this.prefill.consumePrefill();
      this.sourceType = sourceType;
      this.targetId = targetId;
    }
    this.api.get<{ jira_server?: string }>('/connection-settings').subscribe({
      next: (res) => {
        this.jiraServerUrl = (res?.jira_server || '').replace(/\/$/, '');
        if (hasPrefill && this.targetId) {
          this.loadSource();
        }
      },
      error: () => {
        if (hasPrefill && this.targetId) {
          this.loadSource();
        }
      },
    });
    this.loadCurrentModel();
  }

  ngOnDestroy(): void {
    if (this.loading) {
      this.generateAbort?.abort();
    }
  }

  private loadCurrentModel(): void {
    this.api.get<{ initialized?: boolean; current_model_id?: string | null }>('/init-status').subscribe({
      next: (res) => {
        const id = (res?.current_model_id ?? '').toString().trim();
        this.currentModelId = id;
        if (!res?.initialized || !id) return;
        this.api.get<{ models: Record<string, string>; default_model_id?: string | null }>('/bedrock-models').subscribe({
          next: (bm) => {
            const models = bm?.models ?? {};
            this.modelOptions = Object.entries(models).map(([label, value]) => ({ label: String(label), value: String(value) }));
            if (this.modelOptions.length) {
              this.selectedModelId = this.pickModelIdFromList(this.modelOptions, id);
              const opt = this.modelOptions.find(o => o.value === this.selectedModelId);
              this.currentModelDisplay = opt?.label ?? this.selectedModelId;
            } else {
              this.currentModelDisplay = id;
            }
          },
          error: () => { this.currentModelDisplay = id; },
        });
      },
      error: () => {},
    });
  }

  private pickModelIdFromList(options: { label: string; value: string }[], defaultId: string): string {
    if (!options.length) return '';
    const d = (defaultId || '').trim();
    if (!d) return options[0].value;
    const byValue = options.find(o => o.value.trim() === d);
    if (byValue) return byValue.value;
    const byLabel = options.find(o => o.label.trim() === d);
    if (byLabel) return byLabel.value;
    const byContains = options.find(o => o.value.includes(d) || d.includes(o.value));
    if (byContains) return byContains.value;
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

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.ticketDetailOverlayOpen) { this.closeTicketDetails(); return; }
    if (this.editOverlayTc) { this.cancelEditOverlay(); return; }
    if (this.publishReviewOpen) { this.cancelPublishReview(); return; }
  }

  openEditOverlay(tc: TestCaseItem): void {
    this.editOverlayIndex = this.items.indexOf(tc) + 1;
    this.editOverlayTc = { id: tc.id, title: tc.title, content: tc.content };
    document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  saveEditOverlay(): void {
    if (!this.editOverlayTc) return;
    const orig = this.items.find(t => t.id === this.editOverlayTc!.id);
    if (orig) {
      orig.title = this.editOverlayTc.title;
      orig.content = this.editOverlayTc.content;
      orig.duplicateChecked = false;
      orig.isDuplicate = false;
      orig.existingXrayKey = undefined;
      orig.summaryUsed = undefined;
      orig.similarity = undefined;
      orig.matchType = undefined;
      orig.quality = undefined;
      this.toast.success('Test case updated.');
    }
    this.editOverlayTc = null;
  }

  cancelEditOverlay(): void {
    this.editOverlayTc = null;
  }

  openPublishReview(mode: 'all' | 'selected'): void {
    if (!this.xrayProjectKey.trim()) return;
    if (mode === 'all') {
      const unapproved = this.unapprovedCount;
      if (unapproved > 0) {
        this.toast.error(`${unapproved} test case${unapproved === 1 ? '' : 's'} need${unapproved === 1 ? 's' : ''} review. Approve all low-confidence cases before using "Publish all".`);
        return;
      }
      this.publishReviewItems = this.items.map(tc => ({ ...tc }));
    } else {
      const selected = this.items.filter(tc => tc.selected && !tc.isDuplicate && tc.approved !== false);
      if (selected.length === 0) {
        const hasUnapproved = this.items.some(tc => tc.selected && tc.approved === false);
        this.toast.error(
          hasUnapproved
            ? 'Some selected test cases need review. Approve low-confidence cases before publishing.'
            : 'No publishable test cases selected.',
        );
        return;
      }
      this.publishReviewItems = selected.map(tc => ({ ...tc }));
    }
    this.publishReviewMode = mode;
    this.publishReviewExpandedId = null;
    this.publishReviewOpen = true;
  }

  removeFromPublishReview(tc: TestCaseItem): void {
    this.publishReviewItems = this.publishReviewItems.filter(t => t.id !== tc.id);
    if (this.publishReviewExpandedId === tc.id) this.publishReviewExpandedId = null;
  }

  confirmPublish(): void {
    if (!this.publishReviewItems.length || this.writingToXray) return;
    this.writingToXray = true;
    this.xrayMessage = '';

    const items = this.publishReviewItems;
    const endpoint = this.publishReviewMode === 'all' ? '/test-cases/write-to-xray' : '/test-cases/write-to-xray-selected';
    const contentText = items.map(tc => tc.content).join('\n\n');
    const body = this.publishReviewMode === 'all'
      ? {
          output_text: items.map(tc => {
            if (this.outputFormat === 'Xray Jira Test Format') {
              const hasSummary = tc.content.includes('**Test Summary:**');
              return hasSummary ? tc.content : `**Test Summary:** ${tc.title}\n\n${tc.content}`;
            }
            return `## ${tc.title}\n\n${tc.content}`;
          }).join(this.outputFormat === 'Xray Jira Test Format' ? '\n\n---\n\n' : '\n\n'),
          output_format: this.effectivePublishOutputFormat(contentText),
          project_key: this.xrayProjectKey.trim(),
          skip_if_duplicate: true,
        }
      : {
          project_key: this.xrayProjectKey.trim(),
          output_format: this.effectivePublishOutputFormat(contentText),
          test_cases: items.map(tc => ({ id: tc.id, title: tc.title, content: tc.content })),
          skip_if_duplicate: true,
        };

    this.api.postJson<{
      ok: boolean;
      created_keys?: string[];
      count?: number;
      skipped_count?: number;
      detail?: string;
      per_item?: { index: number; id?: string; title?: string; status: string; created_key?: string; existing_key?: string }[];
    }>(endpoint, body).subscribe({
      next: (res) => {
        this.writingToXray = false;
        this.publishReviewOpen = false;
        this.xrayOk = res?.ok ?? false;
        const skipped = res?.skipped_count ?? 0;
        if (res?.ok && res?.per_item?.length) {
          this.mapPublishedKeys(res.per_item, items);
        }
        if (res?.ok && res?.created_keys?.length) {
          this.xrayMessage = `Published ${res.count} test(s) to Xray: ${res.created_keys.join(', ')}.`;
          if (skipped > 0) this.xrayMessage += ` Skipped ${skipped} duplicate(s).`;
          this.toast.success(`Published ${res.count} test(s) to Xray.${skipped > 0 ? ` Skipped ${skipped} duplicate(s).` : ''}`);
        } else if (res?.ok) {
          this.xrayMessage = skipped > 0 ? `No new tests created; skipped ${skipped} duplicate(s).` : 'Published to Xray.';
          this.toast.success(skipped > 0 ? `No new issues created (${skipped} duplicate(s) skipped).` : 'Published to Xray.');
        } else {
          this.xrayMessage = res?.detail || 'Publish failed.';
          this.toast.error(this.xrayMessage);
        }
      },
      error: (err) => {
        this.writingToXray = false;
        this.publishReviewOpen = false;
        this.xrayOk = false;
        this.xrayMessage = err?.error?.detail || err?.message || 'Publish failed.';
        this.toast.error(this.xrayMessage);
      },
    });
  }

  private mapPublishedKeys(
    perItem: { index: number; id?: string; title?: string; status: string; created_key?: string; existing_key?: string }[],
    publishedItems: TestCaseItem[],
  ): void {
    for (const entry of perItem) {
      const key = entry.status === 'created' ? entry.created_key : entry.status === 'skipped_duplicate' ? entry.existing_key : undefined;
      if (!key) continue;
      const reviewItem = publishedItems[entry.index];
      if (!reviewItem) continue;
      const mainItem = this.items.find(tc => tc.id === reviewItem.id);
      if (mainItem) mainItem.publishedKey = key;
    }
  }

  cancelPublishReview(): void {
    this.publishReviewOpen = false;
    this.publishReviewItems = [];
    this.publishReviewExpandedId = null;
  }

  get aiBusyOpen(): boolean {
    return (
      this.loading ||
      this.refiningAll ||
      this.refiningId !== null ||
      this.writingToXray ||
      this.checkingXrayDuplicates ||
      this.reviewingQuality
    );
  }

  get aiBusyTitle(): string {
    if (this.loading) return 'Generating test cases';
    if (this.refiningAll || this.refiningId) return 'Refining test cases';
    if (this.reviewingQuality) return 'AI Quality Review';
    if (this.checkingXrayDuplicates) return 'Checking Xray for duplicates';
    if (this.writingToXray) return 'Publishing to Xray';
    return 'Working…';
  }

  get aiBusySubtitle(): string {
    if (this.loading) return 'Sit tight! Let the AI do your work…';
    if (this.refiningAll || this.refiningId) return 'Applying your feedback and regenerating with AI…';
    if (this.reviewingQuality) return 'Scoring each test case on clarity, completeness, edge cases, and structure…';
    if (this.checkingXrayDuplicates) return 'Searching your Jira project for Tests with matching summaries…';
    if (this.writingToXray) return 'Sending tests to Jira / Xray…';
    return 'Please wait…';
  }

  get aiBusySteps(): string[] {
    if (this.loading) {
      return [
        this.sourceType === 'jira' ? 'Analyzing Jira ticket details' : 'Analyzing Confluence page',
        this.useKnowledgeBase ? 'Reading relevant info from knowledge base' : 'Skipping knowledge base (off)',
        'Generating test scenarios',
        'Formatting results',
      ];
    }
    if (this.refiningAll || this.refiningId) {
      return ['Parsing feedback', 'Regenerating with AI', 'Parsing results', 'Refreshing the list'];
    }
    if (this.reviewingQuality) {
      return ['Sending test cases to AI', 'Evaluating clarity and completeness', 'Scoring edge cases and structure', 'Compiling results'];
    }
    if (this.checkingXrayDuplicates) {
      return ['Connecting to Jira', 'Running summary search', 'Comparing normalized titles', 'Building results'];
    }
    if (this.writingToXray) {
      return ['Building Xray payload', 'Creating tests in Jira', 'Verifying responses', 'Finishing up'];
    }
    return [];
  }

  /** Selected rows that are approved and not marked as Jira duplicates. */
  get selectedPublishableCount(): number {
    return this.items.filter(tc => tc.selected && !tc.isDuplicate && tc.approved !== false).length;
  }

  get unapprovedCount(): number {
    return this.items.filter(tc => tc.approved === false).length;
  }

  approveTestCase(tc: TestCaseItem): void {
    tc.approved = true;
    this.toast.success(`Test case "${tc.title.slice(0, 40)}${tc.title.length > 40 ? '…' : ''}" approved.`);
  }

  approveAll(): void {
    const count = this.unapprovedCount;
    if (count === 0) return;
    this.items.forEach(tc => { if (tc.approved === false) tc.approved = true; });
    this.toast.success(`${count} test case${count === 1 ? '' : 's'} approved.`);
  }

  loadSource(): void {
    const id = this.targetId.trim();
    if (!id) return;
    if (this.sourceType === 'confluence') {
      this.sourceLoaded = true;
      this.sourceInfo = { ticket_id: id, summary: 'Confluence page' };
      return;
    }
    this.loadingSource = true;
    this.api.get<any>(`/jira/ticket-info?ticket_id=${encodeURIComponent(id)}`).subscribe({
      next: (data) => {
        this.sourceInfo = { ticket_id: data.ticket_id, summary: data.summary, _detail: data };
        this.targetId = data.ticket_id;
        this.sourceLoaded = true;
        this.loadingSource = false;
      },
      error: () => {
        this.toast.error(`Could not load ticket ${id}`);
        this.loadingSource = false;
      },
    });
  }

  changeSource(): void {
    this.sourceLoaded = false;
    this.sourceInfo = null;
    this.targetId = '';
  }

  viewTicketDetails(ticketId: string): void {
    if (this.sourceInfo?._detail) {
      this.ticketDetailData = this.sourceInfo._detail;
      this.ticketDetailOverlayOpen = true;
      this.commentsExpanded = false;
      return;
    }
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

  jiraBrowseUrl(key: string): string {
    if (!key || !this.jiraServerUrl) return '#';
    return `${this.jiraServerUrl}/browse/${key}`;
  }

  /**
   * Align API output_format with generated body when the dropdown is still BDD but content is Xray markdown.
   * (Backend also infers per case; this keeps duplicate checks and payloads consistent.)
   */
  effectivePublishOutputFormat(text: string): string {
    if (this.outputFormat === 'Xray Jira Test Format') {
      return this.outputFormat;
    }
    const t = text || '';
    if (!t.includes('|')) return this.outputFormat;
    const hasStepCol = /\|\s*Step\s*\||\|\s*Action\s*\|/i.test(t);
    const hasExpected = /Expected\s*Result/i.test(t);
    const hasSummary =
      /\*{0,2}Test\s*Summary\*{0,2}\s*:/i.test(t) || /\*Test\s*Summary:\s*\*/i.test(t);
    if (hasStepCol && hasExpected && hasSummary) return 'Xray Jira Test Format';
    return this.outputFormat;
  }

  checkXrayDuplicates(): void {
    if (!this.xrayProjectKey.trim() || !this.items.length) return;
    this.checkingXrayDuplicates = true;
    const test_cases = this.items.map(tc => ({
      id: tc.id,
      title: tc.title,
      content: tc.content,
    }));
    this.api
      .postJson<{
        ok?: boolean;
        results?: Array<{
          is_duplicate: boolean;
          existing_issue_key?: string | null;
          summary_used: string;
          similarity?: number | null;
          match_type?: string | null;
        }>;
      }>('/test-cases/check-xray-duplicates', {
        project_key: this.xrayProjectKey.trim(),
        output_format: this.effectivePublishOutputFormat(this.buildOutputText()),
        test_cases,
      })
      .subscribe({
        next: (res) => {
          this.checkingXrayDuplicates = false;
          const results = res?.results ?? [];
          let dupCount = 0;
          let semanticCount = 0;
          results.forEach((r, i) => {
            const tc = this.items[i];
            if (!tc) return;
            tc.duplicateChecked = true;
            tc.isDuplicate = !!r.is_duplicate;
            tc.existingXrayKey = r.existing_issue_key || undefined;
            tc.summaryUsed = r.summary_used;
            tc.similarity = r.similarity ?? undefined;
            tc.matchType = r.match_type ?? undefined;
            if (r.is_duplicate) {
              tc.selected = false;
              dupCount += 1;
              if (r.match_type === 'semantic') semanticCount += 1;
            }
          });
          if (dupCount > 0) {
            const exactCount = dupCount - semanticCount;
            const parts: string[] = [];
            if (exactCount > 0) parts.push(`${exactCount} exact`);
            if (semanticCount > 0) parts.push(`${semanticCount} semantically similar`);
            this.toast.info(
              `${dupCount} duplicate test case${dupCount === 1 ? '' : 's'} found (${parts.join(', ')}); ${dupCount === 1 ? 'it was' : 'they were'} deselected for publish.`,
            );
          } else {
            this.toast.success('No duplicates found for the current summaries in that project.');
          }
        },
        error: (err) => {
          this.checkingXrayDuplicates = false;
          this.toast.error(err?.error?.detail || 'Duplicate check failed.');
        },
      });
  }

  stopGeneration(): void {
    if (!this.loading) {
      return;
    }
    this.userCancelledGeneration = true;
    this.generateAbort?.abort();
    this.loading = false;
    this.messageOk = false;
    this.message = 'Generation cancelled.';
    this.toast.info('Generation cancelled.');
  }

  applyInstructionPreset(value: string): void {
    this.userInstructions = this.userInstructions.trim()
      ? this.userInstructions + '\n' + value
      : value;
  }

  copyTestCase(tc: TestCaseItem): void {
    const text = `${tc.title}\n\n${tc.content}`;
    navigator.clipboard?.writeText(text).then(
      () => this.toast.success('Copied to clipboard.'),
      () => this.toast.error('Copy failed.')
    );
  }

  moveTestCase(tc: TestCaseItem, delta: number): void {
    const idx = this.items.findIndex((t) => t.id === tc.id);
    if (idx === -1) return;
    const newIdx = idx + delta;
    if (newIdx < 0 || newIdx >= this.items.length) return;
    const arr = [...this.items];
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    this.items = arr;
  }

  get selectedCount(): number {
    return this.items.filter(tc => tc.selected).length;
  }

  trustHtml(html: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(html || '');
  }

  /** Render basic markdown/Gherkin (## ### ** and tables) for preview; escapes HTML for safety. */
  formatContent(content: string): SafeHtml {
    if (!content?.trim()) return this.sanitizer.bypassSecurityTrustHtml('');
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    let html = esc(content);
    html = html.replace(/^###\s+(.+)$/gm, '</p><h4 class="tc-preview-h4">$1</h4><p class="tc-preview-p">');
    html = html.replace(/^##\s+(.+)$/gm, '</p><h3 class="tc-preview-h3">$1</h3><p class="tc-preview-p">');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = this.convertMarkdownTables(html);
    html = html.replace(/\n/g, '<br>');
    html = '<p class="tc-preview-p">' + html + '</p>';
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Convert consecutive markdown-table lines (|...|) into an HTML <table>. */
  private convertMarkdownTables(html: string): string {
    const lines = html.split('\n');
    const result: string[] = [];
    let i = 0;

    while (i < lines.length) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith('|') && (trimmed.match(/\|/g) || []).length >= 2) {
        const tableLines: string[] = [];
        while (i < lines.length && lines[i].trim().startsWith('|')) {
          tableLines.push(lines[i].trim());
          i++;
        }
        if (tableLines.length >= 2) {
          result.push(this.buildHtmlTable(tableLines));
        } else {
          result.push(...tableLines);
        }
      } else {
        result.push(lines[i]);
        i++;
      }
    }

    return result.join('\n');
  }

  private buildHtmlTable(tableLines: string[]): string {
    const parseRow = (line: string): string[] => {
      const parts = line.split('|');
      if (parts.length > 0 && parts[0].trim() === '') parts.shift();
      if (parts.length > 0 && parts[parts.length - 1].trim() === '') parts.pop();
      return parts.map(p => p.trim());
    };
    const isSeparator = (line: string): boolean => /^\|[\s\-:|]+\|$/.test(line);

    let headerCells: string[] | null = null;
    const bodyRows: string[][] = [];

    for (let j = 0; j < tableLines.length; j++) {
      if (isSeparator(tableLines[j])) continue;
      const cells = parseRow(tableLines[j]);
      if (!headerCells) {
        headerCells = cells;
      } else {
        bodyRows.push(cells);
      }
    }

    let t = '</p><table class="xray-steps-table">';
    if (headerCells) {
      t += '<thead><tr>' + headerCells.map(c => `<th>${c}</th>`).join('') + '</tr></thead>';
    }
    if (bodyRows.length) {
      t += '<tbody>';
      for (const row of bodyRows) {
        t += '<tr>' + row.map(c => `<td>${c}</td>`).join('') + '</tr>';
      }
      t += '</tbody>';
    }
    t += '</table><p class="tc-preview-p">';
    return t;
  }

  removeTestCase(tc: TestCaseItem): void {
    tc._exiting = true;
    setTimeout(() => {
      this.items = this.items.filter((t) => t.id !== tc.id);
      this.toast.info('Test case removed.');
    }, 280);
  }

  deleteSelected(): void {
    const n = this.selectedCount;
    if (n === 0) return;
    this.items = this.items.filter((t) => !t.selected);
    this.toast.info(`${n} test case${n === 1 ? '' : 's'} deleted.`);
  }

  generate(): void {
    if (!this.targetId.trim()) {
      this.message = 'Enter ticket ID or Confluence URL.';
      return;
    }
    this.userCancelledGeneration = false;
    this.generateAbort = new AbortController();
    this.loading = true;
    this.message = '';
    this.api
      .postForm(
        '/test-cases/generate',
        {
          source_type: this.sourceType,
          target_id: this.targetId.trim(),
          output_format: this.outputFormat,
          use_knowledge_base: this.useKnowledgeBase,
          user_instructions: this.userInstructions.trim(),
        },
        { signal: this.generateAbort.signal },
      )
      .subscribe({
        next: (res: any) => {
          this.loading = false;
          this.generateAbort = null;
          this.generatedText = res?.generated_text || '';
          const parsed = res?.parsed || [];
          this.items = parsed.map((p: { id: string; title: string; content: string; confidence?: number }) => ({
            id: p.id,
            title: p.title,
            content: p.content,
            confidence: p.confidence,
            selected: true,
            feedback: undefined,
            approved: (p.confidence ?? CONFIDENCE_APPROVAL_THRESHOLD) >= CONFIDENCE_APPROVAL_THRESHOLD,
          }));
          const needsReview = this.items.filter(tc => !tc.approved).length;
          this.messageOk = true;
          this.message = this.items.length
            ? `Generated ${this.items.length} test cases.` + (needsReview ? ` ${needsReview} need${needsReview === 1 ? 's' : ''} review (low confidence).` : '')
            : 'No test cases parsed.';
          if (this.items.length) {
            this.toast.success(`${this.items.length} test case${this.items.length === 1 ? '' : 's'} generated.`);
          }
        },
        error: (err: any) => {
          this.loading = false;
          this.generateAbort = null;
          if (this.userCancelledGeneration) {
            this.userCancelledGeneration = false;
            return;
          }
          this.messageOk = false;
          this.message = err?.error?.detail || err?.message || 'Failed.';
        },
      });
  }

  selectAll(): void {
    this.items.forEach(tc => tc.selected = true);
  }

  deselectAll(): void {
    this.items.forEach(tc => tc.selected = false);
  }

  buildOutputText(): string {
    if (this.outputFormat === 'Xray Jira Test Format') {
      return this.items.map(tc => {
        const hasSummary = tc.content.includes('**Test Summary:**');
        return hasSummary ? tc.content : `**Test Summary:** ${tc.title}\n\n${tc.content}`;
      }).join('\n\n---\n\n');
    }
    return this.items.map(tc => `## ${tc.title}\n\n${tc.content}`).join('\n\n');
  }

  exportExcel(): void {
    const outputText = this.buildOutputText();
    this.api.postJsonBlob('/export/excel', { output_text: outputText, output_format: this.outputFormat }).subscribe({
      next: (blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'test-cases.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      },
      error: () => { this.toast.error('Excel export failed. Please try again.'); },
    });
  }

  clearAll(): void {
    this.items = [];
    this.generatedText = '';
    this.globalFeedback = '';
    this.sourceLoaded = false;
    this.sourceInfo = null;
    this.targetId = '';
    this.messageOk = true;
    this.message = 'Cleared. You can generate new test cases.';
  }

  buildCurrentTestsText(): string {
    if (this.outputFormat === 'Xray Jira Test Format') {
      return this.items.map(tc => {
        const hasSummary = tc.content.includes('**Test Summary:**');
        return hasSummary ? tc.content : `**Test Summary:** ${tc.title}\n\n${tc.content}`;
      }).join('\n\n---\n\n');
    }
    return this.items.map(tc => `## ${tc.title}\n\n${tc.content}`).join('\n\n');
  }

  applyFeedbackToAll(): void {
    if (!this.globalFeedback.trim()) return;
    this.refiningAll = true;
    this.message = '';
    const snapshots = new Map(this.items.map(tc => [tc.id, tc.content]));
    const currentTests = this.buildCurrentTestsText();
    this.api.postForm('/test-cases/refine', {
      current_tests: currentTests,
      output_format: this.outputFormat,
      feedback: this.globalFeedback.trim(),
    }).subscribe({
      next: (res: unknown) => {
        this.refiningAll = false;
        const r = res as { parsed?: { id: string; title: string; content: string; confidence?: number }[] };
        const parsed = r?.parsed ?? [];
        this.items = parsed.map((p, i) => {
          const prev = snapshots.get(p.id) ?? snapshots.get(this.items[i]?.id ?? '') ?? undefined;
          return {
            id: p.id || `tc_${i + 1}`,
            title: p.title,
            content: p.content,
            confidence: p.confidence,
            selected: true,
            feedback: undefined,
            previousContent: prev,
            showDiff: !!prev && prev !== p.content,
            approved: (p.confidence ?? CONFIDENCE_APPROVAL_THRESHOLD) >= CONFIDENCE_APPROVAL_THRESHOLD,
          };
        });
        this.globalFeedback = '';
        this.messageOk = true;
        this.message = `Applied feedback to all ${this.items.length} test cases.`;
        this.toast.success(`Feedback applied to all ${this.items.length} test cases.`);
      },
      error: (err) => {
        this.refiningAll = false;
        this.message = err?.error?.detail || 'Refine failed.';
        this.messageOk = false;
        this.toast.error(err?.error?.detail || 'Refine failed.');
      },
    });
  }

  applyFeedbackToOne(tc: TestCaseItem): void {
    const feedback = (tc.feedback || '').trim();
    if (!feedback) return;
    this.refiningId = tc.id;
    const snapshot = tc.content;
    this.api.postForm('/test-cases/refine-single', {
      test_case_content: tc.content,
      output_format: this.outputFormat,
      feedback,
    }).subscribe({
        next: (res: unknown) => {
        this.refiningId = null;
        const r = res as { refined_content?: string; confidence?: number };
        if (r?.refined_content != null) {
          tc.previousContent = snapshot;
          tc.showDiff = true;
          tc.title = this.extractTitleFromContent(r.refined_content, tc.title);
          tc.content = r.refined_content;
          tc.feedback = '';
          tc.duplicateChecked = false;
          tc.isDuplicate = false;
          tc.existingXrayKey = undefined;
          tc.summaryUsed = undefined;
          tc.similarity = undefined;
          tc.matchType = undefined;
          tc.quality = undefined;
          if (r.confidence != null) {
            tc.confidence = r.confidence;
            tc.approved = r.confidence >= CONFIDENCE_APPROVAL_THRESHOLD;
          }
          this.toast.success('Test case updated.');
        }
      },
      error: () => {
        this.refiningId = null;
        this.toast.error('Failed to refine test case.');
      },
    });
  }

  reviewQuality(): void {
    if (!this.items.length) return;
    this.reviewingQuality = true;
    this.api.postJson<{ ok?: boolean; results?: Array<QualityScore & { id: string }> }>('/test-cases/quality-review', {
      output_format: this.outputFormat,
      test_cases: this.items.map(tc => ({ id: tc.id, title: tc.title, content: tc.content })),
    }).subscribe({
      next: (res) => {
        this.reviewingQuality = false;
        const results = res?.results ?? [];
        results.forEach(r => {
          const tc = this.items.find(t => t.id === r.id);
          if (tc) {
            tc.quality = r;
          }
        });
        this.toast.success(`Quality review completed for ${results.length} test case${results.length === 1 ? '' : 's'}.`);
      },
      error: (err) => {
        this.reviewingQuality = false;
        this.toast.error(err?.error?.detail || 'Quality review failed.');
      },
    });
  }

  /**
   * Extract an updated title from refined test-case content.
   * Handles Xray headers ("**Test Summary:** Title", "**Test Case N: Title**"),
   * and BDD headers ("Scenario: Title", "Scenario Outline: Title").
   */
  private extractTitleFromContent(content: string, fallback: string): string {
    if (!content) return fallback;
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Xray: **Test Summary:** Title
      const summaryMatch = trimmed.match(
        /^\*\*\s*Test\s+Summary\s*:\s*\*\*\s*(.+)$/i
      );
      if (summaryMatch?.[1]) return summaryMatch[1].trim();

      // Xray (legacy): **Test Case 9: Title** or ## Test Case 9: Title
      const xrayMatch = trimmed.match(
        /^(?:#{1,6}\s*)?(?:\*\*)?\s*Test\s*Case\s*\d+\s*:\s*(.*?)\s*(?:\*\*)?\s*$/i
      );
      if (xrayMatch?.[1]) return xrayMatch[1].trim();

      // BDD: Scenario: Title or Scenario Outline: Title
      const bddMatch = trimmed.match(
        /^(?:Scenario(?:\s+Outline)?)\s*:\s*(.+)$/i
      );
      if (bddMatch?.[1]) return bddMatch[1].trim();
    }
    return fallback;
  }

  qualityTooltip(q: QualityScore): string {
    const lines: string[] = [];
    if (q.clarity) lines.push(`Clarity: ${q.clarity.score}/5 — ${q.clarity.reason}`);
    if (q.completeness) lines.push(`Completeness: ${q.completeness.score}/5 — ${q.completeness.reason}`);
    if (q.edge_cases) lines.push(`Edge cases: ${q.edge_cases.score}/5 — ${q.edge_cases.reason}`);
    if (q.structure) lines.push(`Structure: ${q.structure.score}/5 — ${q.structure.reason}`);
    return lines.join('\n') || `Overall: ${q.overall}/5`;
  }

  duplicateTooltip(tc: TestCaseItem): string {
    if (tc.matchType === 'semantic') {
      const pct = tc.similarity != null ? `${(tc.similarity * 100).toFixed(0)}%` : '?';
      return `Semantically similar match (${pct} similarity).\nExisting issue: ${tc.existingXrayKey}\nSummary compared: "${tc.summaryUsed || ''}"`;
    }
    return `Exact match found.\nExisting issue: ${tc.existingXrayKey}\nSummary compared: "${tc.summaryUsed || ''}"`;
  }

  /** Line-level diff: highlight removed lines in the "before" column. */
  formatDiffRemoved(before: string, after: string): SafeHtml {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const bLines = before.split('\n');
    const aSet = new Set(after.split('\n'));
    const html = bLines.map(line => {
      const escaped = esc(line);
      return aSet.has(line) ? escaped : `<span class="diff-del">${escaped}</span>`;
    }).join('\n');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }

  /** Line-level diff: highlight added lines in the "after" column. */
  formatDiffAdded(before: string, after: string): SafeHtml {
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const aLines = after.split('\n');
    const bSet = new Set(before.split('\n'));
    const html = aLines.map(line => {
      const escaped = esc(line);
      return bSet.has(line) ? escaped : `<span class="diff-ins">${escaped}</span>`;
    }).join('\n');
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
