import { Component, input, output, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';

import { ViewMode } from '../../../core/models/cluster-info.models';

@Component({
  selector: 'app-view-toggle',
  standalone: true,
  imports: [RouterModule],
  template: `
    <div class="view-toggle" [class.view-toggle-header]="variant() === 'header'">
      @if (variant() === 'header') {
        <div class="view-toggle-indicator" [class.view-toggle-indicator-details]="currentView() === 'deepdive'"></div>
      }
      @for (view of views; track view) {
        <a
          [class.active]="currentView() === view.value"
          [routerLink]="[getCurrentPath()]"
          [queryParams]="{ view: view.value }"
          queryParamsHandling="merge"
          (click)="onViewChange(view.value)"
          class="view-btn"
          [class.view-btn-header]="variant() === 'header'"
          >
          <i [class]="view.icon"></i>
          {{ view.label }}
        </a>
      }
    </div>
    `,
  styles: [
    `
      .view-toggle {
        display: flex;
        gap: 0.5rem;
      }
      .view-btn {
        padding: 0.5rem 1rem;
        border: 1px solid #ddd;
        background: var(--theme-bg-surface);
        border-radius: 4px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: inherit;
        text-decoration: none;
        transition: all 0.2s ease;
      }
      .view-btn:hover,
      .view-btn:focus,
      .view-btn:active {
        text-decoration: none;
      }
      .view-btn:hover {
        background: var(--theme-bg-app);
      }
      .view-btn.active {
        background: #007bff;
        color: white;
        border-color: #007bff;
      }
      .view-toggle-header {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        padding: 0.2rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        width: clamp(205px, 26vw, 240px);
      }
      .view-toggle-indicator {
        position: absolute;
        top: 0.2rem;
        left: 0.2rem;
        width: calc(50% - 0.2rem);
        height: calc(100% - 0.4rem);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.95);
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.15);
        transform: translateX(0);
        transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        z-index: 1;
      }
      .view-toggle-indicator.view-toggle-indicator-details {
        transform: translateX(100%);
      }
      .view-btn-header {
        position: relative;
        z-index: 2;
        flex: 1;
        border-radius: 999px;
        border: 1px solid transparent;
        background: transparent;
        color: rgba(255, 255, 255, 0.92);
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        padding: 0.45rem 0.95rem;
        min-height: 38px;
        min-width: 0;
        box-shadow: none;
        transition: all 0.2s ease;
        justify-content: center;
        line-height: 1;
        white-space: nowrap;
      }
      .view-btn-header:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
      }
      .view-btn-header.active {
        background: transparent;
        border-color: transparent;
        color: var(--theme-text-dark);
        font-weight: var(--theme-font-table-header-weight);
      }
      .view-btn-header i {
        font-size: var(--theme-font-body);
        line-height: 1;
      }
      @media (max-width: 1320px) {
        .view-toggle-header {
          width: clamp(196px, 24vw, 225px);
        }
        .view-btn-header {
          font-size: var(--theme-font-body);
          padding: 0.4rem 0.6rem;
          gap: 0.35rem;
          min-height: 36px;
        }
        .view-btn-header i {
          font-size: var(--theme-font-caption);
        }
      }
    `,
  ],
})
export class ViewToggleComponent {
  private router = inject(Router);
  currentView = input.required<ViewMode>();
  variant = input<'default' | 'header'>('default');
  viewChange = output<ViewMode>();

  views = [
    { value: 'scanning' as ViewMode, label: 'List', icon: 'fas fa-list' },
    { value: 'deepdive' as ViewMode, label: 'Details', icon: 'fas fa-th-large' },
  ];

  onViewChange(view: ViewMode): void {
    this.viewChange.emit(view);
  }

  getCurrentPath(): string {
    const path = this.router.url.split('?')[0];
    return path || '/';
  }
}

