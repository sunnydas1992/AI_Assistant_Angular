import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
  visible: boolean;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 0;
  private messages: ToastMessage[] = [];
  private readonly toasts$ = new BehaviorSubject<ToastMessage[]>([]);

  get toasts(): ToastMessage[] {
    return this.toasts$.value;
  }

  get toastsObservable() {
    return this.toasts$.asObservable();
  }

  private notify(): void {
    this.toasts$.next(this.messages.filter((m) => m.visible));
  }

  show(text: string, type: ToastType = 'success'): void {
    const id = ++this.nextId;
    const msg: ToastMessage = { id, text, type, visible: true };
    this.messages.push(msg);
    this.notify();
    setTimeout(() => {
      msg.visible = false;
      this.notify();
      setTimeout(() => {
        this.messages = this.messages.filter((m) => m.id !== id);
        this.notify();
      }, 300);
    }, 3500);
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
