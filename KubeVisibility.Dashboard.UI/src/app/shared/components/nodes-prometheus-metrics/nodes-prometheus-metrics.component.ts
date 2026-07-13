
import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';
import type { EChartsOption } from 'echarts';
import { EchartsWrapperComponent } from '../echarts-wrapper/echarts-wrapper.component';

@Component({
  selector: 'app-nodes-prometheus-metrics',
  standalone: true,
  imports: [EchartsWrapperComponent],
  template: `
    @if (prometheusEnabled) {
      @if (showTimeFilter) {
        <div class="metrics-time-filter">
          <div class="filter-bar">
            <div class="filter-left-group">
              <div class="filter-field compact-field mode-field">
                <label>Mode</label>
                <div class="mode-toggle" role="tablist" aria-label="Node filter mode">
                  <button
                    type="button"
                    class="mode-btn"
                    [class.active]="filterMode === 'top'"
                    (click)="setFilterMode('top')"
                    [disabled]="loading"
                  >
                    Top Nodes
                  </button>
                  <button
                    type="button"
                    class="mode-btn"
                    [class.active]="filterMode === 'list'"
                    (click)="setFilterMode('list')"
                    [disabled]="loading"
                  >
                    Node List
                  </button>
                </div>
              </div>

              @if (filterMode === 'top') {
                <div class="filter-field compact-field">
                  <label>Top</label>
                  <select
                  [value]="'' + topNodeLimit"
                    (change)="onTopNodeLimitChange($event)"
                    [disabled]="loading"
                  >
                    <option value="1">1</option>
                    <option value="3">3</option>
                    <option value="5">5</option>
                    <option value="10">10</option>
                  </select>
                </div>
                <div class="filter-field compact-field top-metrics-field">
                  <label>Top By</label>
                  <button
                    type="button"
                    class="nodes-dropdown-trigger"
                    (click)="toggleTopMetricsDropdown($event)"
                    [disabled]="loading"
                  >
                    <span>{{ selectedTopMetricsLabel() }}</span>
                    <i class="fas" [class.fa-chevron-down]="!topMetricsDropdownOpen()" [class.fa-chevron-up]="topMetricsDropdownOpen()"></i>
                  </button>
                  @if (topMetricsDropdownOpen()) {
                    <div class="nodes-dropdown" (click)="$event.stopPropagation()">
                      <label class="node-option node-option-all">
                        <input
                          type="checkbox"
                          [checked]="selectedTopMetrics.length === topMetricOptions.length"
                          (change)="setAllTopMetricsFromEvent($event)"
                        />
                        <span>All metrics</span>
                      </label>
                      @for (metric of topMetricOptions; track metric.value) {
                        <label class="node-option">
                          <input
                            type="checkbox"
                            [checked]="isTopMetricSelected(metric.value)"
                            (change)="toggleTopMetricSelection(metric.value)"
                          />
                          <span>{{ metric.label }}</span>
                        </label>
                      }
                    </div>
                  }
                </div>
              }
              @if (filterMode === 'list') {
                <div class="filter-field compact-field nodes-filter-field">
                  <label>Nodes</label>
                  <button
                    type="button"
                    class="nodes-dropdown-trigger"
                    (click)="toggleNodesDropdown($event)"
                    [disabled]="loading"
                  >
                    <span>{{ selectedNodesLabel() }}</span>
                    <i class="fas" [class.fa-chevron-down]="!nodesDropdownOpen()" [class.fa-chevron-up]="nodesDropdownOpen()"></i>
                  </button>
                  @if (nodesDropdownOpen()) {
                    <div class="nodes-dropdown" (click)="$event.stopPropagation()">
                      @for (node of nodeOptions; track node) {
                        <label class="node-option">
                          <input
                            type="checkbox"
                            [checked]="isNodeSelected(node)"
                            (change)="toggleNodeSelection(node)"
                          />
                          <span>{{ node }}</span>
                        </label>
                      }
                    </div>
                  }
                </div>
              }
            </div>

            <div class="group-separator" aria-hidden="true"></div>

            <div class="filter-right-group">
              <div class="filter-presets">
                <span class="presets-label">Range</span>
                <div class="preset-buttons">
                  @for (preset of timePresets; track preset.id) {
                    <button
                      type="button"
                      class="preset-btn"
                      [class.active]="activePresetId === preset.id"
                      (click)="timePresetChange.emit(preset.id)"
                      [disabled]="loading"
                    >
                      {{ preset.label }}
                    </button>
                  }
                </div>
              </div>
              <div class="filter-divider" aria-hidden="true"></div>
              <div class="filter-duration">
                <label class="duration-label">Duration</label>
                <span class="duration-pill">
                  <i class="fas fa-clock" aria-hidden="true"></i>
                  {{ selectedDurationLabel }}
                </span>
              </div>
              <div class="filter-divider" aria-hidden="true"></div>
              <div class="filter-dates">
                <div class="filter-field">
                  <label>Start</label>
                  <div class="input-wrap">
                    <input
                      type="datetime-local"
                      [value]="metricsStartInputValue"
                      [min]="metricsStartMin"
                      [max]="metricsStartMax"
                      (change)="metricsStartChange.emit($event)"
                      [disabled]="loading"
                    />
                    <i class="fas fa-calendar-alt filter-icon" aria-hidden="true"></i>
                  </div>
                </div>
                <div class="filter-field">
                  <label>End</label>
                  <div class="input-wrap">
                    <input
                      type="datetime-local"
                      [value]="metricsEndInputValue"
                      [min]="metricsEndMin"
                      [max]="metricsEndMax"
                      (change)="metricsEndChange.emit($event)"
                      [disabled]="loading"
                    />
                    <i class="fas fa-calendar-alt filter-icon" aria-hidden="true"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      }

      @if (loading) {
        <div class="metrics-selection-note">
          Loading node metrics for the selected range...
        </div>
        <div class="prometheus-charts">
          <div class="prometheus-chart-block">
            <h4 class="chart-title"><i class="fas fa-microchip"></i> CPU usage </h4>
            <div class="chart-wrap chart-wrap-skeleton">
              <div class="skeleton-line skeleton-line-primary"></div>
              <div class="skeleton-line skeleton-line-secondary"></div>
              <div class="skeleton-line skeleton-line-tertiary"></div>
            </div>
          </div>
          <div class="prometheus-chart-block">
            <h4 class="chart-title"><i class="fas fa-memory"></i> Memory usage </h4>
            <div class="chart-wrap chart-wrap-skeleton">
              <div class="skeleton-line skeleton-line-primary"></div>
              <div class="skeleton-line skeleton-line-secondary"></div>
              <div class="skeleton-line skeleton-line-tertiary"></div>
            </div>
          </div>
          <div class="prometheus-chart-block">
            <h4 class="chart-title"><i class="fas fa-hdd"></i> Disk usage </h4>
            <div class="chart-wrap chart-wrap-skeleton">
              <div class="skeleton-line skeleton-line-primary"></div>
              <div class="skeleton-line skeleton-line-secondary"></div>
              <div class="skeleton-line skeleton-line-tertiary"></div>
            </div>
          </div>
        </div>
      } @else if (hasSeries) {
        <div class="metrics-selection-note">
          @if (filterMode === 'list' && selectedNodeNames.length > 0) {
            Showing {{ selectedNodeNames.length }} selected node{{ selectedNodeNames.length !== 1 ? 's' : '' }}.
          } @else if (filterMode === 'list') {
            Showing all nodes.
          } @else {
            Showing Top {{ topNodeLimit }} node{{ topNodeLimit !== 1 ? 's' : '' }} by usage.
          }
        </div>
        <div class="prometheus-charts">
          <div class="prometheus-chart-block">
            <h4 class="chart-title"><i class="fas fa-microchip"></i> CPU usage </h4>
            <div class="chart-wrap">
              <app-echarts-wrapper [chartOption]="cpuChartOption" [height]="chartHeight" />
            </div>
          </div>
          <div class="prometheus-chart-block">
            <h4 class="chart-title"><i class="fas fa-memory"></i> Memory usage </h4>
            <div class="chart-wrap">
              <app-echarts-wrapper [chartOption]="memoryChartOption" [height]="chartHeight" />
            </div>
          </div>
          <div class="prometheus-chart-block">
            <h4 class="chart-title"><i class="fas fa-hdd"></i> Disk usage </h4>
            <div class="chart-wrap">
              <app-echarts-wrapper [chartOption]="diskChartOption" [height]="chartHeight" />
            </div>
          </div>
        </div>
      } @else {
        <div class="prometheus-charts-empty">
          <p>No metrics data for the selected range.</p>
        </div>
      }
    }
  `,
  styles: [`
    .metrics-time-filter {
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      background: var(--theme-bg-surface);
      border-radius: 10px;
      border: 1px solid var(--theme-border-gray-light);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    .filter-bar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: nowrap;
    }
    .filter-left-group,
    .filter-right-group {
      display: flex;
      align-items: flex-end;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .filter-right-group {
      margin-left: auto;
    }
    .group-separator {
      width: 1px;
      align-self: stretch;
      background: var(--theme-bg-teal-lighter);
      margin: 0 0.25rem;
    }
    .filter-dates {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
    }
    .filter-field { display: flex; flex-direction: column; gap: 0.25rem; }
    .filter-field label {
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .input-wrap { position: relative; display: inline-block; }
    .filter-field input {
      padding: 0.4rem 1.75rem 0.4rem 0.5rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      font-size: var(--theme-font-table-header);
      width: 160px;
      max-width: 100%;
      background: var(--theme-bg-app);
      color: var(--theme-text-dark);
    }
    .filter-field select {
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      font-size: var(--theme-font-table-header);
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
      min-width: 130px;
    }
    .filter-field.compact-field select {
      min-width: 140px;
    }
    .mode-toggle {
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      background: var(--theme-bg-app);
      overflow: hidden;
      height: 32px;
    }
    .mode-btn {
      border: none;
      background: transparent;
      padding: 0.3rem 0.55rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-table-header-color);
      cursor: pointer;
      height: 100%;
      white-space: nowrap;
    }
    .mode-btn + .mode-btn {
      border-left: 1px solid var(--theme-border-gray-light);
    }
    .mode-btn.active {
      background: var(--theme-button-primary);
      color: #fff;
      font-weight: var(--theme-font-table-header-weight);
    }
    .mode-btn:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .nodes-filter-field {
      position: relative;
    }
    .mode-field {
      position: relative;
    }
    .top-metrics-field {
      position: relative;
    }
    .nodes-dropdown-trigger {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.4rem;
      padding: 0.3rem 0.45rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      font-size: var(--theme-font-caption);
      line-height: 1.2;
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
      min-width: 170px;
      height: 32px;
      cursor: pointer;
      text-align: left;
    }
    .nodes-dropdown-trigger span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
    }
    .nodes-filter-field .nodes-dropdown-trigger {
      min-width: 140px;
      width: 140px;
    }
    .top-metrics-field .nodes-dropdown-trigger {
      min-width: 150px;
      width: 150px;
    }
    .nodes-dropdown-trigger:focus {
      outline: none;
      border-color: var(--theme-button-primary);
      background: var(--theme-bg-surface);
      box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.2);
    }
    .nodes-dropdown {
      position: absolute;
      top: calc(100% + 0.35rem);
      min-width: 200px;
      max-width: 280px;
      max-height: 220px;
      overflow-y: auto;
      background: var(--theme-bg-surface);
      border-radius: 8px;
      border: 1px solid var(--theme-border-gray-light);
      box-shadow: 0 8px 18px rgba(15, 23, 42, 0.14);
      padding: 0.25rem;
      z-index: 30;
    }
    .nodes-filter-field .nodes-dropdown {
      left: 0;
      right: auto;
      min-width: 180px;
      max-width: 220px;
    }
    .top-metrics-field .nodes-dropdown {
      left: 0;
      right: auto;
      min-width: 180px;
      max-width: 220px;
    }
    .node-option {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.25rem 0.4rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-table-header-color);
      cursor: pointer;
      border-radius: 4px;
      white-space: nowrap;
    }
    .node-option:hover {
      background: var(--theme-bg-app);
    }
    .node-option input {
      accent-color: var(--theme-button-primary);
      cursor: pointer;
      flex-shrink: 0;
      width: 12px;
      height: 12px;
    }
    .node-option-all {
      border-bottom: 1px solid var(--theme-border-gray-light);
      margin-bottom: 0.25rem;
      padding-bottom: 0.45rem;
      font-weight: var(--theme-font-table-header-weight);
    }
    .filter-field input:focus {
      outline: none;
      border-color: var(--theme-button-primary);
      background: var(--theme-bg-surface);
      box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.2);
    }
    .filter-field select:focus {
      outline: none;
      border-color: var(--theme-button-primary);
      background: var(--theme-bg-surface);
      box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.2);
    }
    .filter-icon {
      position: absolute;
      right: 0.5rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--theme-text-gray);
      pointer-events: none;
      font-size: var(--theme-font-caption);
    }
    .filter-divider {
      width: 1px;
      height: 1.75rem;
      background: var(--theme-bg-teal-lighter);
      flex-shrink: 0;
    }
    .filter-duration { display: flex; flex-direction: column; gap: 0.25rem; }
    .duration-label,
    .presets-label {
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .duration-pill {
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
    .duration-pill i { color: var(--theme-text-teal); font-size: var(--theme-font-caption); }
    .filter-presets { display: flex; flex-direction: column; gap: 0.25rem; }
    .preset-buttons { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .preset-btn {
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      background: var(--theme-bg-app);
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-body-weight);
      cursor: pointer;
      color: var(--theme-table-header-color);
    }
    .preset-btn.active {
      background: var(--theme-button-primary);
      border-color: var(--theme-button-primary);
      color: #fff;
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
    .metrics-selection-note {
      margin-top: 1rem;
      font-size: var(--theme-font-table-header);
      color: var(--theme-table-header-color);
      font-weight: var(--theme-font-table-body-weight);
    }
    .prometheus-chart-block {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      padding: 1rem;
      border: 1px solid var(--theme-border-gray);
    }
    .chart-title {
      margin: 0 0 0.75rem 0;
      font-size: var(--theme-font-body);
      color: var(--theme-table-header-color);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .chart-wrap { min-height: 260px; }
    .chart-wrap-skeleton {
      border-radius: 6px;
      background: linear-gradient(180deg, var(--theme-bg-app) 0%, var(--theme-bg-teal-lighter) 100%);
      border: 1px solid var(--theme-border-gray-light);
      padding: 1rem;
      display: flex;
      flex-direction: column;
      justify-content: space-around;
      gap: 0.75rem;
    }
    .skeleton-line {
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--theme-border-gray-light) 25%, var(--theme-border-gray) 50%, var(--theme-border-gray-light) 75%);
      background-size: 200% 100%;
      animation: skeleton-shimmer 1.4s infinite;
    }
    .skeleton-line-primary { width: 92%; }
    .skeleton-line-secondary { width: 74%; }
    .skeleton-line-tertiary { width: 58%; }
    @keyframes skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    @media (max-width: 1180px) {
      .filter-bar {
        flex-wrap: wrap;
      }
      .group-separator {
        display: none;
      }
      .filter-right-group {
        margin-left: 0;
      }
    }
  `]
})
export class NodesPrometheusMetricsComponent {
  private hostRef = inject(ElementRef<HTMLElement>);

  @Input() prometheusEnabled = false;
  @Input() showTimeFilter = false;
  @Input() loading = false;
  @Input() hasSeries = false;
  @Input() chartHeight = '260px';
  @Input() cpuChartOption: EChartsOption = {};
  @Input() memoryChartOption: EChartsOption = {};
  @Input() diskChartOption: EChartsOption = {};
  @Input() filterMode: 'top' | 'list' = 'top';
  @Input() topNodeLimit = 3;
  @Input() selectedTopMetrics: Array<'cpu' | 'memory' | 'disk'> = ['cpu', 'memory', 'disk'];
  @Input() nodeOptions: string[] = [];
  @Input() selectedNodeNames: string[] = [];
  @Input() timePresets: { id: string; label: string; ms: number }[] = [];
  @Input() activePresetId = '';
  @Input() selectedDurationLabel = '';
  @Input() metricsStartInputValue = '';
  @Input() metricsStartMin = '';
  @Input() metricsStartMax = '';
  @Input() metricsEndInputValue = '';
  @Input() metricsEndMin = '';
  @Input() metricsEndMax = '';

  @Output() timePresetChange = new EventEmitter<string>();
  @Output() metricsStartChange = new EventEmitter<Event>();
  @Output() metricsEndChange = new EventEmitter<Event>();
  @Output() filterModeChange = new EventEmitter<'top' | 'list'>();
  @Output() topNodeLimitChange = new EventEmitter<number>();
  @Output() selectedTopMetricsChange = new EventEmitter<Array<'cpu' | 'memory' | 'disk'>>();
  @Output() selectedNodeNamesChange = new EventEmitter<string[]>();

  nodesDropdownOpen = signal(false);
  topMetricsDropdownOpen = signal(false);
  readonly topMetricOptions: Array<{ value: 'cpu' | 'memory' | 'disk'; label: string }> = [
    { value: 'cpu', label: 'CPU' },
    { value: 'memory', label: 'Memory' },
    { value: 'disk', label: 'Disk' }
  ];

  setFilterMode(mode: 'top' | 'list'): void {
    if (this.filterMode !== mode) {
      this.filterModeChange.emit(mode);
    }
    this.closeAllDropdowns();
  }

  onTopNodeLimitChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement).value);
    if (value > 0 && Number.isFinite(value)) {
      this.topNodeLimitChange.emit(Math.floor(value));
    }
  }

  toggleNodesDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.topMetricsDropdownOpen.set(false);
    this.nodesDropdownOpen.set(!this.nodesDropdownOpen());
  }

  toggleTopMetricsDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.nodesDropdownOpen.set(false);
    this.topMetricsDropdownOpen.set(!this.topMetricsDropdownOpen());
  }

  selectedTopMetricsLabel(): string {
    if (this.selectedTopMetrics.length === 3) return 'CPU, Mem, Disk';
    if (this.selectedTopMetrics.length === 0) return 'No metric';
    if (this.selectedTopMetrics.length === 1) {
      const only = this.topMetricOptions.find(m => m.value === this.selectedTopMetrics[0]);
      return only?.label ?? '1 metric';
    }
    return `${this.selectedTopMetrics.length} metrics`;
  }

  isTopMetricSelected(metric: 'cpu' | 'memory' | 'disk'): boolean {
    return this.selectedTopMetrics.includes(metric);
  }

  toggleTopMetricSelection(metric: 'cpu' | 'memory' | 'disk'): void {
    const next = new Set(this.selectedTopMetrics);
    if (next.has(metric)) {
      next.delete(metric);
    } else {
      next.add(metric);
    }
    this.selectedTopMetricsChange.emit(Array.from(next) as Array<'cpu' | 'memory' | 'disk'>);
  }

  setAllTopMetricsFromEvent(event: Event): void {
    const checked = (event.target as HTMLInputElement | null)?.checked ?? false;
    if (checked) {
      this.selectedTopMetricsChange.emit(this.topMetricOptions.map(metric => metric.value));
      return;
    }
    this.selectedTopMetricsChange.emit([]);
  }

  selectedNodesLabel(): string {
    const count = this.selectedNodeNames.length;
    if (count === 0) return 'All nodes';
    if (count === 1) return this.selectedNodeNames[0];
    return `${count} nodes selected`;
  }

  isNodeSelected(nodeName: string): boolean {
    return this.selectedNodeNames.includes(nodeName);
  }

  toggleNodeSelection(nodeName: string): void {
    const next = new Set(this.selectedNodeNames);
    if (next.has(nodeName)) {
      next.delete(nodeName);
    } else {
      next.add(nodeName);
    }
    this.selectedNodeNamesChange.emit(Array.from(next));
  }

  clearSelectedNodes(): void {
    this.selectedNodeNamesChange.emit([]);
  }

  private closeAllDropdowns(): void {
    this.nodesDropdownOpen.set(false);
    this.topMetricsDropdownOpen.set(false);
  }

  private isInsideDropdownField(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return !!target.closest('.nodes-filter-field, .top-metrics-field');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Close when clicking anywhere outside node-list dropdown controls,
    // including other controls within this same component.
    if (!this.isInsideDropdownField(event.target)) {
      this.closeAllDropdowns();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' || event.key === 'Esc') {
      this.closeAllDropdowns();
    }
  }

  @HostListener('document:focusin', ['$event'])
  onDocumentFocusIn(event: FocusEvent): void {
    // Close when focus moves away from both dropdown control groups
    // (supports tabbing out or focusing another filter/element).
    if (!this.isInsideDropdownField(event.target)) {
      this.closeAllDropdowns();
    }
  }
}

