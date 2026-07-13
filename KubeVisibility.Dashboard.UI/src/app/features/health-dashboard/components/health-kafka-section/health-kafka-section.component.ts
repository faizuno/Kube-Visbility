
import { Component, computed, inject, input, output } from '@angular/core';
import { KafkaHealthPanelComponent } from '../kafka-health-panel/kafka-health-panel.component';
import { HealthStateService } from '../../services/health-state.service';

@Component({
  selector: 'app-health-kafka-section',
  standalone: true,
  imports: [KafkaHealthPanelComponent],
  template: `
    <div class="health-accordion">
      <div class="health-accordion-header" (click)="toggleRequested.emit()">
        <div class="accordion-info">
          <i class="fas fa-stream"></i>
          <span class="accordion-title">Kafka Health</span>
        </div>
        <div class="kafka-header-summary">
          <span class="summary-pill summary-pill-broker">
            <i
              class="fas fa-server summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="brokerTone() === 'green'"
              [class.icon-yellow]="brokerTone() === 'yellow'"
              [class.icon-orange]="brokerTone() === 'orange'"
              [class.icon-red]="brokerTone() === 'red'"
              [class.icon-neutral]="brokerTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Broker</span>
            <span
              class="summary-pill-value"
              [class.value-green]="brokerTone() === 'green'"
              [class.value-yellow]="brokerTone() === 'yellow'"
              [class.value-orange]="brokerTone() === 'orange'"
              [class.value-red]="brokerTone() === 'red'"
              [class.value-neutral]="brokerTone() === 'neutral'"
            >
              {{ brokerSummary() }}
            </span>
          </span>
          <span class="summary-pill summary-pill-controller">
            <i
              class="fas fa-cogs summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="controllerTone() === 'green'"
              [class.icon-yellow]="controllerTone() === 'yellow'"
              [class.icon-orange]="controllerTone() === 'orange'"
              [class.icon-red]="controllerTone() === 'red'"
              [class.icon-neutral]="controllerTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Controller</span>
            <span
              class="summary-pill-value"
              [class.value-green]="controllerTone() === 'green'"
              [class.value-yellow]="controllerTone() === 'yellow'"
              [class.value-orange]="controllerTone() === 'orange'"
              [class.value-red]="controllerTone() === 'red'"
              [class.value-neutral]="controllerTone() === 'neutral'"
            >
              {{ controllerSummary() }}
            </span>
          </span>
          <span class="summary-pill summary-pill-score">
            <i
              class="fas fa-heartbeat summary-pill-icon"
              aria-hidden="true"
              [class.icon-green]="healthTone() === 'green'"
              [class.icon-yellow]="healthTone() === 'yellow'"
              [class.icon-orange]="healthTone() === 'orange'"
              [class.icon-red]="healthTone() === 'red'"
              [class.icon-neutral]="healthTone() === 'neutral'"
            ></i>
            <span class="summary-pill-label">Health</span>
            <span
              class="summary-pill-value"
              [class.value-green]="healthTone() === 'green'"
              [class.value-yellow]="healthTone() === 'yellow'"
              [class.value-orange]="healthTone() === 'orange'"
              [class.value-red]="healthTone() === 'red'"
              [class.value-neutral]="healthTone() === 'neutral'"
            >
              {{ healthScoreSummary() }}
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
          <app-kafka-health-panel [isLoading]="isLoading()"></app-kafka-health-panel>
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
      padding: 1.3rem 1.5rem;
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
    }
    .kafka-header-summary {
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

    .toggle-icon {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      grid-column: 3;
      justify-self: end;
    }
    .accordion-title {
      white-space: nowrap;
    }
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
export class HealthKafkaSectionComponent {
  private readonly healthState = inject(HealthStateService);

  isOpen = input<boolean>(false);
  isLoading = input<boolean>(false);

  toggleRequested = output<void>();
  contentTransitionEnd = output<TransitionEvent>();

  readonly brokerSummary = computed(() => {
    const counts = this.resolvedKafkaCounts();
    if (!counts) {
      return '--/--';
    }

    return `${counts.onlineBrokers}/${counts.totalBrokers}`;
  });

  readonly controllerSummary = computed(() => {
    const counts = this.resolvedKafkaCounts();
    if (!counts) {
      return '--/--';
    }

    return `${counts.onlineControllers}/${counts.totalControllers}`;
  });

  readonly healthScoreSummary = computed(() => {
    const score = this.resolvedKafkaHealthScore();
    if (!Number.isFinite(score)) {
      return '--%';
    }

    return `${(score as number).toFixed(0)}%`;
  });

  readonly brokerTone = computed(() => {
    const counts = this.resolvedKafkaCounts();
    if (!counts || counts.totalBrokers <= 0) {
      return 'neutral';
    }

    return this.resolveToneFromRatio(counts.onlineBrokers, counts.totalBrokers);
  });

  readonly controllerTone = computed(() => {
    const counts = this.resolvedKafkaCounts();
    if (!counts || counts.totalControllers <= 0) {
      return 'neutral';
    }

    return this.resolveToneFromRatio(counts.onlineControllers, counts.totalControllers);
  });

  readonly healthTone = computed(() => {
    const score = this.resolvedKafkaHealthScore();
    if (!Number.isFinite(score)) {
      return 'neutral';
    }

    return this.resolveToneFromPercentage(score as number);
  });

  private resolvedKafkaHealthScore(): number | null {
    const kafka = this.healthState.kafkaHealth();
    if (kafka && Number.isFinite(kafka.healthScore)) {
      return kafka.healthScore;
    }

    const kafkaOverview = this.healthState.kafkaOverview();
    if (kafkaOverview && Number.isFinite(kafkaOverview.healthScore)) {
      return kafkaOverview.healthScore;
    }

    return null;
  }

  private resolvedKafkaCounts():
    | { totalBrokers: number; onlineBrokers: number; totalControllers: number; onlineControllers: number }
    | null {
    const kafka = this.healthState.kafkaHealth();
    if (kafka) {
      const totalControllers = kafka.totalControllers ?? kafka.controllers?.length ?? 0;
      const onlineControllers = kafka.onlineControllers ?? kafka.controllers?.filter(controller => controller.isOnline).length ?? 0;
      return {
        totalBrokers: kafka.totalBrokers,
        onlineBrokers: kafka.onlineBrokers,
        totalControllers,
        onlineControllers
      };
    }

    const kafkaOverview = this.healthState.kafkaOverview();
    if (kafkaOverview) {
      return {
        totalBrokers: kafkaOverview.totalBrokers,
        onlineBrokers: kafkaOverview.onlineBrokers,
        totalControllers: kafkaOverview.totalControllers,
        onlineControllers: kafkaOverview.onlineControllers
      };
    }

    return null;
  }

  private resolveToneFromRatio(online: number, total: number): 'green' | 'yellow' | 'orange' | 'red' | 'neutral' {
    if (total <= 0) {
      return 'neutral';
    }

    const ratioPercent = (online / total) * 100;
    return this.resolveToneFromPercentage(ratioPercent, online === total);
  }

  private resolveToneFromPercentage(value: number, isPerfect: boolean = false): 'green' | 'yellow' | 'orange' | 'red' | 'neutral' {
    if (!Number.isFinite(value)) {
      return 'neutral';
    }

    // Keep fully healthy systems visually distinct.
    if (isPerfect || value >= 100) {
      return 'green';
    }
    if (value >= 90) {
      return 'yellow';
    }
    if (value >= 70) {
      return 'orange';
    }
    return 'red';
  }
}
