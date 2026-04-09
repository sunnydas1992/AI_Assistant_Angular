import { Component, OnInit, OnDestroy } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Subscription, filter } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { InitService } from './init.service';
import { ToastService } from './toast.service';
import { ApiService } from './api.service';
import { ThemeService } from './theme.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [AsyncPipe, RouterLink, RouterLinkActive, RouterOutlet],
  template: `
    <div class="app-layout">
      <div class="toast-stack" aria-live="polite">
        @for (t of (toastService.toastsObservable | async); track t.id) {
          <div class="toast toast-{{ t.type }}" [class.toast-exit]="t.exiting">
            <span class="toast-icon" aria-hidden="true">
              @if (t.type === 'success') {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
              } @else if (t.type === 'error') {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
              } @else {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>
              }
            </span>
            <span class="toast-text">{{ t.text }}</span>
            <button class="toast-dismiss" (click)="toastService.dismiss(t.id)" aria-label="Dismiss">&times;</button>
            <div class="toast-progress" [style.animation-duration.ms]="t.duration"></div>
          </div>
        }
      </div>
      @if (showOnboardingBanner && (initService.initialized$ | async)) {
        <div class="onboarding-banner">
          <span><strong>What's next?</strong> Add tickets to Knowledge Base → Load a ticket in Ticket Analyzer → Generate test cases.</span>
          <button type="button" class="dismiss-btn" (click)="dismissOnboarding()" aria-label="Dismiss">×</button>
        </div>
      }
      <div class="app-body">
      <aside class="sidebar" [class.collapsed]="sidebarCollapsed">
        <div class="sidebar-shimmer" aria-hidden="true"></div>
        <div class="sidebar-top-row">
          <a routerLink="/home" class="logo-block logo-link" title="Go to Home" aria-label="Hyland QA Assistant — Home">
            <span class="logo-wordmark">{{ sidebarCollapsed ? 'H' : 'Hyland' }}</span>
            <span class="logo-text" [class.hidden]="sidebarCollapsed">QA Assistant</span>
          </a>
          <button type="button" class="sidebar-toggle" (click)="toggleSidebar()" [attr.aria-label]="sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'" title="{{ sidebarCollapsed ? 'Expand' : 'Collapse' }}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              @if (sidebarCollapsed) {
                <polyline points="9 18 15 12 9 6"/>
              } @else {
                <polyline points="15 18 9 12 15 6"/>
              }
            </svg>
          </button>
        </div>

        <nav class="sidebar-nav-main" aria-label="Main navigation">
          <a routerLink="/config" routerLinkActive="active" [routerLinkActiveOptions]="{exact: true}" class="nav-pill">
            <span class="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
            </span>
            <span class="nav-label">Configuration</span>
          </a>

          @if (initService.initialized$ | async; as initialized) {
            <a routerLink="/home" routerLinkActive="active" class="nav-pill"
               [class.nav-disabled]="!initialized"
               (click)="!initialized && $event.preventDefault(); !initialized && navToConfig()"
               [title]="!initialized ? 'Initialize first' : 'Home'">
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5z"/></svg>
              </span>
              <span class="nav-label">Home</span>
            </a>
            <a routerLink="/knowledge-base" routerLinkActive="active" class="nav-pill"
               [class.nav-disabled]="!initialized"
               (click)="!initialized && $event.preventDefault(); !initialized && navToConfig()"
               [title]="!initialized ? 'Initialize the system first' : 'Knowledge Base'">
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h8"/></svg>
              </span>
              <span class="nav-label">Knowledge Base</span>
            </a>
            <a routerLink="/ticket-analyzer" routerLinkActive="active" class="nav-pill"
               [class.nav-disabled]="!initialized"
               (click)="!initialized && $event.preventDefault(); !initialized && navToConfig()"
               [title]="!initialized ? 'Initialize the system first' : 'Ticket Analyzer'">
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
              </span>
              <span class="nav-label">Ticket Analyzer</span>
            </a>
            <a routerLink="/test-cases" routerLinkActive="active" class="nav-pill"
               [class.nav-disabled]="!initialized"
               (click)="!initialized && $event.preventDefault(); !initialized && navToConfig()"
               [title]="!initialized ? 'Initialize the system first' : 'Test Cases'">
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              </span>
              <span class="nav-label">Test Cases</span>
            </a>
            <a routerLink="/test-plan" routerLinkActive="active" class="nav-pill"
               [class.nav-disabled]="!initialized"
               (click)="!initialized && $event.preventDefault(); !initialized && navToConfig()"
               [title]="!initialized ? 'Initialize the system first' : 'Test Plan'">
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/></svg>
              </span>
              <span class="nav-label">Test Plan</span>
            </a>
          }
        </nav>

        <div class="sidebar-footer">
          <button type="button" class="nav-pill nav-pill-btn theme-toggle" (click)="themeService.toggle()"
            [attr.aria-label]="themeService.theme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'">
            @if (themeService.theme() === 'dark') {
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              </span>
              <span class="nav-label">Light Mode</span>
            } @else {
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
              </span>
              <span class="nav-label">Dark Mode</span>
            }
          </button>
          <a routerLink="/about" routerLinkActive="active" class="nav-pill" title="Quick tour of features, getting started, and tech stack">
            <span class="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>
            </span>
            <span class="nav-label">About</span>
          </a>
          @if (initService.initialized$ | async) {
            <button type="button" class="nav-pill nav-pill-btn" (click)="disconnect()" title="Disconnect and return to Configuration">
              <span class="nav-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </span>
              <span class="nav-label">Disconnect</span>
            </button>
          }
        </div>
      </aside>
      <main class="main-content" [class.page-entering]="pageEntering">
        <router-outlet></router-outlet>
      </main>
      </div>
    </div>
  `,
  styles: [`
    .app-layout {
      display: flex;
      flex-direction: column;
      height: 100vh;
      max-height: 100vh;
      overflow: hidden;
    }
    .app-body {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .sidebar {
      width: 248px;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      padding: 1rem 0.65rem 1rem;
      box-shadow: 4px 0 20px rgba(0, 0, 0, 0.1);
      position: relative;
      overflow: hidden;
      transition: width 0.3s cubic-bezier(0.22,1,0.36,1), padding 0.3s cubic-bezier(0.22,1,0.36,1);
    }
    .sidebar.collapsed { width: 60px; padding: 1rem 0.35rem; }
    .sidebar.collapsed .nav-label { display: none; }
    .sidebar.collapsed .logo-text { display: none; }
    .sidebar.collapsed .logo-block { align-items: center; }
    .sidebar.collapsed .logo-wordmark { font-size: 1.1rem; letter-spacing: 0; }
    .sidebar.collapsed a.nav-pill,
    .sidebar.collapsed button.nav-pill { justify-content: center; padding: 0.55rem 0.35rem; }
    .sidebar.collapsed .nav-icon { margin: 0 auto; }
    .sidebar-top-row {
      display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 1.25rem;
    }
    .sidebar.collapsed .sidebar-top-row { flex-direction: column; align-items: center; gap: 0.5rem; }
    .sidebar-toggle {
      background: none; border: 1px solid var(--nav-pill-border); border-radius: 6px;
      color: var(--sidebar-text); cursor: pointer; padding: 0.25rem; display: grid; place-items: center;
      width: 1.6rem; height: 1.6rem; flex-shrink: 0; opacity: 0.7;
      transition: opacity 0.2s, background 0.2s, transform 0.2s;
    }
    .sidebar-toggle:hover { opacity: 1; background: var(--nav-pill-hover-bg); }
    .sidebar-toggle svg { width: 1rem; height: 1rem; }
    .sidebar-shimmer {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      background: linear-gradient(
        90deg,
        transparent 0%,
        var(--hyland-teal) 25%,
        var(--hyland-blue) 50%,
        var(--hyland-purple) 75%,
        transparent 100%
      );
      background-size: 200% 100%;
      animation: sidebarShimmer 3.5s ease-in-out infinite;
      opacity: 0.85;
    }
    @keyframes sidebarShimmer {
      0%, 100% { background-position: -200% 0; }
      50% { background-position: 200% 0; }
    }
    .logo-block {
      margin-bottom: 1.25rem;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
    a.logo-link {
      text-decoration: none;
      color: inherit;
      cursor: pointer;
      border-radius: 8px;
      margin: -0.25rem;
      padding: 0.25rem;
      transition: background 0.2s ease, opacity 0.2s ease;
    }
    a.logo-link:hover {
      background: rgba(82, 161, 255, 0.14);
    }
    a.logo-link:focus-visible {
      outline: 2px solid var(--hyland-teal, #13eac1);
      outline-offset: 2px;
    }
    .logo-wordmark {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 1.35rem;
      letter-spacing: 0.08em;
      color: var(--sidebar-logo-mark-color);
      line-height: 1;
    }
    .logo-text {
      font-family: var(--font-heading);
      font-weight: 800;
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--sidebar-logo-text);
      line-height: 1.2;
      background: linear-gradient(90deg, var(--sidebar-logo-text) 0%, var(--hyland-teal) 50%, var(--sidebar-logo-text) 100%);
      background-size: 200% auto;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: logoTextShimmer 4s ease-in-out infinite;
      transition: opacity 0.2s;
    }
    .logo-text.hidden { display: none; }
    @keyframes logoTextShimmer {
      0%, 100% { background-position: 0% center; }
      50%      { background-position: 200% center; }
    }
    .sidebar-nav-main {
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.25rem 0 0.75rem;
      overflow-y: auto;
    }

    a.nav-pill,
    button.nav-pill {
      display: flex;
      align-items: center;
      gap: 0.55rem;
      width: 100%;
      margin: 0;
      padding: 0.55rem 0.65rem;
      border: 1px solid var(--nav-pill-border);
      border-radius: 10px;
      background: var(--nav-pill-bg);
      color: var(--nav-pill-color);
      text-decoration: none;
      font-family: var(--font-body, 'Source Sans 3', sans-serif);
      font-weight: 600;
      font-size: 0.82rem;
      line-height: 1.2;
      text-align: left;
      cursor: pointer;
      transition: background 0.25s ease, border-color 0.25s ease, box-shadow 0.3s ease,
                  color 0.2s ease, opacity 0.2s ease, transform 0.25s cubic-bezier(0.22,1,0.36,1);
      box-shadow: var(--nav-pill-shadow);
      animation: navPillEnter 0.35s cubic-bezier(0.22,1,0.36,1) both;
    }
    .sidebar-nav-main a.nav-pill:nth-child(1) { animation-delay: 0.04s; }
    .sidebar-nav-main a.nav-pill:nth-child(2) { animation-delay: 0.08s; }
    .sidebar-nav-main a.nav-pill:nth-child(3) { animation-delay: 0.12s; }
    .sidebar-nav-main a.nav-pill:nth-child(4) { animation-delay: 0.16s; }
    .sidebar-nav-main a.nav-pill:nth-child(5) { animation-delay: 0.2s; }
    .sidebar-nav-main a.nav-pill:nth-child(6) { animation-delay: 0.24s; }
    @keyframes navPillEnter {
      from { opacity: 0; transform: translateX(-10px); }
      to   { opacity: 1; transform: translateX(0); }
    }

    a.nav-pill:hover:not(.nav-disabled),
    button.nav-pill:hover:not(:disabled) {
      background: var(--nav-pill-hover-bg);
      border-color: var(--nav-pill-hover-border);
      color: var(--nav-pill-hover-color);
      transform: translateX(3px);
      box-shadow: var(--nav-pill-shadow), 0 0 12px rgba(19,234,193,0.1);
    }

    a.nav-pill.active {
      background: var(--nav-pill-active-bg);
      border-color: var(--nav-pill-active-border);
      color: var(--nav-pill-active-color);
      box-shadow: 0 0 0 1px rgba(19,234,193,0.25), 0 0 14px rgba(19,234,193,0.12);
    }

    a.nav-pill.active .nav-icon {
      color: var(--hyland-teal, #13eac1);
    }

    a.nav-pill.nav-disabled {
      opacity: var(--nav-pill-disabled-opacity);
      cursor: not-allowed;
      pointer-events: auto;
    }

    a.nav-pill.nav-disabled:hover {
      background: var(--nav-pill-bg);
      border-color: var(--nav-pill-border);
      color: var(--nav-pill-color);
    }

    button.nav-pill-btn:not(.theme-toggle) {
      border-color: var(--nav-pill-border);
      background: var(--nav-pill-bg);
    }

    button.nav-pill-btn:not(.theme-toggle):hover {
      background: var(--nav-disconnect-hover-bg);
      border-color: var(--nav-disconnect-hover-border);
    }

    button.theme-toggle {
      border-color: var(--nav-pill-border);
      background: var(--nav-pill-bg);
    }

    .nav-icon {
      flex-shrink: 0;
      width: 1.65rem;
      height: 1.65rem;
      display: grid;
      place-items: center;
      color: var(--nav-icon-color);
    }

    .nav-icon svg {
      width: 1.125rem;
      height: 1.125rem;
    }

    .nav-label {
      flex: 1;
      min-width: 0;
    }

    .sidebar-footer {
      margin-top: auto;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding-top: 0.85rem;
      border-top: 1px solid var(--sidebar-footer-border);
    }
    .main-content {
      flex: 1;
      min-width: 0;
      min-height: 0;
      padding: 1.25rem 1.5rem;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .main-content.page-entering {
      animation: pageTransition 0.3s ease both;
    }
    @keyframes pageTransition {
      from { opacity: 0; }
      to   { opacity: 1; }
    }
    .toast-stack {
      position: fixed;
      top: 1rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      pointer-events: none;
    }
    .toast-stack .toast {
      display: flex; align-items: center; gap: 0.5rem;
      padding: 0.6rem 0.75rem 0.6rem 0.65rem;
      border-radius: var(--radius-sm);
      font-size: 0.88rem;
      font-weight: 600;
      box-shadow: var(--shadow-card-hover);
      max-width: 92vw;
      overflow: hidden;
      pointer-events: auto;
      position: relative;
    }
    .toast-stack .toast-success { background: var(--hyland-teal); color: var(--hyland-dark-blue); }
    .toast-stack .toast-error { background: #c0392b; color: #fff; }
    .toast-stack .toast-info { background: var(--hyland-blue); color: #fff; }
    .toast-icon { flex-shrink: 0; width: 1.15rem; height: 1.15rem; display: grid; place-items: center; }
    .toast-icon svg { width: 1.15rem; height: 1.15rem; }
    .toast-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast-dismiss {
      flex-shrink: 0; background: none; border: none; color: inherit; font-size: 1.1rem;
      cursor: pointer; padding: 0 0.15rem; line-height: 1; opacity: 0.7;
      transition: opacity 0.15s;
    }
    .toast-dismiss:hover { opacity: 1; }
    .toast-progress {
      position: absolute; bottom: 0; left: 0; height: 3px; width: 100%;
      background: rgba(255,255,255,0.35); border-radius: 0 0 var(--radius-sm) var(--radius-sm);
      animation: toastProgressShrink linear forwards;
      transform-origin: left;
    }
    .toast-success .toast-progress { background: rgba(0,0,0,0.2); }
    @keyframes toastProgressShrink {
      from { transform: scaleX(1); }
      to   { transform: scaleX(0); }
    }
    .toast-stack .toast.toast-exit {
      animation: toastSlideOut 0.3s ease forwards !important;
    }
    @keyframes toastSlideOut {
      from { opacity: 1; transform: translateY(0) scale(1); }
      to   { opacity: 0; transform: translateY(-14px) scale(0.92); }
    }
    .onboarding-banner {
      flex-shrink: 0;
      display: flex; align-items: center; justify-content: space-between; gap: 1rem;
      padding: 0.75rem 1.25rem; background: var(--app-onboarding-bg); border-bottom: 1px solid var(--hyland-teal);
      font-size: 0.9rem;
      color: var(--app-text);
      animation: bannerSlideDown 0.4s cubic-bezier(0.22,1,0.36,1) both;
    }
    @keyframes bannerSlideDown {
      from { opacity: 0; transform: translateY(-100%); }
      to   { opacity: 1; transform: translateY(0); }
    }
    .onboarding-banner .dismiss-btn { background: none; border: none; font-size: 1.25rem; cursor: pointer; padding: 0 0.5rem; line-height: 1; }
    .onboarding-banner .dismiss-btn:hover { opacity: 0.8; }
    @media (max-width: 768px) {
      .app-layout {
        height: auto;
        max-height: none;
        min-height: 100vh;
        overflow: visible;
      }
      .app-body { flex-direction: column; overflow: visible; }
      .sidebar, .sidebar.collapsed {
        width: 100%;
        height: auto;
        max-height: none;
        padding: 1rem 0.65rem 1rem;
      }
      .sidebar.collapsed .nav-label { display: inline; }
      .sidebar.collapsed .logo-text { display: inline; }
      .sidebar.collapsed a.nav-pill,
      .sidebar.collapsed button.nav-pill { justify-content: flex-start; padding: 0.55rem 0.65rem; }
      .sidebar-toggle { display: none; }
      .main-content {
        overflow: visible;
        min-height: 0;
      }
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
export class AppComponent implements OnInit, OnDestroy {
  title = 'QA Assistant';
  showOnboardingBanner = true;
  sidebarCollapsed = false;
  pageEntering = false;
  private static readonly ONBOARDING_DISMISSED_KEY = 'qa_assistant_onboarding_dismissed';
  private static readonly SIDEBAR_COLLAPSED_KEY = 'qa_assistant_sidebar_collapsed';
  private routerSub?: Subscription;

  constructor(
    public initService: InitService,
    public toastService: ToastService,
    public themeService: ThemeService,
    private router: Router,
    private api: ApiService,
  ) {}

  ngOnInit(): void {
    this.initService.checkInitStatus();
    try {
      this.showOnboardingBanner = !localStorage.getItem(AppComponent.ONBOARDING_DISMISSED_KEY);
      this.sidebarCollapsed = localStorage.getItem(AppComponent.SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      this.showOnboardingBanner = false;
    }
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe(() => {
        this.pageEntering = false;
        requestAnimationFrame(() => { this.pageEntering = true; });
      });
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
  }

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    try { localStorage.setItem(AppComponent.SIDEBAR_COLLAPSED_KEY, this.sidebarCollapsed ? '1' : '0'); } catch {}
  }

  dismissOnboarding(): void {
    try {
      localStorage.setItem(AppComponent.ONBOARDING_DISMISSED_KEY, '1');
      this.showOnboardingBanner = false;
    } catch {
      this.showOnboardingBanner = false;
    }
  }

  navToConfig(): void {
    this.router.navigate(['/config']);
  }

  disconnect(): void {
    this.api.postForm('/disconnect', {}).subscribe({
      next: () => {
        this.initService.setInitialized(false);
        this.router.navigate(['/config']);
        this.toastService.success('Disconnected. Initialize again to use the app.');
      },
      error: () => {
        this.initService.setInitialized(false);
        this.router.navigate(['/config']);
        this.toastService.info('Disconnected. Initialize again to use the app.');
      },
    });
  }
}
