import { Component, computed, inject, signal, OnDestroy, input } from '@angular/core';

import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HealthStateService } from '../../services/health-state.service';
import { HealthApiService } from '../../services/health-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { NodesHealthTableComponent } from '../../../../shared/components/nodes-health-table/nodes-health-table.component';
import { NodesPrometheusMetricsComponent } from '../../../../shared/components/nodes-prometheus-metrics/nodes-prometheus-metrics.component';
import type { EChartsOption } from 'echarts';
import type { NodePrometheusMetricsCurrentResponse, NodePrometheusMetricsTimeSeriesResponse } from '../../models/health.models';

@Component({
  selector: 'app-cluster-health-panel',
  standalone: true,
  imports: [NodesHealthTableComponent, NodesPrometheusMetricsComponent],
  template: `
    <div class="cluster-health-panel">
      <div class="panel-content">
        <!-- Nodes table (same as Nodes page) -->
        <div class="nodes-section">
          @if (prometheusEnabled()) {
            <div class="nodes-toolbar">
              <button type="button" class="btn-view-metrics" (click)="openMetricsModal()">
                <i class="fas fa-chart-line"></i>
                <span>View Metrics</span>
              </button>
            </div>
          }
          @if (isLoading()) {
            <div class="nodes-table-skeleton dashboard-common-table-wrap">
              <table class="dashboard-common-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Version</th>
                    <th>CPU Cores</th>
                    <th>Total Memory</th>
                    <th>Alloc. CPU</th>
                    <th>Alloc. Memory</th>
                    <th>Alloc. Pods</th>
                    <th>CPU Usage</th>
                    <th>Memory Usage</th>
                    @if (prometheusEnabled()) {
                      <th>P. Disk %</th>
                    }
                    <th>Pods</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of [1, 2, 3, 4, 5]; track row) {
                    <tr>
                      <td><span class="table-skeleton-bar table-skeleton-wide"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-badge"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      @if (prometheusEnabled()) {
                        <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                      }
                      <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (healthState.nodeHealth()) {
            <app-nodes-health-table
              [nodeHealth]="healthState.nodeHealth()"
              [prometheusEnabled]="prometheusEnabled()"
              [prometheusMetrics]="prometheusMetrics()"
              [showDiskColumn]="prometheusEnabled()"
              [showMetricBars]="false"
              tableMaxHeight="360px"
            />
          }
          @else {
            <div class="empty-state">No node data available</div>
          }
        </div>
      </div>

      @if (showMetricsModal() && prometheusEnabled()) {
        <div class="modal-overlay" (click)="closeMetricsModal()">
          <div
            class="modal-container"
            (click)="$event.stopPropagation()"
            [style.max-height]="metricsModalMaxHeight()"
          >
            <div class="modal-header">
              <h2>
                <i class="fas fa-chart-line"></i>
                Node Metrics
              </h2>
              <button class="close-button" (click)="closeMetricsModal()">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="modal-body">
              <app-nodes-prometheus-metrics
                [prometheusEnabled]="prometheusEnabled()"
                [showTimeFilter]="true"
                [loading]="diskSeriesLoading()"
                [hasSeries]="!!diskSeries()?.length"
                [chartHeight]="'260px'"
                [cpuChartOption]="cpuChartOption()"
                [memoryChartOption]="memoryChartOption()"
                [diskChartOption]="diskChartOption()"
                [filterMode]="nodeFilterMode()"
                [topNodeLimit]="topNodeLimit()"
                [selectedTopMetrics]="selectedTopMetrics()"
                [nodeOptions]="prometheusNodeOptions()"
                [selectedNodeNames]="selectedNodeNames()"
                [timePresets]="timePresets"
                [activePresetId]="activePresetId()"
                [selectedDurationLabel]="selectedDurationLabel()"
                [metricsStartInputValue]="metricsStartInputValue()"
                [metricsStartMin]="metricsStartMin()"
                [metricsStartMax]="metricsStartMax()"
                [metricsEndInputValue]="metricsEndInputValue()"
                [metricsEndMin]="metricsEndMin()"
                [metricsEndMax]="metricsEndMax()"
                (timePresetChange)="setTimePreset($event)"
                (metricsStartChange)="onMetricsStartChange($event)"
                (metricsEndChange)="onMetricsEndChange($event)"
                (filterModeChange)="onNodeFilterModeChange($event)"
                (topNodeLimitChange)="onTopNodeLimitChange($event)"
                (selectedTopMetricsChange)="onSelectedTopMetricsChange($event)"
                (selectedNodeNamesChange)="onSelectedNodeNamesChange($event)"
              />
            </div>
          </div>
        </div>
      }

    </div>
  `,
  styles: [`
    .cluster-health-panel {
      border-radius: 8px;
      padding: .5rem 1rem 1rem 1rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      margin-bottom: 2rem;
    }

    .panel-content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .charts-row {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 1.5rem;
    }

    .chart-container {
      background: var(--theme-bg-surface);
      border-radius: 6px;
      padding: 1rem;
      transition: all 0.3s;
    }

    .chart-container.clickable {
      cursor: pointer;
      border: 2px solid transparent;
    }

    .chart-container.clickable:hover {
      border-color: var(--theme-button-primary);
      box-shadow: 0 4px 12px rgba(147, 41, 154, 0.15);
      transform: translateY(-2px);
    }

    .chart-container.clickable:active {
      transform: translateY(0);
    }

    .chart-container.flex-2 {
      grid-column: span 1;
    }

    .chart-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .chart-container h3 {
      margin: 0;
      padding: 0;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-table-header-color);
      text-align: left;
      line-height: 1.5;
    }
    .nodes-monitoring-link {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-teal);
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      white-space: nowrap;
    }
    .nodes-monitoring-link:hover {
      text-decoration: underline;
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(100vh * 20);
      background: rgba(0, 0, 0, 0.5);
      z-index: 1000000;
      padding: 1rem;
      animation: fadeIn 0.2s;
      overflow-y: auto;
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
      width: 90%;
      max-width: 1600px;
      margin: 5vh auto 0;
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
      padding: 1.5rem 2rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: var(--theme-header-gradient);
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
      background: var(--theme-bg-app);
    }

    /* Table Styles */
    .table-wrapper {
      overflow-x: auto;
      border-radius: 6px;
      border: 1px solid var(--theme-border-gray);
    }

    .nodes-table-wrapper {
      max-height: 360px;
      overflow-y: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--theme-font-body);
    }

    thead {
      background: var(--theme-bg-app);
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      padding: 0.75rem;
      text-align: left;
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-table-header-color);
      border-bottom: 2px solid var(--theme-border-gray-light);
      vertical-align: middle;
    }

    th:nth-child(1) { width: 12%; }
    th:nth-child(2) { width: 8%; }
    th:nth-child(3) { width: 9%; }
    th:nth-child(4) { width: 8%; }
    th:nth-child(5) { width: 6%; }
    th:nth-child(6) { width: 9%; }
    th:nth-child(7) { width: 6%; }
    th:nth-child(8) { width: 9%; }
    th:nth-child(9) { width: 6%; }
    th:nth-child(10) { width: 10%; }
    th:nth-child(11) { width: 10%; }
    th:nth-child(12) { width: 7%; }

    td {
      padding: 0.75rem;
      border-bottom: 1px solid var(--theme-border-gray-light);
      vertical-align: middle;
      word-wrap: break-word;
    }

    tbody tr:hover {
      background: var(--theme-bg-app);
    }

    .node-name {
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-dark);
    }

    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      white-space: nowrap;
      vertical-align: middle;
    }

    .status-ready {
      background: #dcfce7;
      color: #166534;
    }

    .status-notready {
      background: #fee2e2;
      color: #991b1b;
    }

    .status-unknown {
      background: var(--theme-bg-app);
      color: var(--theme-text-gray);
    }

    .type-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      background: #e0e7ff;
      color: #3730a3;
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
    }

    .type-badge.control-plane {
      background: #fef3c7;
      color: #92400e;
    }

    .metric-cell {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      width: 100%;
      align-items: flex-start;
      justify-content: center;
    }

    .metric-cell > span {
      display: block;
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-dark);
      line-height: 1.4;
      font-size: var(--theme-font-body);
    }

    .metric-bar {
      width: 100%;
      height: 4px;
      background: var(--theme-border-gray);
      border-radius: 2px;
      overflow: hidden;
    }

    .metric-fill {
      height: 100%;
      background: #10b981;
      transition: width 0.3s ease;
    }

    .metric-fill.warning {
      background: #f59e0b;
    }

    .metric-fill.critical {
      background: #ef4444;
    }

    .text-muted {
      color: var(--theme-text-gray);
    }

    .warning {
      color: #f59e0b;
    }

    .critical {
      color: #ef4444;
    }

    .nodes-section {
      margin-top: 0;
    }

    .nodes-table-skeleton {
      overflow-x: auto;
      overflow-y: hidden;
    }

    .table-skeleton-bar {
      display: inline-block;
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--theme-skeleton-base) 25%, var(--theme-skeleton-highlight) 50%, var(--theme-skeleton-base) 75%);
      background-size: 200% 100%;
      animation: node-table-skeleton-shimmer 1.3s ease-in-out infinite;
    }

    .table-skeleton-wide {
      width: 140px;
    }

    .table-skeleton-badge {
      width: 84px;
    }

    .table-skeleton-cell {
      width: 72px;
    }

    @keyframes node-table-skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }

    .nodes-toolbar {
      display: flex;
      justify-content: flex-start;
      margin-bottom: 0.75rem;
    }

    .btn-view-metrics {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      border: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      border-radius: 8px;
      padding: 0.45rem 0.75rem;
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      transition: all 0.18s ease;
    }

    .btn-view-metrics:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }

    .btn-view-metrics i {
      color: var(--theme-text-teal);
    }

    .metrics-time-filter {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: var(--theme-bg-surface);
      border-radius: 10px;
      border: 1px solid var(--theme-border-gray-light);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    .metrics-time-filter .filter-bar {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      justify-content: flex-end;
      gap: 0.75rem 1rem;
    }
    .metrics-time-filter .filter-dates {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
    }
    .metrics-time-filter .filter-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .metrics-time-filter .filter-field label {
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .metrics-time-filter .input-wrap {
      position: relative;
      display: inline-block;
    }
    .metrics-time-filter .filter-field input {
      padding: 0.4rem 1.75rem 0.4rem 0.5rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      font-size: var(--theme-font-table-header);
      width: 160px;
      max-width: 100%;
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
      transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
    }
    .metrics-time-filter .filter-field input:hover:not(:disabled) {
      background: var(--theme-bg-surface);
      border-color: var(--theme-border-gray);
    }
    .metrics-time-filter .filter-field input:focus {
      outline: none;
      border-color: var(--theme-button-primary);
      background: var(--theme-bg-surface);
      box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.2);
    }
    .metrics-time-filter .filter-field input:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .metrics-time-filter .filter-field .filter-icon {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--theme-text-gray);
      pointer-events: none;
      font-size: var(--theme-font-caption);
    }
    .metrics-time-filter .filter-divider {
      width: 1px;
      height: 1.75rem;
      background: var(--theme-bg-teal-lighter);
      flex-shrink: 0;
    }
    .metrics-time-filter .filter-duration {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .metrics-time-filter .filter-duration .duration-label {
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .metrics-time-filter .filter-duration .duration-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.35rem 0.65rem;
      background: var(--theme-bg-app);
      border-radius: 6px;
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-table-header-color);
      border: 1px solid var(--theme-border-gray-light);
    }
    .metrics-time-filter .filter-duration .duration-pill i {
      color: var(--theme-text-teal);
      font-size: var(--theme-font-caption);
    }
    .metrics-time-filter .filter-presets {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.25rem;
    }
    .metrics-time-filter .presets-label {
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .metrics-time-filter .preset-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .metrics-time-filter .preset-btn {
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      background: var(--theme-bg-app);
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-body-weight);
      cursor: pointer;
      color: var(--theme-table-header-color);
      transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease, transform 0.08s ease;
    }
    .metrics-time-filter .preset-btn:hover:not(:disabled) {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
      color: var(--theme-table-header-color);
    }
    .metrics-time-filter .preset-btn:active:not(:disabled) {
      transform: scale(0.97);
    }
    .metrics-time-filter .preset-btn.active {
      background: var(--theme-button-primary);
      border-color: var(--theme-button-primary);
      color: #fff;
      box-shadow: 0 1px 2px rgba(147, 41, 154, 0.25);
    }
    .metrics-time-filter .preset-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    @media (max-width: 768px) {
      .metrics-time-filter .filter-bar {
        flex-direction: column;
        align-items: stretch;
        justify-content: flex-start;
      }
      .metrics-time-filter .filter-dates {
        flex-direction: column;
        align-items: stretch;
      }
      .metrics-time-filter .filter-field input {
        width: 100%;
      }
      .metrics-time-filter .filter-divider {
        width: 100%;
        height: 1px;
      }
    }

    .metrics-loader {
      margin-top: 1.5rem;
      padding: 3rem 2rem;
      background: var(--theme-bg-app);
      border-radius: 12px;
      border: 1px solid var(--theme-border-gray-light);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      min-height: 280px;
    }
    .metrics-loader-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid var(--theme-border-gray-light);
      border-top-color: var(--theme-button-primary);
      border-radius: 50%;
      animation: metrics-spin 0.8s linear infinite;
    }
    @keyframes metrics-spin {
      to { transform: rotate(360deg); }
    }
    .metrics-loader-text {
      margin: 0;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-table-header-color);
    }
    .metrics-loader-hint {
      margin: 0;
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
    }

    .prometheus-charts-empty {
      margin-top: 1.5rem;
      padding: 2rem;
      text-align: center;
      background: var(--theme-bg-app);
      border-radius: 12px;
      border: 1px solid var(--theme-border-gray-light);
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
    }

    .prometheus-charts {
      margin-top: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .prometheus-chart-block {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      padding: 1rem;
      border: 1px solid var(--theme-border-gray);
    }

    .prometheus-chart-block .chart-title {
      margin: 0 0 0.75rem 0;
      font-size: var(--theme-font-body);
      color: var(--theme-table-header-color);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .chart-wrap {
      min-height: 260px;
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
    }

    @media (max-width: 1024px) {
      .charts-row {
        grid-template-columns: 1fr;
      }

      .modal-container {
        max-height: 90vh;
      }
    }
  `]
})
export class ClusterHealthPanelComponent implements OnDestroy {
  isLoading = input<boolean>(false);
  showMetricsModal = signal(false);

  healthState = inject(HealthStateService);
  healthApi = inject(HealthApiService);
  auth = inject(AuthService);
  viewportScaleService = inject(ViewportScaleService);

  prometheusEnabled = this.auth.prometheusEnabled;

  /** Max lookback 30 days; no future dates. Used for metrics time range. */
  private static readonly MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

  readonly timePresets: { id: string; label: string; ms: number }[] = [
    { id: '1h', label: '1h', ms: 60 * 60 * 1000 },
    { id: '3h', label: '3h', ms: 3 * 60 * 60 * 1000 },
    { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
    { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
    { id: '15d', label: '15d', ms: 15 * 24 * 60 * 60 * 1000 },
    { id: '30d', label: '30d', ms: ClusterHealthPanelComponent.MAX_LOOKBACK_MS },
  ];

  /** End time for metrics (default: now). Never in the future. */
  metricsEnd = signal<Date>(new Date());
  /** Start time for metrics (default: 1 hour ago). */
  metricsStart = signal<Date>(new Date(Date.now() - 60 * 60 * 1000));
  /** Active preset id or empty when range is custom. */
  activePreset = signal<string>('1h');

  prometheusMetrics = signal<NodePrometheusMetricsCurrentResponse | null>(null);
  diskSeries = signal<NodePrometheusMetricsTimeSeriesResponse[] | null>(null);
  diskSeriesLoading = signal(false);
  nodeFilterMode = signal<'top' | 'list'>('top');
  topNodeLimit = signal<number>(3);
  selectedTopMetrics = signal<Array<'cpu' | 'memory' | 'disk'>>(['cpu', 'memory', 'disk']);
  selectedNodeNames = signal<string[]>([]);
  prometheusNodeOptions = computed(() => {
    const series = this.diskSeries() ?? [];
    return Array.from(new Set(series.map(s => s.nodeName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  });
  
  /** Format Date for datetime-local input (local time). */
  private dateToInputValue(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day}T${h}:${min}`;
  }

  metricsStartInputValue = computed(() => this.dateToInputValue(this.metricsStart()));
  metricsEndInputValue = computed(() => this.dateToInputValue(this.metricsEnd()));

  private nowCeiledToMinute(): Date {
    const n = new Date();
    n.setSeconds(0, 0);
    return n;
  }

  /** Min start = end - 30 days; max start = end. */
  metricsStartMin = computed(() => {
    const end = this.metricsEnd();
    const minStart = new Date(end.getTime() - ClusterHealthPanelComponent.MAX_LOOKBACK_MS);
    return this.dateToInputValue(minStart);
  });
  metricsStartMax = computed(() => this.dateToInputValue(this.metricsEnd()));

  /** End: min = start; max = now (no future). */
  metricsEndMin = computed(() => this.dateToInputValue(this.metricsStart()));
  metricsEndMax = computed(() => this.dateToInputValue(this.nowCeiledToMinute()));
  metricsModalMaxHeight = computed(() => {
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const visibleHeight = viewportHeight / scale;
    const maxHeight = Math.min((94 * baseHeight) / 100, visibleHeight * 0.94);
    return `${maxHeight}px`;
  });

  selectedDurationLabel = computed(() => {
    const start = this.metricsStart().getTime();
    const end = this.metricsEnd().getTime();
    const ms = Math.max(0, end - start);
    if (ms < 60 * 1000) return '< 1 min';
    if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))} min`;
    if (ms < 24 * 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)} hours`;
    const days = ms / (24 * 60 * 60 * 1000);
    return `${days.toFixed(1)} day${days !== 1 ? 's' : ''}`;
  });

  /** Active preset id: explicit selection or preset that matches current range (for highlight). */
  activePresetId = computed(() => {
    const explicit = this.activePreset();
    if (explicit) return explicit;
    const start = this.metricsStart().getTime();
    const end = this.metricsEnd().getTime();
    const ms = Math.max(0, end - start);
    const match = this.timePresets.find((p) => Math.abs(p.ms - ms) < 60 * 1000);
    return match?.id ?? '';
  });

  setTimePreset(presetId: string): void {
    const preset = this.timePresets.find((p) => p.id === presetId);
    if (!preset) return;
    const now = this.nowCeiledToMinute();
    const start = new Date(Math.max(now.getTime() - preset.ms, now.getTime() - ClusterHealthPanelComponent.MAX_LOOKBACK_MS));
    this.metricsEnd.set(now);
    this.metricsStart.set(start);
    this.activePreset.set(presetId);
    this.loadPrometheusData();
  }

  onMetricsStartChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input?.value;
    if (!value) return;
    const start = new Date(value);
    if (Number.isNaN(start.getTime())) return;
    const end = this.metricsEnd();
    const maxStart = end.getTime();
    const minStart = end.getTime() - ClusterHealthPanelComponent.MAX_LOOKBACK_MS;
    const clamped = new Date(Math.min(maxStart, Math.max(minStart, start.getTime())));
    this.metricsStart.set(clamped);
    this.activePreset.set('');
    this.loadPrometheusData();
  }

  onMetricsEndChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input?.value;
    if (!value) return;
    let end = new Date(value);
    if (Number.isNaN(end.getTime())) return;
    const now = this.nowCeiledToMinute();
    if (end.getTime() > now.getTime()) end = now;
    const start = this.metricsStart();
    if (end.getTime() < start.getTime()) end = new Date(start.getTime());
    const minStart = end.getTime() - ClusterHealthPanelComponent.MAX_LOOKBACK_MS;
    if (start.getTime() < minStart) this.metricsStart.set(new Date(minStart));
    this.metricsEnd.set(end);
    this.activePreset.set('');
    this.loadPrometheusData();
  }

  openMetricsModal(): void {
    if (!this.prometheusEnabled()) {
      return;
    }
    this.showMetricsModal.set(true);
    this.loadPrometheusData();
  }

  closeMetricsModal(): void {
    this.showMetricsModal.set(false);
  }

  private loadPrometheusData(): void {
    this.diskSeriesLoading.set(true);
    const start = this.metricsStart();
    const end = this.metricsEnd();
    const rangeMs = end.getTime() - start.getTime();
    let step = '60s';
    if (rangeMs > 30 * 24 * 60 * 60 * 1000) step = '1h';
    else if (rangeMs > 7 * 24 * 60 * 60 * 1000) step = '15m';
    else if (rangeMs > 24 * 60 * 60 * 1000) step = '5m';
    forkJoin({
      prometheus: this.healthApi.getNodeMetricsCurrentFromPrometheus().pipe(
        catchError(() => of({ nodes: [], timestamp: undefined }))
      ),
      diskSeries: this.healthApi.getNodeMetricsSeriesFromPrometheus({
        start: start.toISOString(),
        end: end.toISOString(),
        step,
      }).pipe(catchError(() => of([]))),
    }).subscribe({
      next: ({ prometheus, diskSeries }) => {
        this.prometheusMetrics.set(prometheus.nodes?.length ? prometheus : null);
        this.diskSeries.set(diskSeries?.length ? diskSeries : null);
        if (this.nodeFilterMode() === 'list') {
          this.ensureDefaultNodeListSelection();
        }
        this.diskSeriesLoading.set(false);
      },
      error: () => {
        this.prometheusMetrics.set(null);
        this.diskSeries.set(null);
        this.diskSeriesLoading.set(false);
      },
    });
  }

  cpuChartOption = computed((): EChartsOption => this.buildMetricChartOption('Cpu', 'CPU %'));
  memoryChartOption = computed((): EChartsOption => this.buildMetricChartOption('Memory', 'Memory %'));
  diskChartOption = computed((): EChartsOption => this.buildMetricChartOption('Disk', 'Disk %'));

  onNodeFilterModeChange(mode: 'top' | 'list'): void {
    this.nodeFilterMode.set(mode);
    if (mode === 'list') {
      this.ensureDefaultNodeListSelection();
    }
  }

  onTopNodeLimitChange(value: number): void {
    if (value > 0 && Number.isFinite(value)) {
      this.topNodeLimit.set(Math.floor(value));
    }
  }

  onSelectedTopMetricsChange(metrics: Array<'cpu' | 'memory' | 'disk'>): void {
    const unique = Array.from(new Set(metrics));
    this.selectedTopMetrics.set(unique);
  }

  onSelectedNodeNamesChange(nodeNames: string[]): void {
    this.selectedNodeNames.set([...nodeNames]);
    if (this.nodeFilterMode() === 'list' && nodeNames.length === 0) {
      this.ensureDefaultNodeListSelection();
    }
  }

  private ensureDefaultNodeListSelection(): void {
    const current = this.selectedNodeNames();
    if (current.length > 0) {
      return;
    }
    const defaults = this.prometheusNodeOptions().slice(0, 3);
    if (defaults.length > 0) {
      this.selectedNodeNames.set(defaults);
    }
  }

  private buildMetricChartOption(metricType: string, yAxisName: string): EChartsOption {
    const data = this.diskSeries();
    if (!data?.length) return {};
    const nodeHealth = this.healthState.nodeHealth();
    const nodeNameToType = new Map<string, string>();
    if (nodeHealth?.nodes?.length) {
      for (const n of nodeHealth.nodes) {
        nodeNameToType.set(n.name, n.type ?? n.name);
        if (n.name.toLowerCase() !== n.name) nodeNameToType.set(n.name.toLowerCase(), n.type ?? n.name);
      }
    }
    const colors = ['#007bff', '#10b981', '#f59e0b', '#ef4444', '#a13e97', '#ec4899'];
    const selectedNodes = new Set(this.selectedNodeNames().map(n => n.toLowerCase()));
    let rankedSeries = data.map((node) => {
      const metric = node.series.find((s) => s.metricType === metricType);
      const points = (metric?.dataPoints ?? []).map((dp) => [
        this.parseTimestamp(dp.timestamp),
        Math.round(dp.value * 100) / 100,
      ]);
      const latestValue = points.length > 0 ? Number(points[points.length - 1][1]) : Number.NaN;
      return { nodeName: node.nodeName, points, latestValue };
    }).filter((s) => s.points.length > 0 && !Number.isNaN(s.latestValue))
      .sort((a, b) => b.latestValue - a.latestValue);

    if (this.nodeFilterMode() === 'list') {
      if (selectedNodes.size > 0) {
        rankedSeries = rankedSeries.filter(s => selectedNodes.has(s.nodeName.toLowerCase()));
      } else {
        const fallback = new Set(this.prometheusNodeOptions().slice(0, 3).map(n => n.toLowerCase()));
        rankedSeries = rankedSeries.filter(s => fallback.has(s.nodeName.toLowerCase()));
      }
    } else {
      // Top-n mode: rank by composite load (average CPU/Memory/Disk over selected time range).
      const topNames = this.getTopNodeNamesByCompositeLoad(this.topNodeLimit(), this.selectedTopMetrics());
      const topNamesSet = new Set(topNames.map(n => n.toLowerCase()));
      const topIndex = new Map(topNames.map((name, idx) => [name.toLowerCase(), idx]));

      rankedSeries = rankedSeries
        .filter(s => topNamesSet.has(s.nodeName.toLowerCase()))
        .sort((a, b) => {
          const aIdx = topIndex.get(a.nodeName.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
          const bIdx = topIndex.get(b.nodeName.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
          return aIdx - bIdx;
        });
    }

    const series = rankedSeries.map((node, idx) => {
      return {
        name: node.nodeName,
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        data: node.points,
        lineStyle: { width: 2 },
        itemStyle: { color: colors[idx % colors.length] },
      };
    });
    if (series.length === 0) return {};
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params : [];
          const lines = (p as { seriesName: string; value: [number, number] }[]).map((x) => {
            const label = nodeNameToType.get(x.seriesName) ?? nodeNameToType.get(x.seriesName.toLowerCase()) ?? x.seriesName;
            return `${label}: ${Number(x.value[1]).toFixed(1)}%`;
          });
          const time = p[0] && typeof (p[0] as { value: [number, number] }).value?.[0] === 'number'
            ? new Date((p[0] as { value: [number, number] }).value[0]).toLocaleString()
            : '';
          return time + '<br/>' + lines.join('<br/>');
        },
      },
      legend: {
        type: 'scroll',
        bottom: '0%',
        left: 'center',
        tooltip: {
          show: true,
          formatter: (params: { name?: string }) => {
            const name = params?.name ?? '';
            return nodeNameToType.get(name) ?? nodeNameToType.get(name.toLowerCase()) ?? name;
          }
        }
      },
      grid: { left: '3%', right: '4%', bottom: '18%', top: '10%', containLabel: true },
      xAxis: { type: 'time', axisLabel: { formatter: '{HH}:{mm}' } },
      yAxis: { type: 'value', name: yAxisName, min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
      series,
    };
  }

  private parseTimestamp(ts: string): number {
    const ms = Date.parse(ts);
    return Number.isNaN(ms) ? 0 : ms;
  }

  private getMetricAverage(
    node: NodePrometheusMetricsTimeSeriesResponse,
    metricType: 'Cpu' | 'Memory' | 'Disk'
  ): number | null {
    const metric = node.series.find(s => s.metricType === metricType);
    const values = (metric?.dataPoints ?? [])
      .map(dp => Number(dp.value))
      .filter(v => Number.isFinite(v));

    if (values.length === 0) {
      return null;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    return total / values.length;
  }

  private getTopNodeNamesByCompositeLoad(limit: number, selectedMetrics: Array<'cpu' | 'memory' | 'disk'>): string[] {
    const data = this.diskSeries() ?? [];
    if (!data.length || limit <= 0) {
      return [];
    }

    const metricsToUse: Array<'cpu' | 'memory' | 'disk'> = selectedMetrics.length > 0
      ? selectedMetrics
      : ['cpu', 'memory', 'disk'];
    const toMetricType = (metric: 'cpu' | 'memory' | 'disk'): 'Cpu' | 'Memory' | 'Disk' => {
      if (metric === 'cpu') return 'Cpu';
      if (metric === 'memory') return 'Memory';
      return 'Disk';
    };
    const metricTypes = metricsToUse.map(toMetricType);

    return data
      .map(node => {
        const averages = metricTypes
          .map(metricType => this.getMetricAverage(node, metricType))
          .filter((value): value is number => value !== null);

        if (averages.length === 0) {
          return null;
        }

        const loadScore = averages.reduce((sum, value) => sum + value, 0) / averages.length;
        return {
          nodeName: node.nodeName,
          loadScore
        };
      })
      .filter((entry): entry is { nodeName: string; loadScore: number } => entry !== null)
      .sort((a, b) => b.loadScore - a.loadScore)
      .slice(0, limit)
      .map(entry => entry.nodeName);
  }

  ngOnDestroy(): void {}

}

