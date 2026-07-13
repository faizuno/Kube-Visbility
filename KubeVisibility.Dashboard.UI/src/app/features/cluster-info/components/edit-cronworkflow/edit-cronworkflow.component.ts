import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges, inject, signal, computed, effect, Injector } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CronWorkflowsService } from '../../../../core/services/api/cron-workflows.service';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { ResourceInfo, UpdateCronWorkflowRequest } from '../../../../core/models/cluster-info.models';

@Component({
  selector: 'app-edit-cronworkflow',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible() && resource) {
      <div class="modal-overlay" (click)="onBackdropClick($event)">
        <div class="modal-container" (click)="$event.stopPropagation()" [ngStyle]="modalStyle()">
          <div class="modal-header">
            <h3 id="editCronWorkflowModalTitle">Edit CronWorkflow: {{ resourceName() }}</h3>
            <button type="button" class="modal-close" (click)="close()">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="modal-body">
            <form id="editCronWorkflowForm" (ngSubmit)="saveChanges()">
              <div class="form-group" [class.error]="errors().schedules">
                <label for="modal-schedules">Schedules *</label>
                <textarea
                  id="modal-schedules"
                  rows="3"
                  required
                  [(ngModel)]="schedulesText"
                  (input)="validateSchedules()"
                  (blur)="validateSchedules()"
                  name="schedules"
                ></textarea>
                <div class="form-hint">
                  <div style="margin-bottom: 6px;">Enter cron schedules (one per line). Format: <code>minute hour day month dayOfWeek</code></div>
                  <details style="cursor: pointer; color: var(--primary-color, var(--theme-button-primary));">
                    <summary style="display: inline-flex; align-items: center; gap: 4px;">
                      <i class="fas fa-info-circle"></i> Common Examples
                    </summary>
                    <div style="margin-top: 8px; padding: 8px; background: var(--bg-color, #f8f9fa); border-radius: 4px; font-family: monospace; font-size: var(--theme-font-body); line-height: 1.6;">
                      <div><strong>* * * * *</strong> - Every minute</div>
                      <div><strong>*/15 * * * *</strong> - Every 15 minutes</div>
                      <div><strong>0 * * * *</strong> - Every hour (at minute 0)</div>
                      <div><strong>0 0 * * *</strong> - Every day at midnight</div>
                      <div><strong>0 3 * * *</strong> - Every day at 3:00 AM</div>
                      <div><strong>30 14 * * *</strong> - Every day at 2:30 PM</div>
                      <div><strong>0 3 * * 3</strong> - Every Wednesday at 3:00 AM</div>
                      <div><strong>0 3 * * 1-5</strong> - Weekdays (Mon-Fri) at 3:00 AM</div>
                      <div><strong>0 0 1 * *</strong> - First day of every month at midnight</div>
                      <div style="margin-top: 6px; color: var(--text-secondary, #666); font-family: 'Segoe UI', sans-serif;">
                        <strong>Fields:</strong> minute (0-59), hour (0-23), day (1-31), month (1-12), dayOfWeek (0-7, 0 or 7 = Sunday)
                      </div>
                    </div>
                  </details>
                </div>
                <div class="form-error" [class.active]="errors().schedules">
                  {{ errors().schedules }}
                </div>
              </div>
              
              <div class="form-group">
                <label for="modal-starting-deadline">Starting Deadline Seconds *</label>
                <input
                  type="number"
                  id="modal-starting-deadline"
                  min="0"
                  value="0"
                  required
                  [(ngModel)]="formData.startingDeadlineSeconds"
                  name="startingDeadlineSeconds"
                />
                <div class="form-hint">Optional deadline in seconds for starting the job if it misses scheduled time</div>
              </div>
              
              <div class="form-group">
                <label for="modal-concurrency-policy">Concurrency Policy *</label>
                <select
                  id="modal-concurrency-policy"
                  required
                  [(ngModel)]="formData.concurrencyPolicy"
                  name="concurrencyPolicy"
                >
                  <option value="Allow">Allow - Allow concurrent runs</option>
                  <option value="Forbid">Forbid - Do not allow concurrent runs</option>
                  <option value="Replace">Replace - Replace currently running job</option>
                </select>
                <div class="form-hint">How to handle concurrent workflow runs</div>
              </div>
              
              <div class="form-group" [class.error]="errors().successfulLimit">
                <label for="modal-successful-limit">Successful Jobs History Limit *</label>
                <input
                  type="number"
                  id="modal-successful-limit"
                  min="0"
                  max="100"
                  value="4"
                  required
                  [(ngModel)]="formData.successfulJobsHistoryLimit"
                  (input)="validateSuccessfulLimit()"
                  (blur)="validateSuccessfulLimit()"
                  name="successfulJobsHistoryLimit"
                />
                <div class="form-hint">Number of successful job histories to keep (0-100)</div>
                <div class="form-error" [class.active]="errors().successfulLimit">
                  {{ errors().successfulLimit }}
                </div>
              </div>
              
              <div class="form-group" [class.error]="errors().failedLimit">
                <label for="modal-failed-limit">Failed Jobs History Limit *</label>
                <input
                  type="number"
                  id="modal-failed-limit"
                  min="0"
                  max="100"
                  value="4"
                  required
                  [(ngModel)]="formData.failedJobsHistoryLimit"
                  (input)="validateFailedLimit()"
                  (blur)="validateFailedLimit()"
                  name="failedJobsHistoryLimit"
                />
                <div class="form-hint">Number of failed job histories to keep (0-100)</div>
                <div class="form-error" [class.active]="errors().failedLimit">
                  {{ errors().failedLimit }}
                </div>
              </div>
              
              <div class="form-group">
                <div class="checkbox-group">
                  <input
                    type="checkbox"
                    id="modal-suspend"
                    [(ngModel)]="formData.suspend"
                    name="suspend"
                  />
                  <label for="modal-suspend">Suspend workflow execution</label>
                </div>
                <div class="form-hint">When checked, the workflow will not run on schedule</div>
              </div>
            </form>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-modal btn-modal-cancel" (click)="close()">Cancel</button>
            <button
              type="button"
              class="btn-modal btn-modal-submit"
              (click)="saveChanges()"
              [disabled]="saving() || hasErrors()"
            >
              {{ saving() ? 'Saving...' : 'Save Changes' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        height: 200vh;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: var(--z-modal-backdrop, 1000000);
        pointer-events: auto;
        animation: fadeIn 0.2s ease-out;
      }
      
      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }
      
      .modal-container {
        background: var(--theme-bg-app);
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        display: flex;
        flex-direction: column;
        margin: 0;
        pointer-events: auto;
        animation: modalSlideIn 0.3s ease-out;
      }
      
      @keyframes modalSlideIn {
        from {
          transform: translateY(-50px);
          opacity: 0;
        }
        to {
          transform: translateY(0);
          opacity: 1;
        }
      }
      
      .modal-header {
        padding: 0.9rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
        background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
        color: white;
        border-radius: 12px 12px 0 0;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }
      
      .modal-header h3 {
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-header-weight);
        color: white;
        margin: 0;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        line-height: 1.2;
      }
      
      .modal-close {
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
      
      .modal-close:hover {
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
      }
      
      .modal-body {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        background: var(--theme-bg-app);
      }
      
      .modal-body::-webkit-scrollbar {
        width: 4px;
      }
      
      .modal-body::-webkit-scrollbar-track {
        background: var(--theme-bg-app);
        border-radius: 2px;
      }
      
      .modal-body::-webkit-scrollbar-thumb {
        background: var(--theme-border-gray-light);
        border-radius: 2px;
      }
      
      .modal-body::-webkit-scrollbar-thumb:hover {
        background: #999;
      }
      
      .form-group {
        margin-bottom: 20px;
      }
      
      .form-group label {
        display: block;
        font-weight: var(--theme-font-table-body-weight);
        margin-bottom: 8px;
        color: var(--theme-text-dark);
        font-size: var(--theme-font-body);
      }
      
      .form-group input[type="number"],
      .form-group select,
      .form-group textarea {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        font-size: var(--theme-font-body);
        font-family: inherit;
        transition: border-color 0.2s;
        box-sizing: border-box;
      }
      
      .form-group input[type="number"]:focus,
      .form-group select:focus,
      .form-group textarea:focus {
        outline: none;
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
      }
      
      .form-group textarea {
        resize: vertical;
        min-height: 80px;
        font-family: 'Courier New', Courier, monospace;
      }
      
      .form-hint {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
        margin-top: 4px;
      }
      
      .form-hint code {
        background: var(--theme-bg-app);
        padding: 2px 6px;
        border-radius: 3px;
        font-size: var(--theme-font-body);
        font-family: 'Courier New', Courier, monospace;
      }
      
      .form-error {
        font-size: var(--theme-font-body);
        color: #dc2626;
        margin-top: 4px;
        display: none;
      }
      
      .form-error.active {
        display: block;
      }
      
      .form-group.error input,
      .form-group.error select,
      .form-group.error textarea {
        border-color: #dc2626;
        border-width: 2px;
      }
      
      .form-group.error label {
        color: #dc2626;
      }
      
      .checkbox-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .checkbox-group input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
      }
      
      .checkbox-group label {
        margin: 0;
        cursor: pointer;
      }
      
      .modal-footer {
        padding: 16px 24px;
        border-top: 1px solid var(--theme-border-gray-light);
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        flex-shrink: 0;
        background: var(--theme-bg-surface);
        border-radius: 0 0 12px 12px;
      }
      
      .btn-modal {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .btn-modal-cancel {
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
      }
      
      .btn-modal-cancel:hover {
        background: #e8e8e8;
      }
      
      .btn-modal-submit {
        background: var(--theme-button-primary-hover);
        color: white;
      }
      
      .btn-modal-submit:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }
      
      .btn-modal-submit:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class EditCronworkflowComponent implements OnInit, OnChanges, OnDestroy {
  @Input() namespace = '';
  @Input() resource: ResourceInfo | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<ResourceInfo>();

  private cronWorkflowsService = inject(CronWorkflowsService);
  private stateService = inject(ClusterStateService);
  private viewportScaleService = inject(ViewportScaleService);
  private injector = inject(Injector);

  visible = signal(false);
  resourceName = signal('');
  saving = signal(false);
  errors = signal<{
    schedules?: string;
    successfulLimit?: string;
    failedLimit?: string;
  }>({});
  
  private scrollPosition = signal({ top: 0, left: 0 });
  private scrollListener?: () => void;
  private resizeListener?: () => void;

  schedulesText = ''; // String for textarea binding
  formData: UpdateCronWorkflowRequest = {
    namespaceName: '',
    resourceName: '',
    schedules: [],
    startingDeadlineSeconds: 0,
    concurrencyPolicy: 'Allow',
    successfulJobsHistoryLimit: 4,
    failedJobsHistoryLimit: 4,
    suspend: false,
  };
  
  // Calculate modal position accounting for viewport scale
  modalStyle = computed(() => {
    if (typeof window === 'undefined' || !this.visible()) {
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
    // Modal should be 90% width with max-width of 600px
    const modalWidth = Math.min(600, baseWidth * 0.9);
    
    return {
      position: 'absolute' as const,
      top: `${centerY}px`,
      left: `${centerX}px`,
      transform: 'translate(-50%, -50%)',
      width: `80%`,
      maxWidth: '1200px',
      maxHeight: `${Math.min(90 * baseHeight / 100, visibleHeight * 0.8)}px`,
    };
  });

  constructor() {
    // Track visibility changes to set up/tear down scroll tracking
    effect(() => {
      if (this.visible()) {
        this.setupScrollTracking();
        this.updateScrollPosition();
      } else {
        this.cleanupScrollTracking();
      }
    }, { injector: this.injector });
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

  ngOnInit(): void {
    if (this.resource && this.namespace) {
      this.open();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resource'] && this.resource && this.namespace && !this.visible()) {
      this.open();
    }
  }
  
  ngOnDestroy(): void {
    // Clean up scroll tracking
    this.cleanupScrollTracking();
  }

  open(): void {
    if (!this.resource || !this.namespace) {
      return;
    }

    this.resourceName.set(this.resource.name || this.resource.metadataName);
    this.formData.namespaceName = this.namespace;
    this.formData.resourceName = this.resource.metadataName;

    // Populate form with resource data
    const schedules = this.resource.schedules || (this.resource.schedule ? [this.resource.schedule] : []);
    this.schedulesText = schedules.join('\n');
    this.formData.startingDeadlineSeconds = this.resource.startingDeadlineSeconds || 0;
    this.formData.concurrencyPolicy = this.resource.concurrencyPolicy || 'Allow';
    this.formData.successfulJobsHistoryLimit = this.resource.successfulJobsHistoryLimit ?? 4;
    this.formData.failedJobsHistoryLimit = this.resource.failedJobsHistoryLimit ?? 4;
    this.formData.suspend = this.resource.suspend || false;

    this.clearErrors();
    this.visible.set(true);
    // Set up scroll tracking for modal positioning
    this.setupScrollTracking();
  }

  close(): void {
    this.visible.set(false);
    this.clearErrors();
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  clearErrors(): void {
    this.errors.set({});
  }

  validateSchedules(): boolean {
    const schedulesText = this.schedulesText.trim();
    const errors = { ...this.errors() };

    if (!schedulesText) {
      errors.schedules = 'Please enter at least one schedule';
      this.errors.set(errors);
      return false;
    }

    const schedules = schedulesText.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);

    if (schedules.length === 0) {
      errors.schedules = 'Please enter at least one schedule';
      this.errors.set(errors);
      return false;
    }

    // Validate each schedule
    for (const schedule of schedules) {
      const parts = schedule.split(/\s+/);
      if (parts.length < 5 || parts.length > 6) {
        errors.schedules = `Invalid cron format: "${schedule}". Should have 5-6 parts (minute hour day month dayOfWeek)`;
        this.errors.set(errors);
        return false;
      }

      // Basic validation of each part
      if (
        !this.isValidCronPart(parts[0], 0, 59) || // minute
        !this.isValidCronPart(parts[1], 0, 23) || // hour
        !this.isValidCronPart(parts[2], 1, 31) || // day
        !this.isValidCronPart(parts[3], 1, 12) || // month
        !this.isValidCronPart(parts[4], 0, 7)
      ) {
        // dayOfWeek
        errors.schedules = `Invalid values in: "${schedule}". Check ranges (min 0-59, hour 0-23, day 1-31, month 1-12, dow 0-7)`;
        this.errors.set(errors);
        return false;
      }
    }

    delete errors.schedules;
    this.errors.set(errors);
    return true;
  }

  isValidCronPart(part: string, min: number, max: number): boolean {
    // Allow wildcards, ranges, steps, and lists
    if (part === '*') return true;
    if (part.includes('*')) return true; // */5, */10, etc.
    if (part.includes('-')) return true; // 1-5
    if (part.includes(',')) return true; // 1,3,5

    // Check if it's a valid number within range
    const num = parseInt(part, 10);
    return !isNaN(num) && num >= min && num <= max;
  }

  validateSuccessfulLimit(): boolean {
    // Parse value to ensure it's a number (matching backend behavior with parseInt)
    const value = parseInt(String(this.formData.successfulJobsHistoryLimit), 10);
    const errors = { ...this.errors() };

    if (isNaN(value) || value < 0 || value > 100) {
      errors.successfulLimit = 'Value must be between 0 and 100';
      this.errors.set(errors);
      return false;
    }

    // Ensure formData has the parsed integer value
    this.formData.successfulJobsHistoryLimit = value;

    delete errors.successfulLimit;
    this.errors.set(errors);
    return true;
  }

  validateFailedLimit(): boolean {
    // Parse value to ensure it's a number (matching backend behavior with parseInt)
    const value = parseInt(String(this.formData.failedJobsHistoryLimit), 10);
    const errors = { ...this.errors() };

    if (isNaN(value) || value < 0 || value > 100) {
      errors.failedLimit = 'Value must be between 0 and 100';
      this.errors.set(errors);
      return false;
    }

    // Ensure formData has the parsed integer value
    this.formData.failedJobsHistoryLimit = value;

    delete errors.failedLimit;
    this.errors.set(errors);
    return true;
  }

  hasErrors(): boolean {
    const errs = this.errors();
    return Object.keys(errs).length > 0;
  }

  async saveChanges(): Promise<void> {
    // Validate all fields
    const schedulesValid = this.validateSchedules();
    const successfulLimitValid = this.validateSuccessfulLimit();
    const failedLimitValid = this.validateFailedLimit();

    if (!schedulesValid || !successfulLimitValid || !failedLimitValid) {
      return; // Don't submit if validation fails
    }

    // Parse schedules from textarea
    const schedules = this.schedulesText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    // Parse numeric values to ensure they're integers (matching backend behavior)
    const startingDeadlineSeconds = parseInt(String(this.formData.startingDeadlineSeconds), 10) || 0;

    const request: UpdateCronWorkflowRequest = {
      namespaceName: this.formData.namespaceName,
      resourceName: this.formData.resourceName,
      schedules,
      startingDeadlineSeconds,
      concurrencyPolicy: this.formData.concurrencyPolicy,
      successfulJobsHistoryLimit: this.formData.successfulJobsHistoryLimit,
      failedJobsHistoryLimit: this.formData.failedJobsHistoryLimit,
      suspend: this.formData.suspend,
    };

    this.saving.set(true);

    try {
      const response = await this.cronWorkflowsService.updateCronWorkflow(request).toPromise();

      if (response?.success) {
        // Update the resource in state
        if (response.updatedResource) {
          this.stateService.updateResourceInState(this.namespace, response.updatedResource);
          this.saved.emit(response.updatedResource);
        } else {
          // Fallback: reload namespace data
          await this.stateService.loadNamespaceData(this.namespace);
        }

        this.close();
      } else {
        // Handle error - show toast or alert
        alert(response?.message || 'Failed to update CronWorkflow');
      }
    } catch (error: any) {
      console.error('Error saving CronWorkflow changes:', error);
      if (error.status === 403) {
        alert('Access denied. Only admin users can update CronWorkflows.');
      } else {
        alert('Error saving changes: ' + (error.message || 'Unknown error'));
      }
    } finally {
      this.saving.set(false);
    }
  }
}

