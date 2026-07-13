import { Injectable, inject } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { Subject, filter, Subscription } from 'rxjs';

export interface UrlChangeEvent {
  path: string;
  queryParams: string;
  fullUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class NavigationService {
  private router = inject(Router);
  
  private routerSubscription?: Subscription;
  private popstateListener?: () => void;
  private previousPath: string = '';
  private previousQueryParams: string = '';
  private isInitialized = false;
  
  // Subject to emit URL change events
  private urlChangeSubject = new Subject<UrlChangeEvent>();
  public urlChanges$ = this.urlChangeSubject.asObservable();
  
  constructor() {
    this.initialize();
  }
  
  /**
   * Initialize the navigation service
   * Sets up listeners for router events and browser back/forward
   */
  private initialize(): void {
    // Track initial state
    if (typeof window !== 'undefined') {
      this.previousPath = this.router.url.split('?')[0];
      this.previousQueryParams = this.router.url.split('?')[1] || '';
    }
    
    // Listen to router navigation events
    this.routerSubscription = this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event) => {
        if (event instanceof NavigationEnd) {
          const currentPath = event.urlAfterRedirects.split('?')[0];
          const currentQueryParams = event.urlAfterRedirects.split('?')[1] || '';
          
          // Check if query params changed on the same route
          if (currentPath === this.previousPath && currentQueryParams !== this.previousQueryParams) {
            this.emitUrlChange(currentPath, currentQueryParams);
          }
          
          // Update previous values
          this.previousPath = currentPath;
          this.previousQueryParams = currentQueryParams;
          this.isInitialized = true;
        }
      });
    
    // Listen to browser back/forward button
    if (typeof window !== 'undefined') {
      this.popstateListener = () => {
        // Small delay to ensure URL is updated
        setTimeout(() => {
          const currentPath = this.router.url.split('?')[0];
          const currentQueryParams = this.router.url.split('?')[1] || '';
          this.emitUrlChange(currentPath, currentQueryParams);
          
          // Update previous values
          this.previousPath = currentPath;
          this.previousQueryParams = currentQueryParams;
        }, 0);
      };
      
      window.addEventListener('popstate', this.popstateListener);
    }
  }
  
  /**
   * Emit URL change event
   */
  private emitUrlChange(path: string, queryParams: string): void {
    this.urlChangeSubject.next({
      path,
      queryParams,
      fullUrl: this.router.url,
    });
  }
  
  /**
   * Get current URL parameters
   */
  getCurrentUrlParams(): URLSearchParams {
    return new URLSearchParams(window.location.search);
  }
  
  /**
   * Check if service is initialized
   */
  get initialized(): boolean {
    return this.isInitialized;
  }
  
  /**
   * Cleanup - called automatically by Angular when service is destroyed
   */
  ngOnDestroy(): void {
    if (this.routerSubscription) {
      this.routerSubscription.unsubscribe();
    }
    
    if (this.popstateListener && typeof window !== 'undefined') {
      window.removeEventListener('popstate', this.popstateListener);
    }
  }
}

