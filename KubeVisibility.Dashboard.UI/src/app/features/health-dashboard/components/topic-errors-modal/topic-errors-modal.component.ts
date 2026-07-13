import { Component, Input, OnInit, OnDestroy, Output, EventEmitter, signal, computed, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TopicErrorEntry } from '../../../../core/services/api/elasticsearch.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';

@Component({
  selector: 'app-topic-errors-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (isVisible()) {
      <div class="topic-errors-modal" (click)="onBackdropClick($event)">
        <div class="modal-content" (click)="$event.stopPropagation()" [ngStyle]="modalStyle()">
          <div class="modal-header">
            <div class="modal-header-left">
              <h2>
                <i class="fas fa-exclamation-triangle"></i>
                Errors for Topic: {{ topicName }}
              </h2>
              <div class="errors-count-info">
                {{ errors.length }} error(s) found
              </div>
            </div>
            <button (click)="close()" class="modal-close" title="Close topic errors" aria-label="Close topic errors">&times;</button>
          </div>
          <div class="modal-body">
            @if (errors.length === 0) {
              <div class="no-errors">
                No errors found for this topic.
              </div>
            } @else {
              <!-- Search Bar -->
              <div class="search-bar-container">
                <div class="search-bar">
                  <i class="fas fa-search"></i>
                  <input
                    type="text"
                    placeholder="Search in application, service, message, exception..."
                    [(ngModel)]="searchQuery"
                    class="search-input"
                  />
                  @if (searchQuery()) {
                    <button class="btn-clear-search" (click)="searchQuery.set('')" title="Clear search">
                      <i class="fas fa-times"></i>
                    </button>
                  }
                </div>
                @if (searchQuery()) {
                  <div class="search-results-info">
                    Showing {{ filteredErrors().length }} of {{ errors.length }} errors
                  </div>
                }
              </div>

              <div class="errors-table-wrapper">
                <table class="errors-table">
                  <thead>
                    <tr>
                      <th class="sortable" (click)="sortBy('timestamp')">
                        Timestamp
                        <i class="fas" 
                           [class.fa-sort-up]="sortColumn() === 'timestamp' && sortDirection() === 'asc'" 
                           [class.fa-sort-down]="sortColumn() === 'timestamp' && sortDirection() === 'desc'"></i>
                      </th>
                      <th class="sortable" (click)="sortBy('applicationName')">
                        Application
                        <i class="fas" 
                           [class.fa-sort-up]="sortColumn() === 'applicationName' && sortDirection() === 'asc'" 
                           [class.fa-sort-down]="sortColumn() === 'applicationName' && sortDirection() === 'desc'"></i>
                      </th>
                      <th class="sortable" (click)="sortBy('serviceName')">
                        Service
                        <i class="fas" 
                           [class.fa-sort-up]="sortColumn() === 'serviceName' && sortDirection() === 'asc'" 
                           [class.fa-sort-down]="sortColumn() === 'serviceName' && sortDirection() === 'desc'"></i>
                      </th>
                      <th>Message</th>
                      <th class="sortable" (click)="sortBy('partition')">
                        Partition
                        <i class="fas" 
                           [class.fa-sort-up]="sortColumn() === 'partition' && sortDirection() === 'asc'" 
                           [class.fa-sort-down]="sortColumn() === 'partition' && sortDirection() === 'desc'"></i>
                      </th>
                      <th class="sortable" (click)="sortBy('offset')">
                        Offset
                        <i class="fas" 
                           [class.fa-sort-up]="sortColumn() === 'offset' && sortDirection() === 'asc'" 
                           [class.fa-sort-down]="sortColumn() === 'offset' && sortDirection() === 'desc'"></i>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    @if (filteredErrors().length === 0) {
                      <tr>
                        <td colspan="6" class="no-matches">
                          No errors match the search query "{{ searchQuery() }}"
                        </td>
                      </tr>
                    } @else {
                      @for (error of filteredErrors(); track error.timestamp + error.message + $index) {
                      <tr [class.expanded]="expandedRows().has($index)">
                        <td class="timestamp-col">
                          {{ formatTimestamp(error.timestamp) }}
                        </td>
                        <td class="application-col">{{ error.applicationName || 'N/A' }}</td>
                        <td class="service-col">{{ error.serviceName || 'N/A' }}</td>
                        <td class="message-col">
                          <div class="message-content">
                            {{ error.message || 'N/A' }}
                            @if (error.exception) {
                              <button class="expand-btn" (click)="toggleDetails($index)">
                                <i class="fas" [class.fa-chevron-down]="!expandedRows().has($index)" [class.fa-chevron-up]="expandedRows().has($index)"></i>
                              </button>
                            }
                          </div>
                          @if (expandedRows().has($index) && error.exception) {
                            <div class="error-details">
                              <div class="detail-row">
                                <strong>Exception:</strong>
                                <pre>{{ error.exception }}</pre>
                              </div>
                            </div>
                          }
                        </td>
                        <td class="partition-col">{{ error.partition !== null && error.partition !== undefined ? error.partition : 'N/A' }}</td>
                        <td class="offset-col">{{ error.offset !== null && error.offset !== undefined ? (error.offset | number) : 'N/A' }}</td>
                      </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Overlay: keep z-index so this stays above view topics modal (Kafka section) */
    .topic-errors-modal {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(100vh * 20);
      background: var(--theme-bg-overlay-backdrop);
      z-index: var(--z-modal-backdrop);
      pointer-events: auto;
    }

    .modal-content {
      background: var(--theme-bg-app);
      border-radius: 12px;
      border: 1px solid var(--theme-border-gray-light);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: var(--theme-shadow-lg);
      pointer-events: auto;
      z-index: var(--z-modal-content);
    }

    /* Match global logs modal header */
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 0.9rem 1.25rem;
      border-bottom: 1px solid var(--theme-border-teal-dark);
      background: var(--theme-header-gradient);
      color: var(--theme-bg-surface);
      flex-shrink: 0;
      box-shadow: var(--theme-shadow-md);
    }

    .modal-header-left {
      flex: 1;
    }

    .modal-header-left h2 {
      margin: 0;
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-bg-surface);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      line-height: 1.2;
    }

    .errors-count-info {
      font-size: var(--theme-font-caption);
      color: var(--theme-bg-surface);
      margin-top: 0.25rem;
      opacity: 0.9;
    }

    .modal-close {
      background: none;
      border: none;
      font-size: var(--theme-font-page-title);
      cursor: pointer;
      color: var(--theme-bg-surface);
      line-height: 1;
      padding: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .modal-close:hover {
      background-color: var(--theme-bg-overlay-light);
      color: var(--theme-bg-surface);
    }

    .modal-body {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      padding: 1rem 1.25rem;
      min-height: 0;
      background: var(--theme-bg-app);
    }

    .search-bar-container {
      margin-bottom: 1rem;
      flex-shrink: 0;
    }

    .search-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      transition: all 0.2s;
      max-width: 30%;
    }

    .search-bar:focus-within {
      border-color: var(--theme-button-primary);
      box-shadow: 0 0 0 3px var(--theme-button-primary-shadow);
    }

    .search-bar i.fa-search {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
    }

    .search-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray-dark);
      background: transparent;
    }

    .search-input::placeholder {
      color: var(--theme-text-gray);
    }

    .btn-clear-search {
      background: none;
      border: none;
      color: var(--theme-text-gray);
      cursor: pointer;
      padding: 0.25rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .btn-clear-search:hover {
      color: var(--theme-button-danger);
      background: var(--theme-bg-app);
    }

    .btn-clear-search i {
      font-size: var(--theme-font-body);
    }

    .search-results-info {
      margin-top: 0.5rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
      font-style: italic;
    }

    .no-errors {
      text-align: center;
      padding: 3rem;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
    }

    .errors-table-wrapper {
      flex: 1;
      overflow-y: auto;
      overflow-x: auto;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
      background: var(--theme-bg-surface);
      min-height: 0;
    }

    .errors-table {
      width: 100%;
      border-collapse: collapse;
    }

    .errors-table thead {
      position: sticky;
      top: 0;
      background: var(--theme-bg-app);
      z-index: 10;
      box-shadow: var(--theme-shadow-sm);
    }

    .errors-table th {
      padding: 3px 7px;
      text-align: left;
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      border-bottom: 2px solid var(--theme-border-gray-light);
      white-space: nowrap;
      font-size: var(--theme-font-caption);
      line-height: 1.1;
    }

    .errors-table th.sortable {
      cursor: pointer;
      user-select: none;
      transition: background-color 0.2s;
    }

    .errors-table th.sortable:hover {
      background: var(--theme-bg-teal-lighter);
    }

    .errors-table th.sortable i {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
      margin-left: 0.25rem;
    }

    .errors-table th.sortable i.fa-sort-up,
    .errors-table th.sortable i.fa-sort-down {
      color: var(--theme-text-teal);
      opacity: 1;
    }

    .errors-table tbody tr {
      border-bottom: 1px solid var(--theme-border-gray);
      transition: background 0.2s;
    }

    .errors-table tbody tr:hover {
      background: var(--theme-bg-app);
    }

    .errors-table tbody tr.expanded {
      background: var(--theme-bg-app);
    }

    .errors-table td {
      padding: 3px 7px;
      vertical-align: top;
      overflow: hidden;
      font-size: var(--theme-font-caption);
      line-height: 1;
    }

    .timestamp-col {
      white-space: nowrap;
      width: 180px;
    }

    .application-col {
      width: 150px;
    }

    .service-col {
      width: 150px;
    }

    .message-col {
      min-width: 300px;
      max-width: 400px;
    }

    .partition-col {
      width: 100px;
      text-align: center;
    }

    .offset-col {
      width: 120px;
      text-align: right;
    }

    .message-content {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .expand-btn {
      background: transparent;
      border: none;
      color: var(--theme-text-gray);
      cursor: pointer;
      padding: 4px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .expand-btn:hover {
      color: var(--theme-button-primary);
    }

    .error-details {
      margin-top: 12px;
      padding: 12px;
      background: var(--theme-bg-surface);
      border-radius: 6px;
      border: 1px solid var(--theme-border-gray-light);
    }

    .detail-row {
      margin-bottom: 8px;
    }

    .detail-row:last-child {
      margin-bottom: 0;
    }

    .detail-row strong {
      display: block;
      margin-bottom: 4px;
      color: var(--theme-text-dark);
      font-size: var(--theme-font-caption);
    }

    .detail-row pre {
      margin: 0;
      padding: 8px;
      background: var(--theme-bg-surface);
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      line-height: 1;
      overflow-x: auto;
      white-space: pre-wrap;
      word-wrap: break-word;
      font-family: 'Consolas', 'Courier New', monospace;
    }

    .no-matches {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      font-style: italic;
    }
  `]
})
export class TopicErrorsModalComponent implements OnInit, OnDestroy {
  private viewportScaleService = inject(ViewportScaleService);

  @Input() set topicName(value: string) {
    this._topicName.set(value);
  }
  get topicName() {
    return this._topicName();
  }
  private _topicName = signal<string>('');

  @Input() set errors(value: TopicErrorEntry[]) {
    this._errors.set(value || []);
  }
  get errors() {
    return this._errors();
  }
  private _errors = signal<TopicErrorEntry[]>([]);

  @Output() closed = new EventEmitter<void>();

  isVisible = signal<boolean>(false);
  sortColumn = signal<string | null>(null);
  sortDirection = signal<'asc' | 'desc'>('asc');
  expandedRows = signal<Set<number>>(new Set());
  scrollPosition = signal({ top: 0, left: 0 });
  private scrollListener?: () => void;
  searchQuery = signal<string>('');

  sortedErrors = computed(() => {
    const errors = this._errors();
    const column = this.sortColumn();
    const direction = this.sortDirection();

    if (!column) return errors;

    const sorted = [...errors].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (column) {
        case 'timestamp':
          aValue = this.parseTimestampMs(a.timestamp) ?? -1;
          bValue = this.parseTimestampMs(b.timestamp) ?? -1;
          break;
        case 'applicationName':
          aValue = (a.applicationName || '').toLowerCase();
          bValue = (b.applicationName || '').toLowerCase();
          break;
        case 'serviceName':
          aValue = (a.serviceName || '').toLowerCase();
          bValue = (b.serviceName || '').toLowerCase();
          break;
        case 'partition':
          aValue = a.partition ?? -1;
          bValue = b.partition ?? -1;
          break;
        case 'offset':
          aValue = a.offset ?? -1;
          bValue = b.offset ?? -1;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  });

  // Filter errors based on search query
  filteredErrors = computed(() => {
    const sorted = this.sortedErrors();
    const query = this.searchQuery().toLowerCase().trim();

    if (!query) return sorted;

    return sorted.filter(error => {
      const applicationName = (error.applicationName || '').toLowerCase();
      const serviceName = (error.serviceName || '').toLowerCase();
      const message = (error.message || '').toLowerCase();
      const exception = (error.exception || '').toLowerCase();
      const timestamp = this.formatTimestamp(error.timestamp).toLowerCase();
      const partition = error.partition !== null && error.partition !== undefined ? error.partition.toString() : '';
      const offset = error.offset !== null && error.offset !== undefined ? error.offset.toString() : '';

      return applicationName.includes(query) ||
             serviceName.includes(query) ||
             message.includes(query) ||
             exception.includes(query) ||
             timestamp.includes(query) ||
             partition.includes(query) ||
             offset.includes(query);
    });
  });

  // Calculate modal position and height accounting for viewport scale
  modalStyle = computed(() => {
    if (typeof window === 'undefined' || !this.isVisible()) {
      return {};
    }
    
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const baseWidth = this.viewportScaleService.baseWidth;
    const scrollPos = this.scrollPosition();
    
    // Calculate the actual visible area accounting for scroll
    const visibleTop = scrollPos.top / scale;
    const visibleHeight = viewportHeight / scale;
    
    // Center the modal vertically in the visible viewport
    const centerY = visibleTop + (visibleHeight / 2);
    
    // Center horizontally (always center of the base width)
    const centerX = baseWidth / 2;
    
    // Calculate the transform to center the modal
    return {
      position: 'absolute' as const,
      top: `${centerY}px`,
      left: `${centerX}px`,
      transform: 'translate(-50%, -50%)',
      width: '90%',
      maxWidth: '1600px',
      maxHeight: `${Math.min(90 * baseHeight / 100, visibleHeight * 0.8)}px`,
    };
  });

  constructor() {
    // Track visibility changes to set up/tear down scroll tracking
    effect(() => {
      if (this.isVisible()) {
        this.setupScrollTracking();
        this.updateScrollPosition();
      } else {
        this.cleanupScrollTracking();
      }
    });
  }

  ngOnInit() {
    this.isVisible.set(true);
  }

  ngOnDestroy() {
    this.cleanupScrollTracking();
  }

  private setupScrollTracking() {
    if (typeof window === 'undefined') return;
    
    this.updateScrollPosition();
    this.scrollListener = () => this.updateScrollPosition();
    window.addEventListener('scroll', this.scrollListener, true);
  }

  private cleanupScrollTracking() {
    if (this.scrollListener && typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.scrollListener, true);
      this.scrollListener = undefined;
    }
  }

  private updateScrollPosition() {
    if (typeof window === 'undefined') return;
    
    const scrollContainer = document.querySelector('.viewport-container') as HTMLElement;
    if (scrollContainer) {
      this.scrollPosition.set({
        top: scrollContainer.scrollTop,
        left: scrollContainer.scrollLeft
      });
    } else {
      // Fallback to window scroll
      this.scrollPosition.set({
        top: window.scrollY || window.pageYOffset || 0,
        left: window.scrollX || window.pageXOffset || 0
      });
    }
  }

  close() {
    this.isVisible.set(false);
    this.expandedRows.set(new Set());
    this.sortColumn.set(null);
    this.sortDirection.set('asc');
    this.searchQuery.set('');
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  sortBy(column: string) {
    const currentColumn = this.sortColumn();
    const currentDirection = this.sortDirection();

    if (currentColumn === column) {
      this.sortDirection.set(currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  toggleDetails(index: number) {
    const expanded = new Set(this.expandedRows());
    if (expanded.has(index)) {
      expanded.delete(index);
    } else {
      expanded.add(index);
    }
    this.expandedRows.set(expanded);
  }

  formatTimestamp(timestamp: string): string {
    try {
      const timestampMs = this.parseTimestampMs(timestamp);
      if (timestampMs === null) {
        return timestamp;
      }
      return new Date(timestampMs).toLocaleString();
    } catch {
      return timestamp;
    }
  }

  private parseTimestampMs(timestamp?: string | null): number | null {
    const raw = (timestamp ?? '').trim();
    if (!raw) {
      return null;
    }

    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

