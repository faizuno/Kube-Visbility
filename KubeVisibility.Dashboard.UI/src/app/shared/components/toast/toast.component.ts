import { Component, Input } from '@angular/core';


export type ToastType = 'success' | 'error' | 'warning' | 'info';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [],
  template: `
    @if (message) {
      <div [class]="toastClass" class="toast">
        <i [class]="iconClass"></i>
        <span>{{ message }}</span>
      </div>
    }
    `,
  styles: [
    `
      .toast {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.5rem 0.75rem 0.5rem 1.0rem;
        border-radius: 10px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        box-shadow: 0 12px 26px rgba(2, 6, 23, 0.35);
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        color: #ffffff;
        background: rgba(15, 23, 42, 0.92);
        display: flex;
        animation: slideIn 0.3s ease-out;
        background-clip: padding-box;
      }
      @keyframes slideIn {
        from {
          transform: translateX(100%);
          opacity: 0;
        }
        to {
          transform: translateX(0);
          opacity: 1;
        }
      }
      .toast.success {
        background: rgba(6, 78, 59, 0.95);
        border-color: rgba(110, 231, 183, 0.45);
        color: #dcfce7;
      }
      .toast.error {
        background: rgba(127, 29, 29, 0.95);
        border-color: rgba(248, 113, 113, 0.45);
        color: #fee2e2;
      }
      .toast.warning {
        background: rgba(146, 64, 14, 0.95);
        border-color: rgba(251, 191, 36, 0.5);
        color: #ffedd5;
      }
      .toast.info {
        background: rgba(30, 64, 175, 0.96);
        border-color: rgba(147, 197, 253, 0.55);
        color: #e0ecff;
      }
    `,
  ],
})
export class ToastComponent {
  @Input() message: string = '';
  @Input() type: ToastType = 'info';

  get toastClass(): string {
    return this.type;
  }

  get iconClass(): string {
    switch (this.type) {
      case 'success':
        return 'fas fa-check-circle';
      case 'error':
        return 'fas fa-exclamation-circle';
      case 'warning':
        return 'fas fa-exclamation-triangle';
      default:
        return 'fas fa-info-circle';
    }
  }
}

