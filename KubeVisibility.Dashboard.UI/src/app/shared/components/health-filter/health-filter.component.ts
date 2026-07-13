import {
  Component,
  ElementRef,
  HostListener,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { HealthFilter } from '../../../core/models/cluster-info.models';

@Component({
  selector: 'app-health-filter',
  standalone: true,
  imports: [],
  template: `
    <div class="health-filter-container" [class.header]="variant() === 'header'" [class.menu-open]="menuOpen()">
      <button
        type="button"
        class="health-filter-trigger"
        [class.header]="variant() === 'header'"
        [class.has-selection]="selectedFilters().length > 0"
        (click)="toggleMenu($event)"
      >
        <i class="fas fa-filter"></i>
        <span class="filter-label">{{ getButtonLabel() }}</span>
        <i
          class="fas"
          [class.fa-chevron-up]="menuOpen()"
          [class.fa-chevron-down]="!menuOpen()"
        ></i>
      </button>
      @if (menuOpen()) {
        <div class="health-filter-dropdown" (click)="$event.stopPropagation()">
          @for (filter of filters; track filter.value) {
            <label class="dropdown-option" [class.option-all]="filter.value === 'all'">
              <input
                type="checkbox"
                [checked]="isSelected(filter.value)"
                (change)="toggleSelection(filter.value)"
              />
              <span class="option-label">
        @if (filter.icon.startsWith('fas')) {
          <i [class]="filter.icon"></i>
        } @else {
          <span class="emoji-icon">{{ filter.icon }}</span>
        }
        {{ filter.label }}
              </span>
              @if (getFilterCount(filter.value) !== null) {
                <span class="option-count">{{ getFilterCount(filter.value) }}</span>
              }
            </label>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .health-filter-container {
        position: relative;
      }
      .health-filter-container.menu-open {
        z-index: 1200;
      }
      .health-filter-trigger {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border-radius: 999px;
        border: 1px solid #d1d5db;
        background: var(--theme-bg-app);
        padding: 0.5rem 1rem;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        cursor: pointer;
        line-height: 1.4;
        box-shadow: 0 4px 10px rgba(15, 23, 42, 0.1);
        transition: all 0.2s ease;
        box-sizing: border-box;
        height: 44px;
      }
      .filter-label {
        display: inline-block;
        white-space: nowrap;
        font: inherit;
      }
      .health-filter-trigger.header {
        border: 1px solid rgba(255, 255, 255, 0.35);
        background: var(--theme-bg-surface);
        color: var(--theme-text-dark);
        box-shadow: 0 6px 16px rgba(15, 23, 42, 0.15);
        height: auto;
        padding: 0.34rem 0.75rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
      }
      .health-filter-trigger.has-selection {
        border-color: #16a34a;
      }
      .health-filter-dropdown {
        position: absolute;
        top: calc(100% + 0.35rem);
        right: 0;
        min-width: 200px;
        background: var(--theme-bg-surface);
        border-radius: 12px;
        box-shadow: 0 20px 45px rgba(15, 23, 42, 0.2);
        padding: 0.5rem;
        z-index: 1201;
        border: 1px solid rgba(15, 23, 42, 0.08);
        color: var(--theme-text-dark);
        isolation: isolate;
        font-family: inherit;
      }
      .dropdown-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.25rem 0.5rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        line-height: 1.4;
        cursor: pointer;
        color: var(--theme-text-dark);
        white-space: nowrap;
      }
      .dropdown-option:hover {
        background-color: rgba(15, 23, 42, 0.05);
        border-radius: 6px;
      }
      .dropdown-option input {
        accent-color: var(--theme-button-primary);
        cursor: pointer;
        flex-shrink: 0;
      }
      .option-label {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        color: var(--theme-text-dark);
        font-size: var(--theme-font-section-title);
        line-height: 1.4;
        flex: 1;
        font-family: inherit;
      }
      .option-label span,
      .option-label i {
        color: var(--theme-text-dark);
        font-size: inherit;
        font-weight: inherit;
        line-height: inherit;
      }
      .option-all {
        border-bottom: 1px solid rgba(15, 23, 42, 0.08);
        margin-bottom: 0.25rem;
        padding-bottom: 0.3rem;
      }
      .option-count {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.6rem;
        height: 1.2rem;
        border-radius: 999px;
        background: var(--theme-bg-app);
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        padding: 0 0.4rem;
      }
      .emoji-icon {
        font-size: var(--theme-font-body);
        line-height: 1;
      }
      .health-filter-container.header .dropdown-option {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }
      .health-filter-container.header .option-label {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }
      .health-filter-container.header .option-count {
        font-size: var(--theme-font-caption);
      }
      .health-filter-container.header .emoji-icon {
        font-size: var(--theme-font-body);
      }
    `,
  ],
})
export class HealthFilterComponent {
  private hostRef = inject(ElementRef<HTMLElement>);

  currentFilter = input.required<HealthFilter[]>();
  filterCounts = input<Partial<Record<HealthFilter, number>> | null>(null);
  variant = input<'default' | 'header'>('default');
  filterChange = output<HealthFilter[]>();

  filters: Array<{ value: HealthFilter | 'all'; label: string; icon: string }> = [
    { value: 'all', label: 'All statuses', icon: 'fas fa-globe' },
    { value: 'healthy', label: 'Healthy', icon: '✅' },
    { value: 'degraded', label: 'Degraded', icon: '⚠️' },
    { value: 'failed', label: 'Failed', icon: '❌' },
    { value: 'paused', label: 'Paused', icon: '⏸️' },
    { value: 'stopped', label: 'Stopped', icon: '🛑' },
  ];

  selectedFilters = signal<HealthFilter[]>([]);
  menuOpen = signal(false);

  constructor() {
    effect(() => {
      const incoming = this.currentFilter();
      this.selectedFilters.set([...incoming]);
    });
  }

  toggleMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.menuOpen.set(!this.menuOpen());
  }

  toggleSelection(filter: HealthFilter | 'all'): void {
    if (filter === 'all') {
      this.selectedFilters.set([]);
      this.emitSelection([]);
      this.menuOpen.set(false);
      return;
    }

    const current = new Set(this.selectedFilters());
    if (current.has(filter)) {
      current.delete(filter);
    } else {
      current.add(filter);
    }

    const next = Array.from(current);
    this.selectedFilters.set(next);
    this.emitSelection(next);
  }

  isSelected(filter: HealthFilter | 'all'): boolean {
    if (filter === 'all') {
      return this.selectedFilters().length === 0;
    }
    return this.selectedFilters().includes(filter);
  }

  getButtonLabel(): string {
    const current = this.selectedFilters();
    if (current.length === 0) {
      return 'All statuses';
    }
    if (current.length === 1) {
      const option = this.filters.find((f) => f.value === current[0]);
      return option ? option.label : '1 status';
    }
    return `${current.length} statuses`;
  }

  getFilterCount(filter: HealthFilter | 'all'): number | null {
    const counts = this.filterCounts();
    if (!counts) {
      return null;
    }
    if (filter === 'all') {
      return (counts.healthy ?? 0) + (counts.degraded ?? 0) + (counts.failed ?? 0) + (counts.paused ?? 0) + (counts.stopped ?? 0);
    }
    return counts[filter] ?? 0;
  }

  private emitSelection(filters: HealthFilter[]): void {
    this.filterChange.emit(filters);
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: MouseEvent): void {
    if (
      this.menuOpen() &&
      this.hostRef.nativeElement &&
      !this.hostRef.nativeElement.contains(event.target as Node)
    ) {
      this.menuOpen.set(false);
    }
  }
}
