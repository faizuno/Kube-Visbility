import { Component, Input } from '@angular/core';


@Component({
  selector: 'app-health-badge',
  standalone: true,
  imports: [],
  template: `
    <span [class]="badgeClass" class="health-badge">
      <i [class]="iconClass"></i>
      {{ healthStatus }}
    </span>
  `,
  styles: [
    `
      .health-badge {
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      .health-badge.healthy {
        background-color: #d4edda;
        color: #155724;
      }
      .health-badge.degraded {
        background-color: #fff3cd;
        color: #856404;
      }
      .health-badge.failed {
        background-color: #f8d7da;
        color: #721c24;
      }
      .health-badge.unknown {
        background-color: #e2e3e5;
        color: #383d41;
      }
    `,
  ],
})
export class HealthBadgeComponent {
  @Input() healthStatus: 'Healthy' | 'Degraded' | 'Failed' | 'Unknown' = 'Unknown';

  get badgeClass(): string {
    return this.healthStatus.toLowerCase();
  }

  get iconClass(): string {
    switch (this.healthStatus) {
      case 'Healthy':
        return 'fas fa-check-circle';
      case 'Degraded':
        return 'fas fa-exclamation-triangle';
      case 'Failed':
        return 'fas fa-times-circle';
      default:
        return 'fas fa-question-circle';
    }
  }
}

