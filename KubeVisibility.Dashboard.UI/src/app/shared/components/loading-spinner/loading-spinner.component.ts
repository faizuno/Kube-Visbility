import { Component, input } from '@angular/core';


@Component({
  selector: 'app-loading-spinner',
  standalone: true,
  imports: [],
  template: `
    @if (show()) {
      <div class="loading-overlay">
        <div class="spinner-container">
          <div class="spinner"></div>
          @if (message()) {
            <div class="spinner-text">{{ message() }}</div>
          }
        </div>
      </div>
    }
    `,
  styles: [`
    .loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--z-modal-backdrop, 1000000);
      backdrop-filter: blur(2px);
    }

    .spinner-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1rem;
    }

    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top-color: var(--theme-button-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .spinner-text {
      color: white;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      text-align: center;
    }
  `]
})
export class LoadingSpinnerComponent {
  show = input<boolean>(false);
  message = input<string>('');
}

