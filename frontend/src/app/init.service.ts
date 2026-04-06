import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ApiService } from './api.service';
import { LoggerService } from './logger.service';

@Injectable({ providedIn: 'root' })
export class InitService {
  private _initialized = new BehaviorSubject<boolean>(false);
  readonly initialized$ = this._initialized.asObservable();

  get initialized(): boolean {
    return this._initialized.value;
  }

  constructor(private api: ApiService, private logger: LoggerService) {}

  checkInitStatus(): void {
    this.api.get<{ initialized?: boolean }>('/init-status').subscribe({
      next: (res) => this._initialized.next(res?.initialized ?? false),
      error: (err) => {
        this.logger.warn('init-status check failed', err);
        this._initialized.next(false);
      },
    });
  }

  /** For use in guards: ensure status is fetched and return current value. */
  refreshAndGetInitialized(): Promise<boolean> {
    return new Promise((resolve) => {
      this.api.get<{ initialized?: boolean }>('/init-status').subscribe({
        next: (res) => {
          const v = res?.initialized ?? false;
          this._initialized.next(v);
          resolve(v);
        },
        error: (err) => {
          this.logger.warn('init-status refresh failed', err);
          const current = this._initialized.value;
          resolve(current);
        },
      });
    });
  }

  setInitialized(value: boolean): void {
    this._initialized.next(value);
  }
}
