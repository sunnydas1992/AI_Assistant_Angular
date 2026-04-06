import { inject } from '@angular/core';
import { Router, type CanActivateFn } from '@angular/router';
import { InitService } from './init.service';

export const initGuard: CanActivateFn = async () => {
  const init = inject(InitService);
  const router = inject(Router);
  const ok = await init.refreshAndGetInitialized();
  return ok ? true : router.createUrlTree(['/config']);
};
