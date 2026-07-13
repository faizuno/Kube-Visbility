import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class LoadingService {
  private _isLoading = signal(false);
  private _loadingCount = 0;

  readonly isLoading = this._isLoading.asReadonly();

  /**
   * Start loading (increment counter)
   */
  start(): void {
    this._loadingCount++;
    this._isLoading.set(true);
  }

  /**
   * Stop loading (decrement counter)
   */
  stop(): void {
    this._loadingCount = Math.max(0, this._loadingCount - 1);
    if (this._loadingCount === 0) {
      this._isLoading.set(false);
    }
  }

  /**
   * Reset loading state
   */
  reset(): void {
    this._loadingCount = 0;
    this._isLoading.set(false);
  }
}

