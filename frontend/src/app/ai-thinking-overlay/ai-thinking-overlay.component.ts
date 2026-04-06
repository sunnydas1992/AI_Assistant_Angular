import {
  Component,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';

type StepStatus = 'pending' | 'active' | 'done';

interface DisplayStep {
  id: string;
  label: string;
  status: StepStatus;
}

const DEFAULT_STEP_LABELS = [
  'Preparing request',
  'Connecting to services',
  'Running AI',
  'Finalizing response',
];

@Component({
  selector: 'app-ai-thinking-overlay',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (open) {
      <div class="think-overlay" role="dialog" aria-modal="true" aria-labelledby="think-modal-title">
        <div class="think-modal">
          <div class="think-modal-header">
            <div class="think-hero">
              <div class="think-ai-visual" aria-hidden="true">
                <div class="think-ai-bloom"></div>
                <div class="think-orbit think-orbit--1"><span class="think-orbit-dot"></span></div>
                <div class="think-orbit think-orbit--2"><span class="think-orbit-dot think-orbit-dot--teal"></span></div>
                <div class="think-orbit think-orbit--3"><span class="think-orbit-dot think-orbit-dot--purple"></span></div>
                <svg class="think-ai-svg" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient id="thinkAiStrokeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stop-color="#52A1FF" />
                      <stop offset="50%" stop-color="#13EAC1" />
                      <stop offset="100%" stop-color="#6E33FF" />
                    </linearGradient>
                    <linearGradient id="thinkAiCoreFill" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stop-color="#52A1FF" stop-opacity="0.22" />
                      <stop offset="100%" stop-color="#13EAC1" stop-opacity="0.12" />
                    </linearGradient>
                  </defs>
                  <g class="think-ai-rings">
                    <circle cx="60" cy="60" r="52" stroke="rgba(82,161,255,0.18)" stroke-width="3" />
                    <circle
                      class="think-ai-ring-dash"
                      cx="60"
                      cy="60"
                      r="52"
                      stroke="url(#thinkAiStrokeGrad)"
                      stroke-width="3"
                      stroke-linecap="round"
                    />
                    <circle
                      class="think-ai-ring-inner"
                      cx="60"
                      cy="60"
                      r="40"
                      stroke="url(#thinkAiStrokeGrad)"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      stroke-dasharray="36 115"
                      stroke-opacity="0.55"
                    />
                  </g>
                  <g class="think-ai-core">
                    <rect
                      x="38"
                      y="38"
                      width="44"
                      height="44"
                      rx="14"
                      fill="url(#thinkAiCoreFill)"
                      stroke="url(#thinkAiStrokeGrad)"
                      stroke-width="1.5"
                    />
                    <path
                      class="think-ai-trace"
                      d="M50 54h20M50 60h20M50 66h20"
                      stroke="url(#thinkAiStrokeGrad)"
                      stroke-width="1.25"
                      stroke-linecap="round"
                      opacity="0.55"
                    />
                    <circle class="think-ai-node think-ai-node--1" cx="48" cy="50" r="3.2" fill="#52A1FF" />
                    <circle class="think-ai-node think-ai-node--2" cx="72" cy="50" r="3.2" fill="#13EAC1" />
                    <circle class="think-ai-node think-ai-node--3" cx="48" cy="70" r="3.2" fill="#6E33FF" />
                    <circle class="think-ai-node think-ai-node--4" cx="72" cy="70" r="3.2" fill="#52A1FF" />
                    <circle
                      class="think-ai-hub"
                      cx="60"
                      cy="60"
                      r="8"
                      stroke="url(#thinkAiStrokeGrad)"
                      stroke-width="1.75"
                    />
                    <path
                      class="think-ai-spark think-ai-spark--a"
                      d="M60 44v-6M60 82v6M44 60h-6M82 60h6"
                      stroke="#52A1FF"
                      stroke-width="1.5"
                      stroke-linecap="round"
                      opacity="0.65"
                    />
                  </g>
                </svg>
              </div>
              <h2 id="think-modal-title" class="think-modal-title">{{ title }}</h2>
              <p class="think-modal-sub">{{ subtitle }}</p>
            </div>
          </div>
          <div class="think-steps-panel">
            @for (step of steps; track step.id) {
              <div
                class="think-step"
                [class.think-step-done]="step.status === 'done'"
                [class.think-step-active]="step.status === 'active'"
                [class.think-step-pending]="step.status === 'pending'"
              >
                <span class="think-step-icon" aria-hidden="true">
                  @if (step.status === 'done') {
                    <svg viewBox="0 0 24 24" class="think-ico-check" aria-hidden="true">
                      <path fill="currentColor" d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                    </svg>
                  } @else if (step.status === 'active') {
                    <span class="think-ico-spin"></span>
                  } @else {
                    <span class="think-ico-dot"></span>
                  }
                </span>
                <span class="think-step-label">{{ step.label }}</span>
              </div>
            }
          </div>
          @if (showStop) {
            <button type="button" class="think-stop-btn" (click)="onStop()">
              <span class="think-stop-square" aria-hidden="true"></span>
              {{ stopButtonText }}
            </button>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      .think-overlay {
        position: fixed;
        inset: 0;
        z-index: 10050;
        background: rgba(15, 20, 45, 0.5);
        display: grid;
        place-items: center;
        padding: 1rem;
        backdrop-filter: blur(5px);
      }
      .think-modal {
        background: var(--app-card-bg);
        color: var(--app-text);
        border-radius: 16px;
        box-shadow: 0 24px 56px rgba(0, 0, 0, 0.2);
        max-width: 420px;
        width: 100%;
        padding: 1.5rem 1.35rem 1.35rem;
        border: 1px solid var(--app-card-border);
      }
      .think-modal-header {
        margin-bottom: 0.25rem;
      }
      .think-hero {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
      }
      .think-ai-visual {
        position: relative;
        width: 108px;
        height: 108px;
        margin: 0 auto 0.9rem;
      }
      .think-ai-bloom {
        position: absolute;
        inset: -14px;
        border-radius: 50%;
        background: radial-gradient(
          circle,
          rgba(82, 161, 255, 0.38) 0%,
          rgba(19, 234, 193, 0.14) 42%,
          transparent 68%
        );
        animation: thinkBloom 2.8s ease-in-out infinite;
        pointer-events: none;
      }
      @keyframes thinkBloom {
        0%,
        100% {
          transform: scale(0.88);
          opacity: 0.65;
        }
        50% {
          transform: scale(1.06);
          opacity: 1;
        }
      }
      .think-orbit {
        position: absolute;
        inset: 0;
        animation: thinkOrbitSpin 5.2s linear infinite;
        pointer-events: none;
      }
      .think-orbit--2 {
        animation-duration: 3.4s;
        animation-direction: reverse;
      }
      .think-orbit--3 {
        animation-duration: 2.15s;
      }
      @keyframes thinkOrbitSpin {
        to {
          transform: rotate(360deg);
        }
      }
      .think-orbit-dot {
        position: absolute;
        top: 1px;
        left: 50%;
        width: 7px;
        height: 7px;
        margin-left: -3.5px;
        border-radius: 50%;
        background: var(--hyland-blue);
        box-shadow:
          0 0 10px rgba(82, 161, 255, 0.95),
          0 0 20px rgba(82, 161, 255, 0.35);
        animation: thinkOrbitPulse 1.4s ease-in-out infinite;
      }
      .think-orbit-dot--teal {
        background: var(--hyland-teal);
        box-shadow:
          0 0 10px rgba(19, 234, 193, 0.85),
          0 0 18px rgba(19, 234, 193, 0.3);
        animation-delay: 0.25s;
      }
      .think-orbit-dot--purple {
        background: var(--hyland-purple);
        box-shadow:
          0 0 10px rgba(110, 51, 255, 0.75),
          0 0 16px rgba(110, 51, 255, 0.28);
        animation-delay: 0.5s;
      }
      @keyframes thinkOrbitPulse {
        0%,
        100% {
          transform: scale(1);
          opacity: 0.85;
        }
        50% {
          transform: scale(1.15);
          opacity: 1;
        }
      }
      .think-ai-svg {
        position: relative;
        z-index: 1;
        width: 100%;
        height: 100%;
        display: block;
        filter: drop-shadow(0 2px 12px rgba(82, 161, 255, 0.2));
      }
      .think-ai-rings {
        transform-origin: 60px 60px;
        animation: thinkRingsRotate 12s linear infinite;
      }
      @keyframes thinkRingsRotate {
        to {
          transform: rotate(360deg);
        }
      }
      .think-ai-ring-dash {
        stroke-dasharray: 52 275;
        animation: thinkDashMarch 2.2s linear infinite;
      }
      @keyframes thinkDashMarch {
        to {
          stroke-dashoffset: -327;
        }
      }
      .think-ai-ring-inner {
        animation: thinkInnerDash 3.6s linear infinite;
      }
      @keyframes thinkInnerDash {
        to {
          stroke-dashoffset: -151;
        }
      }
      .think-ai-core {
        transform-origin: 60px 60px;
        animation: thinkCoreFloat 3.2s ease-in-out infinite;
      }
      @keyframes thinkCoreFloat {
        0%,
        100% {
          transform: translateY(0);
        }
        50% {
          transform: translateY(-2px);
        }
      }
      .think-ai-hub {
        fill: none;
        animation: thinkHubPulse 2s ease-in-out infinite;
      }
      @keyframes thinkHubPulse {
        0%,
        100% {
          stroke-opacity: 0.55;
        }
        50% {
          stroke-opacity: 1;
        }
      }
      .think-ai-node {
        animation: thinkNodeGlow 1.85s ease-in-out infinite;
      }
      .think-ai-node--1 {
        animation-delay: 0s;
      }
      .think-ai-node--2 {
        animation-delay: 0.22s;
      }
      .think-ai-node--3 {
        animation-delay: 0.44s;
      }
      .think-ai-node--4 {
        animation-delay: 0.66s;
      }
      @keyframes thinkNodeGlow {
        0%,
        100% {
          opacity: 0.4;
        }
        50% {
          opacity: 1;
        }
      }
      .think-ai-trace {
        stroke-dasharray: 6 10;
        animation: thinkTraceFlow 1.2s linear infinite;
      }
      @keyframes thinkTraceFlow {
        to {
          stroke-dashoffset: -32;
        }
      }
      .think-ai-spark {
        animation: thinkSparkFade 2.4s ease-in-out infinite;
      }
      .think-ai-spark--a {
        animation-delay: 0.15s;
      }
      @keyframes thinkSparkFade {
        0%,
        100% {
          opacity: 0.35;
        }
        50% {
          opacity: 0.9;
        }
      }
      .think-modal-title {
        margin: 0;
        font-size: 1.12rem;
        font-weight: 800;
        font-family: var(--font-heading, 'Figtree', sans-serif);
        letter-spacing: 0.02em;
      }
      .think-modal-sub {
        margin: 0.4rem 0 0;
        font-size: 0.88rem;
        color: var(--app-text-muted);
        line-height: 1.4;
      }
      .think-steps-panel {
        margin-top: 1.2rem;
        padding: 0.7rem;
        background: var(--app-surface-muted);
        border-radius: 12px;
        border: 1px solid var(--app-border-subtle);
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }
      .think-step {
        display: flex;
        align-items: center;
        gap: 0.65rem;
        padding: 0.5rem 0.6rem;
        border-radius: 10px;
        font-size: 0.86rem;
        line-height: 1.35;
        background: var(--app-card-bg);
        border: 1px solid var(--app-card-border);
        transition:
          opacity 0.2s ease,
          border-color 0.2s ease;
      }
      .think-step-pending {
        opacity: 0.58;
      }
      .think-step-pending .think-step-label {
        color: var(--app-text-muted);
      }
      .think-step-active {
        border-color: rgba(82, 161, 255, 0.5);
        box-shadow: 0 0 0 1px rgba(82, 161, 255, 0.12);
        opacity: 1;
      }
      .think-step-done .think-step-label {
        color: var(--app-text);
      }
      .think-step-icon {
        width: 1.55rem;
        height: 1.55rem;
        flex-shrink: 0;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: var(--hyland-blue);
        color: #fff;
      }
      .think-step-pending .think-step-icon {
        background: transparent;
        border: 2px solid var(--app-text-muted);
        opacity: 0.85;
      }
      .think-ico-check {
        width: 14px;
        height: 14px;
      }
      .think-ico-spin {
        width: 12px;
        height: 12px;
        border: 2px solid rgba(255, 255, 255, 0.35);
        border-top-color: #fff;
        border-radius: 50%;
        animation: thinkSpin 0.65s linear infinite;
      }
      @keyframes thinkSpin {
        to {
          transform: rotate(360deg);
        }
      }
      .think-ico-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--app-text-muted);
        opacity: 0.45;
      }
      .think-stop-btn {
        margin-top: 1.1rem;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        padding: 0.68rem 1rem;
        border: none;
        border-radius: 999px;
        font-weight: 700;
        font-size: 0.9rem;
        cursor: pointer;
        background: #e85d4c;
        color: #fff;
        font-family: inherit;
        transition:
          filter 0.2s ease,
          transform 0.12s ease;
      }
      .think-stop-btn:hover {
        filter: brightness(1.05);
      }
      .think-stop-btn:focus-visible {
        outline: 2px solid var(--hyland-blue);
        outline-offset: 2px;
      }
      .think-stop-btn:active {
        transform: scale(0.99);
      }
      .think-stop-square {
        width: 10px;
        height: 10px;
        background: #fff;
        border-radius: 2px;
      }
    `,
  ],
})
export class AiThinkingOverlayComponent implements OnChanges, OnDestroy {
  @Input() open = false;
  @Input() title = 'Working…';
  @Input() subtitle = 'Sit tight! Let the AI do your work…';
  /** When empty, default generic steps are used. */
  @Input() stepLabels: string[] = [];
  @Input() showStop = false;
  @Input() stopButtonText = 'Stop';

  @Output() stopped = new EventEmitter<void>();

  steps: DisplayStep[] = [];

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private rowDefs: { id: string; label: string }[] = [];
  private phase = 0;
  /** Content key of labels last used to start the timer; avoids reset when parents pass a new array ref each CD. */
  private lastSimulatedLabelsKey = '';

  ngOnChanges(ch: SimpleChanges): void {
    if (!this.open) {
      if (ch['open'] || ch['stepLabels']) {
        this.clearSimulation();
        this.steps = [];
        this.lastSimulatedLabelsKey = '';
      }
      return;
    }

    const labels = this.stepLabels?.length ? this.stepLabels : DEFAULT_STEP_LABELS;
    const labelsKey = labels.join('\u0001');

    const openTurnedOn =
      !!ch['open'] && ch['open'].currentValue === true && ch['open'].previousValue !== true;

    const shouldRestart =
      openTurnedOn || (!!ch['stepLabels'] && labelsKey !== this.lastSimulatedLabelsKey);

    if (shouldRestart) {
      this.startSimulation();
    }
  }

  ngOnDestroy(): void {
    this.clearSimulation();
  }

  @HostListener('document:keydown.escape', ['$event'])
  onEscape(event: Event): void {
    if (!this.open || !this.showStop) {
      return;
    }
    event.preventDefault();
    this.onStop();
  }

  onStop(): void {
    if (!this.open || !this.showStop) {
      return;
    }
    this.stopped.emit();
  }

  private startSimulation(): void {
    this.clearSimulation();
    const labels = this.stepLabels?.length ? this.stepLabels : DEFAULT_STEP_LABELS;
    this.lastSimulatedLabelsKey = labels.join('\u0001');
    this.rowDefs = labels.map((label, i) => ({ id: `s${i + 1}`, label }));
    this.phase = 0;
    const rows = this.rowDefs;
    this.steps = rows.map((r, i) => ({
      ...r,
      status: (i === 0 ? 'active' : 'pending') as StepStatus,
    }));

    this.intervalId = setInterval(() => {
      if (!this.open) {
        this.clearSimulation();
        return;
      }
      if (this.phase >= rows.length - 1) {
        return;
      }
      this.phase += 1;
      this.steps = rows.map((r, i) => ({
        ...r,
        status: (i < this.phase ? 'done' : i === this.phase ? 'active' : 'pending') as StepStatus,
      }));
    }, 1050);
  }

  private clearSimulation(): void {
    if (this.intervalId != null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
}
