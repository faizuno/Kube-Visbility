import { Component, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';


export type NavOption = 'cluster' | 'messages' | null;

@Component({
  selector: 'app-nav-toggle-slider',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="nav-toggle-slider" 
         [class.active-cluster]="currentNav() === 'cluster'" 
         [class.active-kafka]="currentNav() === 'messages'"
         [class.no-active]="currentNav() === null">
      <div class="slider-track" [class.single-option]="!messagingEnabled()">
        <div class="slider-indicator" [class.hidden]="currentNav() === null || !messagingEnabled()"></div>
        <a
          class="nav-option cluster-info"
          [class.active]="currentNav() === 'cluster'"
          [routerLink]="['/cluster']"
          [attr.aria-current]="currentNav() === 'cluster' ? 'page' : null"
          title="Cluster resources and service health"
          (click)="onNavChange('cluster')"
        >
          <i class="fas fa-server" aria-hidden="true"></i>
          <span>Cluster</span>
        </a>
        @if (messagingEnabled()) {
          <a
            class="nav-option kafka"
            [class.active]="currentNav() === 'messages'"
            [routerLink]="['/messages']"
            [attr.aria-current]="currentNav() === 'messages' ? 'page' : null"
            title="Kafka topics and consumer groups"
            (click)="onNavChange('messages')"
          >
            <i class="fas fa-stream" aria-hidden="true"></i>
            <span>Messaging</span>
          </a>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .nav-toggle-slider {
        position: relative;
        display: inline-block;
        width: auto;
      }

      .slider-track {
        position: relative;
        display: inline-flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 999px;
        padding: 0.2rem;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
        width: clamp(180px, 24vw, 230px);
      }

      .slider-indicator {
        position: absolute;
        top: 0.2rem;
        left: 0.2rem;
        width: calc(50% - 0.2rem);
        height: calc(100% - 0.4rem);
        background: rgba(255, 255, 255, 0.95);
        border-radius: 999px;
        transform: translateX(0);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease;
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.15);
        z-index: 1;
      }

      .slider-indicator.hidden {
        opacity: 0;
        pointer-events: none;
      }

      .nav-toggle-slider.active-kafka .slider-indicator {
        transform: translateX(100%);
      }
      .nav-toggle-slider.active-cluster .slider-indicator {
        transform: translateX(0);
      }

      .slider-track.single-option .slider-indicator {
        width: calc(100% - 0.4rem);
      }
      .slider-track.single-option {
        min-width: 120px;
      }

      .nav-option {
        position: relative;
        z-index: 2;
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        padding: 0.45rem 0.95rem;
        background: transparent;
        border: none;
        border-radius: 999px;
        color: rgba(255, 255, 255, 0.9);
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        cursor: pointer;
        transition: all 0.2s ease;
        min-height: 38px;
        height: 38px;
        min-width: 0;
        line-height: 1;
        white-space: nowrap;
        text-decoration: none;
        text-align: center;
      }

      .nav-option:hover:not(.active) {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.18);
        text-decoration: none;
      }

      .nav-option:focus,
      .nav-option:active {
        text-decoration: none;
      }

      .nav-option.active {
        color: var(--theme-text-dark);
        font-weight: var(--theme-font-table-header-weight);
      }

      .nav-option span {
        display: block;
        line-height: 1;
        white-space: nowrap;
      }
      .nav-option i {
        font-size: var(--theme-font-caption);
        line-height: 1;
        opacity: 0.95;
        margin-right: 0.42rem;
      }
      @media (max-width: 1320px) {
        .nav-option {
          font-size: var(--theme-font-body);
          padding: 0.4rem 0.7rem;
          min-height: 36px;
          height: 36px;
        }
        .nav-option i {
          font-size: var(--theme-font-caption);
          margin-right: 0.32rem;
        }
      }
    `,
  ],
})
export class NavToggleSliderComponent {
  currentNav = input.required<NavOption>();
  messagingEnabled = input<boolean>(true);
  navChange = output<NavOption>();

  onNavChange(nav: 'cluster' | 'messages'): void {
    // Always emit the navigation change, even if already on that route
    // This allows users to refresh/navigate to the same route
    this.navChange.emit(nav);
  }
}

