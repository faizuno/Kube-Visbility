import { Component, Input, Output, EventEmitter, signal, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ResourceInfo } from '../../../../core/models/cluster-info.models';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';

export interface BulkActionItem {
  namespace: string;
  resource: ResourceInfo;
  status: 'pending' | 'processing' | 'success' | 'error';
  errorMessage?: string;
  successMessage?: string;
}

// Styles using CSS custom properties (variables) - AOT compatible
const BULK_ACTION_PROGRESS_STYLES = `
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        height: calc(100vh*20);
        background: rgba(0, 0, 0, 0.6);
        z-index: var(--z-modal-backdrop, 1000000);
        pointer-events: auto;
        height: calc(100vh*20);
      }

      .modal-container {
        background: var(--theme-bg-app);
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        max-width: 700px;
        width: 90%;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        pointer-events: auto;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.9rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        background: var(--theme-header-gradient);
        color: white;
        flex-shrink: 0;
        border-radius: 12px 12px 0 0;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }

      .modal-header h2 {
        margin: 0;
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-header-weight);
        color: white;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        line-height: 1.2;
      }

      .modal-header h2 i {
        color: white;
      }

      .btn-close {
        background: none;
        border: none;
        font-size: var(--theme-font-page-title);
        color: rgba(255, 255, 255, 0.95);
        cursor: pointer;
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: all 0.2s;
      }

      .btn-close:hover:not(:disabled) {
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
      }

      .btn-close:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .modal-content {
        padding: 1.5rem;
        overflow-y: auto;
        flex: 1;
        background: var(--theme-bg-app);
      }

      .progress-summary {
        margin-bottom: 1.5rem;
      }

      .progress-bar-container {
        width: 100%;
        height: 32px;
        background-color: var(--theme-bg-app);
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 1rem;
        position: relative;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--theme-button-primary) 0%, var(--theme-button-primary-hover) 100%);
        transition: width 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
      }

      .progress-stats {
        display: flex;
        gap: 1.5rem;
        flex-wrap: wrap;
      }

      .progress-stats span {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }

      .stat-success {
        color: #10b981;
      }

      .stat-error {
        color: #ef4444;
      }

      .stat-pending {
        color: var(--theme-text-gray);
      }

      .items-list {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .item-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        padding: 1rem;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 8px;
        transition: all 0.2s;
      }

      .item-row.item-processing {
        background-color: #f0fdfa;
        border-color: var(--theme-border-teal);
      }

      .item-row.item-success {
        background-color: #f0fdf4;
        border-color: #10b981;
      }

      .item-row.item-error {
        background-color: #fef2f2;
        border-color: #ef4444;
      }

      .item-actions {
        display: flex;
        align-items: center;
        gap: 1rem;
      }

      .item-status-icon {
        font-size: var(--theme-font-page-title);
        width: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
      }

      .item-status-icon .fa-clock {
        color: var(--theme-text-gray);
      }

      .item-status-icon .fa-spinner {
        color: var(--theme-button-primary);
      }

      .item-status-icon .fa-check-circle {
        color: #10b981;
      }

      .item-status-icon .fa-times-circle {
        color: #ef4444;
      }

      .item-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .item-name {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
        font-size: var(--theme-font-body);
      }

      .item-namespace {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
      }

      .item-error-message {
        font-size: var(--theme-font-body);
        color: #ef4444;
        margin-top: 0.25rem;
      }

      .btn-retry {
        background-color: var(--theme-button-primary);
        color: white;
        border: none;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s;
      }

      .btn-retry:hover {
        background-color: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px var(--theme-button-primary-shadow);
      }

      .modal-footer {
        padding: 1rem 1.5rem;
        border-top: 1px solid var(--theme-border-gray-light);
        display: flex;
        justify-content: flex-end;
      }

      .btn-close-footer {
        background-color: var(--theme-button-primary);
        color: white;
        border: none;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        transition: all 0.2s;
      }

      .btn-close-footer:hover:not(:disabled) {
        background-color: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px var(--theme-button-primary-shadow);
      }

      .btn-close-footer:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
    `;

@Component({
  selector: 'app-bulk-action-progress',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="modal-overlay" (click)="onCloseClick()">
      <div class="modal-container" (click)="$event.stopPropagation()" [ngStyle]="modalStyle()">
        <div class="modal-header">
          <h2>
            <i class="fas" [class.fa-redo]="actionType === 'restart'" 
                       [class.fa-stop]="actionType === 'toggleConsumer' && actionLabel.includes('Stop')"
                       [class.fa-play]="actionType === 'toggleConsumer' && actionLabel.includes('Start')"
                       [class.fa-pause]="actionType === 'toggleSuspend' && actionLabel.includes('Pause')"
                       [class.fa-play]="actionType === 'toggleSuspend' && actionLabel.includes('Resume')"></i>
            {{ actionLabel }}
          </h2>
          <button class="btn-close" (click)="onCloseClick()" [disabled]="!canClose()">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-content">
          <div class="progress-summary">
            <div class="progress-bar-container">
              <div class="progress-bar" [style.width.%]="progressPercentage()">
                <span class="progress-text">{{ completedCount() }} / {{ totalCount() }}</span>
              </div>
            </div>
            <div class="progress-stats">
              <span class="stat-success">
                <i class="fas fa-check-circle"></i> {{ successCount() }} Success
              </span>
              <span class="stat-error">
                <i class="fas fa-times-circle"></i> {{ errorCount() }} Failed
              </span>
              <span class="stat-pending">
                <i class="fas fa-clock"></i> {{ pendingCount() }} Pending
              </span>
            </div>
          </div>
          <div class="items-list">
            @for (item of itemsSignal(); track getItemKey(item)) {
              <div class="item-row" [class.item-success]="item.status === 'success'" 
                                   [class.item-error]="item.status === 'error'"
                                   [class.item-processing]="item.status === 'processing'">
                <div class="item-info">
                  <div class="item-name">{{ item.resource.name }}</div>
                  <div class="item-namespace">{{ item.namespace }}</div>
                  @if (item.status === 'error' && item.errorMessage) {
                    <div class="item-error-message">{{ item.errorMessage }}</div>
                  }
                </div>
                <div class="item-actions">
                  @if (item.status === 'error') {
                    <button class="btn-retry" (click)="onRetryClick(item)">
                      <i class="fas fa-redo"></i> Retry
                    </button>
                  }
                  <div class="item-status-icon">
                    @if (item.status === 'pending') {
                      <i class="fas fa-clock"></i>
                    } @else if (item.status === 'processing') {
                      <i class="fas fa-spinner fa-spin"></i>
                    } @else if (item.status === 'success') {
                      <i class="fas fa-check-circle"></i>
                    } @else if (item.status === 'error') {
                      <i class="fas fa-times-circle"></i>
                    }
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn-close-footer" (click)="onCloseClick()" [disabled]="!canClose()">
            Close
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [BULK_ACTION_PROGRESS_STYLES],
})
export class BulkActionProgressComponent implements OnInit, OnDestroy {
  @Input() actionType: 'restart' | 'toggleConsumer' | 'toggleSuspend' | 'submit' = 'restart';
  @Input() set items(value: BulkActionItem[]) {
    this.itemsSignal.set(value);
  }
  @Input() actionLabel: string = 'Bulk Action';
  @Output() close = new EventEmitter<void>();
  @Output() retry = new EventEmitter<BulkActionItem>();

  private viewportScaleService = inject(ViewportScaleService);

  itemsSignal = signal<BulkActionItem[]>([]);
  private scrollPosition = signal({ top: 0, left: 0 });
  private scrollListener?: () => void;
  private resizeListener?: () => void;

  totalCount = computed(() => this.itemsSignal().length);
  completedCount = computed(() => 
    this.itemsSignal().filter(item => item.status === 'success' || item.status === 'error').length
  );
  successCount = computed(() => 
    this.itemsSignal().filter(item => item.status === 'success').length
  );
  errorCount = computed(() => 
    this.itemsSignal().filter(item => item.status === 'error').length
  );
  pendingCount = computed(() => 
    this.itemsSignal().filter(item => item.status === 'pending' || item.status === 'processing').length
  );
  progressPercentage = computed(() => {
    const total = this.totalCount();
    if (total === 0) return 0;
    return (this.completedCount() / total) * 100;
  });

  // Calculate modal position accounting for viewport scale
  modalStyle = computed(() => {
    if (typeof window === 'undefined') {
      return {};
    }
    
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight(); // Dynamic base height
    const baseWidth = this.viewportScaleService.baseWidth; // Base width from service
    const scrollPos = this.scrollPosition();
    
    // Calculate the actual visible area accounting for scroll
    // Scroll position is in actual pixels, but we need to convert to base coordinates
    const visibleTop = scrollPos.top / scale;
    const visibleHeight = viewportHeight / scale;
    
    // Center the modal vertically in the visible viewport
    // Position it at the center of the current viewport, accounting for scroll
    const centerY = visibleTop + (visibleHeight / 2);
    
    // Center horizontally (always center of the base width)
    const centerX = baseWidth / 2;
    
    // Calculate the transform to center the modal
    // The backdrop covers the full viewport container, modal content is centered within it
    return {
      position: 'absolute' as const,
      top: `${centerY}px`,
      left: `${centerX}px`,
      transform: 'translate(-50%, -50%)',
      width: `${90 * baseWidth / 100}px`,
      maxWidth: '700px',
      maxHeight: `${Math.min(90 * baseHeight / 100, visibleHeight * 0.9)}px`,
    };
  });

  canClose(): boolean {
    return this.pendingCount() === 0;
  }

  getItemKey(item: BulkActionItem): string {
    return `${item.namespace}:${item.resource.metadataName}`;
  }

  onCloseClick(): void {
    if (this.canClose()) {
      this.close.emit();
    }
  }

  onRetryClick(item: BulkActionItem): void {
    this.retry.emit(item);
  }

  ngOnInit(): void {
    this.setupScrollTracking();
  }

  ngOnDestroy(): void {
    this.cleanupScrollTracking();
  }

  private updateScrollPosition(): void {
    if (typeof window === 'undefined') {
      return;
    }
    
    // Get the scrollable container (app-root :host element)
    const viewportContainer = document.querySelector('.viewport-container') as HTMLElement;
    if (!viewportContainer) {
      return;
    }
    
    // The scroll happens on the app-root element (which is the :host)
    const scrollContainer = viewportContainer.closest('app-root') || 
                           document.querySelector('app-root') ||
                           document.documentElement;
    
    const scrollTop = scrollContainer.scrollTop || window.scrollY || 0;
    const scrollLeft = scrollContainer.scrollLeft || window.scrollX || 0;
    
    this.scrollPosition.set({ top: scrollTop, left: scrollLeft });
  }
  
  private setupScrollTracking(): void {
    if (typeof window === 'undefined' || this.scrollListener) {
      return;
    }
    
    this.updateScrollPosition();
    
    this.scrollListener = () => {
      this.updateScrollPosition();
    };
    
    this.resizeListener = () => {
      this.updateScrollPosition();
    };
    
    // Listen to scroll on the app-root element and window
    const viewportContainer = document.querySelector('.viewport-container');
    const scrollContainer = viewportContainer?.closest('app-root') || window;
    
    scrollContainer.addEventListener('scroll', this.scrollListener, true);
    window.addEventListener('resize', this.resizeListener);
    window.addEventListener('scroll', this.scrollListener, true);
  }
  
  private cleanupScrollTracking(): void {
    if (this.scrollListener) {
      const viewportContainer = document.querySelector('.viewport-container');
      const scrollContainer = viewportContainer?.closest('app-root') || window;
      
      scrollContainer.removeEventListener('scroll', this.scrollListener, true);
      window.removeEventListener('scroll', this.scrollListener, true);
      this.scrollListener = undefined;
    }
    
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = undefined;
    }
  }
}

