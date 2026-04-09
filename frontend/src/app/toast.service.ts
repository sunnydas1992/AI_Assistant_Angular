import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
  visible: boolean;
  duration: number;
  exiting: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private messages: ToastMessage[] = [];
  private readonly toasts$ = new BehaviorSubject<ToastMessage[]>([]);
  private readonly maxVisible = 5;

  get toasts(): ToastMessage[] {
    return this.toasts$.value;
  }

  get toastsObservable() {
    return this.toasts$.asObservable();
  }

  private notify(): void {
    const visible = this.messages.filter((m) => m.visible);
    this.toasts$.next(visible);
  }

  private enforceMax(): void {
    const visible = this.messages.filter(m => m.visible && !m.exiting);
    while (visible.length > this.maxVisible) {
      const oldest = visible.shift();
      if (oldest) this.startExit(oldest);
    }
  }

  private startExit(msg: ToastMessage): void {
    if (msg.exiting) return;
    msg.exiting = true;
    this.notify();
    setTimeout(() => {
      msg.visible = false;
      this.messages = this.messages.filter(m => m.id !== msg.id);
      this.notify();
    }, 350);
  }

  show(text: string, type: ToastType = 'success', duration?: number): void {
    const dur = duration ?? (type === 'error' ? 5000 : 3500);
    const id = ++this.nextId;
    const msg: ToastMessage = { id, text, type, visible: true, duration: dur, exiting: false };
    this.messages.push(msg);
    this.notify();
    this.enforceMax();
    setTimeout(() => {
      if (msg.visible && !msg.exiting) this.startExit(msg);
    }, dur);
  }

  dismiss(id: number): void {
    const msg = this.messages.find(m => m.id === id);
    if (msg && msg.visible) this.startExit(msg);
  }

  success(text: string): void {
    this.show(text, 'success');
  }

  error(text: string): void {
    this.show(text, 'error');
  }

  info(text: string): void {
    this.show(text, 'info');
  }
}
