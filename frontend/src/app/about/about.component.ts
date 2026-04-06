import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

interface TourStep {
  icon: string;
  title: string;
  tagline: string;
  bullets: string[];
  route: string;
  routeLabel: string;
}

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="tour-surface">
      <header class="tour-hero">
        <div class="hero-text">
          <p class="eyebrow">Quick Tour</p>
          <h1 class="hero-title">AI-Powered QA Assistant</h1>
          <p class="hero-lead">
            Generate test cases, analyze Jira tickets with AI chat, build test plans, and publish to Xray and Confluence
            &mdash; all powered by AWS Bedrock LLMs and a knowledge-base RAG pipeline.
          </p>
        </div>
        <a routerLink="/home" class="close-link" aria-label="Close and go to Home" title="Close">
          <span aria-hidden="true">&times;</span>
        </a>
      </header>

      <!-- Feature highlight cards -->
      <section class="highlights" aria-label="Key capabilities">
        @for (h of highlights; track h.title) {
          <div class="highlight-card">
            <span class="hl-icon">{{ h.icon }}</span>
            <strong class="hl-title">{{ h.title }}</strong>
            <span class="hl-desc">{{ h.desc }}</span>
          </div>
        }
      </section>

      <!-- Interactive feature explorer -->
      <section class="tour-section" id="tour-stepper" aria-label="Feature tour">
        <h2 class="section-heading">Explore Each Feature</h2>

        <nav class="feature-tabs" role="tablist">
          @for (s of steps; track s.title; let i = $index) {
            <button
              type="button"
              role="tab"
              class="feature-tab"
              [class.active]="i === currentStep"
              [attr.aria-selected]="i === currentStep"
              (click)="currentStep = i">
              <span class="tab-icon">{{ s.icon }}</span>
              <span class="tab-label">{{ s.title }}</span>
            </button>
          }
        </nav>

        <div class="feature-panel" role="tabpanel">
          <div class="panel-header">
            <span class="panel-icon">{{ steps[currentStep].icon }}</span>
            <div>
              <h3 class="panel-title">{{ steps[currentStep].title }}</h3>
              <p class="panel-tagline">{{ steps[currentStep].tagline }}</p>
            </div>
          </div>
          <ul class="panel-bullets">
            @for (b of steps[currentStep].bullets; track b) {
              <li>{{ b }}</li>
            }
          </ul>
          <div class="panel-footer">
            <a [routerLink]="steps[currentStep].route" class="panel-cta">{{ steps[currentStep].routeLabel }} &#8594;</a>
            <div class="panel-nav">
              <button type="button" class="pnav-btn" (click)="prev()" [disabled]="currentStep === 0" aria-label="Previous feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pnav-icon"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span class="pnav-counter">{{ currentStep + 1 }} of {{ steps.length }}</span>
              <button type="button" class="pnav-btn" (click)="next()" [disabled]="currentStep === steps.length - 1" aria-label="Next feature">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="pnav-icon"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Tech stack (collapsible) -->
      <section class="tech-strip" aria-label="Technology">
        <button type="button" class="tech-toggle" (click)="techOpen = !techOpen">
          <span>Technology &amp; Architecture</span>
          <span class="toggle-arrow" [class.open]="techOpen">&#9662;</span>
        </button>
        @if (techOpen) {
          <div class="tech-body">
            <div class="tech-grid">
              @for (t of techStack; track t.name) {
                <div class="tech-item">
                  <strong>{{ t.name }}</strong>
                  <span>{{ t.desc }}</span>
                </div>
              }
            </div>
          </div>
        }
      </section>

      <!-- ═══ Original About section ═══ -->
      <div class="about-divider">
        <span class="divider-label">About This Tool</span>
      </div>

      <div class="columns">
        <section class="panel" aria-labelledby="how-heading">
          <h2 id="how-heading" class="panel-title">How It Works</h2>
          <ul class="steps-list">
            <li class="step-item">
              <span class="step-badge">1</span>
              <div class="step-item-body">
                <strong class="step-name">Pick a Source</strong>
                <p class="step-desc">Enter a Jira ticket ID or Confluence page URL &mdash; or load tickets in Ticket Analyzer.</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-badge">2</span>
              <div class="step-item-body">
                <strong class="step-name">Fetch &amp; Enrich</strong>
                <p class="step-desc">The app pulls summary, description, acceptance criteria, and related fields from Jira or Confluence automatically.</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-badge">3</span>
              <div class="step-item-body">
                <strong class="step-name">Choose Test Format</strong>
                <p class="step-desc">Select <strong>BDD (Gherkin)</strong> or <strong>Xray Jira Test Format</strong> for structured manual-style steps.</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-badge">4</span>
              <div class="step-item-body">
                <strong class="step-name">Optional RAG</strong>
                <p class="step-desc">Turn on the knowledge base so similar tickets and docs ground generation and chat.</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-badge">5</span>
              <div class="step-item-body">
                <strong class="step-name">Generate</strong>
                <p class="step-desc">Bedrock produces test cases or answers; add optional instructions (e.g. accessibility, edge cases).</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-badge">6</span>
              <div class="step-item-body">
                <strong class="step-name">Review &amp; Refine</strong>
                <p class="step-desc">Edit in place, apply feedback to one or all items, then choose what to publish.</p>
              </div>
            </li>
            <li class="step-item">
              <span class="step-badge">7</span>
              <div class="step-item-body">
                <strong class="step-name">Export &amp; Publish</strong>
                <p class="step-desc">Push to Jira/Xray, publish test plans to Confluence, or download Excel &mdash; within your permissions.</p>
              </div>
            </li>
          </ul>
        </section>

        <section class="panel" aria-labelledby="stack-heading">
          <h2 id="stack-heading" class="panel-title">AI &amp; Tech Stack</h2>
          <ul class="checklist">
            <li>
              <span class="check" aria-hidden="true"></span>
              <div>
                <strong>AWS Bedrock</strong>
                <span class="item-sub">Configurable LLM for generation, chat, and refinement.</span>
              </div>
            </li>
            <li>
              <span class="check" aria-hidden="true"></span>
              <div>
                <strong>RAG (ChromaDB)</strong>
                <span class="item-sub">Per-session vector store and retrieval for knowledge-aware prompts.</span>
              </div>
            </li>
            <li>
              <span class="check" aria-hidden="true"></span>
              <div>
                <strong>Jira REST API &amp; Confluence</strong>
                <span class="item-sub">Live ticket and page content, comments, and publishing workflows.</span>
              </div>
            </li>
            <li>
              <span class="check" aria-hidden="true"></span>
              <div>
                <strong>Xray-Oriented Tests</strong>
                <span class="item-sub">Create Test-type issues for your project; duplicate checks can align with Xray/Jira search.</span>
              </div>
            </li>
            <li>
              <span class="check" aria-hidden="true"></span>
              <div>
                <strong>FastAPI + Python</strong>
                <span class="item-sub">Session-scoped backend: orchestration, parsing, and integrations.</span>
              </div>
            </li>
            <li>
              <span class="check" aria-hidden="true"></span>
              <div>
                <strong>Angular 18</strong>
                <span class="item-sub">Standalone components, Hyland-themed UI, lazy-loaded routes.</span>
              </div>
            </li>
          </ul>
        </section>

        <section class="panel" aria-labelledby="gen-heading">
          <h2 id="gen-heading" class="panel-title">What It Generates</h2>

          <div class="generates-block">
            <h3 class="generates-subtitle" id="gen-ticket-analyzer">Ticket Analyzer</h3>
            <ul class="checklist checklist-tight" aria-labelledby="gen-ticket-analyzer">
              <li><span class="check" aria-hidden="true"></span><span>Chat grounded in loaded Jira tickets (optional knowledge-base context)</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Summaries, gap analysis, risk discussion, and test ideas</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Quick actions to steer the assistant without retyping prompts</span></li>
            </ul>
          </div>

          <div class="generates-block">
            <h3 class="generates-subtitle" id="gen-test-cases">Test Cases</h3>
            <ul class="checklist checklist-tight" aria-labelledby="gen-test-cases">
              <li><span class="check" aria-hidden="true"></span><span>Happy-path, negative, boundary, and edge-case scenarios</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Accessibility-focused ideas (via your instructions)</span></li>
              <li><span class="check" aria-hidden="true"></span><span>BDD Gherkin or Xray-style step tables</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Confidence scores with human-in-the-loop approval for low-confidence cases before publishing</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Excel export and publish workflows to Jira / Xray (within your permissions)</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Iterative AI refinement for one test case or all generated cases</span></li>
            </ul>
          </div>

          <div class="generates-block">
            <h3 class="generates-subtitle" id="gen-test-plan">Test Plan</h3>
            <ul class="checklist checklist-tight" aria-labelledby="gen-test-plan">
              <li><span class="check" aria-hidden="true"></span><span>Plans from multiple Confluence URLs, Jira tickets, and uploads</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Confluence-ready pages ready to publish</span></li>
              <li><span class="check" aria-hidden="true"></span><span>Refine the plan with feedback before publishing</span></li>
            </ul>
          </div>

          <p class="disclaimer">Exact outputs depend on model, prompts, and your Jira/Confluence access.</p>
        </section>
      </div>

      <footer class="tour-footer">
        <a routerLink="/config" class="footer-link">Configuration</a>
        <span class="dot-sep" aria-hidden="true"></span>
        <a routerLink="/home" class="footer-link">Home</a>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: block; margin: -1.25rem -1.5rem; }

    .tour-surface {
      min-height: calc(100vh - 2rem);
      padding: 1.75rem 1.5rem 2rem;
      background: var(--about-surface-bg);
      color: var(--about-text);
    }

    /* ═══════════ Hero ═══════════ */
    .tour-hero {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 1.5rem;
      margin-bottom: 2rem; padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--about-hero-border);
    }
    .hero-text { flex: 1; min-width: 0; }
    .eyebrow { margin: 0 0 0.35rem; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; color: var(--about-eyebrow); }
    .hero-title {
      margin: 0 0 0.6rem;
      font-family: var(--font-heading, 'Figtree', sans-serif); font-weight: 800;
      font-size: clamp(1.35rem, 2.5vw, 1.85rem); line-height: 1.15;
      color: var(--about-hero-title); letter-spacing: 0.02em;
      border: none; padding: 0; text-transform: none;
    }
    .hero-lead { margin: 0; max-width: 54rem; font-size: 0.92rem; line-height: 1.55; color: var(--about-hero-lead); }
    .close-link {
      flex-shrink: 0; width: 2.25rem; height: 2.25rem;
      display: grid; place-items: center; border-radius: 10px;
      border: 1px solid var(--about-close-border); background: var(--about-close-bg);
      color: var(--about-close-color); font-size: 1.5rem; line-height: 1; text-decoration: none;
      transition: background 0.2s, border-color 0.2s, color 0.2s;
    }
    .close-link:hover { background: var(--about-close-hover-bg); border-color: var(--about-close-hover-border); color: var(--about-close-hover-color); }

    /* ═══════════ Highlight cards ═══════════ */
    .highlights {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(185px, 1fr));
      gap: 0.85rem; margin-bottom: 2.25rem;
    }
    .highlight-card {
      display: flex; flex-direction: column; gap: 0.35rem;
      padding: 0.85rem 1rem; border-radius: 12px;
      background: var(--about-panel-bg); border: 1px solid var(--about-panel-border);
      box-shadow: 0 2px 12px rgba(0,0,0,0.12);
      animation: hlIn 0.4s ease both;
    }
    .highlight-card:nth-child(1) { animation-delay: 0.05s; }
    .highlight-card:nth-child(2) { animation-delay: 0.10s; }
    .highlight-card:nth-child(3) { animation-delay: 0.15s; }
    .highlight-card:nth-child(4) { animation-delay: 0.20s; }
    .highlight-card:nth-child(5) { animation-delay: 0.25s; }
    .highlight-card:nth-child(6) { animation-delay: 0.30s; }
    @keyframes hlIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    .hl-icon { font-size: 1.5rem; line-height: 1.2; }
    .hl-title { font-size: 0.82rem; font-weight: 700; color: var(--about-list-strong); }
    .hl-desc { font-size: 0.74rem; line-height: 1.4; color: var(--about-list-sub); }

    /* ═══════════ Section heading ═══════════ */
    .section-heading {
      margin: 0 0 1.25rem; font-family: var(--font-heading, 'Figtree', sans-serif);
      font-size: 1rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--about-panel-title);
    }

    /* ═══════════ Feature explorer (tabs + panel) ═══════════ */
    .tour-section { margin-bottom: 2.5rem; }

    .feature-tabs {
      display: flex; gap: 0; overflow-x: auto;
      border-bottom: 2px solid var(--about-panel-border);
      margin-bottom: 0; scrollbar-width: thin;
    }
    .feature-tab {
      display: flex; align-items: center; gap: 0.45rem;
      padding: 0.7rem 1.1rem; border: none; background: none;
      font-size: 0.82rem; font-weight: 600; white-space: nowrap;
      color: var(--about-list-sub); cursor: pointer;
      border-bottom: 2.5px solid transparent; margin-bottom: -2px;
      transition: color 0.2s, border-color 0.25s, background 0.2s;
    }
    .feature-tab:hover { color: var(--about-list-strong); background: rgba(82,161,255,0.06); }
    .feature-tab.active {
      color: var(--hyland-blue, #52a1ff); font-weight: 700;
      border-bottom-color: var(--hyland-blue, #52a1ff);
    }
    .tab-icon { font-size: 1.05rem; line-height: 1; }
    .tab-label { line-height: 1.2; }

    .feature-panel {
      padding: 1.35rem 1.5rem;
      background: var(--about-panel-bg); border: 1px solid var(--about-panel-border);
      border-top: none; border-radius: 0 0 14px 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
    }
    .panel-header {
      display: flex; gap: 0.85rem; align-items: flex-start; margin-bottom: 0.85rem;
    }
    .panel-icon { font-size: 2rem; line-height: 1; flex-shrink: 0; }
    .panel-title {
      margin: 0 0 0.25rem; font-family: var(--font-heading, 'Figtree', sans-serif);
      font-size: 1.05rem; font-weight: 800; color: var(--about-panel-title);
      border: none; padding: 0; text-transform: none; letter-spacing: 0;
    }
    .panel-tagline { margin: 0; font-size: 0.86rem; line-height: 1.5; color: var(--about-hero-lead); }

    .panel-bullets {
      margin: 0 0 0.85rem; padding: 0; list-style: none;
      display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.45rem 1.5rem;
    }
    .panel-bullets li {
      font-size: 0.82rem; line-height: 1.5; color: var(--about-list-text);
      position: relative; padding-left: 0.95rem;
    }
    .panel-bullets li::before {
      content: ''; position: absolute; left: 0; top: 0.5em;
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--hyland-teal, #13eac1);
    }

    .panel-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding-top: 0.85rem; margin-top: 0.25rem;
      border-top: 1px solid var(--about-panel-border);
    }
    .panel-cta {
      font-size: 0.85rem; font-weight: 700;
      color: var(--hyland-blue); text-decoration: none;
      transition: color 0.2s, letter-spacing 0.2s;
    }
    .panel-cta:hover { color: var(--hyland-teal); letter-spacing: 0.03em; }
    .panel-nav { display: flex; align-items: center; gap: 0.5rem; }
    .pnav-btn {
      width: 2rem; height: 2rem; border-radius: 8px;
      display: grid; place-items: center;
      cursor: pointer; border: 1.5px solid var(--about-panel-border);
      background: var(--about-panel-bg); color: var(--about-list-text);
      transition: border-color 0.2s, color 0.2s, background 0.2s, box-shadow 0.2s;
      padding: 0;
    }
    .pnav-btn:hover:not(:disabled) {
      border-color: var(--hyland-teal); color: var(--hyland-teal);
      box-shadow: 0 1px 6px rgba(19,234,193,0.15);
    }
    .pnav-btn:disabled { opacity: 0.3; cursor: default; }
    .pnav-icon { width: 0.95rem; height: 0.95rem; }
    .pnav-counter {
      font-size: 0.76rem; font-weight: 700; color: var(--about-list-sub);
      letter-spacing: 0.03em; min-width: 2.5rem; text-align: center;
    }

    /* ═══════════ Tech strip ═══════════ */
    .tech-strip {
      margin-bottom: 2rem; border-radius: 12px;
      background: var(--about-panel-bg); border: 1px solid var(--about-panel-border);
      overflow: hidden;
    }
    .tech-toggle {
      display: flex; width: 100%; align-items: center; justify-content: space-between;
      padding: 0.85rem 1.15rem; background: none; border: none;
      font-size: 0.88rem; font-weight: 700; color: var(--about-list-strong);
      cursor: pointer; transition: color 0.2s;
    }
    .tech-toggle:hover { color: var(--hyland-teal); }
    .toggle-arrow { transition: transform 0.25s ease; font-size: 0.75rem; }
    .toggle-arrow.open { transform: rotate(180deg); }
    .tech-body { padding: 0 1.15rem 1rem; }
    .tech-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 0.75rem; }
    .tech-item {
      padding: 0.65rem 0.85rem; border-radius: 8px;
      background: var(--about-surface-bg); border: 1px solid var(--about-panel-border);
    }
    .tech-item strong { display: block; font-size: 0.82rem; color: var(--about-list-strong); margin-bottom: 0.15rem; }
    .tech-item span { font-size: 0.75rem; line-height: 1.4; color: var(--about-list-sub); }

    /* ═══════════ About divider ═══════════ */
    .about-divider {
      display: flex; align-items: center; gap: 1rem;
      margin-bottom: 1.75rem;
    }
    .about-divider::before, .about-divider::after {
      content: ''; flex: 1; height: 1px;
      background: var(--about-hero-border);
    }
    .divider-label {
      font-family: var(--font-heading, 'Figtree', sans-serif);
      font-size: 0.78rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase;
      color: var(--about-panel-title); white-space: nowrap;
    }

    /* ═══════════ Original About columns ═══════════ */
    .columns {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 1.25rem;
      align-items: stretch;
      margin-bottom: 1.5rem;
    }
    @media (max-width: 1100px) { .columns { grid-template-columns: 1fr; gap: 1rem; } }

    .panel {
      background: var(--about-panel-bg);
      border: 1px solid var(--about-panel-border);
      border-radius: 14px;
      padding: 1.25rem 1.35rem 1.4rem;
      box-shadow: 0 4px 24px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.04);
      backdrop-filter: blur(8px);
    }
    .panel-title {
      margin: 0 0 1.1rem; padding-bottom: 0.65rem;
      font-family: var(--font-heading, 'Figtree', sans-serif);
      font-size: 0.95rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;
      color: var(--about-panel-title);
      border-bottom: 2px solid var(--about-panel-title-border);
    }
    .steps-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1rem; }
    .step-item { display: flex; gap: 0.85rem; align-items: flex-start; }
    .step-badge {
      flex-shrink: 0; width: 1.85rem; height: 1.85rem; border-radius: 50%;
      display: grid; place-items: center;
      font-family: var(--font-heading, 'Figtree', sans-serif); font-weight: 800; font-size: 0.72rem;
      color: var(--about-step-num-color);
      background: linear-gradient(145deg, #52a1ff 0%, #6e33ff 100%);
      box-shadow: 0 2px 10px rgba(82,161,255,0.35);
    }
    .step-item-body { min-width: 0; }
    .step-name { display: block; font-size: 0.88rem; color: var(--about-step-name); margin-bottom: 0.2rem; }
    .step-desc { margin: 0; font-size: 0.8rem; line-height: 1.5; color: var(--about-step-desc); }
    .step-desc strong { color: var(--about-step-desc-strong); font-weight: 600; }

    .checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.95rem; }
    .checklist-tight { gap: 0.65rem; }
    .generates-block + .generates-block { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--about-panel-border); }
    .generates-subtitle {
      margin: 0 0 0.55rem; font-family: var(--font-heading, 'Figtree', sans-serif);
      font-size: 0.84rem; font-weight: 800; letter-spacing: 0.02em;
      color: var(--about-list-strong); text-transform: none; border: none; padding: 0;
    }
    .checklist li { display: flex; gap: 0.65rem; align-items: flex-start; font-size: 0.82rem; line-height: 1.45; color: var(--about-list-text); }
    .checklist li > span:last-child { padding-top: 0.1rem; }
    .checklist strong { display: block; color: var(--about-list-strong); font-size: 0.86rem; margin-bottom: 0.15rem; }
    .item-sub { display: block; font-size: 0.78rem; color: var(--about-list-sub); font-weight: 400; }
    .check {
      flex-shrink: 0; width: 1.15rem; height: 1.15rem; margin-top: 0.15rem;
      border-radius: 50%; background: var(--about-check-bg);
      border: 1.5px solid var(--about-check-border); position: relative;
    }
    .check::after {
      content: ''; position: absolute; left: 50%; top: 45%;
      width: 4px; height: 7px;
      border: solid var(--hyland-teal, #13eac1); border-width: 0 2px 2px 0;
      transform: translate(-50%, -50%) rotate(45deg);
    }
    .disclaimer { margin: 1rem 0 0; font-size: 0.72rem; line-height: 1.4; color: var(--about-disclaimer); }

    /* ═══════════ Footer ═══════════ */
    .tour-footer {
      margin-top: 1.75rem; padding-top: 1.25rem;
      border-top: 1px solid var(--about-footer-border);
      display: flex; align-items: center; justify-content: center; gap: 0.65rem; flex-wrap: wrap;
    }
    .footer-link { color: var(--about-footer-link); font-weight: 600; font-size: 0.88rem; text-decoration: none; }
    .footer-link:hover { color: var(--about-footer-link-hover); text-decoration: underline; }
    .dot-sep { width: 4px; height: 4px; border-radius: 50%; background: var(--about-dot); }

    @media (max-width: 700px) {
      .feature-tabs { gap: 0; }
      .feature-tab { padding: 0.6rem 0.75rem; font-size: 0.76rem; }
      .tab-icon { font-size: 0.9rem; }
      .panel-header { flex-direction: column; gap: 0.5rem; }
      .panel-bullets { grid-template-columns: 1fr; }
      .highlights { grid-template-columns: repeat(2, 1fr); }
    }
  `],
})
export class AboutComponent {
  currentStep = 0;
  techOpen = false;

  highlights = [
    { icon: '\u{1F9EA}', title: 'Test Case Generation', desc: 'BDD Gherkin or Xray step tables from Jira tickets and Confluence pages.' },
    { icon: '\u{1F4AC}', title: 'AI Chat over Tickets', desc: 'Load Jira tickets and chat with context-aware AI assistant.' },
    { icon: '\u{1F4CB}', title: 'Test Plan Builder', desc: 'Build plans from multiple sources and publish to Confluence.' },
    { icon: '\u{1F4DA}', title: 'Knowledge Base (RAG)', desc: 'Add docs, tickets, and pages to ground AI responses.' },
    { icon: '\u{1F6E1}', title: 'Confidence Guardrails', desc: 'Low-confidence test cases require human approval before publishing.' },
    { icon: '\u{1F504}', title: 'Iterative Refinement', desc: 'Apply feedback to refine one or all generated items.' },
  ];

  steps: TourStep[] = [
    {
      icon: '\u{2699}\u{FE0F}',
      title: 'Configuration',
      tagline: 'Connect to Jira, Confluence, and AWS Bedrock. Choose your LLM model and tune parameters.',
      bullets: [
        'Enter Jira/Confluence URL and API token',
        'Select AWS profile and region',
        'Pick from available Bedrock models (Claude, Llama, Mistral, etc.)',
        'Tune temperature, chunk size, top-K retrieval settings',
      ],
      route: '/config',
      routeLabel: 'Open Configuration',
    },
    {
      icon: '\u{1F50D}',
      title: 'Ticket Analyzer',
      tagline: 'Load Jira tickets and have an AI-powered conversation grounded in real ticket data.',
      bullets: [
        'Load one or more Jira tickets as context',
        'Chat freely or use Quick Actions (summarize, find gaps, assess risks, generate test ideas)',
        'Attach files for additional context',
        'Toggle knowledge-base RAG for richer responses',
        'Export conversations or post AI analysis as Jira comments',
      ],
      route: '/ticket-analyzer',
      routeLabel: 'Open Ticket Analyzer',
    },
    {
      icon: '\u{1F9EA}',
      title: 'Generate Test Cases',
      tagline: 'Generate structured test cases from a Jira ticket or Confluence page with a single click.',
      bullets: [
        'Choose BDD (Gherkin) or Xray Jira Test Format',
        'Add custom instructions (accessibility, edge cases, security, performance)',
        'AI confidence scores with human-in-the-loop approval for low-confidence cases',
        'Edit in-line, refine with feedback, check for Xray duplicates',
        'Publish selected test cases directly to Jira/Xray or export to Excel',
      ],
      route: '/test-cases',
      routeLabel: 'Open Test Cases',
    },
    {
      icon: '\u{1F4CB}',
      title: 'Test Plan',
      tagline: 'Create comprehensive test plans from Confluence pages, Jira tickets, and uploaded documents.',
      bullets: [
        'Combine multiple Confluence URLs, Jira tickets, and file uploads',
        'AI generates a structured, Confluence-ready test plan',
        'Refine the plan with iterative feedback',
        'Publish directly to a Confluence page',
      ],
      route: '/test-plan',
      routeLabel: 'Open Test Plan',
    },
    {
      icon: '\u{1F4DA}',
      title: 'Knowledge Base',
      tagline: 'Build a project-specific knowledge base that grounds AI generation and chat in your real data.',
      bullets: [
        'Add Jira tickets, Confluence pages, and uploaded files as knowledge sources',
        'ChromaDB vector store with configurable chunking and retrieval',
        'Improves test case quality and chat relevance',
        'View sources and manage the knowledge base',
      ],
      route: '/knowledge-base',
      routeLabel: 'Open Knowledge Base',
    },
  ];

  techStack = [
    { name: 'AWS Bedrock', desc: 'Configurable LLM for generation, chat, and refinement.' },
    { name: 'RAG (ChromaDB)', desc: 'Per-session vector store and retrieval for knowledge-aware prompts.' },
    { name: 'Jira REST API', desc: 'Live ticket content, comments, Xray test publishing.' },
    { name: 'Confluence API', desc: 'Page content fetching and test plan publishing.' },
    { name: 'FastAPI + Python', desc: 'Session-scoped backend: orchestration, parsing, integrations.' },
    { name: 'Angular 18', desc: 'Standalone components, Hyland-themed UI, lazy-loaded routes.' },
  ];

  prev(): void {
    if (this.currentStep > 0) this.currentStep--;
  }

  next(): void {
    if (this.currentStep < this.steps.length - 1) this.currentStep++;
  }
}
