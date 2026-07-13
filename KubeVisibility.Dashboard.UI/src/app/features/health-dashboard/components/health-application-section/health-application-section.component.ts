
import { Component, computed, inject, input, output } from '@angular/core';
import { ApplicationHealthPanelComponent } from '../application-health-panel/application-health-panel.component';
import { HealthStateService } from '../../services/health-state.service';

@Component({
  selector: 'app-health-application-section',
  standalone: true,
  imports: [ApplicationHealthPanelComponent],
  template: `
    <div class="health-accordion">
      <div class="health-accordion-header" (click)="toggleRequested.emit()">
        <div class="accordion-info">
          <i class="fas fa-cube"></i>
          <span class="accordion-title">Application Health</span>
        </div>
        <div class="app-header-summary">
          <span class="summary-pill">
            <i
              class="fas fa-cogs summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="servicesTone() === 'green'"
              [class.icon-yellow]="servicesTone() === 'yellow'"
              [class.icon-orange]="servicesTone() === 'orange'"
              [class.icon-red]="servicesTone() === 'red'"
              [class.icon-neutral]="servicesTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Services</span>
            <span
              class="summary-pill-value"
              [class.value-green]="servicesTone() === 'green'"
              [class.value-yellow]="servicesTone() === 'yellow'"
              [class.value-orange]="servicesTone() === 'orange'"
              [class.value-red]="servicesTone() === 'red'"
              [class.value-neutral]="servicesTone() === 'neutral'"
            >
              {{ servicesRunningPercentSummary() }}
            </span>
          </span>
          <span class="summary-pill">
            <i
              class="fas fa-stream summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="consumersTone() === 'green'"
              [class.icon-yellow]="consumersTone() === 'yellow'"
              [class.icon-orange]="consumersTone() === 'orange'"
              [class.icon-red]="consumersTone() === 'red'"
              [class.icon-neutral]="consumersTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Consumers</span>
            <span
              class="summary-pill-value"
              [class.value-green]="consumersTone() === 'green'"
              [class.value-yellow]="consumersTone() === 'yellow'"
              [class.value-orange]="consumersTone() === 'orange'"
              [class.value-red]="consumersTone() === 'red'"
              [class.value-neutral]="consumersTone() === 'neutral'"
            >
              {{ consumersRunningPercentSummary() }}
            </span>
          </span>
          <span class="summary-pill">
            <i
              class="fas fa-calendar-check summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="jobsTone() === 'green'"
              [class.icon-yellow]="jobsTone() === 'yellow'"
              [class.icon-orange]="jobsTone() === 'orange'"
              [class.icon-red]="jobsTone() === 'red'"
              [class.icon-neutral]="jobsTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Jobs</span>
            <span
              class="summary-pill-value"
              [class.value-green]="jobsTone() === 'green'"
              [class.value-yellow]="jobsTone() === 'yellow'"
              [class.value-orange]="jobsTone() === 'orange'"
              [class.value-red]="jobsTone() === 'red'"
              [class.value-neutral]="jobsTone() === 'neutral'"
            >
              {{ jobsRunningPercentSummary() }}
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
          <app-application-health-panel [isLoading]="isLoading()"></app-application-health-panel>
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
      font-size: var(--theme-font-section-title);
    }

    .accordion-title {
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      white-space: nowrap;
    }

    .app-header-summary {
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

    .accordion-content-wrapper ::ng-deep .application-health-panel {
      margin-bottom: 0;
      box-shadow: none;
      border-radius: 0;
      padding: 1.5rem;
    }
  `]
})
export class HealthApplicationSectionComponent {
  private readonly healthState = inject(HealthStateService);

  isOpen = input<boolean>(false);
  isLoading = input<boolean>(false);

  toggleRequested = output<void>();
  contentTransitionEnd = output<TransitionEvent>();

  readonly servicesRunningPercent = computed(() => {
    const appOverview = this.healthState.applicationOverview();
    const servicesSummary = this.healthState.servicesHealth()?.summary;
    const total = appOverview?.totalServices ?? servicesSummary?.totalServices ?? 0;
    const running = appOverview?.healthyServices ?? servicesSummary?.runningServices ?? 0;
    if (total <= 0) {
      return null;
    }

    return (running / total) * 100;
  });

  readonly consumersRunningPercent = computed(() => {
    const appOverview = this.healthState.applicationOverview();
    const consumersSummary = this.healthState.consumersHealth()?.summary;
    const total = appOverview?.totalConsumers ?? consumersSummary?.totalConsumers ?? 0;
    const stopped = appOverview?.stoppedConsumers ?? consumersSummary?.stoppedConsumers ?? 0;
    const running = appOverview?.healthyConsumers ?? consumersSummary?.runningConsumers ?? 0;
    const effectiveTotal = total - stopped;
    if (effectiveTotal <= 0) {
      return null;
    }

    return (running / effectiveTotal) * 100;
  });

  readonly jobsRunningPercent = computed(() => {
    const appOverview = this.healthState.applicationOverview();
    const jobsSummary = this.healthState.jobsHealth()?.summary;
    const total = appOverview?.totalJobs ?? jobsSummary?.totalJobs ?? 0;
    const paused = appOverview?.pausedJobs ?? jobsSummary?.pausedJobs ?? 0;
    const running = appOverview?.healthyJobs ?? jobsSummary?.scheduledJobs ?? 0;
    const effectiveTotal = total - paused;
    if (effectiveTotal <= 0) {
      return null;
    }

    return (running / effectiveTotal) * 100;
  });

  readonly servicesRunningPercentSummary = computed(() => this.formatPercent(this.servicesRunningPercent()));
  readonly consumersRunningPercentSummary = computed(() => this.formatPercent(this.consumersRunningPercent()));
  readonly jobsRunningPercentSummary = computed(() => this.formatPercent(this.jobsRunningPercent()));

  readonly servicesTone = computed(() => this.resolveToneFromPercentage(this.servicesRunningPercent()));
  readonly consumersTone = computed(() => this.resolveToneFromPercentage(this.consumersRunningPercent()));
  readonly jobsTone = computed(() => this.resolveToneFromPercentage(this.jobsRunningPercent()));

  private formatPercent(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return '--%';
    }

    return `${Math.max(0, Math.min(100, value)).toFixed(0)}%`;
  }

  private resolveToneFromPercentage(value: number | null): 'green' | 'yellow' | 'orange' | 'red' | 'neutral' {
    if (value === null || !Number.isFinite(value)) {
      return 'neutral';
    }

    if (value >= 100) return 'green';
    if (value >= 90) return 'yellow';
    if (value >= 70) return 'orange';
    return 'red';
  }
}
