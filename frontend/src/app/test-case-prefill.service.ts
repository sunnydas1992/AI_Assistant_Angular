import { Injectable } from '@angular/core';

/** Shared state for pre-filling Test Cases page from Ticket Analyzer (e.g. "Generate test cases from this ticket"). */
@Injectable({ providedIn: 'root' })
export class TestCasePrefillService {
  sourceType: 'jira' | 'confluence' = 'jira';
  targetId = '';

  setPrefill(sourceType: 'jira' | 'confluence', targetId: string): void {
    this.sourceType = sourceType;
    this.targetId = targetId || '';
  }

  consumePrefill(): { sourceType: 'jira' | 'confluence'; targetId: string } {
    const out = { sourceType: this.sourceType, targetId: this.targetId };
    this.targetId = '';
    return out;
  }

  hasPrefill(): boolean {
    return !!this.targetId?.trim();
  }
}
