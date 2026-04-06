import { Routes } from '@angular/router';
import { initGuard } from './init.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'config', pathMatch: 'full' },
  { path: 'config', loadComponent: () => import('./config/config.component').then(m => m.ConfigComponent) },
  { path: 'about', loadComponent: () => import('./about/about.component').then(m => m.AboutComponent) },
  {
    path: 'help/advanced-settings',
    loadComponent: () =>
      import('./help/advanced-settings-help.component').then(m => m.AdvancedSettingsHelpComponent),
  },
  { path: 'home', canActivate: [initGuard], loadComponent: () => import('./dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'knowledge-base', canActivate: [initGuard], loadComponent: () => import('./knowledge-base/knowledge-base.component').then(m => m.KnowledgeBaseComponent) },
  { path: 'ticket-analyzer', canActivate: [initGuard], loadComponent: () => import('./ticket-analyzer/ticket-analyzer.component').then(m => m.TicketAnalyzerComponent) },
  { path: 'test-cases', canActivate: [initGuard], loadComponent: () => import('./test-cases/test-cases.component').then(m => m.TestCasesComponent) },
  { path: 'test-plan', canActivate: [initGuard], loadComponent: () => import('./test-plan/test-plan.component').then(m => m.TestPlanComponent) },
  { path: '**', redirectTo: 'config' },
];
