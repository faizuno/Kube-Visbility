import { Component, inject, signal, computed, OnInit, AfterViewInit, OnDestroy, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { HeaderComponent } from '../../layout/header/header.component';
import { AuthService } from '../../core/services/auth.service';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';
import { HealthApiService } from '../health-dashboard/services/health-api.service';
import { ViewportScaleService } from '../../core/services/viewport-scale.service';
import type {
  NodeHealthResponse,
  NodePrometheusMetricsCurrentResponse,
  NodePrometheusMetricsTimeSeriesResponse,
} from '../health-dashboard/models/health.models';
import { LoadingSkeletonComponent } from '../../shared/components/loading-skeleton/loading-skeleton.component';
import { NodesHealthTableComponent } from '../../shared/components/nodes-health-table/nodes-health-table.component';
import { NodesPrometheusMetricsComponent } from '../../shared/components/nodes-prometheus-metrics/nodes-prometheus-metrics.component';
import type { EChartsOption } from 'echarts';

@Component({
  selector: 'app-nodes',
  standalone: true,
  imports: [CommonModule, RouterLink, HeaderComponent, LoadingSkeletonComponent, NodesHealthTableComponent, NodesPrometheusMetricsComponent],
  template: `
    <div class="nodes-container">
      <app-header
        [headerMode]="'standard'"
        [currentView]="'scanning'"
        [healthFilter]="[]"
        [showHealthFilter]="false"
        [showSearch]="false"
        [autoRefreshEnabled]="autoRefreshEnabled()"
        [autoRefreshInterval]="autoRefreshInterval()"
        [externalIsRefreshing]="isRefreshing()"
        (searchChange)="noop()"
        (viewChange)="noop()"
        (healthFilterChange)="noop()"
        (autoRefreshEnabledChange)="onAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onAutoRefreshIntervalChange($event)"
        (refreshClick)="refreshNodesContext()"
      />
      <div class="view-container">
        @if (!prometheusEnabled()) {
          <div class="empty-state prometheus-disabled">
            <i class="fas fa-chart-line"></i>
            <h2>Nodes monitoring is not available</h2>
            <p>Prometheus-backed node metrics are disabled for this environment.</p>
            <a routerLink="/" class="back-link"><i class="fas fa-arrow-left"></i> Back to Dashboard</a>
          </div>
        } @else {
          <div class="nodes-content">
            <div class="nodes-header">
              <a routerLink="/" class="back-link"><i class="fas fa-arrow-left"></i> Dashboard</a>
              <h1><i class="fas fa-server"></i> Nodes monitoring</h1>
            </div>
            <div class="nodes-body" [ngStyle]="containerHeightStyle()">
            @if (loading()) {
              <div class="panel-loading">
                <app-loading-skeleton [count]="8" />
              </div>
            } @else if (error()) {
              <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <p>{{ error() }}</p>
                <button type="button" class="btn-retry" (click)="loadNodes()">Try Again</button>
              </div>
            } @else if (nodeHealth()) {
              <app-nodes-health-table
                [nodeHealth]="nodeHealth()"
                [prometheusEnabled]="prometheusEnabled()"
                [prometheusMetrics]="prometheusMetrics()"
                [showDiskColumn]="true"
                [showMetricBars]="false"
              />
              <app-nodes-prometheus-metrics
                [prometheusEnabled]="prometheusEnabled()"
                [showTimeFilter]="true"
                [loading]="diskSeriesLoading()"
                [hasSeries]="!!diskSeries()?.length"
                [chartHeight]="'280px'"
                [cpuChartOption]="cpuChartOption()"
                [memoryChartOption]="memoryChartOption()"
                [diskChartOption]="diskChartOption()"
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
              />
            } @else {
              <div class="empty-state">No node data available.</div>
            }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .nodes-container { width: 100%; background: #f5f5f5; padding: 0 1rem; padding-bottom: 0; }
    .view-container { padding: 1rem 0; max-width: 100%; }
    .nodes-content { width: 100%; }
    .nodes-header { margin-bottom: 1rem; }
    .nodes-body {
      width: var(--base-viewport-width);
      padding-right: 1.5rem;
      position: fixed;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--theme-border-gray) transparent;
    }
    .empty-state, .error-state {
      text-align: center; padding: 3rem 2rem; background: var(--theme-bg-surface); border-radius: 12px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .empty-state.prometheus-disabled { max-width: 480px; margin: 2rem auto; }
    .empty-state i, .error-state i { font-size: var(--theme-font-page-title); color: var(--theme-text-gray); margin-bottom: 1rem; }
    .empty-state h2, .error-state p { margin: 0.5rem 0; color: var(--theme-table-header-color); }
    .back-link {
      display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 1rem;
      color: var(--theme-text-teal); text-decoration: none; font-weight: var(--theme-font-table-body-weight);
    }
    .back-link:hover { text-decoration: underline; }
    .nodes-header .back-link { margin-bottom: 0.5rem; }
    .nodes-header h1 { margin: 0; font-size: var(--theme-font-page-title); color: var(--theme-text-dark); display: flex; align-items: center; gap: 0.5rem; }
    .panel-loading { padding: 1.5rem; background: var(--theme-bg-surface); border-radius: 8px; }
    .error-state .btn-retry { margin-top: 1rem; padding: 0.5rem 1rem; background: var(--theme-button-primary); color: white; border: none; border-radius: 6px; cursor: pointer; }
    .table-wrapper { overflow-x: auto; border-radius: 8px; border: 1px solid var(--theme-border-gray); background: var(--theme-bg-surface); }
    table { width: 100%; border-collapse: collapse; font-size: var(--theme-font-body); }
    thead { background: var(--theme-bg-app); position: sticky; top: 0; }
    th { padding: 0.75rem; text-align: left; font-weight: var(--theme-font-table-header-weight); color: var(--theme-table-header-color); border-bottom: 2px solid var(--theme-border-gray-light); }
    td { padding: 0.75rem; border-bottom: 1px solid var(--theme-border-gray-light); }
    tbody tr:hover { background: var(--theme-bg-app); }
    .node-name { font-weight: var(--theme-font-table-body-weight); color: var(--theme-text-dark); }
    .status-badge { display: inline-block; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .status-ready { background: #dcfce7; color: #166534; }
    .status-notready { background: #fee2e2; color: #991b1b; }
    .status-unknown { background: var(--theme-bg-app); color: var(--theme-text-gray); }
    .type-badge { display: inline-block; padding: 0.25rem 0.5rem; background: #e0e7ff; color: #3730a3; border-radius: 4px; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .type-badge.control-plane { background: #fef3c7; color: #92400e; }
    .text-muted { color: var(--theme-text-gray); }
    .warning { color: #f59e0b; }
    .critical { color: #ef4444; }
    .charts-row { margin-top: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
    .charts-row .chart-section { width: 100%; }
    .chart-section { background: var(--theme-bg-surface); border-radius: 8px; border: 1px solid var(--theme-border-gray); padding: 1rem; }
    .chart-title { margin: 0 0 0.75rem 0; font-size: var(--theme-font-section-title); color: var(--theme-table-header-color); display: flex; align-items: center; gap: 0.5rem; }
    .chart-wrapper { min-height: 280px; }
    .chart-skeleton { padding: 1rem; min-height: 120px; }
  `],
})
export class NodesComponent implements OnInit, AfterViewInit, OnDestroy {
  private auth = inject(AuthService);
  private refreshPreferences = inject(RefreshPreferencesService);
  private healthApi = inject(HealthApiService);
  private viewportScaleService = inject(ViewportScaleService);
  private platformId = inject(PLATFORM_ID);

  prometheusEnabled = this.auth.prometheusEnabled;
  nodeHealth = signal<NodeHealthResponse | null>(null);
  prometheusMetrics = signal<NodePrometheusMetricsCurrentResponse | null>(null);
  diskSeries = signal<NodePrometheusMetricsTimeSeriesResponse[] | null>(null);
  diskSeriesLoading = signal(false);
  isRefreshing = signal(false);
  autoRefreshEnabled = this.refreshPreferences.autoRefreshEnabled;
  autoRefreshInterval = this.refreshPreferences.autoRefreshInterval;
  loading = signal(true);
  error = signal<string | null>(null);
  private static readonly MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
  readonly timePresets: { id: string; label: string; ms: number }[] = [
    { id: '1h', label: '1h', ms: 60 * 60 * 1000 },
    { id: '3h', label: '3h', ms: 3 * 60 * 60 * 1000 },
    { id: '24h', label: '24h', ms: 24 * 60 * 60 * 1000 },
    { id: '7d', label: '7d', ms: 7 * 24 * 60 * 60 * 1000 },
    { id: '15d', label: '15d', ms: 15 * 24 * 60 * 60 * 1000 },
    { id: '30d', label: '30d', ms: NodesComponent.MAX_LOOKBACK_MS },
  ];
  metricsEnd = signal<Date>(new Date());
  metricsStart = signal<Date>(new Date(Date.now() - 60 * 60 * 1000));
  activePreset = signal<string>('1h');

  private componentOffsetTop = signal<number>(0);
  private autoRefreshTimer?: number;
  private isAutoRefreshActive = false;

  containerHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const offsetTop = this.componentOffsetTop();
    const availableHeight = Math.max(baseHeight - offsetTop, 300);
    return { height: `${availableHeight}px` };
  });

  ngOnInit(): void {
    if (this.prometheusEnabled()) {
      this.refreshNodesContext();
      this.setupAutoRefresh();
    } else {
      this.loading.set(false);
    }
  }

  ngAfterViewInit(): void {
    this.calculateComponentOffset();
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', this.handleResize);
    }
  }

  ngOnDestroy(): void {
    this.clearAutoRefresh();
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.handleResize);
    }
  }

  private handleResize = (): void => {
    this.calculateComponentOffset();
  };

  private calculateComponentOffset(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    setTimeout(() => {
      const element = document.querySelector('.nodes-body');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        this.componentOffsetTop.set(rect.top / scale);
      }
    }, 0);
  }

  /** No-op for header outputs the nodes page does not use. */
  noop(): void {}

  onAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    if (enabled) {
      this.setupAutoRefresh();
    } else {
      this.clearAutoRefresh();
    }
  }

  onAutoRefreshIntervalChange(interval: number): void {
    this.refreshPreferences.setAutoRefreshInterval(interval);
    this.clearAutoRefresh();
    this.setupAutoRefresh();
  }

  async refreshNodesContext(): Promise<void> {
    if (!this.prometheusEnabled() || this.isRefreshing()) {
      return;
    }

    this.isRefreshing.set(true);
    try {
      await Promise.all([this.loadNodes(), this.loadPrometheusData()]);
    } finally {
      this.isRefreshing.set(false);
    }
  }

  loadNodes(): Promise<void> {
    if (!this.prometheusEnabled()) return Promise.resolve();
    this.loading.set(true);
    this.error.set(null);
    return new Promise((resolve) => {
      this.healthApi.getNodeHealth().subscribe({
        next: (nodeHealth) => {
          this.nodeHealth.set(nodeHealth);
          this.loading.set(false);
          resolve();
        },
        error: (err) => {
          this.error.set(err?.message || 'Failed to load node health');
          this.loading.set(false);
          resolve();
        },
      });
    });
  }

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

  metricsStartMin = computed(() => this.dateToInputValue(new Date(this.metricsEnd().getTime() - NodesComponent.MAX_LOOKBACK_MS)));
  metricsStartMax = computed(() => this.dateToInputValue(this.metricsEnd()));
  metricsEndMin = computed(() => this.dateToInputValue(this.metricsStart()));
  metricsEndMax = computed(() => this.dateToInputValue(this.nowCeiledToMinute()));

  selectedDurationLabel = computed(() => {
    const ms = Math.max(0, this.metricsEnd().getTime() - this.metricsStart().getTime());
    if (ms < 60 * 1000) return '< 1 min';
    if (ms < 60 * 60 * 1000) return `${Math.round(ms / (60 * 1000))} min`;
    if (ms < 24 * 60 * 60 * 1000) return `${(ms / (60 * 60 * 1000)).toFixed(1)} hours`;
    const days = ms / (24 * 60 * 60 * 1000);
    return `${days.toFixed(1)} day${days !== 1 ? 's' : ''}`;
  });

  activePresetId = computed(() => {
    const explicit = this.activePreset();
    if (explicit) return explicit;
    const ms = Math.max(0, this.metricsEnd().getTime() - this.metricsStart().getTime());
    const match = this.timePresets.find((p) => Math.abs(p.ms - ms) < 60 * 1000);
    return match?.id ?? '';
  });

  setTimePreset(presetId: string): void {
    const preset = this.timePresets.find((p) => p.id === presetId);
    if (!preset) return;
    const now = this.nowCeiledToMinute();
    const start = new Date(Math.max(now.getTime() - preset.ms, now.getTime() - NodesComponent.MAX_LOOKBACK_MS));
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
    const minStart = end.getTime() - NodesComponent.MAX_LOOKBACK_MS;
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
    const minStart = end.getTime() - NodesComponent.MAX_LOOKBACK_MS;
    if (start.getTime() < minStart) this.metricsStart.set(new Date(minStart));
    this.metricsEnd.set(end);
    this.activePreset.set('');
    this.loadPrometheusData();
  }

  private loadPrometheusData(): Promise<void> {
    this.diskSeriesLoading.set(true);
    const start = this.metricsStart();
    const end = this.metricsEnd();
    const rangeMs = end.getTime() - start.getTime();
    let step = '60s';
    if (rangeMs > 30 * 24 * 60 * 60 * 1000) step = '1h';
    else if (rangeMs > 7 * 24 * 60 * 60 * 1000) step = '15m';
    else if (rangeMs > 24 * 60 * 60 * 1000) step = '5m';

    return new Promise((resolve) => {
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
          this.diskSeriesLoading.set(false);
          resolve();
        },
        error: () => {
          this.prometheusMetrics.set(null);
          this.diskSeries.set(null);
          this.diskSeriesLoading.set(false);
          resolve();
        },
      });
    });
  }

  private setupAutoRefresh(): void {
    this.clearAutoRefresh();

    if (!this.prometheusEnabled() || !this.autoRefreshEnabled() || this.autoRefreshInterval() <= 0) {
      return;
    }

    this.isAutoRefreshActive = true;
    this.scheduleNextRefresh(this.autoRefreshInterval());
  }

  private scheduleNextRefresh(intervalSeconds: number): void {
    if (!this.isAutoRefreshActive) {
      return;
    }

    this.autoRefreshTimer = window.setTimeout(async () => {
      if (!this.isAutoRefreshActive) {
        return;
      }

      await this.refreshNodesContext();

      if (this.isAutoRefreshActive) {
        this.scheduleNextRefresh(intervalSeconds);
      }
    }, intervalSeconds * 1000);
  }

  private clearAutoRefresh(): void {
    this.isAutoRefreshActive = false;
    if (this.autoRefreshTimer) {
      clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
  }

  /** ECharts option for CPU usage time series (one line per node). */
  cpuChartOption = computed((): EChartsOption => this.buildMetricChartOption('Cpu', 'CPU %'));

  /** ECharts option for Memory usage time series (one line per node). */
  memoryChartOption = computed((): EChartsOption => this.buildMetricChartOption('Memory', 'Memory %'));

  /** ECharts option for disk usage time series (one line per node). */
  diskChartOption = computed((): EChartsOption => this.buildMetricChartOption('Disk', 'Disk %'));

  private buildMetricChartOption(metricType: string, yAxisName: string): EChartsOption {
    const data = this.diskSeries();
    if (!data?.length) return {};
    const colors = ['#007bff', '#10b981', '#f59e0b', '#ef4444', '#a13e97', '#ec4899'];
    const series = data.map((node, idx) => {
      const metric = node.series.find((s) => s.metricType === metricType);
      const points = (metric?.dataPoints ?? []).map((dp) => [
        this.parseTimestamp(dp.timestamp),
        Math.round(dp.value * 100) / 100,
      ]);
      return {
        name: node.nodeName,
        type: 'line' as const,
        smooth: true,
        symbol: 'circle',
        symbolSize: 4,
        data: points,
        lineStyle: { width: 2 },
        itemStyle: { color: colors[idx % colors.length] },
      };
    }).filter((s) => s.data.length > 0);
    if (series.length === 0) return {};
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: unknown) => {
          const p = Array.isArray(params) ? params : [];
          const lines = (p as { seriesName: string; value: [number, number] }[]).map(
            (x) => `${x.seriesName}: ${Number(x.value[1]).toFixed(1)}%`
          );
          const time = p[0] && typeof (p[0] as { value: [number, number] }).value?.[0] === 'number'
            ? new Date((p[0] as { value: [number, number] }).value[0]).toLocaleString()
            : '';
          return time + '<br/>' + lines.join('<br/>');
        },
      },
      legend: { type: 'scroll', bottom: '0%', left: 'center' },
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

}
