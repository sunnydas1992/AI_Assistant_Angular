import { Injectable, Inject, signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';

export type AppTheme = 'light' | 'dark';

const STORAGE_KEY = 'qa_assistant_theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Current UI theme; persisted in localStorage. */
  readonly theme = signal<AppTheme>('light');

  constructor(@Inject(DOCUMENT) private doc: Document) {
    let initial: AppTheme = 'light';
    try {
      const s = this.doc.defaultView?.localStorage?.getItem(STORAGE_KEY);
      if (s === 'dark' || s === 'light') initial = s;
    } catch {
      /* private mode */
    }
    this.theme.set(initial);
    this.apply(initial);
  }

  toggle(): void {
    this.setTheme(this.theme() === 'light' ? 'dark' : 'light');
  }

  setTheme(next: AppTheme): void {
    this.theme.set(next);
    try {
      this.doc.defaultView?.localStorage?.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
    this.apply(next);
  }

  private apply(t: AppTheme): void {
    this.doc.documentElement.setAttribute('data-theme', t);
  }
}
