import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  importProvidersFrom,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApmErrorHandler, ApmModule, ApmService } from '@elastic/apm-rum-angular';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { AuthService } from './core/services/auth.service';
import { LoadingService } from './core/services/loading.service';
import { environment } from '../environments/environment';

function initializeApm() {
  const apmService = inject(ApmService);

  apmService.init({
    serviceName: 'kube-visibility-dashboard',
    serverUrl: '/apm',
    environment: environment.production ? 'production' : 'development',
  });
}

function initializeApp() {
  const authService = inject(AuthService);
  const loadingService = inject(LoadingService);
  
  // Start loading during app initialization
  loadingService.start();
  
  return authService.loadUserInfo().finally(() => {
    // Stop loading after initialization completes
    setTimeout(() => {
      loadingService.stop();
    }, 300); // Small delay for smooth transition
  });
}

export const appConfig: ApplicationConfig = {
  providers: [
    importProvidersFrom(ApmModule),
    ApmService,
    { provide: ErrorHandler, useClass: ApmErrorHandler },
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAppInitializer(initializeApm),
    provideAppInitializer(initializeApp)
  ]
};
