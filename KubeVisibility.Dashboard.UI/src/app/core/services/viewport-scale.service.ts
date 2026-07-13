import { Injectable, signal, inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root',
})
export class ViewportScaleService {
  private platformId = inject(PLATFORM_ID);

  // Base viewport width (fixed for consistent horizontal layouts)
  private readonly BASE_WIDTH = 1920;
  
  // Expose base width as a readonly property for components to use
  readonly baseWidth = this.BASE_WIDTH;

  // Scale factor signal
  private _scaleFactor = signal<number>(1);
  readonly scaleFactor = this._scaleFactor.asReadonly();

  // Viewport dimensions signals (actual browser window size)
  private _viewportWidth = signal<number>(this.BASE_WIDTH);
  private _viewportHeight = signal<number>(1200); // Default fallback
  readonly viewportWidth = this._viewportWidth.asReadonly();
  readonly viewportHeight = this._viewportHeight.asReadonly();

  // Base height signal (calculated dynamically based on actual viewport)
  private _baseHeight = signal<number>(1200);
  readonly baseHeight = this._baseHeight.asReadonly();

  private resizeListener?: () => void;

  constructor() {
    if (isPlatformBrowser(this.platformId)) {
      this.initialize();
    }
  }

  private initialize(): void {
    // Calculate initial scale
    this.calculateScale();

    // Set up resize listener
    this.resizeListener = () => this.calculateScale();
    window.addEventListener('resize', this.resizeListener);

    // Handle orientation change with a delay for accurate dimensions
    window.addEventListener('orientationchange', () => {
      setTimeout(() => this.calculateScale(), 100);
    });
  }

  private calculateScale(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const actualWidth = window.innerWidth;
    const actualHeight = window.innerHeight;

    this._viewportWidth.set(actualWidth);
    this._viewportHeight.set(actualHeight);

    // Calculate scale based on width (keeps horizontal layout consistent at 1920px base)
    const scale = actualWidth / this.BASE_WIDTH;

    this._scaleFactor.set(scale);

    // Calculate the dynamic base height based on actual viewport
    // This ensures the content always fills the viewport vertically without scrolling
    const calculatedBaseHeight = actualHeight / scale;
    this._baseHeight.set(calculatedBaseHeight);
  }

  /**
   * Cleanup method to remove event listeners
   * Can be called manually if needed (e.g., in tests)
   */
  cleanup(): void {
    if (this.resizeListener && isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.resizeListener);
      window.removeEventListener('orientationchange', this.resizeListener);
      this.resizeListener = undefined;
    }
  }
}

