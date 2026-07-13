import { Component, input, output } from '@angular/core';

import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-auto-refresh',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div
      class="auto-refresh-control"
      [class.auto-refresh-dark]="appearance() === 'dark'"
      [class.auto-refresh-header]="appearance() === 'header'"
    >
      <label class="refresh-toggle">
        <input
          type="checkbox"
          [checked]="enabled()"
          (change)="onEnabledChange($event)"
        />
        @if (showLabel()) {
          <span>Auto refresh</span>
        }
        <span class="refresh-status">{{ enabled() ? 'On' : 'Off' }}</span>
      </label>
      <select [value]="interval()" (change)="onIntervalChange($event)">
        <option value="10">10s</option>
        <option value="15">15s</option>
        <option value="30">30s</option>
        <option value="60">1m</option>
        <option value="120">2m</option>
        <option value="300">5m</option>
        <option value="600">10m</option>
        <option value="900">15m</option>
        <option value="1800">30m</option>
      </select>
    </div>
  `,
  styles: [
    `
      .auto-refresh-control {
        display: flex;
        align-items: center;
        gap: 1rem;
      }
      .refresh-toggle {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .refresh-status {
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        padding: 0.1rem 0.45rem;
        border-radius: 999px;
        background: rgba(15, 23, 42, 0.08);
        color: var(--theme-text-dark);
      }
      select {
        padding: 0.5rem;
        border: 1px solid #ddd;
        border-radius: 4px;
      }
      .auto-refresh-dark {
        background-color: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.35);
        border-radius: 999px;
        padding: 0.4rem 0.85rem;
        color: white;
      }
      .auto-refresh-dark .refresh-toggle span {
        color: inherit;
      }
      .auto-refresh-dark select {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.5);
        color: white;
      }
      .auto-refresh-dark option {
        color: var(--theme-text-dark);
      }
      .auto-refresh-dark input[type='checkbox'] {
        accent-color: white;
      }
      .auto-refresh-header {
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid rgba(15, 23, 42, 0.1);
        border-radius: 999px;
        padding: 0.5rem 1rem;
        color: var(--theme-text-dark);
        box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
        min-width: 180px;
        justify-content: space-between;
        font-size: var(--auto-refresh-font-size, 1rem);
        font-weight: var(--theme-font-table-header-weight);
        line-height: 1.4;
        box-sizing: border-box;
        height: 44px;
      }
      .auto-refresh-header .refresh-toggle span {
        color: inherit;
        font-weight: var(--theme-font-table-header-weight);
      }
      .auto-refresh-header .refresh-status {
        background: rgba(15, 23, 42, 0.08);
      }
      .auto-refresh-header select {
        border: none;
        background: transparent;
        color: inherit;
        font-weight: var(--theme-font-table-header-weight);
        font-size: inherit;
        line-height: 1.4;
        padding: 0;
        min-width: 55px;
      }
      .auto-refresh-header option {
        color: var(--theme-text-dark);
        font-size: var(--theme-font-caption);
        line-height: 1.4;
      }
    `,
  ],
})
export class AutoRefreshComponent {
  enabled = input.required<boolean>();
  interval = input.required<number>();
  appearance = input<'light' | 'dark' | 'header'>('light');
  showLabel = input<boolean>(true);
  enabledChange = output<boolean>();
  intervalChange = output<number>();

  onEnabledChange(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.enabledChange.emit(checked);
  }

  onIntervalChange(event: Event): void {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.intervalChange.emit(value);
  }
}

