import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ToastService, ToastMessage } from './toast.service';

describe('ToastService', () => {
  let service: ToastService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ToastService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should show a success toast', () => {
    service.success('Done');
    const toasts = service.toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('success');
    expect(toasts[0].text).toBe('Done');
    expect(toasts[0].visible).toBeTrue();
  });

  it('should show an error toast with longer default duration', () => {
    service.error('Oops');
    const toasts = service.toasts;
    expect(toasts.length).toBe(1);
    expect(toasts[0].type).toBe('error');
    expect(toasts[0].duration).toBe(5000);
  });

  it('should show an info toast', () => {
    service.info('FYI');
    expect(service.toasts[0].type).toBe('info');
  });

  it('should assign sequential IDs', () => {
    service.success('A');
    service.success('B');
    const ids = service.toasts.map(t => t.id);
    expect(ids[1]).toBeGreaterThan(ids[0]);
  });

  it('should dismiss a toast by id', fakeAsync(() => {
    service.success('Bye');
    const id = service.toasts[0].id;
    service.dismiss(id);
    tick(6000);
    expect(service.toasts.length).toBe(0);
  }));

  it('should enforce maxVisible cap', () => {
    for (let i = 0; i < 7; i++) {
      service.show(`Toast ${i}`);
    }
    const visible = service.toasts.filter(t => !t.exiting);
    expect(visible.length).toBeLessThanOrEqual(5);
  });

  it('should auto-remove toast after duration', fakeAsync(() => {
    service.show('Temp', 'success', 100);
    expect(service.toasts.length).toBe(1);
    tick(500);
    expect(service.toasts.length).toBe(0);
  }));

  it('should emit via observable', (done) => {
    service.toastsObservable.subscribe(toasts => {
      if (toasts.length > 0) {
        expect(toasts[0].text).toBe('Observable');
        done();
      }
    });
    service.success('Observable');
  });
});
