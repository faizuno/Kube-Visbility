
import { Component, Input } from '@angular/core';
import type {
  NodeHealthResponse,
  NodePrometheusMetricsCurrentResponse,
  NodePrometheusMetricCurrent,
} from '../../../features/health-dashboard/models/health.models';

type NodeSortColumn =
  | 'name'
  | 'status'
  | 'type'
  | 'version'
  | 'cpuCores'
  | 'totalMemory'
  | 'allocCpu'
  | 'allocMemory'
  | 'allocPods'
  | 'cpuUsage'
  | 'memoryUsage'
  | 'diskUsage'
  | 'pods';

@Component({
  selector: 'app-nodes-health-table',
  standalone: true,
  imports: [],
  template: `
    @if (nodeHealth?.nodes?.length) {
      <div class="table-wrapper dashboard-common-table-wrap" [style.max-height]="tableMaxHeight || null">
        <table class="dashboard-common-table">
          <thead>
            <tr>
              <th class="sortable" (click)="toggleSort('name')">Name {{ sortIndicator('name') }}</th>
              <th class="sortable" (click)="toggleSort('status')">
                Status {{ sortIndicator('status') }}
                <span class="status-info" [attr.title]="statusLegendTooltip">i</span>
              </th>
              <th class="sortable" (click)="toggleSort('type')">Type {{ sortIndicator('type') }}</th>
              <th class="sortable" (click)="toggleSort('version')">Version {{ sortIndicator('version') }}</th>
              <th class="sortable" (click)="toggleSort('cpuCores')">CPU Cores {{ sortIndicator('cpuCores') }}</th>
              <th class="sortable" (click)="toggleSort('totalMemory')">Total Memory {{ sortIndicator('totalMemory') }}</th>
              <th class="sortable" (click)="toggleSort('allocCpu')">Alloc. CPU {{ sortIndicator('allocCpu') }}</th>
              <th class="sortable" (click)="toggleSort('allocMemory')">Alloc. Memory {{ sortIndicator('allocMemory') }}</th>
              <th class="sortable" (click)="toggleSort('allocPods')">Alloc. Pods {{ sortIndicator('allocPods') }}</th>
              <th class="sortable" (click)="toggleSort('cpuUsage')">CPU Usage {{ sortIndicator('cpuUsage') }}</th>
              <th class="sortable" (click)="toggleSort('memoryUsage')">Memory Usage {{ sortIndicator('memoryUsage') }}</th>
              @if (showDiskColumn && prometheusEnabled) {
                <th class="sortable" (click)="toggleSort('diskUsage')">P. Disk % {{ sortIndicator('diskUsage') }}</th>
              }
              <th class="sortable" (click)="toggleSort('pods')">Pods {{ sortIndicator('pods') }}</th>
            </tr>
          </thead>
          <tbody>
            @for (node of sortedNodes(); track node.name) {
              <tr>
                <td class="node-name">{{ node.name }}</td>
                <td>
                  <span
                    class="status-badge"
                    [class]="'status-badge ' + getStatusBadgeClass(node.status)"
                    [attr.title]="getStatusTooltip(node)"
                  >
                    {{ getDisplayStatus(node) }}
                  </span>
                </td>
                <td [attr.title]="node.type">
                  <span class="type-badge" [class.control-plane]="node.type === 'control-plane'">
                    {{ node.type }}
                  </span>
                </td>
                <td>{{ node.kubernetesVersion }}</td>
                <td>{{ node.capacity.cpu }}</td>
                <td>{{ formatMemory(node.capacity.memory) }}</td>
                <td>@if (node.allocatable) { {{ node.allocatable.cpu }} } @else { <span class="text-muted">N/A</span> }</td>
                <td>@if (node.allocatable) { {{ formatMemory(node.allocatable.memory) }} } @else { <span class="text-muted">N/A</span> }</td>
                <td>@if (node.allocatable) { {{ node.allocatable.pods }} } @else { <span class="text-muted">N/A</span> }</td>
                <td>
                  @if (node.currentMetrics) {
                    @if (showMetricBars) {
                      <div class="metric-cell">
                        <span>{{ node.currentMetrics.cpuUsagePercent.toFixed(1) }}%</span>
                        <div class="metric-bar">
                          <div
                            class="metric-fill"
                            [style.width.%]="node.currentMetrics.cpuUsagePercent"
                            [class.critical]="node.currentMetrics.cpuUsagePercent > 90"
                            [class.warning]="node.currentMetrics.cpuUsagePercent > 70 && node.currentMetrics.cpuUsagePercent <= 90"
                          ></div>
                        </div>
                      </div>
                    } @else {
                      <span [class.critical]="node.currentMetrics.cpuUsagePercent > 90" [class.warning]="node.currentMetrics.cpuUsagePercent > 70 && node.currentMetrics.cpuUsagePercent <= 90">
                        {{ node.currentMetrics.cpuUsagePercent.toFixed(1) }}%
                      </span>
                    }
                  } @else {
                    <span class="text-muted">N/A</span>
                  }
                </td>
                <td>
                  @if (node.currentMetrics) {
                    @if (showMetricBars) {
                      <div class="metric-cell">
                        <span>{{ node.currentMetrics.memoryUsagePercent.toFixed(1) }}%</span>
                        <div class="metric-bar">
                          <div
                            class="metric-fill"
                            [style.width.%]="node.currentMetrics.memoryUsagePercent"
                            [class.critical]="node.currentMetrics.memoryUsagePercent > 90"
                            [class.warning]="node.currentMetrics.memoryUsagePercent > 70 && node.currentMetrics.memoryUsagePercent <= 90"
                          ></div>
                        </div>
                      </div>
                    } @else {
                      <span [class.critical]="node.currentMetrics.memoryUsagePercent > 90" [class.warning]="node.currentMetrics.memoryUsagePercent > 70 && node.currentMetrics.memoryUsagePercent <= 90">
                        {{ node.currentMetrics.memoryUsagePercent.toFixed(1) }}%
                      </span>
                    }
                  } @else {
                    <span class="text-muted">N/A</span>
                  }
                </td>
                @if (showDiskColumn && prometheusEnabled) {
                  <td>
                    @if (getPrometheusForNode(node.name); as p) {
                      @if (p.diskUsagePercent != null) {
                        <span [class.critical]="p.diskUsagePercent > 90" [class.warning]="p.diskUsagePercent > 70 && p.diskUsagePercent <= 90">
                          {{ p.diskUsagePercent.toFixed(1) }}%
                        </span>
                      } @else {
                        <span class="text-muted">N/A</span>
                      }
                    } @else {
                      <span class="text-muted">N/A</span>
                    }
                  </td>
                }
                <td>{{ node.runningPods }}/{{ node.totalPods }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <div class="empty-state">No node data available</div>
    }
  `,
  styles: [`
    .table-wrapper {
      overflow-x: auto;
      overflow-y: auto;
      border-radius: 8px;
    }
    thead {
      position: sticky;
      top: 0;
      z-index: 10;
    }
    th {
      vertical-align: middle;
      white-space: nowrap;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    .node-name { font-weight: var(--theme-font-table-body-weight); color: var(--theme-text-dark); }
    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      white-space: nowrap;
    }
    .status-ready { background: #dcfce7; color: #166534; }
    .status-notready { background: #fee2e2; color: #991b1b; }
    .status-unknown { background: var(--theme-bg-app); color: var(--theme-text-gray); }
    .status-info {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      margin-left: 0.35rem;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 700;
      color: #0f172a;
      background: #dbeafe;
      vertical-align: middle;
      cursor: help;
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
    .type-badge.control-plane { background: #fef3c7; color: #92400e; }
    .metric-cell {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      width: 100%;
      align-items: flex-start;
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
    .metric-fill.warning { background: #f59e0b; }
    .metric-fill.critical { background: #ef4444; }
    .text-muted { color: var(--theme-text-gray); }
    .warning { color: #f59e0b; }
    .critical { color: #ef4444; }
    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
      background: var(--theme-bg-surface);
      border-radius: 8px;
      border: 1px solid var(--theme-border-gray);
    }
  `]
})
export class NodesHealthTableComponent {
  @Input() nodeHealth: NodeHealthResponse | null = null;
  @Input() prometheusEnabled = false;
  @Input() prometheusMetrics: NodePrometheusMetricsCurrentResponse | null = null;
  @Input() showDiskColumn = true;
  @Input() showMetricBars = false;
  @Input() tableMaxHeight: string | null = null;
  readonly statusLegendTooltip =
    'Node status format: <Readiness>[,<Flag1>,<Flag2>...]\n' +
    'Readiness: Ready | NotReady | Unknown\n' +
    'Common flags: SchedulingDisabled, MemoryPressure, DiskPressure, PIDPressure, NetworkUnavailable';
  sortColumn: NodeSortColumn = 'name';
  sortDirection: 'asc' | 'desc' = 'asc';

  toggleSort(column: NodeSortColumn): void {
    if (this.sortColumn === column) {
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
      return;
    }
    this.sortColumn = column;
    this.sortDirection = column === 'name' ? 'asc' : 'desc';
  }

  sortIndicator(column: NodeSortColumn): string {
    if (this.sortColumn !== column) return '';
    return this.sortDirection === 'asc' ? '↑' : '↓';
  }

  sortedNodes() {
    const nodes = this.nodeHealth?.nodes ?? [];
    const direction = this.sortDirection === 'asc' ? 1 : -1;
    return [...nodes].sort((left, right) => this.compareNodes(left, right) * direction);
  }

  getPrometheusForNode(nodeName: string): NodePrometheusMetricCurrent | null {
    const metrics = this.prometheusMetrics;
    if (!metrics?.nodes?.length) return null;
    const found = metrics.nodes.find(
      (n) => n.nodeName === nodeName || n.nodeName.toLowerCase() === nodeName.toLowerCase()
    );
    return found ?? null;
  }

  private compareNodes(left: NodeHealthResponse['nodes'][number], right: NodeHealthResponse['nodes'][number]): number {
    const leftValue = this.getSortValue(left, this.sortColumn);
    const rightValue = this.getSortValue(right, this.sortColumn);
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }
    return String(leftValue).localeCompare(String(rightValue), undefined, { sensitivity: 'base' });
  }

  private getSortValue(node: NodeHealthResponse['nodes'][number], column: NodeSortColumn): number | string {
    switch (column) {
      case 'name':
        return node.name || '';
      case 'status':
        return this.getDisplayStatus(node);
      case 'type':
        return node.type || '';
      case 'version':
        return node.kubernetesVersion || '';
      case 'cpuCores':
        return this.toNumber(node.capacity.cpu);
      case 'totalMemory':
        return this.parseResourceMemoryToBytes(node.capacity.memory);
      case 'allocCpu':
        return this.toNumber(node.allocatable?.cpu);
      case 'allocMemory':
        return this.parseResourceMemoryToBytes(node.allocatable?.memory);
      case 'allocPods':
        return this.toNumber(node.allocatable?.pods);
      case 'cpuUsage':
        return node.currentMetrics?.cpuUsagePercent ?? -1;
      case 'memoryUsage':
        return node.currentMetrics?.memoryUsagePercent ?? -1;
      case 'diskUsage':
        return this.getPrometheusForNode(node.name)?.diskUsagePercent ?? -1;
      case 'pods':
        return node.runningPods ?? 0;
      default:
        return '';
    }
  }

  private toNumber(value?: string | number | null): number {
    if (value === null || value === undefined) return -1;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : -1;
  }

  private parseResourceMemoryToBytes(memory?: string | null): number {
    if (!memory) return -1;
    const match = memory.match(/^(\d+)([A-Za-z]*)$/);
    if (!match) return -1;
    const value = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(value)) return -1;
    switch (unit) {
      case 'Ki': return value * 1024;
      case 'Mi': return value * 1024 * 1024;
      case 'Gi': return value * 1024 * 1024 * 1024;
      case 'Ti': return value * 1024 * 1024 * 1024 * 1024;
      case 'K': return value * 1000;
      case 'M': return value * 1000 * 1000;
      case 'G': return value * 1000 * 1000 * 1000;
      case 'T': return value * 1000 * 1000 * 1000 * 1000;
      default: return value;
    }
  }

  getDisplayStatus(node: NodeHealthResponse['nodes'][number]): string {
    return (node.exactStatus?.trim() || node.status || '').trim();
  }

  getStatusTooltip(node: NodeHealthResponse['nodes'][number]): string {
    const displayStatus = this.getDisplayStatus(node);
    const statusFlags = node.statusFlags?.length
      ? node.statusFlags
      : displayStatus.split(',').slice(1).map((value) => value.trim()).filter(Boolean);

    const lines = [
      `Status: ${displayStatus}`,
      `Readiness: ${this.describeReadiness(node.status)}`
    ];

    if (statusFlags.length > 0) {
      lines.push('Flags:');
      for (const flag of statusFlags) {
        lines.push(`- ${flag}: ${this.describeStatusFlag(flag)}`);
      }
    } else {
      lines.push('Flags: None');
    }

    return lines.join('\n');
  }

  getStatusBadgeClass(status: string | undefined): string {
    switch ((status ?? '').toLowerCase()) {
      case 'ready':
        return 'status-ready';
      case 'notready':
        return 'status-notready';
      default:
        return 'status-unknown';
    }
  }

  private describeReadiness(status: string | undefined): string {
    switch ((status ?? '').toLowerCase()) {
      case 'ready':
        return 'Kubelet is healthy and reporting Ready.';
      case 'notready':
        return 'Kubelet is reachable but not healthy for workloads.';
      default:
        return 'Node readiness is unknown or not currently reported.';
    }
  }

  private describeStatusFlag(flag: string): string {
    switch (flag) {
      case 'SchedulingDisabled':
        return 'Node is cordoned and not accepting new pods.';
      case 'MemoryPressure':
        return 'Node is under memory pressure.';
      case 'DiskPressure':
        return 'Node is under disk pressure.';
      case 'PIDPressure':
        return 'Node is running low on available process IDs.';
      case 'NetworkUnavailable':
        return 'Node networking is unavailable.';
      default:
        if (flag.endsWith('Unknown')) {
          const condition = flag.slice(0, -'Unknown'.length) || 'Condition';
          return `${condition} condition is in Unknown state.`;
        }
        return 'Additional Kubernetes node condition is active.';
    }
  }

  formatMemory(memory: string): string {
    if (!memory) return 'N/A';
    const match = memory.match(/^(\d+)([A-Za-z]*)$/);
    if (!match) return memory;
    const value = parseInt(match[1], 10);
    const unit = match[2];
    let bytes = value;
    switch (unit) {
      case 'Ki': bytes = value * 1024; break;
      case 'Mi': bytes = value * 1024 * 1024; break;
      case 'Gi': bytes = value * 1024 * 1024 * 1024; break;
      case 'Ti': bytes = value * 1024 * 1024 * 1024 * 1024; break;
      case 'K': bytes = value * 1000; break;
      case 'M': bytes = value * 1000 * 1000; break;
      case 'G': bytes = value * 1000 * 1000 * 1000; break;
      case 'T': bytes = value * 1000 * 1000 * 1000 * 1000; break;
      default: break;
    }
    if (bytes >= 1024 * 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(1)} TB`;
    if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${bytes} B`;
  }
}

