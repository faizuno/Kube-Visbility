
import { Component, computed, inject, input, output } from '@angular/core';
import { HealthOverviewComponent } from '../health-overview/health-overview.component';
import { HealthStateService } from '../../services/health-state.service';

@Component({
  selector: 'app-health-overview-section',
  standalone: true,
  imports: [HealthOverviewComponent],
  template: `
    <div class="health-accordion">
      <div class="health-accordion-header" (click)="onHeaderClick()">
        <div class="accordion-info">
          <i class="fas fa-chart-line"></i>
          <span class="accordion-title">Overview</span>
        </div>
        <div class="overview-header-summary">
          <span class="summary-pill">
            <i
              class="fas fa-server summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="kubernetesTone() === 'green'"
              [class.icon-yellow]="kubernetesTone() === 'yellow'"
              [class.icon-orange]="kubernetesTone() === 'orange'"
              [class.icon-red]="kubernetesTone() === 'red'"
              [class.icon-neutral]="kubernetesTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Kubernetes</span>
            <span
              class="summary-pill-value"
              [class.value-green]="kubernetesTone() === 'green'"
              [class.value-yellow]="kubernetesTone() === 'yellow'"
              [class.value-orange]="kubernetesTone() === 'orange'"
              [class.value-red]="kubernetesTone() === 'red'"
              [class.value-neutral]="kubernetesTone() === 'neutral'"
            >
              {{ kubernetesHealthSummary() }}
            </span>
          </span>
          @if (isMessagingEnabled()) {
            <span class="summary-pill">
              <i
                class="fas fa-stream summary-pill-icon"
                aria-hidden="true"
                [class.icon-green]="kafkaTone() === 'green'"
                [class.icon-yellow]="kafkaTone() === 'yellow'"
                [class.icon-orange]="kafkaTone() === 'orange'"
                [class.icon-red]="kafkaTone() === 'red'"
                [class.icon-neutral]="kafkaTone() === 'neutral'"
              ></i>
              <span class="summary-pill-label">Kafka</span>
              <span
                class="summary-pill-value"
                [class.value-green]="kafkaTone() === 'green'"
                [class.value-yellow]="kafkaTone() === 'yellow'"
                [class.value-orange]="kafkaTone() === 'orange'"
                [class.value-red]="kafkaTone() === 'red'"
                [class.value-neutral]="kafkaTone() === 'neutral'"
              >
                {{ kafkaHealthSummary() }}
              </span>
            </span>
          }
          <span class="summary-pill">
            <i
              class="fas fa-cube summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="applicationTone() === 'green'"
              [class.icon-yellow]="applicationTone() === 'yellow'"
              [class.icon-orange]="applicationTone() === 'orange'"
              [class.icon-red]="applicationTone() === 'red'"
              [class.icon-neutral]="applicationTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Application</span>
            <span
              class="summary-pill-value"
              [class.value-green]="applicationTone() === 'green'"
              [class.value-yellow]="applicationTone() === 'yellow'"
              [class.value-orange]="applicationTone() === 'orange'"
              [class.value-red]="applicationTone() === 'red'"
              [class.value-neutral]="applicationTone() === 'neutral'"
            >
              {{ applicationHealthSummary() }}
            </span>
          </span>
        </div>
        <i
          class="fas toggle-icon"
          [class.fa-chevron-down]="!isLoading() && !isOpen()"
          [class.fa-chevron-up]="isLoading() || isOpen()"
        ></i>
      </div>

      <div class="health-accordion-content" [class.accordion-content-wrapper]="isLoading() || isOpen()">
        <app-health-overview (cardClick)="cardClick.emit($event)"></app-health-overview>
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

    .overview-header-summary {
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

    .accordion-content-wrapper ::ng-deep .health-overview {
      margin-bottom: 0;
      box-shadow: none;
      border-radius: 0;
      padding: 1.5rem;
    }

  `]
})
export class HealthOverviewSectionComponent {
  private readonly healthState = inject(HealthStateService);

  isLoading = input<boolean>(false);
  isOpen = input<boolean>(false);
  isMessagingEnabled = input<boolean>(false);

  toggleAccordionRequested = output<void>();
  cardClick = output<'kubernetes' | 'kafka' | 'application'>();

  readonly kubernetesHealthSummary = computed(() => {
    const score = this.healthState.kubernetesOverview()?.healthScore;
    if (!Number.isFinite(score)) {
      return '--%';
    }
    return `${score!.toFixed(0)}%`;
  });

  readonly kafkaHealthSummary = computed(() => {
    const score = this.healthState.kafkaOverview()?.healthScore;
    if (!Number.isFinite(score)) {
      return '--%';
    }
    return `${score!.toFixed(0)}%`;
  });

  readonly applicationHealthSummary = computed(() => {
    const score = this.healthState.applicationOverview()?.healthScore;
    if (!Number.isFinite(score)) {
      return '--%';
    }
    return `${score!.toFixed(0)}%`;
  });

  readonly kubernetesTone = computed(() => this.resolveToneFromPercentage(this.healthState.kubernetesOverview()?.healthScore));
  readonly kafkaTone = computed(() => this.resolveToneFromPercentage(this.healthState.kafkaOverview()?.healthScore));
  readonly applicationTone = computed(() => this.resolveToneFromPercentage(this.healthState.applicationOverview()?.healthScore));

  private resolveToneFromPercentage(score?: number): 'green' | 'yellow' | 'orange' | 'red' | 'neutral' {
    if (!Number.isFinite(score)) {
      return 'neutral';
    }

    const value = score as number;
    if (value >= 100) return 'green';
    if (value >= 90) return 'yellow';
    if (value >= 70) return 'orange';
    return 'red';
  }

  onHeaderClick(): void {
    if (this.isLoading()) {
      return;
    }
    this.toggleAccordionRequested.emit();
  }
}
