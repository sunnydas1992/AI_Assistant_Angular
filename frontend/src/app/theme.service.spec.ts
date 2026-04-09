import { TestBed } from '@angular/core/testing';
import { DOCUMENT } from '@angular/common';
import { ThemeService } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let doc: Document;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    doc = TestBed.inject(DOCUMENT);
    service = TestBed.inject(ThemeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should have a valid theme on init', () => {
    expect(['light', 'dark']).toContain(service.theme());
  });

  it('should toggle from light to dark', () => {
    service.setTheme('light');
    service.toggle();
    expect(service.theme()).toBe('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('should toggle from dark to light', () => {
    service.setTheme('dark');
    service.toggle();
    expect(service.theme()).toBe('light');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('should apply data-theme attribute to html element', () => {
    service.setTheme('dark');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    service.setTheme('light');
    expect(doc.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
