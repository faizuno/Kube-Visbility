import { Component, inject, OnInit, OnDestroy } from '@angular/core';
import { RouterOutlet, Router, NavigationStart, NavigationEnd, NavigationCancel, NavigationError, Event, ActivatedRoute } from '@angular/router';
import { Title } from '@angular/platform-browser';
import { ViewportScaleService } from './core/services/viewport-scale.service';
import { LoadingService } from './core/services/loading.service';
import { LoadingSpinnerComponent } from './shared/components/loading-spinner/loading-spinner.component';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, LoadingSpinnerComponent],
  template: `
    <app-loading-spinner 
      [show]="loadingService.isLoading()" 
      [message]="loadingMessage()" />
    <div class="viewport-container" [style.transform]="'scale(' + scaleFactor() + ')'">
      <div class="content-wrapper">
        <router-outlet />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100vw;
        height: 100vh;
        overflow-y: auto;
        overflow-x: hidden;
        background: var(--theme-bg-app);
        position: fixed;
        top: 0;
        left: 0;
      }

      .viewport-container {
        width: 1920px;
        transform-origin: top left;
        position: fixed;
        margin: 0 auto;
        background: var(--theme-bg-app);
        height: 100%
      }

      .content-wrapper {
        width: 100%;
      }
    `,
  ],
})
export class App implements OnInit, OnDestroy {
  private readonly appTitleBase = 'Kube Visibility — Logs & Health Console';
  private viewportScaleService = inject(ViewportScaleService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private title = inject(Title);
  protected loadingService = inject(LoadingService);

  scaleFactor = this.viewportScaleService.scaleFactor;
  loadingMessage = () => 'Loading...';

  private navigationSubscription?: any;
  // Track which routes have been loaded to avoid showing loader for already-loaded routes
  private loadedRoutes = new Set<string>();
  private isInitialLoad = true;

  ngOnInit(): void {
    // Service is already initialized, scale factor will be calculated automatically
    this.title.setTitle(this.appTitleBase);
    
    // Track router navigation events for lazy loading
    this.navigationSubscription = this.router.events
      .pipe(
        filter((event: Event): event is NavigationStart | NavigationEnd | NavigationCancel | NavigationError =>
          event instanceof NavigationStart ||
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        )
      )
      .subscribe((event) => {
        if (event instanceof NavigationStart) {
          // Get the route path without query params
          const routePath = event.url.split('?')[0];
          
          // Only show loader if:
          // 1. It's the initial load (first navigation)
          // 2. The route hasn't been loaded before (lazy chunk loading)
          const isNewRoute = !this.loadedRoutes.has(routePath);
          
          if (this.isInitialLoad || isNewRoute) {
            this.loadingService.start();
          }
          
          // Mark initial load as complete after first navigation starts
          if (this.isInitialLoad) {
            this.isInitialLoad = false;
          }
        } else if (
          event instanceof NavigationEnd ||
          event instanceof NavigationCancel ||
          event instanceof NavigationError
        ) {
          // Mark route as loaded when navigation completes
          if (event instanceof NavigationEnd) {
            const routePath = event.urlAfterRedirects.split('?')[0];
            this.loadedRoutes.add(routePath);
            this.updatePageTitle();
          }
          
          // Hide spinner when navigation completes, is cancelled, or errors
          // Add a small delay to ensure smooth transition
          setTimeout(() => {
            this.loadingService.stop();
          }, 100);
        }
      });
  }

  private updatePageTitle(): void {
    let current = this.route;
    while (current.firstChild) {
      current = current.firstChild;
    }

    const routeTitle = current.snapshot.title?.toString().trim();
    if (!routeTitle || routeTitle === this.appTitleBase) {
      this.title.setTitle(this.appTitleBase);
      return;
    }

    this.title.setTitle(`${this.appTitleBase} | ${routeTitle}`);
  }

  ngOnDestroy(): void {
    // Cleanup is handled by the service
    this.navigationSubscription?.unsubscribe();
  }
}
