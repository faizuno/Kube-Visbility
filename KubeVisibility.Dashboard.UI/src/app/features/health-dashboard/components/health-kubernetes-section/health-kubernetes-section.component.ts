
import { Component, computed, inject, input, output } from '@angular/core';
import { ClusterHealthPanelComponent } from '../cluster-health-panel/cluster-health-panel.component';
import { HealthStateService } from '../../services/health-state.service';

@Component({
  selector: 'app-health-kubernetes-section',
  standalone: true,
  imports: [ClusterHealthPanelComponent],
  template: `
    <div class="health-accordion">
      <div class="health-accordion-header" (click)="toggleRequested.emit()">
        <div class="accordion-info">
          <i class="fas fa-server"></i>
          <span class="accordion-title">Kubernetes Health</span>
        </div>
        <div class="k8s-header-summary">
          <span class="summary-pill">
            <i
              class="fas fa-server summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="nodesTone() === 'green'"
              [class.icon-yellow]="nodesTone() === 'yellow'"
              [class.icon-orange]="nodesTone() === 'orange'"
              [class.icon-red]="nodesTone() === 'red'"
              [class.icon-neutral]="nodesTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Nodes</span>
            <span
              class="summary-pill-value"
              [class.value-green]="nodesTone() === 'green'"
              [class.value-yellow]="nodesTone() === 'yellow'"
              [class.value-orange]="nodesTone() === 'orange'"
              [class.value-red]="nodesTone() === 'red'"
              [class.value-neutral]="nodesTone() === 'neutral'"
            >
              {{ nodesSummary() }}
            </span>
          </span>
          <span class="summary-pill">
            <i
              class="fas fa-microchip summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="cpuTone() === 'green'"
              [class.icon-yellow]="cpuTone() === 'yellow'"
              [class.icon-orange]="cpuTone() === 'orange'"
              [class.icon-red]="cpuTone() === 'red'"
              [class.icon-neutral]="cpuTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Avg CPU</span>
            <span
              class="summary-pill-value"
              [class.value-green]="cpuTone() === 'green'"
              [class.value-yellow]="cpuTone() === 'yellow'"
              [class.value-orange]="cpuTone() === 'orange'"
              [class.value-red]="cpuTone() === 'red'"
              [class.value-neutral]="cpuTone() === 'neutral'"
            >
              {{ avgCpuSummary() }}
            </span>
          </span>
          <span class="summary-pill">
            <i
              class="fas fa-memory summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="memoryTone() === 'green'"
              [class.icon-yellow]="memoryTone() === 'yellow'"
              [class.icon-orange]="memoryTone() === 'orange'"
              [class.icon-red]="memoryTone() === 'red'"
              [class.icon-neutral]="memoryTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Avg Memory</span>
            <span
              class="summary-pill-value"
              [class.value-green]="memoryTone() === 'green'"
              [class.value-yellow]="memoryTone() === 'yellow'"
              [class.value-orange]="memoryTone() === 'orange'"
              [class.value-red]="memoryTone() === 'red'"
              [class.value-neutral]="memoryTone() === 'neutral'"
            >
              {{ avgMemorySummary() }}
            </span>
          </span>
        </div>
        <i
          class="fas toggle-icon"
          [class.fa-chevron-down]="!isOpen()"
          [class.fa-chevron-up]="isOpen()"
        ></i>
      </div>

      <div
        class="health-accordion-content"
        [class.accordion-content-wrapper]="isOpen()"
        (transitionend)="contentTransitionEnd.emit($event)"
      >
        @if (isOpen()) {
          <app-cluster-health-panel [isLoading]="isLoading()"></app-cluster-health-panel>
        }
      </div>
    </div>
  `,
  styles: [`
    .health-accordion {
      background-color: var(--theme-bg-app);
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      overflow: hidden;
      transition: box-shadow 0.3s ease;
    }

    .health-accordion:has(.health-accordion-content.accordion-content-wrapper) {
      box-shadow: 0 6px 12px -2px rgba(0, 0, 0, 0.15);
    }

    .health-accordion-header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 0.8rem;
      padding: 1.25rem 1.5rem;
      cursor: pointer;
      background-color: var(--theme-bg-surface);
      border-bottom: 1px solid var(--theme-border-gray-light);
      transition: all 0.3s ease;
      user-select: none;
    }

    .health-accordion-header:hover {
      background-color: var(--theme-bg-surface);
    }

    .accordion-info {
      display: flex;
      align-items: center;
      gap: 1rem;
      grid-column: 1;
      justify-self: start;
      min-width: 0;
    }

    .accordion-info i {
      font-size: var(--theme-font-page-title);
    }

    .accordion-title {
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      white-space: nowrap;
    }

    .k8s-header-summary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      grid-column: 2;
      justify-self: center;
      min-width: fit-content;
    }
    .summary-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.32rem;
      border-radius: 999px;
      border: 1px solid var(--theme-border-gray-light);
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      line-height: 1;
      padding: 0.28rem 0.56rem;
      white-space: nowrap;
    }
    .summary-pill-icon {
      font-size: var(--theme-font-caption);
      opacity: 0.85;
    }
    .summary-pill-icon.icon-green { color: #0f766e; }
    .summary-pill-icon.icon-yellow { color: #a16207; }
    .summary-pill-icon.icon-orange { color: #c2410c; }
    .summary-pill-icon.icon-red { color: #b91c1c; }
    .summary-pill-icon.icon-neutral { color: var(--theme-text-gray); }
    .summary-pill-label {
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      letter-spacing: 0;
      text-transform: none;
      color: var(--theme-table-header-color);
    }
    .summary-pill-value {
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }
    .summary-pill-value.value-green { color: #0f766e; }
    .summary-pill-value.value-yellow { color: #a16207; }
    .summary-pill-value.value-orange { color: #c2410c; }
    .summary-pill-value.value-red { color: #b91c1c; }
    .summary-pill-value.value-neutral { color: var(--theme-text-gray); }
    @media (max-width: 1550px) {
      .summary-pill-label {
        font-size: var(--theme-font-caption);
      }
      .summary-pill-value {
        font-size: var(--theme-font-body);
      }
      .summary-pill {
        padding: 0.24rem 0.48rem;
      }
      .summary-pill-icon {
        font-size: var(--theme-font-caption);
      }
    }

    .toggle-icon {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      grid-column: 3;
      justify-self: end;
    }

    .health-accordion-content {
      padding: 0;
      overflow: hidden;
      transition: max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1),
                  opacity 0.3s ease-in-out,
                  padding 0.4s cubic-bezier(0.4, 0, 0.2, 1);
      max-height: 0;
      opacity: 0;
      pointer-events: none;
    }

    .health-accordion-content.accordion-content-wrapper {
      max-height: 10000px;
      opacity: 1;
      pointer-events: auto;
      background-color: var(--theme-bg-app);
    }
  `]
})
export class HealthKubernetesSectionComponent {
  private readonly healthState = inject(HealthStateService);

  isOpen = input<boolean>(false);
  isLoading = input<boolean>(false);

  toggleRequested = output<void>();
  contentTransitionEnd = output<TransitionEvent>();

  readonly nodesSummary = computed(() => {
    const summary = this.healthState.nodeHealth()?.summary;
    if (!summary) {
      return '--/--';
    }

    return `${summary.ready}/${summary.total}`;
  });

  readonly avgCpuSummary = computed(() => {
    const summary = this.healthState.nodeHealth()?.summary;
    if (!summary) {
      return '--%';
    }

    return `${summary.averageCpuUsagePercent.toFixed(0)}%`;
  });

  readonly avgMemorySummary = computed(() => {
    const summary = this.healthState.nodeHealth()?.summary;
    if (!summary) {
      return '--%';
    }

    return `${summary.averageMemoryUsagePercent.toFixed(0)}%`;
  });

  readonly nodesTone = computed(() => {
    const summary = this.healthState.nodeHealth()?.summary;
    if (!summary || summary.total <= 0) {
      return 'neutral';
    }

    const readyRatio = (summary.ready / summary.total) * 100;
    return this.resolveTone(readyRatio, summary.ready === summary.total);
  });

  readonly cpuTone = computed(() => {
    const summary = this.healthState.nodeHealth()?.summary;
    if (!summary) {
      return 'neutral';
    }

    return this.resolveUtilizationTone(summary.averageCpuUsagePercent);
  });

  readonly memoryTone = computed(() => {
    const summary = this.healthState.nodeHealth()?.summary;
    if (!summary) {
      return 'neutral';
    }

    return this.resolveUtilizationTone(summary.averageMemoryUsagePercent);
  });

  private resolveTone(percentage: number, isPerfect: boolean = false): 'green' | 'yellow' | 'orange' | 'red' | 'neutral' {
    if (!Number.isFinite(percentage)) {
      return 'neutral';
    }
    if (isPerfect || percentage >= 100) {
      return 'green';
    }
    if (percentage >= 90) {
      return 'yellow';
    }
    if (percentage >= 70) {
      return 'orange';
    }
    return 'red';
  }

  private resolveUtilizationTone(percentage: number): 'green' | 'yellow' | 'orange' | 'red' | 'neutral' {
    if (!Number.isFinite(percentage)) {
      return 'neutral';
    }
    if (percentage <= 60) {
      return 'green';
    }
    if (percentage <= 75) {
      return 'yellow';
    }
    if (percentage <= 90) {
      return 'orange';
    }
    return 'red';
  }
}
