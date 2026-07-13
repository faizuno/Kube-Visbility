import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { EchartsWrapperComponent } from '../../../../shared/components/echarts-wrapper/echarts-wrapper.component';
import { ElasticsearchService, ErrorAnalyticsResponse, ErrorGroup } from '../../../../core/services/api/elasticsearch.service';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';
import type { EChartsOption } from 'echarts';

@Component({
  selector: 'app-error-analytics-panel',
  standalone: true,
  imports: [CommonModule, EchartsWrapperComponent, LoadingSkeletonComponent],
  template: `
    <div class="error-analytics-panel">
      <div class="error-header">
        <div class="error-title">
          <i class="fas fa-exclamation-triangle"></i>
          <span>Error Analytics</span>
        </div>
        @if (errorData() && !loading()) {
          <div class="error-count">{{ errorData()!.totalErrors | number }}</div>
        } @else {
          <div class="error-count-skeleton">
            <div class="skeleton skeleton-count"></div>
          </div>
        }
      </div>
      
      <div class="error-subtitle">Total Errors (24 hours)</div>
      @if (errorData() && !loading()) {
        <div class="error-details">
          <div class="error-detail-item">
            <span class="detail-label">Error Documents:</span>
            <span class="detail-value">{{ errorData()!.totalErrorDocuments | number }}</span>
          </div>
        </div>
      }
      
      @if (loading()) {
        <div class="chart-skeleton">
          <app-loading-skeleton [count]="1" />
        </div>
      } @else if (errorData() && errorData()!.errorGroups.length > 0) {
        <div class="chart-container" 
             (click)="$event.stopPropagation()">
          <app-echarts-wrapper
            [chartOption]="errorChart()"
            [loadingState]="false"
            height="200px"
            (chartClick)="onBarClick($event)">
          </app-echarts-wrapper>
        </div>
      } @else if (errorData() && errorData()!.errorGroups.length === 0) {
        <div class="no-errors">
          <i class="fas fa-check-circle"></i>
          <span>No errors in the last 24 hours</span>
        </div>
      } @else {
        <div class="error-placeholder">
          <i class="fas fa-exclamation-circle"></i>
          <span>Unable to load error data</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .error-analytics-panel {
      width: 100%;
    }

    .error-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }

    .error-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .error-title i {
      color: var(--theme-status-critical);
    }

    .error-count {
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: #ef4444;
    }

    .error-count-skeleton {
      width: 80px;
      height: 32px;
    }

    .skeleton-count {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, var(--theme-skeleton-base) 25%, var(--theme-skeleton-highlight) 50%, var(--theme-skeleton-base) 75%);
      background-size: 200% 100%;
      animation: loading 1.5s infinite;
      border-radius: 4px;
    }

    @keyframes loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .error-subtitle {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
    }

    .error-details {
      display: flex;
      gap: 1rem;
      margin-bottom: 1rem;
      font-size: var(--theme-font-table-header);
    }

    .error-detail-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .detail-label {
      color: var(--theme-text-gray);
    }

    .detail-value {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .chart-container {
      margin-top: 0.5rem;
      position: relative;
    }

    .chart-container.modal-open {
      pointer-events: none;
    }

    .chart-container.modal-open ::ng-deep .echarts-tooltip {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }

    .chart-skeleton {
      height: 200px;
      padding: 1rem;
    }

    .no-errors {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: #10b981;
      gap: 0.5rem;
    }

    .no-errors i {
      font-size: var(--theme-font-page-title);
    }

    .error-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      color: var(--theme-text-gray);
      gap: 0.5rem;
    }

    .error-placeholder i {
      font-size: var(--theme-font-page-title);
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10020;
      padding: 1rem;
      animation: fadeIn 0.2s;
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
      max-width: 900px;
      width: 100%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: slideUp 0.3s;
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      flex-shrink: 0;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }

    .modal-header h2 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: white;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .modal-header i {
      color: white;
    }

    .close-button {
      background: none;
      border: none;
      font-size: var(--theme-font-page-title);
      color: rgba(255, 255, 255, 0.95);
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .close-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      background: var(--theme-bg-app);
    }

    .error-details {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .detail-row {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .detail-row strong {
      color: var(--theme-text-gray-dark);
      font-size: var(--theme-font-body);
    }

    .error-message-text {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      word-wrap: break-word;
      color: #991b1b;
      font-family: monospace;
      font-size: var(--theme-font-body);
      border: 1px solid #fecaca;
    }

    .error-count-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      background: #fee2e2;
      color: #991b1b;
      border-radius: 12px;
      font-weight: var(--theme-font-table-header-weight);
    }

    .normalized-pattern {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      word-wrap: break-word;
      font-family: monospace;
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
    }

    .sample-logs {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      max-height: 300px;
      overflow-y: auto;
    }

    .sample-log-item {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      border: 1px solid var(--theme-border-gray);
    }

    .log-meta {
      display: flex;
      gap: 1rem;
      margin-bottom: 0.5rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }

    .log-message {
      word-wrap: break-word;
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray-dark);
    }

    .modal-footer {
      padding: 1rem 1.5rem;
      border-top: 1px solid var(--theme-border-gray);
      display: flex;
      gap: 0.75rem;
      justify-content: flex-end;
      background: var(--theme-bg-app);
    }

    .btn-primary,
    .btn-secondary {
      padding: 0.5rem 1rem;
      border: none;
      border-radius: 6px;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .btn-primary {
      background: var(--theme-button-primary);
      color: white;
    }

    .btn-primary:hover {
      background: var(--theme-button-primary-hover);
    }

    .btn-secondary {
      background: var(--theme-bg-surface);
      color: var(--theme-text-gray-dark);
      border: 2px solid #d1d5db;
    }

    .btn-secondary:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
  `]
})
export class ErrorAnalyticsPanelComponent implements OnInit, OnDestroy {
  private elasticsearchService = inject(ElasticsearchService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private location = inject(Location);

  // State - expose errorData for parent component
  loading = signal(false);
  errorData = signal<ErrorAnalyticsResponse | null>(null); // Public for ViewChild access

  // Load data immediately in parallel with dashboard overview calls
  ngOnInit(): void {
    // Load immediately without delay - runs in parallel with other dashboard calls
    this.loadErrorAnalytics();
  }

  ngOnDestroy(): void {
    // Cleanup if needed
  }

  loadErrorAnalytics(): void {
    this.loading.set(true);
    
    // Load errors for last 24 hours
    this.elasticsearchService.getErrorAnalytics(undefined, 1, 1).subscribe({
      next: (data) => {
        this.errorData.set(data);
        this.loading.set(false);
      },
      error: (err) => {
        console.error('Error loading error analytics:', err);
        this.loading.set(false);
        // Don't set error state - just show placeholder
      }
    });
  }

  // Store top errors for click handler
  private topErrors: ErrorGroup[] = [];

  errorChart = computed((): EChartsOption => {
    const data = this.errorData();
    
    if (!data || data.errorGroups.length === 0) {
      this.topErrors = [];
      return {};
    }

    // Sort errors by count descending and get top 10
    const sortedErrors = [...data.errorGroups].sort((a, b) => b.count - a.count);
    this.topErrors = sortedErrors.slice(0, 10);
    
    // Reverse to show max on top
    const reversedErrors = [...this.topErrors].reverse();
    
    const categories = reversedErrors.map(e => {
      // Truncate long messages for display
      const msg = e.errorMessage || 'N/A';
      return msg.length > 50 ? msg.substring(0, 50) + '...' : msg;
    });
    const values = reversedErrors.map(e => e.count);
    
    // Get max count for color gradient
    const maxCount = Math.max(...values);
    
    // Create color array based on count (darker red for higher counts)
    const colors = values.map(count => {
      const intensity = count / maxCount;
      // Gradient from light red (#fca5a5) to dark red (#dc2626)
      if (intensity > 0.8) return '#dc2626'; // Dark red for highest
      if (intensity > 0.6) return '#ef4444'; // Medium red
      if (intensity > 0.4) return '#f87171'; // Light-medium red
      return '#fca5a5'; // Light red for lowest
    });

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        },
        formatter: (params: any) => {
          if (!params || !Array.isArray(params) || params.length === 0) return '';
          const param = params[0];
          const dataIndex = param.dataIndex;
          if (dataIndex >= 0 && dataIndex < reversedErrors.length) {
            const error = reversedErrors[dataIndex];
            return `
              <div style="padding: 8px; max-width: min(420px, 70vw); max-height: 320px; overflow-y: auto;">
                <div style="font-weight: var(--theme-font-table-header-weight); margin-bottom: 4px;">Error Message:</div>
                <div style="margin-bottom: 8px; white-space: normal; overflow-wrap: anywhere; word-break: break-word;">${error.errorMessage || 'N/A'}</div>
                <div style="font-weight: var(--theme-font-table-header-weight);">Occurrences: <span style="color: #dc2626;">${error.count.toLocaleString()}</span></div>
                ${error.serviceName ? `<div style="margin-top: 4px; font-size: var(--theme-font-caption); color: var(--theme-text-gray); white-space: normal; overflow-wrap: anywhere; word-break: break-word;">Service: ${error.serviceName}</div>` : ''}
              </div>
            `;
          }
          return '';
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '15%',
        top: '5%',
        containLabel: true
      },
      xAxis: {
        type: 'value',
        name: 'Occurrences',
        nameLocation: 'middle',
        nameGap: 30,
        min: 0,
        max: maxCount > 0 ? Math.ceil(maxCount * 1.1) : 100,
        splitNumber: 5
      },
      yAxis: {
        type: 'category',
        data: categories,
        inverse: false, // Keep normal order (max on top after reverse)
        axisLabel: {
          show: false // Hide y-axis labels since tooltip shows full error message
        }
      },
      series: [
        {
          name: 'Errors',
          type: 'bar',
          data: values.map((count, index) => ({
            value: count,
            itemStyle: {
              color: colors[index]
            }
          })),
          label: {
            show: true,
            position: 'right',
            formatter: '{c}'
          }
        }
      ]
    };
  });

  onBarClick(event: any): void {
    if (!event || !this.errorData() || this.topErrors.length === 0) return;
    
    // ECharts click event can be the params object directly or nested
    const params = event.params || event;
    const dataIndex = params.dataIndex !== undefined ? params.dataIndex : params.seriesIndex;
    
    if (dataIndex !== undefined && dataIndex >= 0 && dataIndex < this.topErrors.length) {
      // Since we reversed the array for display, we need to reverse the index
      const reversedIndex = this.topErrors.length - 1 - dataIndex;
      const clickedError = this.topErrors[reversedIndex];
      
      // Find the index in the full errorGroups array
      const fullIndex = this.errorData()!.errorGroups.findIndex(
        e => e.errorMessage === clickedError.errorMessage && e.count === clickedError.count
      );
      
      if (fullIndex >= 0) {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { 
            modal: 'error',
            errorIndex: fullIndex.toString()
          },
          queryParamsHandling: 'merge'
        });
      }
    }
  }

  navigateToErrorPage(): void {
    const urlTree = this.router.createUrlTree(['/errors']);
    const url = this.router.serializeUrl(urlTree);
    // Use Location service to prepare external URL with base href
    const externalUrl = this.location.prepareExternalUrl(url);
    const fullUrl = `${window.location.origin}${externalUrl}`;
    window.open(fullUrl, '_blank');
  }

  formatDate(dateString: string | Date): string {
    try {
      const date = typeof dateString === 'string'
        ? this.parseTimestamp(dateString)
        : dateString;
      if (!date || isNaN(date.getTime())) {
        return String(dateString);
      }
      return date.toLocaleString();
    } catch {
      return String(dateString);
    }
  }

  private parseTimestampMs(value?: string | null): number | null {
    const raw = (value ?? '').trim();
    if (!raw) {
      return null;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    }
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private parseTimestamp(value?: string | null): Date | null {
    const timestampMs = this.parseTimestampMs(value);
    return timestampMs === null ? null : new Date(timestampMs);
  }
}

