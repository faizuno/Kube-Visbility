import { Component, input, output, signal, effect } from '@angular/core';

import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="search-section" [class.search-section-compact]="appearance() === 'header' || appearance() === 'header-compact' || appearance() === 'sidebar'">
      <input
        type="text"
        [value]="searchValue()"
        (input)="onSearch($event)"
        [attr.placeholder]="placeholderText()"
        title="Search by service name, image, or environment variable"
        class="search-input"
        [class.search-input-compact]="appearance() === 'header'"
        [class.search-input-compact-dense]="appearance() === 'header-compact'"
        [class.search-input-sidebar]="appearance() === 'sidebar'"
      />
      @if (searchValue().length > 0) {
        <button type="button" class="search-clear" (click)="clearSearch()" aria-label="Clear search">
          <i class="fas fa-times"></i>
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
      .search-section {
        padding: 1rem 0;
        background: var(--theme-bg-app);
        border-bottom: 1px solid var(--theme-border-gray-light);
        width: 100%;
        display: block;
        position: relative;
      }
      .search-input {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: var(--theme-font-body);
        box-sizing: border-box;
      }
      .search-input:focus {
        outline: none;
        border-color: #007bff;
      }
      .search-section-compact {
        padding: 0;
        background: transparent;
        border-bottom: none;
        width: 100%;
        display: block;
      }
      .search-input-compact {
        width: 100%;
        padding: 0.5rem 1rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid var(--theme-border-teal, #5fa6a3);
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
        font-size: var(--theme-font-body);
        line-height: 1.4;
        height: 44px;
        box-sizing: border-box;
      }
      .search-input-compact:focus {
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.25);
      }
      .search-input-compact::placeholder {
        color: var(--theme-table-header-color);
        opacity: 1;
      }
      .search-input-compact-dense {
        width: 100%;
        padding: var(--search-dense-padding, 0.4rem 0.95rem);
        border-radius: var(--search-dense-radius, 999px);
        background: var(--search-dense-bg, rgba(255, 255, 255, 0.95));
        border: var(--search-dense-border, 1px solid var(--theme-border-teal, #5fa6a3));
        box-shadow: var(--search-dense-shadow, 0 4px 12px rgba(15, 23, 42, 0.1));
        font-size: var(--search-dense-font-size, 0.95rem);
        line-height: var(--search-dense-line-height, 1.35);
        height: var(--search-dense-height, 40px);
        box-sizing: border-box;
      }
      .search-input-compact-dense:focus {
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.25);
      }
      .search-input-compact-dense::placeholder {
        color: var(--theme-table-header-color);
        opacity: 1;
      }
      .search-input-sidebar {
        width: 100%;
        padding: 0.4rem 0.95rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.95);
        border: 1px solid var(--theme-border-teal, #5fa6a3);
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.1);
        font-size: var(--theme-font-body);
        line-height: 1.4;
        height: 40px;
        box-sizing: border-box;
      }
      .search-input-sidebar:focus {
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.25);
      }
      .search-input-sidebar::placeholder {
        color: var(--theme-table-header-color);
        opacity: 1;
      }
      .search-clear {
        position: absolute;
        right: 0.7rem;
        top: 50%;
        transform: translateY(-50%);
        border: none;
        background: transparent;
        color: var(--theme-text-gray);
        cursor: pointer;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .search-clear:hover {
        background: rgba(15, 23, 42, 0.08);
        color: var(--theme-text-dark);
      }
    `,
  ],
})
export class SearchBarComponent {
  appearance = input<'default' | 'header' | 'header-compact' | 'sidebar'>('default');
  searchTerm = input<string>('');
  placeholderText = input<string>('Search services...');
  searchValue = signal('');
  searchChange = output<string>();

  constructor() {
    effect(() => {
      this.searchValue.set(this.searchTerm());
    });
  }

  onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchValue.set(value);
    this.searchChange.emit(value);
  }

  clearSearch(): void {
    this.searchValue.set('');
    this.searchChange.emit('');
  }
}

