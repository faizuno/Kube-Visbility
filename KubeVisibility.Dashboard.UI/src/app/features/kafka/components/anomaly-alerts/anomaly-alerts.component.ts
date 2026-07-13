import { Component, Input, signal, computed, Output, EventEmitter } from '@angular/core';

import { Anomaly } from '../../models/diagnostics.models';

/**
 * Component for displaying anomaly alerts
 * Following Single Responsibility Principle - only displays anomalies
 */
@Component({
  selector: 'app-anomaly-alerts',
  standalone: true,
  imports: [],
  template: `
    <div class="anomaly-alerts">
      @if (anomalies().length > 0) {
        <div class="alerts-header">
          <h4>
            <i class="fas fa-bell"></i>
            Anomalies Detected ({{ anomalies().length }})
          </h4>
          @if (anomalies().length > 3 && !showAll()) {
            <button class="show-all-btn" (click)="toggleShowAll()">
              Show All
            </button>
          }
        </div>

        <div class="alerts-list">
          @for (anomaly of displayedAnomalies(); track $index) {
            <div class="anomaly-card" [class]="'severity-' + anomaly.severity">
              <div class="anomaly-header">
                <span class="anomaly-icon">
                  <i class="fas" [class.fa-exclamation-circle]="anomaly.severity === 'critical' || anomaly.severity === 'high'"
                                 [class.fa-exclamation-triangle]="anomaly.severity === 'medium'"
                                 [class.fa-info-circle]="anomaly.severity === 'low'"></i>
                </span>
                <div class="anomaly-title">
                  <span class="anomaly-type">{{ getTypeLabel(anomaly.type) }}</span>
                  <span class="anomaly-badge" [class]="'badge-' + anomaly.severity">
                    {{ anomaly.severity }}
                  </span>
                </div>
                <span class="anomaly-time">{{ getTimeAgo(anomaly.timestamp) }}</span>
              </div>

              <div class="anomaly-description">{{ anomaly.description }}</div>

              @if (anomaly.details) {
                <div class="anomaly-details">{{ anomaly.details }}</div>
              }

              @if (anomaly.metric) {
                <div class="anomaly-metric">
                  <span class="metric-label">{{ anomaly.metric.name }}:</span>
                  <span class="metric-value">{{ formatMetricValue(anomaly.metric.currentValue) }}</span>
                  @if (anomaly.metric.expectedValue) {
                    <span class="metric-expected">(expected: {{ formatMetricValue(anomaly.metric.expectedValue) }})</span>
                  }
                </div>
              }

              @if (anomaly.affectedPartitions && anomaly.affectedPartitions.length > 0) {
                <div class="affected-items">
                  <i class="fas fa-layer-group"></i>
                  Partitions: {{ anomaly.affectedPartitions.join(', ') }}
                </div>
              }

              @if (anomaly.affectedConsumerGroups && anomaly.affectedConsumerGroups.length > 0) {
                <div class="affected-items">
                  <i class="fas fa-users"></i>
                  Groups: {{ anomaly.affectedConsumerGroups.join(', ') }}
                </div>
              }

              <div class="anomaly-action">
                <i class="fas fa-lightbulb"></i>
                <span>{{ anomaly.suggestedAction }}</span>
              </div>

              <button class="dismiss-btn" (click)="onDismiss(anomaly)" title="Dismiss">
                <i class="fas fa-times"></i>
              </button>
            </div>
          }
        </div>

        @if (anomalies().length > 3 && showAll()) {
          <button class="show-less-btn" (click)="toggleShowAll()">
            Show Less
          </button>
        }
      } @else {
        <div class="no-anomalies">
          <i class="fas fa-check-circle"></i>
          <span>No anomalies detected</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .anomaly-alerts {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      border: 1px solid var(--theme-border-gray);
      overflow: hidden;
    }

    .alerts-header {
      padding: 1rem 1.5rem;
      border-bottom: 2px solid var(--theme-border-gray);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--theme-bg-app);
    }

    .alerts-header h4 {
      margin: 0;
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .show-all-btn, .show-less-btn {
      padding: 0.5rem 1rem;
      background: var(--theme-button-primary);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      transition: all 0.2s;
    }

    .show-all-btn:hover, .show-less-btn:hover {
      background: var(--theme-button-primary-hover);
      box-shadow: 0 4px 12px var(--theme-button-primary-shadow);
    }

    .show-less-btn {
      width: 100%;
      margin-top: 1rem;
    }

    .alerts-list {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .anomaly-card {
      position: relative;
      padding: 1rem;
      border-radius: 8px;
      border-left: 4px solid;
      background: var(--theme-bg-surface);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .anomaly-card.severity-critical {
      border-left-color: #dc2626;
      background: #fef2f2;
    }

    .anomaly-card.severity-high {
      border-left-color: #ef4444;
      background: #fef2f2;
    }

    .anomaly-card.severity-medium {
      border-left-color: #f59e0b;
      background: #fefce8;
    }

    .anomaly-card.severity-low {
      border-left-color: var(--theme-button-primary);
      background: #f0fdfa;
    }

    .anomaly-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
    }

    .anomaly-icon {
      font-size: var(--theme-font-page-title);
    }

    .severity-critical .anomaly-icon {
      color: #dc2626;
    }

    .severity-high .anomaly-icon {
      color: #ef4444;
    }

    .severity-medium .anomaly-icon {
      color: #f59e0b;
    }

    .severity-low .anomaly-icon {
      color: var(--theme-button-primary);
    }

    .anomaly-title {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .anomaly-type {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      font-size: var(--theme-font-body);
    }

    .anomaly-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      text-transform: uppercase;
    }

    .badge-critical {
      background: #dc2626;
      color: white;
    }

    .badge-high {
      background: #ef4444;
      color: white;
    }

    .badge-medium {
      background: #f59e0b;
      color: white;
    }

    .badge-low {
      background: var(--theme-button-primary);
      color: white;
    }

    .anomaly-time {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }

    .anomaly-description {
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      margin-bottom: 0.5rem;
      font-weight: var(--theme-font-table-body-weight);
    }

    .anomaly-details {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
      margin-bottom: 0.5rem;
    }

    .anomaly-metric {
      font-size: var(--theme-font-body);
      color: var(--theme-table-header-color);
      margin-bottom: 0.5rem;
      padding: 0.5rem;
      background: var(--theme-bg-surface);
      border-radius: 4px;
    }

    .metric-label {
      font-weight: var(--theme-font-table-header-weight);
      margin-right: 0.5rem;
    }

    .metric-value {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .metric-expected {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-table-header);
      margin-left: 0.5rem;
    }

    .affected-items {
      font-size: var(--theme-font-body);
      color: var(--theme-table-header-color);
      margin-bottom: 0.5rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .anomaly-action {
      padding: 0.75rem;
      background: var(--theme-bg-surface);
      border-radius: 4px;
      border: 1px solid var(--theme-border-gray);
      margin-top: 0.75rem;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
    }

    .anomaly-action i {
      color: #f59e0b;
      margin-top: 0.125rem;
    }

    .dismiss-btn {
      position: absolute;
      top: 0.75rem;
      right: 0.75rem;
      padding: 0.25rem 0.5rem;
      background: transparent;
      border: none;
      color: var(--theme-text-gray);
      cursor: pointer;
      font-size: var(--theme-font-body);
      transition: color 0.2s;
    }

    .dismiss-btn:hover {
      color: var(--theme-text-gray);
    }

    .no-anomalies {
      padding: 3rem;
      text-align: center;
      color: #10b981;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .no-anomalies i {
      font-size: var(--theme-font-page-title);
      opacity: 0.5;
    }

    .no-anomalies span {
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
    }
  `]
})
export class AnomalyAlertsComponent {
  @Input() set data(value: Anomaly[] | null) {
    this.anomalies.set(value || []);
  }

  @Output() dismiss = new EventEmitter<Anomaly>();

  anomalies = signal<Anomaly[]>([]);
  showAll = signal(false);

  displayedAnomalies = computed(() => {
    const all = this.anomalies();
    return this.showAll() ? all : all.slice(0, 3);
  });

  toggleShowAll(): void {
    this.showAll.update(v => !v);
  }

  getTypeLabel(type: string): string {
    return type.split('_').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
  }

  getTimeAgo(timestamp: number): string {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  formatMetricValue(value: number): string {
    if (value >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `${(value / 1000).toFixed(2)}K`;
    return value.toFixed(2);
  }

  onDismiss(anomaly: Anomaly): void {
    this.dismiss.emit(anomaly);
  }
}

