
import { Component, computed, inject } from '@angular/core';
import { HealthStateService } from '../../services/health-state.service';

@Component({
  selector: 'app-prometheus-alert-stats',
  standalone: true,
  imports: [],
  template: `
    <div class="prom-alert-stats">
      @if (!isLoadingStats() && !stats()) {
        <div class="empty-state">No Prometheus alert stats available.</div>
      } @else {
        <div class="range-info">Range: last {{ rangeLabel() }}</div>
        <div class="stats-grid">
          <div class="stat-card total">
            <div class="label">Total Firing</div>
            <div class="value">
              @if (isLoadingStats() && !stats()) {
                <span class="stat-skeleton skeleton-shimmer"></span>
              } @else {
                {{ stats()?.totalFiring ?? 0 }}
              }
            </div>
          </div>
          <div class="stat-card critical">
            <div class="label">Critical</div>
            <div class="value">
              @if (isLoadingStats() && !stats()) {
                <span class="stat-skeleton skeleton-shimmer"></span>
              } @else {
                {{ severityCount('critical') }}
              }
            </div>
          </div>
          <div class="stat-card warning">
            <div class="label">Warning</div>
            <div class="value">
              @if (isLoadingStats() && !stats()) {
                <span class="stat-skeleton skeleton-shimmer"></span>
              } @else {
                {{ severityCount('warning') }}
              }
            </div>
          </div>
        </div>

        <div class="stats-details">
          <div class="detail-card">
            <h4>By Severity</h4>
            @if (isLoadingStats() && !stats()) {
              @for (row of skeletonRows; track row) {
                <div class="row">
                  <span class="name-skeleton skeleton-shimmer"></span>
                  <span class="count-skeleton skeleton-shimmer"></span>
                </div>
              }
            } @else {
              @for (item of severityRows(); track item.key) {
                <div class="row">
                  <span class="name">{{ item.key }}</span>
                  <span class="count">{{ item.value }}</span>
                </div>
              }
            }
          </div>

          <div class="detail-card">
            <h4>Top Alert Types</h4>
            @if (isLoadingStats() && !stats()) {
              @for (row of skeletonRows; track row) {
                <div class="row">
                  <span class="name-skeleton skeleton-shimmer"></span>
                  <span class="count-skeleton skeleton-shimmer"></span>
                </div>
              }
            } @else {
              @for (item of alertTypeRows(); track item.key) {
                <div class="row">
                  <span class="name">{{ item.key }}</span>
                  <span class="count">{{ item.value }}</span>
                </div>
              } @empty {
                <div class="empty">No firing alert types.</div>
              }
            }
          </div>

          <div class="detail-card">
            <h4>Top Namespaces</h4>
            @if (isLoadingStats() && !stats()) {
              @for (row of skeletonRows; track row) {
                <div class="row">
                  <span class="name-skeleton skeleton-shimmer"></span>
                  <span class="count-skeleton skeleton-shimmer"></span>
                </div>
              }
            } @else {
              @for (item of namespaceRows(); track item.key) {
                <div class="row">
                  <span class="name">{{ item.key }}</span>
                  <span class="count">{{ item.value }}</span>
                </div>
              } @empty {
                <div class="empty">No namespace-scoped alerts.</div>
              }
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .prom-alert-stats {
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 12px;
      padding: 1rem;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.06);
      margin-bottom: 0.6rem;
      color: var(--theme-text-dark);
      font-family: inherit;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 0.5rem;
      margin-bottom: 0.7rem;
    }
    .range-info {
      font-size: var(--theme-font-table-header);
      color: var(--theme-text-gray);
      margin-bottom: 0.35rem;
    }
    .stat-card {
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      padding: 0.55rem 0.6rem;
      background: var(--theme-bg-surface);
    }
    .stat-card .label {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      margin-bottom: 0.25rem;
    }
    .stat-card .value {
      font-size: var(--theme-font-page-title);
      line-height: 1.2;
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }
    .stat-card.critical .value { color: #b91c1c; }
    .stat-card.warning .value { color: #b45309; }

    .stats-details {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.5rem;
    }
    .detail-card {
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      padding: 0.55rem 0.6rem;
      background: var(--theme-bg-surface);
    }
    .detail-card h4 {
      margin: 0 0 0.35rem 0;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }
    .row {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.18rem 0;
      border-bottom: 1px dashed var(--theme-border-gray-light);
    }
    .row:last-child { border-bottom: none; }
    .name {
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-table-header);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      color: var(--theme-text-dark);
      font-weight: var(--theme-font-table-header-weight);
      font-size: var(--theme-font-table-header);
    }

    .stat-skeleton {
      display: inline-block;
      width: 72px;
      height: 24px;
      border-radius: 6px;
    }

    .name-skeleton {
      display: inline-block;
      width: 70%;
      height: 12px;
      border-radius: 999px;
    }

    .count-skeleton {
      display: inline-block;
      width: 32px;
      height: 12px;
      border-radius: 999px;
    }

    .skeleton-shimmer {
      background: linear-gradient(
        90deg,
        var(--theme-skeleton-base) 25%,
        var(--theme-skeleton-highlight) 50%,
        var(--theme-skeleton-base) 75%
      );
      background-size: 200% 100%;
      animation: stats-skeleton-shimmer 1.4s ease-in-out infinite;
    }

    @keyframes stats-skeleton-shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }

    .empty-state,
    .empty {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
    }
  `]
})
export class PrometheusAlertStatsComponent {
  healthState = inject(HealthStateService);

  readonly stats = computed(() => this.healthState.prometheusAlertStats());
  readonly isLoadingStats = computed(() => this.healthState.isLoadingPrometheusAlertStats());
  readonly rangeLabel = computed(() => this.toRangeLabel(this.healthState.prometheusAlertRangeHours()));
  readonly skeletonRows = [1, 2, 3, 4];

  readonly severityRows = computed(() => this.toSortedRows(this.stats()?.bySeverity ?? {}));
  readonly alertTypeRows = computed(() => this.toSortedRows(this.stats()?.byAlertName ?? {}, 5));
  readonly namespaceRows = computed(() => this.toSortedRows(this.stats()?.byNamespace ?? {}, 5));

  severityCount(severity: string): number {
    const stats = this.stats();
    if (!stats) return 0;
    return stats.bySeverity?.[severity] ?? 0;
  }

  private toSortedRows(record: Record<string, number>, take: number = 10): Array<{ key: string; value: number }> {
    return Object.entries(record)
      .sort((a, b) => b[1] - a[1])
      .slice(0, take)
      .map(([key, value]) => ({ key, value }));
  }

  private toRangeLabel(hours: number): string {
    if (hours % 24 === 0) {
      const days = hours / 24;
      return `${days} day${days > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
}
