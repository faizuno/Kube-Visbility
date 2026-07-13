import { Component, OnInit, OnDestroy, OnChanges, SimpleChanges, Input, Output, EventEmitter, inject, signal, computed, effect, HostListener, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { ElasticsearchService, ElasticsearchLogEntry } from '../../../core/services/api/elasticsearch.service';
import { ViewportScaleService } from '../../../core/services/viewport-scale.service';

@Component({
  selector: 'app-global-elasticsearch-search, app-elasticsearch-logs-common',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible()) {
      <div class="search-modal" (click)="onBackdropClick($event)">
        <div class="modal-content" (click)="$event.stopPropagation()" [ngStyle]="modalStyle()" aria-label="Global log search panel">
          <div class="modal-header">
            <div class="modal-header-left">
              <h2>
                <i class="fas fa-search"></i> {{ title }}
              </h2>
            </div>
            <button (click)="close()" class="modal-close" title="Close global log search panel" aria-label="Close global log search panel">&times;</button>
          </div>
          <div class="modal-body">
            <!-- Filter Toolbar -->
            <div class="elasticsearch-filters-toolbar">
              <div 
                class="filter-toggle-header"
                [class.expanded]="isFilterExpanded()"
                (click)="isFilterExpanded.set(!isFilterExpanded())"
                [title]="isFilterExpanded() ? 'Click to minimize filters' : 'Click to expand filters'"
              >
                <h3>
                  <i class="fas fa-filter"></i>
                  Search Filters
                </h3>
                <div class="btn-toggle-filter">
                  <i class="fas" [class.fa-minus]="isFilterExpanded()" [class.fa-plus]="!isFilterExpanded()"></i>
                </div>
              </div>

              @if (isFilterExpanded()) {
                <div class="advanced-filters-toggle-row">
                  <button
                    type="button"
                    class="btn-advanced-filters-toggle"
                    [disabled]="loading()"
                    (click)="isAdvancedFiltersExpanded.set(!isAdvancedFiltersExpanded())"
                  >
                    <i class="fas" [class.fa-chevron-down]="!isAdvancedFiltersExpanded()" [class.fa-chevron-up]="isAdvancedFiltersExpanded()"></i>
                    {{ isAdvancedFiltersExpanded() ? 'Hide advanced filters' : 'Show advanced filters' }}
                  </button>
                </div>

                @if (isAdvancedFiltersExpanded()) {
                  <div class="form-row">
                    @if (!hasFixedServiceName()) {
                      <div class="form-group">
                        <label for="serviceNameFilter">Service Name (Optional)</label>
                        <input
                          type="text"
                          id="serviceNameFilter"
                          placeholder="e.g., Gateway.API"
                          [value]="serviceNameFilter()"
                          (input)="onServiceNameFilterChange($event)"
                          [disabled]="loading()"
                        />
                      </div>
                    }

                    <div class="form-group">
                      <label for="podNameFilter">Pod Name (Optional)</label>
                      <input
                        type="text"
                        id="podNameFilter"
                        placeholder="e.g., result-656b49bfcb-sgh72"
                        [value]="podNameFilter()"
                        (input)="onPodNameFilterChange($event)"
                        [disabled]="loading()"
                      />
                    </div>

                    <div class="form-group">
                      <label for="logKeyFilter">Log Key (Optional)</label>
                      <input
                        type="text"
                        id="logKeyFilter"
                        placeholder="e.g., Gateway.API"
                        [value]="logKeyFilter()"
                        (input)="onLogKeyFilterChange($event)"
                        [disabled]="loading()"
                      />
                    </div>

                    <div class="form-group">
                      <label for="messageFilter">Message Filter (Optional)</label>
                      <input
                        type="text"
                        id="messageFilter"
                        placeholder="Search in message..."
                        [value]="messageFilter()"
                        (input)="onMessageFilterChange($event)"
                        [disabled]="loading()"
                      />
                    </div>

                    <div class="form-group">
                      <label for="logLevelFilter">Log Level (Optional)</label>
                      <div class="log-level-dropdown">
                        <button
                          type="button"
                          class="log-level-dropdown-toggle"
                          (click)="toggleLogLevelDropdown()"
                          [disabled]="loading()"
                          [attr.aria-expanded]="isLogLevelDropdownOpen()"
                        >
                          <span>{{ selectedLogLevelsLabel() }}</span>
                          <i class="fas" [class.fa-chevron-down]="!isLogLevelDropdownOpen()" [class.fa-chevron-up]="isLogLevelDropdownOpen()"></i>
                        </button>
                        @if (isLogLevelDropdownOpen()) {
                          <div class="log-level-dropdown-menu">
                            <label class="log-level-option">
                              <input
                                type="checkbox"
                                [checked]="isAllLogLevelsSelected()"
                                (change)="onAllLogLevelsToggle($event)"
                              />
                              <span>All</span>
                            </label>
                            @for (level of availableLogLevels; track level) {
                              <label class="log-level-option">
                                <input
                                  type="checkbox"
                                  [checked]="isLogLevelSelected(level)"
                                  (change)="onLogLevelToggle(level, $event)"
                                />
                                <span>{{ level }}</span>
                              </label>
                            }
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                }

                <div class="form-row">
                  <div class="form-group">
                    <label for="pageSize">Logs per Page</label>
                    <select
                      id="pageSize"
                      [value]="pageSize().toString()"
                      (change)="onPageSizeSelectChange($event)"
                      [disabled]="loading()"
                      class="page-size-select"
                    >
                      <option value="50">50 logs</option>
                      <option value="100">100 logs</option>
                      <option value="250">250 logs</option>
                      <option value="500">500 logs</option>
                      <option value="1000">1000 logs</option>
                    </select>
                  </div>
                </div>

                <div class="form-row time-range-row">
                  <div class="form-group">
                    <label for="timeFrom">Start Time</label>
                    <input
                      type="datetime-local"
                      step="1"
                      id="timeFrom"
                      [value]="timeFromInput()"
                      [min]="minDateTime()"
                      [max]="maxDateTime()"
                      (change)="onTimeFromChange($event)"
                      [disabled]="loading()"
                    />
                  </div>
                  <div class="form-group">
                    <label for="timeTo">End Time</label>
                    <input
                      type="datetime-local"
                      step="1"
                      id="timeTo"
                      [value]="timeToInput()"
                      [min]="minDateTime()"
                      [max]="maxDateTime()"
                      (change)="onTimeToChange($event)"
                      [disabled]="loading()"
                    />
                  </div>
                </div>
                @if (selectedDuration()) {
                  <div class="duration-display">
                    <i class="fas fa-clock"></i>
                    <span>Selected Duration: <strong>{{ selectedDuration() }}</strong></span>
                  </div>
                }
                <div class="time-presets-row">
                  <div class="time-presets">
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '1h'"
                      (click)="setTimePreset(1, '1h')"
                      title="Last 1 hour"
                      [disabled]="loading()"
                    >
                      1h
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '3h'"
                      (click)="setTimePreset(3, '3h')"
                      title="Last 3 hours"
                      [disabled]="loading()"
                    >
                      3h
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '24h'"
                      (click)="setTimePreset(24, '24h')"
                      title="Last 24 hours"
                      [disabled]="loading()"
                    >
                      24h
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '7d'"
                      (click)="setTimePreset(168, '7d')"
                      title="Last 7 days"
                      [disabled]="loading()"
                    >
                      7d
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '15d'"
                      (click)="setTimePresetDays(15, '15d')"
                      title="Last 15 days"
                      [disabled]="loading()"
                    >
                      15d
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '30d'"
                      (click)="setTimePresetDays(30, '30d')"
                      title="Last 30 days"
                      [disabled]="loading()"
                    >
                      30d
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '45d'"
                      (click)="setTimePresetDays(45, '45d')"
                      title="Last 45 days"
                      [disabled]="loading()"
                    >
                      45d
                    </button>
                    <button
                      type="button"
                      class="btn-time-preset"
                      [class.active]="selectedPreset() === '60d'"
                      (click)="setTimePresetDays(60, '60d')"
                      title="Last 60 days"
                      [disabled]="loading()"
                    >
                      60d
                    </button>
                  </div>
                  <div class="form-actions">
                    <button class="btn-search" (click)="applyFilters()" [disabled]="loading() || !canSearch()">
                      <i class="fas fa-search"></i>
                      Search Logs
                    </button>
                    <button class="btn-clear" (click)="clearFilters()" [disabled]="loading()">
                      Clear Log Filters
                    </button>
                  </div>
                </div>
              }
            </div>
            
            <!-- Logs Table -->
            <div class="elasticsearch-logs-container">
              @if (error()) {
                <div class="error-logs">
                  <i class="fas fa-exclamation-triangle"></i> {{ error() }}
                </div>
              } @else if (logs().length === 0 && !loading()) {
                <div class="no-logs">
                  @if (hasSearched()) {
                    No logs found matching your criteria. Try broadening the time range or clearing log filters.
                    <div class="empty-state-actions">
                      <button class="btn-clear" (click)="clearFilters()">Clear Log Filters</button>
                      <button class="btn-time-preset" (click)="setTimePreset(1, '1h')">Last 1h</button>
                      <button class="btn-time-preset" (click)="setTimePreset(24, '24h')">Last 24h</button>
                    </div>
                  } @else {
                    Enter search criteria and click "Search Logs" to find logs.
                  }
                </div>
              } @else {
                <div class="results-section">
                  <div class="results-header">
                    <div class="results-info">
                      <span class="results-count">
                        <strong>{{ total() }}</strong> Found
                      </span>
                      @if (clientSearchQuery()) {
                        <span class="filtered-count"> - Filtered to {{ filteredLogs().length }}</span>
                      }
                    </div>

                    <div class="header-controls">
                      <div class="focus-window-controls">
                        <label for="focusWindowSeconds">Window (sec)</label>
                        <input
                          id="focusWindowSeconds"
                          type="number"
                          min="1"
                          [value]="focusWindowSeconds()"
                          (change)="onFocusWindowSecondsChange($event)"
                          [disabled]="loading()"
                        />
                        @if (isFocusActive()) {
                          <button class="btn-clear-focus" (click)="clearFocusWindow()" [disabled]="loading()">
                            Clear Focus
                          </button>
                        }
                        @if (isPodFocusActive()) {
                          <button class="btn-clear-focus" (click)="clearPodFocus()" [disabled]="loading()">
                            Clear Pod
                          </button>
                        }
                      </div>

                      <button 
                        class="btn-sort" 
                        (click)="toggleSortOrder()"
                        [title]="sortOrder() === 'newest' ? 'Sorted: Newest first' : 'Sorted: Oldest first'"
                      >
                        <i class="fas" [class.fa-sort-amount-down]="sortOrder() === 'newest'" [class.fa-sort-amount-up]="sortOrder() === 'oldest'"></i>
                        <span>{{ sortOrder() === 'newest' ? 'Newest' : 'Oldest' }}</span>
                      </button>
                      
                      <div class="client-search-bar">
                        <i class="fas fa-search"></i>
                        <input
                          type="text"
                          placeholder="Filter displayed logs..."
                          [(ngModel)]="clientSearchQuery"
                          class="client-search-input"
                        />
                        @if (clientSearchQuery()) {
                          <button class="btn-clear-search" (click)="clientSearchQuery.set('')" title="Clear filter">
                            <i class="fas fa-times"></i>
                          </button>
                        }
                      </div>
                      
                      <button class="btn-icon-logs" (click)="refreshLogs()" [disabled]="loading()" title="Refresh Logs">
                        <i class="fas fa-sync-alt" [class.fa-spin]="loading()"></i>
                      </button>
                      <button class="btn-icon-logs" (click)="exportLogs()" [disabled]="exportingLogs()" title="Export Logs">
                        <i class="fas" [class.fa-download]="!exportingLogs()" [class.fa-spinner]="exportingLogs()" [class.fa-spin]="exportingLogs()"></i>
                        @if (exportingLogs()) {
                          <span>Exporting...</span>
                        }
                      </button>
                      @if (exportingLogs()) {
                        <span class="exporting-status">Preparing export...</span>
                      }
                    </div>
                  </div>

                  @if (isFocusActive()) {
                    <div class="focus-status">
                      <i class="fas fa-crosshairs"></i>
                      Showing logs within <strong>±{{ focusWindowSeconds() }}s</strong> of
                      <strong>{{ formatFocusAnchorTimestamp() }}</strong>
                      (<strong>{{ sortedAndFilteredLogs().length }}</strong> matches)
                    </div>
                  }
                  @if (isPodFocusActive()) {
                    <div class="focus-status">
                      <i class="fas fa-cube"></i>
                      Filtering by pod: <strong>{{ podNameFilter() }}</strong>
                    </div>
                  }

                  <div class="elasticsearch-logs-table-wrapper">
                    <table class="elasticsearch-logs-table">
                      <thead>
                        <tr>
                          <th class="timestamp-col">Timestamp</th>
                          <th class="service-col">Service Name</th>
                          <th class="process-id-col">Process Identifier</th>
                          <th class="message-col">Message</th>
                          <th class="log-level-col">Log Level</th>
                          <th class="log-key-col">Log Key</th>
                        </tr>
                      </thead>
                      <tbody>
                        @if (loading()) {
                          @for (row of skeletonRows; track row) {
                            <tr class="skeleton-row">
                              <td class="timestamp-col"><span class="table-skeleton skeleton-md"></span></td>
                              <td class="service-col"><span class="table-skeleton skeleton-sm"></span></td>
                              <td class="process-id-col"><span class="table-skeleton skeleton-sm"></span></td>
                              <td class="message-col"><span class="table-skeleton skeleton-lg"></span></td>
                              <td class="log-level-col"><span class="table-skeleton skeleton-badge"></span></td>
                              <td class="log-key-col"><span class="table-skeleton skeleton-sm"></span></td>
                            </tr>
                          }
                        } @else if (sortedAndFilteredLogs().length === 0) {
                          <tr>
                            <td colspan="6" class="no-matches">No logs match the current filters.</td>
                          </tr>
                        } @else {
                          @for (log of paginatedLogs(); track log.timestamp + (log.message || '') + (log.serviceName || '') + $index) {
                            <tr [class.expanded]="expandedRows().has($index)" [class.focus-anchor-row]="isFocusAnchor(log)" class="log-row">
                              <td class="timestamp-col">
                                <div class="timestamp-content">
                                  <span>{{ formatTimestamp(log.timestamp) }}</span>
                                  <button
                                    type="button"
                                    class="btn-focus-icon"
                                    (click)="focusAroundLog(log)"
                                    [disabled]="loading()"
                                    [title]="'Show logs ±' + focusWindowSeconds() + ' seconds around this timestamp'"
                                  >
                                    <i class="fas fa-crosshairs"></i>
                                  </button>
                                </div>
                              </td>
                              <td class="service-col">
                                @if (log.serviceName) {
                                  @if (shouldShowServiceFilterLink(log)) {
                                    <button
                                      type="button"
                                      class="table-filter-link"
                                      (click)="applyServiceFocus(log)"
                                      [disabled]="loading()"
                                      title="Filter to this service"
                                    >
                                      {{ log.serviceName }}
                                    </button>
                                  } @else {
                                    <span>{{ log.serviceName }}</span>
                                  }
                                } @else {
                                  <span>N/A</span>
                                }
                              </td>
                              <td class="process-id-col">
                                <div class="process-id-content">
                                  @if (hasProcessIdentifier(log)) {
                                    @if (shouldShowPodFilterLink(log)) {
                                      <button
                                        type="button"
                                        class="table-filter-link"
                                        (click)="applyPodFocus(log)"
                                        [disabled]="loading()"
                                        title="Filter to this container/pod"
                                      >
                                        {{ getProcessIdentifier(log.podName) }}
                                      </button>
                                    } @else {
                                      <span>{{ getProcessIdentifier(log.podName) }}</span>
                                    }
                                  } @else {
                                    <span>N/A</span>
                                  }
                                </div>
                              </td>
                              <td class="message-col">
                                <div class="message-content" [title]="log.message || 'N/A'">
                                  {{ getMessagePreview(log.message) }}
                                  @if ((log.message?.length ?? 0) > messagePreviewLength) {
                                    <button type="button" class="btn-show-full-message" (click)="$event.stopPropagation(); openFullMessage(log.message!, $event)" title="Show full message">
                                      <i class="fas fa-expand-alt"></i> Full message
                                    </button>
                                  }
                                  @if (log.exception) {
                                    <button class="expand-btn" (click)="toggleDetails($index)">
                                      <i class="fas" [class.fa-chevron-down]="!expandedRows().has($index)" [class.fa-chevron-up]="expandedRows().has($index)"></i>
                                    </button>
                                  }
                                </div>
                                @if (expandedRows().has($index) && log.exception) {
                                  <div class="log-details">
                                    <div class="detail-row">
                                      <strong>Exception:</strong>
                                      <pre>{{ log.exception }}</pre>
                                    </div>
                                  </div>
                                }
                              </td>
                              <td class="log-level-col">
                                @if (log.logLevel) {
                                  @if (shouldShowLogLevelFilterLink(log)) {
                                    <button
                                      type="button"
                                      class="log-level-badge table-filter-badge-link"
                                      [class.level-info]="log.logLevel.toLowerCase().includes('info')"
                                      [class.level-warning]="log.logLevel.toLowerCase().includes('warn')"
                                      [class.level-error]="log.logLevel.toLowerCase().includes('error')"
                                      (click)="applyLogLevelFocus(log)"
                                      [disabled]="loading()"
                                      title="Filter to this log level"
                                    >
                                      {{ log.logLevel }}
                                    </button>
                                  } @else {
                                    <span class="log-level-badge" 
                                          [class.level-info]="log.logLevel.toLowerCase().includes('info')"
                                          [class.level-warning]="log.logLevel.toLowerCase().includes('warn')"
                                          [class.level-error]="log.logLevel.toLowerCase().includes('error')">
                                      {{ log.logLevel }}
                                    </span>
                                  }
                                } @else {
                                  N/A
                                }
                              </td>
                              <td class="log-key-col">
                                @if (log.logKey) {
                                  @if (shouldShowLogKeyFilterLink(log)) {
                                    <button
                                      type="button"
                                      class="table-filter-link"
                                      (click)="applyLogKeyFocus(log)"
                                      [disabled]="loading()"
                                      title="Filter to this log key"
                                    >
                                      {{ log.logKey }}
                                    </button>
                                  } @else {
                                    <span>{{ log.logKey }}</span>
                                  }
                                } @else {
                                  <span>N/A</span>
                                }
                              </td>
                            </tr>
                          }
                        }
                      </tbody>
                    </table>
                    @if (fullMessagePopup(); as popup) {
                      <div
                        class="full-message-popover"
                        [ngStyle]="{ top: popup.top + 'px', left: popup.left + 'px' }"
                      >
                        <div class="full-message-popover-header">
                          <span>Full message</span>
                          <div class="full-message-popover-actions">
                            <button type="button" class="btn-copy-popover" (click)="copyFullMessageToClipboard()" [title]="copyMessageFeedback() || 'Copy message'">
                              <i class="fas fa-copy"></i> {{ copyMessageFeedback() || 'Copy' }}
                            </button>
                            <button type="button" class="btn-close-popover" (click)="closeFullMessagePopup()">&times;</button>
                          </div>
                        </div>
                        <div class="full-message-popover-body">
                          <pre class="full-message-popover-text">{{ popup.message }}</pre>
                        </div>
                      </div>
                    }
                  </div>

                  <!-- Pagination -->
                  @if (loading() && !hasKnownPaginationLength()) {
                    <div class="pagination-controls pagination-skeleton">
                      <div class="pagination-info">
                        <span class="table-skeleton pagination-skeleton-info"></span>
                      </div>
                      <div class="pagination-buttons">
                        <span class="table-skeleton pagination-skeleton-btn"></span>
                        <span class="table-skeleton pagination-skeleton-btn"></span>
                        <span class="table-skeleton pagination-skeleton-pages"></span>
                        <span class="table-skeleton pagination-skeleton-btn"></span>
                        <span class="table-skeleton pagination-skeleton-btn"></span>
                      </div>
                    </div>
                  } @else if (hasKnownPaginationLength()) {
                    <div class="pagination-controls">
                      <div class="pagination-info">
                        @if (clientSearchQuery().trim()) {
                          @let start = ((currentPage() - 1) * pageSize()) + 1;
                          @let end = Math.min(currentPage() * pageSize(), sortedAndFilteredLogs().length);
                          @let total = sortedAndFilteredLogs().length;
                          Showing <strong>{{ start }}</strong> to <strong>{{ end }}</strong> of <strong>{{ total }}</strong> filtered logs
                        } @else {
                          @let start = ((currentPage() - 1) * pageSize()) + 1;
                          @let end = Math.min(currentPage() * pageSize(), total());
                          @let totalCount = total();
                          Showing <strong>{{ start }}</strong> to <strong>{{ end }}</strong> of <strong>{{ totalCount }}</strong> total logs
                        }
                      </div>
                      <div class="pagination-buttons">
                        <button 
                          class="btn-pagination" 
                          (click)="goToPage(1)"
                          [disabled]="currentPage() === 1 || loading()"
                          title="First page"
                        >
                          <i class="fas fa-angle-double-left"></i>
                        </button>
                        <button 
                          class="btn-pagination" 
                          (click)="goToPage(currentPage() - 1)"
                          [disabled]="currentPage() === 1 || loading()"
                          title="Previous page"
                        >
                          <i class="fas fa-angle-left"></i>
                        </button>
                        <span class="page-numbers">
                          @for (page of visiblePages(); track page) {
                            @if (page === -1) {
                              <span class="pagination-ellipsis">...</span>
                            } @else {
                              <button 
                                class="btn-pagination-number"
                                [class.active]="page === currentPage()"
                                (click)="goToPage(page)"
                                [disabled]="loading()"
                              >
                                {{ page }}
                              </button>
                            }
                          }
                        </span>
                        <button 
                          class="btn-pagination" 
                          (click)="goToPage(currentPage() + 1)"
                          [disabled]="currentPage() === totalPages() || loading()"
                          title="Next page"
                        >
                          <i class="fas fa-angle-right"></i>
                        </button>
                        <button 
                          class="btn-pagination" 
                          (click)="goToPage(totalPages())"
                          [disabled]="currentPage() === totalPages() || loading()"
                          title="Last page"
                        >
                          <i class="fas fa-angle-double-right"></i>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      </div>

    }
  `,
  styles: [
    `
      .search-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        height: calc(100vh*20);
        background: var(--theme-bg-overlay-backdrop);
        z-index: var(--z-modal-backdrop, 1000000);
        pointer-events: auto;
      }
      .modal-content {
        background: var(--theme-bg-app);
        border-radius: 12px;
        border: 1px solid var(--theme-border-gray-light);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 0;
        box-shadow: var(--theme-shadow-lg);
        pointer-events: auto;
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 0.9rem 1.25rem;
        border-bottom: 1px solid var(--theme-border-teal-dark);
        background: var(--theme-header-gradient);
        color: var(--theme-bg-surface);
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
        padding: 0;
        min-height: 0;
        background: var(--theme-bg-app);
      }
      
      /* Filter Toolbar - Reuse styles from elasticsearch-logs-viewer */
      .elasticsearch-filters-toolbar {
        background: var(--theme-bg-app);
        padding: 0.75rem;
        border-bottom: 2px solid var(--theme-border-gray-light);
        display: flex;
        flex-direction: column;
      }

      .filter-toggle-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        cursor: pointer;
        transition: all 0.2s;
        padding: 0.75rem;
        margin: -0.75rem -0.75rem 0 -0.75rem;
        border-radius: 6px 6px 0 0;
        background-color: var(--theme-bg-app);
      }

      .filter-toggle-header.expanded {
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid var(--theme-border-gray);
      }

      .filter-toggle-header:hover {
        background: var(--theme-bg-app);
      }

      .filter-toggle-header h3 {
        margin: 0;
        font-size: var(--theme-font-section-title);
        color: var(--theme-text-gray-dark);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        user-select: none;
      }

      .filter-toggle-header h3 i {
        color: var(--theme-text-teal);
      }

      .btn-toggle-filter {
        padding: 0.5rem;
        width: 36px;
        height: 36px;
        background: var(--theme-bg-app);
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        pointer-events: none;
      }

      .filter-toggle-header:hover .btn-toggle-filter {
        background: var(--theme-bg-app);
        border-color: var(--theme-border-teal);
      }

      .btn-toggle-filter i {
        font-size: var(--theme-font-body);
        transition: color 0.2s;
      }

      .btn-toggle-filter .fa-minus {
        color: var(--theme-button-danger);
      }

      .btn-toggle-filter .fa-plus {
        color: var(--theme-button-success);
      }

      .form-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .advanced-filters-toggle-row {
        margin: 0 0 0.8rem;
      }

      .btn-advanced-filters-toggle {
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        color: var(--theme-table-header-color);
        border-radius: 8px;
        padding: 0.35rem 0.65rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
      }

      .form-group {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .form-group label {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
      }

      .form-group input[type="text"],
      .form-group select {
        padding: 0.5rem 0.75rem;
        border: 2px solid var(--theme-border-gray-light);
        border-radius: 6px;
        font-size: var(--theme-font-body);
        background: var(--theme-bg-surface);
        transition: all 0.2s;
      }

      .form-group input[type="text"]:focus,
      .form-group select:focus {
        outline: none;
        border-color: var(--theme-border-teal);
        box-shadow: 0 0 0 3px var(--theme-button-primary-shadow);
      }

      .form-group input[type="text"]:disabled,
      .form-group select:disabled {
        background: var(--theme-bg-app);
        cursor: not-allowed;
      }

      .time-range-row {
        margin-bottom: 0.5rem;
      }

      .duration-display {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.75rem 1rem;
        background: var(--theme-bg-teal-lighter);
        border: 1px solid var(--theme-border-teal);
        border-radius: 6px;
        margin-bottom: 0.5rem;
        font-size: var(--theme-font-body);
        color: var(--theme-text-teal-dark);
      }

      .duration-display i {
        color: var(--theme-text-teal);
      }

      .duration-display strong {
        color: var(--theme-text-teal-dark);
        font-weight: var(--theme-font-table-header-weight);
      }

      .time-presets-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: .5rem;
        gap: 1rem;
      }

      .time-presets {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .form-actions {
        display: flex;
        gap: 0.75rem;
        margin-top: 0;
      }

      .btn-search,
      .btn-clear {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s;
      }

      .btn-search {
        background: var(--theme-button-primary);
        color: white;
      }

      .btn-search:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }

      .btn-search:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-clear {
        background: var(--theme-bg-app);
        color: var(--theme-text-gray-dark);
        border: 2px solid var(--theme-border-gray-light);
      }

      .btn-clear:hover:not(:disabled) {
        background: var(--theme-bg-app);
        border-color: var(--theme-border-gray);
      }

      .form-group input[type="datetime-local"] {
        padding: 0.5rem 0.75rem;
        border: 2px solid var(--theme-border-gray-light);
        border-radius: 6px;
        font-size: var(--theme-font-body);
        background: var(--theme-bg-surface);
        cursor: pointer;
        transition: all 0.2s;
      }

      .form-group input[type="datetime-local"]:focus {
        outline: none;
        border-color: var(--theme-border-teal);
        box-shadow: 0 0 0 3px var(--theme-button-primary-shadow);
      }

      .btn-time-preset {
        padding: 0.5rem 0.75rem;
        border: 2px solid var(--theme-border-gray-light);
        background: var(--theme-bg-app);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
        transition: all 0.2s;
      }

      .btn-time-preset:hover:not(:disabled) {
        background: var(--theme-button-primary);
        color: var(--theme-bg-surface);
        border-color: var(--theme-button-primary);
      }

      .btn-time-preset:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-time-preset.active {
        background: var(--theme-button-primary);
        color: var(--theme-bg-surface);
        border-color: var(--theme-button-primary);
        box-shadow: var(--theme-shadow-sm);
      }

      .btn-time-preset.active:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
        border-color: var(--theme-button-primary-hover);
      }

      /* Logs Container - Reuse styles from elasticsearch-logs-viewer */
      .elasticsearch-logs-container {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        padding: 0.75rem;
        min-height: 0;
      }

      .results-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }

      .results-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
        padding: 0.75rem;
        background: var(--theme-bg-app);
        border-radius: 6px;
        border: 1px solid var(--theme-border-gray);
        flex-shrink: 0;
      }

      .results-info {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .results-count {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
      }

      .filtered-count {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
        font-style: italic;
      }

      .header-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .focus-window-controls {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.5rem;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        background: var(--theme-bg-app);
      }

      .focus-window-controls label {
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-gray-dark);
        font-weight: var(--theme-font-table-body-weight);
        white-space: nowrap;
      }

      .focus-window-controls input {
        width: 80px;
        padding: 0.375rem 0.5rem;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 4px;
        font-size: var(--theme-font-table-header);
        background: var(--theme-bg-surface);
      }

      .btn-clear-focus {
        padding: 0.375rem 0.625rem;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 4px;
        background: var(--theme-bg-app);
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-gray-dark);
        cursor: pointer;
      }

      .btn-clear-focus:hover:not(:disabled) {
        background: var(--theme-bg-app);
      }

      .log-level-dropdown {
        position: relative;
      }

      .log-level-dropdown-toggle {
        width: 100%;
        min-height: 38px;
        padding: 0.5rem 0.75rem;
        border: 2px solid var(--theme-border-gray-light);
        border-radius: 6px;
        background: var(--theme-bg-surface);
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
        cursor: pointer;
      }

      .log-level-dropdown-toggle:disabled {
        background: var(--theme-bg-app);
        cursor: not-allowed;
      }

      .log-level-dropdown-menu {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        width: 100%;
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        box-shadow: var(--theme-shadow-popover);
        padding: 0.5rem;
        z-index: var(--z-sticky, 10);
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .log-level-option {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
      }

      .focus-status {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.625rem 0.75rem;
        border: 1px solid var(--theme-border-teal);
        border-radius: 6px;
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-text-teal-dark);
        font-size: var(--theme-font-body);
      }

      .focus-status i {
        color: var(--theme-text-teal);
      }

      .btn-sort {
        padding: 0.5rem 0.75rem;
        background: var(--theme-bg-app);
        color: var(--theme-text-gray-dark);
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .btn-sort:hover {
        background: var(--theme-bg-app);
        border-color: var(--theme-border-teal);
        color: var(--theme-text-teal);
      }

      .client-search-bar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: var(--theme-bg-app);
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        min-width: 300px;
        transition: all 0.2s;
      }

      .client-search-bar:focus-within {
        border-color: var(--theme-border-teal);
        box-shadow: 0 0 0 3px var(--theme-button-primary-shadow);
      }

      .client-search-input {
        flex: 1;
        border: none;
        outline: none;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
        background: transparent;
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

      .btn-icon-logs {
        padding: 8px 12px;
        border: 2px solid var(--theme-border-gray-light);
        background: var(--theme-bg-app);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
      }
      .btn-icon-logs:hover:not(:disabled) {
        background: var(--theme-bg-surface);
        border-color: var(--theme-button-primary);
      }
      .btn-icon-logs:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .exporting-status {
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-teal);
        font-weight: var(--theme-font-table-body-weight);
      }

      .elasticsearch-logs-table-wrapper {
        flex: 1 1 0;
        min-height: 0;
        overflow-y: auto;
        overflow-x: hidden;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 8px;
        background: var(--theme-bg-surface);
        position: relative;
      }
      .elasticsearch-logs-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .elasticsearch-logs-table thead {
        position: sticky;
        top: 0;
        background: var(--theme-bg-app);
        z-index: var(--z-sticky, 10);
        box-shadow: var(--theme-shadow-sm);
      }
      .elasticsearch-logs-table th {
        padding: 3px 7px;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
        border-bottom: 2px solid var(--theme-border-gray-light);
        white-space: nowrap;
        font-size: var(--theme-font-table-header);
        line-height: 1.1;
      }
      .elasticsearch-logs-table tbody tr {
        border-bottom: 1px solid var(--theme-bg-gray-light);
        transition: background 0.2s;
      }
      .elasticsearch-logs-table tbody tr:hover {
        background: var(--theme-bg-app);
      }

      .elasticsearch-logs-table tbody tr.skeleton-row:hover {
        background: transparent;
      }

      .table-skeleton {
        display: inline-block;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          var(--theme-skeleton-base) 25%,
          var(--theme-skeleton-highlight) 50%,
          var(--theme-skeleton-base) 75%
        );
        background-size: 200% 100%;
        animation: table-skeleton-shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-sm {
        width: 80px;
        height: 12px;
      }

      .skeleton-md {
        width: 140px;
        height: 12px;
      }

      .skeleton-lg {
        width: 95%;
        height: 12px;
      }

      .skeleton-badge {
        width: 70px;
        height: 20px;
        border-radius: 6px;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
      .elasticsearch-logs-table td {
        padding: 3px 7px;
        vertical-align: top;
        overflow: hidden;
        font-size: var(--theme-font-table-body);
        line-height: 1;
      }
      .timestamp-col {
        white-space: nowrap;
        width: 12%;
        min-width: 155px;
        overflow: visible;
      }
      .service-col {
        width: 16%;
        min-width: 145px;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      .process-id-col {
        width: 7%;
        min-width: 62px;
        white-space: nowrap;
      }
      .process-id-content {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 2px;
      }
      .process-id-content span {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .table-filter-link {
        border: none;
        background: transparent;
        color: var(--theme-text-teal);
        text-decoration: underline;
        cursor: pointer;
        padding: 0;
        font: inherit;
        text-align: left;
      }
      .table-filter-link:hover:not(:disabled) {
        color: var(--theme-text-teal-dark);
      }
      .table-filter-link:disabled {
        opacity: 0.55;
        cursor: not-allowed;
        text-decoration: none;
      }
      .table-filter-badge-link {
        border: none;
        cursor: pointer;
      }
      .table-filter-badge-link:disabled {
        opacity: 0.55;
        cursor: not-allowed;
      }
      .message-col {
        width: 41%;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .log-level-col {
        width: 7%;
        min-width: 62px;
      }
      .log-key-col {
        width: 13%;
        min-width: 90px;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      .log-level-badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        text-transform: uppercase;
      }
      .log-level-badge.level-info {
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-button-primary-hover);
      }
      .log-level-badge.level-warning {
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-button-warning);
        color: var(--theme-button-warning-hover);
      }
      .log-level-badge.level-error {
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-button-danger);
        color: var(--theme-button-danger-hover);
      }
      .message-content {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: anywhere;
        white-space: normal;
        min-width: 0;
        max-width: 100%;
      }
      .timestamp-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 2px;
        width: 100%;
        min-width: 0;
      }

      .timestamp-content span {
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }

      .btn-focus-icon {
        width: 20px;
        height: 20px;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 4px;
        background: var(--theme-bg-app);
        color: var(--theme-text-gray-dark);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: var(--theme-font-caption);
      }

      .btn-focus-icon:hover:not(:disabled) {
        border-color: var(--theme-border-teal);
        color: var(--theme-text-teal-dark);
        background: var(--theme-bg-teal-lighter);
      }

      .focus-anchor-row {
        background: var(--theme-bg-teal-lighter) !important;
      }
      .elasticsearch-logs-table tbody tr.expanded {
        background: var(--theme-bg-app);
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
      .log-details {
        margin-top: 12px;
        padding: 12px;
        background: var(--theme-bg-surface);
        border-radius: 6px;
        border: 1px solid var(--theme-border-gray-light);
      }
      .detail-row strong {
        display: block;
        margin-bottom: 4px;
        color: var(--theme-text-dark);
      }
      .detail-row pre {
        margin: 0;
        padding: 8px;
        background: var(--theme-bg-app);
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        overflow-x: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
        font-family: 'Consolas', 'Courier New', monospace;
      }
      .error-logs, .no-logs, .no-matches {
        text-align: center;
        padding: 2rem;
        color: var(--theme-text-gray);
      }
      .error-logs {
        color: var(--theme-button-danger);
      }
      .no-logs {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.75rem;
      }

      .empty-state-actions {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        justify-content: center;
      }

      .pagination-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem;
        background: var(--theme-bg-app);
        border-top: 1px solid var(--theme-border-gray);
        border-radius: 0 0 8px 8px;
        gap: 1rem;
        flex-wrap: wrap;
        flex-shrink: 0;
      }

      .pagination-info {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
      }

      .pagination-buttons {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .pagination-skeleton .pagination-skeleton-info {
        display: inline-block;
        width: 280px;
        height: 12px;
      }

      .pagination-skeleton .pagination-skeleton-btn {
        display: inline-block;
        width: 36px;
        height: 32px;
        border-radius: 6px;
      }

      .pagination-skeleton .pagination-skeleton-pages {
        display: inline-block;
        width: 140px;
        height: 32px;
        border-radius: 6px;
      }

      .btn-pagination,
      .btn-pagination-number {
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--theme-border-gray-light);
        background: var(--theme-bg-app);
        color: var(--theme-text-gray-dark);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        transition: all 0.2s;
        min-width: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .btn-pagination:hover:not(:disabled),
      .btn-pagination-number:hover:not(:disabled) {
        background: var(--theme-bg-app);
        border-color: var(--theme-border-teal);
        color: var(--theme-text-teal);
      }

      .btn-pagination:disabled,
      .btn-pagination-number:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-pagination-number.active {
        background: var(--theme-button-primary);
        color: var(--theme-bg-surface);
        border-color: var(--theme-button-primary);
      }

      .page-numbers {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }

      .pagination-ellipsis {
        padding: 0.5rem 0.25rem;
        color: var(--theme-text-gray);
        user-select: none;
        font-size: var(--theme-font-body);
      }

      .btn-show-full-message {
        flex-shrink: 0;
        padding: 0.25rem 0.5rem;
        font-size: var(--theme-font-caption);
        color: var(--theme-button-primary);
        background: transparent;
        border: 1px solid currentColor;
        border-radius: 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
        white-space: nowrap;
      }
      .btn-show-full-message:hover {
        background: var(--theme-bg-primary-soft);
      }

      .full-message-popover {
        position: absolute;
        z-index: var(--z-modal-content, 1000001);
        background: var(--theme-bg-surface);
        border-radius: 8px;
        box-shadow: var(--theme-shadow-popover-sm);
        border: 1px solid var(--theme-border-gray);
        width: min(420px, 90vw);
        max-height: min(2080px, 85vh);
        min-height: 400px;
        display: flex;
        flex-direction: column;
        pointer-events: auto;
      }
      .full-message-popover-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--theme-border-gray);
        flex-shrink: 0;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray-dark);
      }
      .full-message-popover-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .btn-copy-popover {
        padding: 0.25rem 0.5rem;
        font-size: var(--theme-font-caption);
        color: var(--theme-button-primary);
        background: transparent;
        border: 1px solid currentColor;
        border-radius: 4px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
      }
      .btn-copy-popover:hover {
        background: var(--theme-bg-primary-soft);
      }
      .btn-close-popover {
        background: none;
        border: none;
        font-size: var(--theme-font-page-title);
        line-height: 1;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 0.25rem;
      }
      .btn-close-popover:hover {
        color: var(--theme-text-gray-dark);
      }
      .full-message-popover-body {
        padding: 0.75rem 1rem;
        overflow-y: auto;
        overflow-x: hidden;
        flex: 1 1 0;
        min-height: 0;
        max-height: min(1800px, 75vh);
      }
      .full-message-popover-text {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-size: var(--theme-font-table-header);
        font-family: 'Consolas', 'Courier New', monospace;
        color: var(--theme-text-dark);
      }
    `,
  ],
})
export class GlobalElasticsearchSearchComponent implements OnInit, OnDestroy, OnChanges {
  @Input() title = 'Global Log Search';
  @Input() fixedServiceName: string | null = null;
  @Input() initialVisible = false;
  @Input() exportFileNamePrefix = 'elasticsearch-logs';
  @Input() contextKey: string | null = null;
  @Input() routeQueryMode = false;
  @Output() closed = new EventEmitter<void>();

  // Expose Math for template
  Math = Math;
  private readonly exportMaxSize = 10000;
  private readonly defaultPageSize = 250;
  
  private elasticsearchService = inject(ElasticsearchService);
  private viewportScaleService = inject(ViewportScaleService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  visible = signal(false);
  logs = signal<ElasticsearchLogEntry[]>([]);
  total = signal(0);
  loading = signal(false);
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
  exportingLogs = signal(false);
  error = signal<string>('');
  hasSearched = signal(false);

  // Filter state
  isFilterExpanded = signal(true);
  isAdvancedFiltersExpanded = signal(false);
  serviceNameFilter = signal('');
  podNameFilter = signal('');
  messageFilter = signal('');
  logKeyFilter = signal('');
  logLevelFilter = signal<string[]>([]);
  isLogLevelDropdownOpen = signal(false);
  readonly availableLogLevels: string[] = ['Trace', 'Information', 'Debug', 'Warning', 'Error'];
  timeFrom = signal<Date | null>(null);
  timeTo = signal<Date | null>(null);
  sortOrder = signal<'newest' | 'oldest'>('newest');
  clientSearchQuery = signal('');
  focusWindowSeconds = signal(30);
  focusAnchorTimestampMs = signal<number | null>(null);
  focusPreviousRange = signal<{ from: Date | null; to: Date | null } | null>(null);
  
  // Track selected preset (null = no preset, '1h' | '3h' | '24h' | '7d' | '15d' | '30d' | '45d' | '60d')
  selectedPreset = signal<string | null>(null);
  
  // Pagination state
  currentPage = signal(1);
  pageSize = signal(this.defaultPageSize);

  // Expanded rows state
  expandedRows = signal<Set<number>>(new Set());

  /** Max characters to show in the Message column before truncation. */
  messagePreviewLength = 125;

  /** Popup state for full message view (position anchors the popover to the button). */
  fullMessagePopup = signal<{ message: string; top: number; left: number } | null>(null);

  /** Brief "Copied!" feedback after copy. */
  copyMessageFeedback = signal<string>('');

  private fullMessageScrollCleanup: (() => void) | null = null;
  private syncingRoute = false;
  /** Server-side query params only (excludes client `q`); used to avoid ES reload when only the displayed-logs filter changes. */
  private prevServerParamsSignature = '';
  private routeQueryParamsSub: Subscription | null = null;
  private routeSyncReady = signal(false);
  private readonly allowedPresets = new Set(['1h', '3h', '24h', '7d', '15d', '30d', '45d', '60d']);
  private readonly modalParamKeys = ['globalLogs', 'svc', 'pod', 'key', 'msg', 'levels', 'from', 'to', 'preset', 'size', 'page', 'sort', 'q', 'searched', 'focusSec'];

  private readonly routeSyncEffect = effect(() => {
    if (!this.routeQueryMode || !this.routeSyncReady() || this.syncingRoute || !this.visible()) {
      return;
    }
    this.syncRouteToQueryParams();
  });

  // Computed values for datetime-local inputs
  timeFromInput = computed(() => {
    const date = this.timeFrom();
    if (!date) return '';
    return this.formatDateTimeLocal(date);
  });

  timeToInput = computed(() => {
    const date = this.timeTo();
    if (!date) return '';
    return this.formatDateTimeLocal(date);
  });

  // Computed values for min/max attributes
  minDateTime = computed(() => {
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    return this.formatDateTimeLocal(sixtyDaysAgo);
  });

  maxDateTime = computed(() => {
    const now = new Date();
    return this.formatDateTimeLocal(now);
  });

  // Computed duration display
  selectedDuration = computed(() => {
    const from = this.timeFrom();
    const to = this.timeTo();
    
    if (!from || !to) {
      return '';
    }
    
    const diffMs = to.getTime() - from.getTime();
    if (diffMs < 0) {
      return 'Invalid range';
    }
    
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    
    if (diffDays > 0) {
      const hours = diffHours % 24;
      if (hours > 0) {
        return `${diffDays} day${diffDays !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`;
      }
      return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    } else if (diffHours > 0) {
      const minutes = diffMinutes % 60;
      if (minutes > 0) {
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''}, ${minutes} minute${minutes !== 1 ? 's' : ''}`;
      }
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
    } else if (diffMinutes > 0) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''}`;
    } else {
      return `${diffSeconds} second${diffSeconds !== 1 ? 's' : ''}`;
    }
  });

  // Sorted and filtered logs (client-side)
  sortedAndFilteredLogs = computed(() => {
    let result = [...this.logs()];
    
    // Apply client-side search filter
    const query = this.clientSearchQuery().toLowerCase().trim();
    if (query) {
      result = result.filter(log => {
        const searchableText = [
          log.serviceName || '',
          log.podName || '',
          log.message || '',
          log.logKey || '',
          log.logLevel || '',
        ].join(' ').toLowerCase();
        return searchableText.includes(query);
      });
    }

    // Sort
    result.sort((a, b) => {
      const dateA = this.parseTimestampMs(a.timestamp);
      const dateB = this.parseTimestampMs(b.timestamp);
      if (dateA === null && dateB === null) return 0;
      if (dateA === null) return 1;
      if (dateB === null) return -1;
      return this.sortOrder() === 'newest' ? dateB - dateA : dateA - dateB;
    });

    return result;
  });

  filteredLogs = computed(() => this.sortedAndFilteredLogs());

  paginatedLogs = computed(() => {
    // If there's a client-side search query, paginate the filtered results
    if (this.clientSearchQuery().trim()) {
      const allLogs = this.sortedAndFilteredLogs();
      const start = (this.currentPage() - 1) * this.pageSize();
      const end = start + this.pageSize();
      return allLogs.slice(start, end);
    }
    // Otherwise, return the logs from the server (already paginated)
    return this.sortedAndFilteredLogs();
  });

  totalPages = computed(() => {
    const total = this.clientSearchQuery().trim() 
      ? this.sortedAndFilteredLogs().length 
      : this.total();
    return Math.ceil(total / this.pageSize());
  });

  hasKnownPaginationLength = computed(() => {
    if (this.clientSearchQuery().trim()) {
      return this.sortedAndFilteredLogs().length > 0;
    }
    return this.total() > 0;
  });

  visiblePages = computed(() => {
    const current = this.currentPage();
    const total = this.totalPages();
    const pages: number[] = [];
    
    if (total <= 7) {
      for (let i = 1; i <= total; i++) {
        pages.push(i);
      }
    } else {
      if (current <= 3) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push(-1); // ellipsis
        pages.push(total);
      } else if (current >= total - 2) {
        pages.push(1);
        pages.push(-1);
        for (let i = total - 4; i <= total; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push(-1);
        for (let i = current - 1; i <= current + 1; i++) pages.push(i);
        pages.push(-1);
        pages.push(total);
      }
    }
    
    return pages;
  });

  modalStyle = computed(() => {
    if (typeof window === 'undefined' || !this.visible()) {
      return {};
    }
    
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    
    const visibleHeight = viewportHeight / scale;

    const topSafeOffset = 120;
    const panelHeight = Math.min(94 * baseHeight / 100, Math.max(320, visibleHeight - topSafeOffset - 24));

    return {
      width: '90%',
      maxWidth: '1600px',
      height: `${panelHeight}px`,
      margin: 'auto',
      marginTop: 'max(8vh, 120px)',
    };
  });

  canSearch = computed(() => {
    return true;
  });

  hasFixedServiceName(): boolean {
    return !!this.fixedServiceName?.trim();
  }

  private effectiveServiceName(): string | undefined {
    const fixed = this.fixedServiceName?.trim();
    if (fixed) return fixed;
    return this.serviceNameFilter().trim() || undefined;
  }

  private resetResultsState(): void {
    this.logs.set([]);
    this.total.set(0);
    this.hasSearched.set(false);
    this.currentPage.set(1);
    this.error.set('');
    this.closeFullMessagePopup();
  }

  ngOnInit(): void {
    // Set default time range to last 24 hours
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    this.timeFrom.set(yesterday);
    this.timeTo.set(now);
    this.selectedPreset.set('24h'); // Set to 24h preset
    this.pageSize.set(this.defaultPageSize);
    this.visible.set(this.initialVisible);

    if (this.routeQueryMode) {
      this.routeQueryParamsSub = this.route.queryParamMap.subscribe((params) => {
        const isOpen = params.get('globalLogs') === '1';
        this.visible.set(isOpen);
        this.routeSyncReady.set(isOpen);

        if (!isOpen) {
          this.prevServerParamsSignature = '';
          this.resetResultsState();
          return;
        }

        // Own navigate from syncRouteToQueryParams — state already matches; skip duplicate loadLogs.
        if (this.syncingRoute) {
          this.applyRouteQueryParams(params);
          this.prevServerParamsSignature = this.getServerParamsSignature(params);
          return;
        }

        this.applyRouteQueryParams(params);
        const serverSig = this.getServerParamsSignature(params);
        const serverParamsChanged = serverSig !== this.prevServerParamsSignature;
        this.prevServerParamsSignature = serverSig;

        if (this.hasSearched()) {
          if (serverParamsChanged) {
            this.loadLogs();
          }
        } else {
          this.resetResultsState();
        }
      });
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialVisible'] && !changes['initialVisible'].firstChange) {
      this.visible.set(!!changes['initialVisible'].currentValue);
    }

    if (changes['contextKey'] && !changes['contextKey'].firstChange) {
      this.resetResultsState();
      this.visible.set(this.initialVisible);
    }
  }

  ngOnDestroy(): void {
    this.detachFullMessageScrollListeners();
    this.routeQueryParamsSub?.unsubscribe();
    this.routeQueryParamsSub = null;
  }

  open(): void {
    if (!this.routeQueryMode) {
      this.visible.set(true);
      return;
    }
    this.syncingRoute = true;
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: false,
      queryParamsHandling: 'merge',
      queryParams: { globalLogs: '1' }
    }).finally(() => {
      this.syncingRoute = false;
    });
  }

  close(): void {
    this.closeFullMessagePopup();
    if (this.routeQueryMode) {
      this.syncingRoute = true;
      this.router.navigate([], {
        relativeTo: this.route,
        replaceUrl: true,
        queryParamsHandling: 'merge',
        queryParams: this.modalParamKeys.reduce<Record<string, null>>((acc, key) => {
          acc[key] = null;
          return acc;
        }, {})
      }).finally(() => {
        this.syncingRoute = false;
      });
    } else {
      this.visible.set(false);
    }
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  onServiceNameFilterChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (this.hasFixedServiceName()) {
      return;
    }
    this.serviceNameFilter.set(value);
  }

  onPodNameFilterChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.podNameFilter.set(value);
  }

  onLogKeyFilterChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.logKeyFilter.set(value);
  }

  onMessageFilterChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.messageFilter.set(value);
  }

  onPageSizeChange(value: number | string): void {
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    this.pageSize.set(Number.isFinite(parsed) && parsed > 0 ? parsed : this.defaultPageSize);
    this.currentPage.set(1); // Reset to first page when page size changes
    // Reload logs if a search has been performed
    if (this.hasSearched()) {
      this.loadLogs();
    }
  }

  onPageSizeSelectChange(event: Event): void {
    const target = event.target as HTMLSelectElement | null;
    this.onPageSizeChange(target?.value ?? this.defaultPageSize);
  }

  onTimeFromChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value) {
      const selectedDate = new Date(target.value);
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      
      this.focusAnchorTimestampMs.set(null);
      this.focusPreviousRange.set(null);

      // Ensure not before 60 days ago
      if (selectedDate < sixtyDaysAgo) {
        this.timeFrom.set(sixtyDaysAgo);
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      // Ensure not after current time
      if (selectedDate > now) {
        this.timeFrom.set(now);
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      // Ensure not after timeTo
      const timeTo = this.timeTo();
      if (timeTo && selectedDate > timeTo) {
        this.timeFrom.set(timeTo);
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      this.timeFrom.set(selectedDate);
      // Clear preset since user manually changed time
      this.selectedPreset.set(null);
    } else {
      this.timeFrom.set(null);
      this.selectedPreset.set(null);
    }
  }

  onTimeToChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.value) {
      const selectedDate = new Date(target.value);
      const now = new Date();
      const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
      
      this.focusAnchorTimestampMs.set(null);
      this.focusPreviousRange.set(null);

      // Ensure not before 60 days ago
      if (selectedDate < sixtyDaysAgo) {
        this.timeTo.set(sixtyDaysAgo);
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      // Ensure not after current time
      if (selectedDate > now) {
        this.timeTo.set(now);
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      // Ensure not before timeFrom
      const timeFrom = this.timeFrom();
      if (timeFrom && selectedDate < timeFrom) {
        this.timeTo.set(timeFrom);
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      this.timeTo.set(selectedDate);
      // Clear preset since user manually changed time
      this.selectedPreset.set(null);
    } else {
      this.timeTo.set(null);
      this.selectedPreset.set(null);
    }
  }

  setTimePreset(hours: number, presetKey: string): void {
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    
    // Ensure preset doesn't go beyond 60 days
    const actualFrom = from < sixtyDaysAgo ? sixtyDaysAgo : from;
    
    this.timeFrom.set(actualFrom);
    this.timeTo.set(now);
    this.selectedPreset.set(presetKey);
    this.focusAnchorTimestampMs.set(null);
    this.focusPreviousRange.set(null);
  }

  setTimePresetDays(days: number, presetKey: string): void {
    const now = new Date();
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    
    // Ensure preset doesn't go beyond 60 days
    const actualFrom = from < sixtyDaysAgo ? sixtyDaysAgo : from;
    
    this.timeFrom.set(actualFrom);
    this.timeTo.set(now);
    this.selectedPreset.set(presetKey);
    this.focusAnchorTimestampMs.set(null);
    this.focusPreviousRange.set(null);
  }

  applyFilters(): void {
    if (!this.canSearch()) {
      return;
    }

    this.focusAnchorTimestampMs.set(null);
    this.focusPreviousRange.set(null);
    this.currentPage.set(1); // Reset to first page when applying filters
    this.hasSearched.set(true);
    this.isFilterExpanded.set(false); // Collapse filters when search is clicked
    this.loadLogs();
  }

  private loadLogs(): void {
    if (!this.canSearch()) {
      return;
    }

    this.loading.set(true);
    this.error.set('');

    // Calculate offset for current page
    const from = (this.currentPage() - 1) * this.pageSize();

    const request = {
      serviceName: this.effectiveServiceName(),
      podName: this.podNameFilter().trim() || undefined,
      logKey: this.logKeyFilter().trim() || undefined,
      message: this.messageFilter().trim() || undefined,
      logLevels: this.getLogLevelsForRequest(),
      timeFrom: this.timeFrom()?.toISOString(),
      timeTo: this.timeTo()?.toISOString(),
      size: this.pageSize(),
      from: from,
    };

    this.elasticsearchService.getLogs(request).subscribe({
      next: (response) => {
        this.logs.set(response.logs);
        this.total.set(response.total);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || err.message || 'Failed to search logs');
        this.loading.set(false);
        this.logs.set([]);
        this.total.set(0);
      },
    });
  }

  clearFilters(): void {
    this.serviceNameFilter.set('');
    this.podNameFilter.set('');
    this.logKeyFilter.set('');
    this.messageFilter.set('');
    this.logLevelFilter.set([]);
    this.isLogLevelDropdownOpen.set(false);
    this.clientSearchQuery.set('');
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    this.timeFrom.set(yesterday);
    this.timeTo.set(now);
    this.selectedPreset.set('24h'); // Set to 24h preset
    this.pageSize.set(this.defaultPageSize);
    this.logs.set([]);
    this.total.set(0);
    this.hasSearched.set(false);
    this.currentPage.set(1);
    this.error.set('');
    this.focusAnchorTimestampMs.set(null);
    this.focusPreviousRange.set(null);
    this.focusWindowSeconds.set(30);
  }

  private applyRouteQueryParams(params: ParamMap): void {
    const service = (params.get('svc') || '').trim();
    const pod = (params.get('pod') || '').trim();
    const key = (params.get('key') || '').trim();
    const message = (params.get('msg') || '').trim();
    const requestedLevels = (params.get('levels') || '')
      .split(',')
      .map(value => value.trim())
      .filter(value => value.length > 0);
    const isAllRequested = requestedLevels.some(value => value.toLowerCase() === 'all');
    const isNoneRequested = requestedLevels.some(value => value.toLowerCase() === 'none');
    const levels = requestedLevels.filter(value => this.availableLogLevels.includes(value));
    const size = this.parsePositiveNumber(params.get('size'));
    const page = this.parsePositiveNumber(params.get('page'));
    const sort = params.get('sort');
    const query = (params.get('q') || '').trim();
    const preset = (params.get('preset') || '').trim();
    const searched = params.get('searched') === '1';
    const focusWindowSeconds = this.parsePositiveNumber(params.get('focusSec'));
    const from = this.parseDateParam(params.get('from'));
    const to = this.parseDateParam(params.get('to'));

    if (!this.hasFixedServiceName()) {
      this.serviceNameFilter.set(service);
    }
    this.podNameFilter.set(pod);
    this.logKeyFilter.set(key);
    this.messageFilter.set(message);
    this.logLevelFilter.set(
      isAllRequested || requestedLevels.length === 0
        ? [...this.availableLogLevels]
        : (isNoneRequested ? [] : levels)
    );

    if (size) {
      this.pageSize.set(size);
    } else {
      this.pageSize.set(this.defaultPageSize);
    }
    this.currentPage.set(page || 1);

    if (sort === 'newest' || sort === 'oldest') {
      this.sortOrder.set(sort);
    } else {
      this.sortOrder.set('newest');
    }

    this.clientSearchQuery.set(query);
    this.focusWindowSeconds.set(focusWindowSeconds || 30);

    if (from && to) {
      this.timeFrom.set(from);
      this.timeTo.set(to);
      this.selectedPreset.set(this.allowedPresets.has(preset) ? preset : null);
    } else {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      this.timeFrom.set(yesterday);
      this.timeTo.set(now);
      this.selectedPreset.set('24h');
    }

    this.hasSearched.set(searched);
  }

  /** Params that affect the Elasticsearch request (excludes client-only `q` and `sort`). */
  private getServerParamsSignature(params: ParamMap): string {
    return [
      params.get('svc') ?? '',
      params.get('pod') ?? '',
      params.get('key') ?? '',
      params.get('msg') ?? '',
      params.get('levels') ?? '',
      params.get('from') ?? '',
      params.get('to') ?? '',
      params.get('preset') ?? '',
      params.get('size') ?? '',
      params.get('page') ?? '',
      params.get('focusSec') ?? '',
      params.get('searched') ?? '',
    ].join('\x1e');
  }

  private syncRouteToQueryParams(): void {
    this.syncingRoute = true;
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        globalLogs: '1',
        svc: this.hasFixedServiceName() ? null : (this.serviceNameFilter().trim() || null),
        pod: this.podNameFilter().trim() || null,
        key: this.logKeyFilter().trim() || null,
        msg: this.messageFilter().trim() || null,
        levels: this.isAllLogLevelsSelected()
          ? 'All'
          : (this.logLevelFilter().length ? this.logLevelFilter().join(',') : 'None'),
        from: this.timeFrom()?.toISOString() || null,
        to: this.timeTo()?.toISOString() || null,
        preset: this.selectedPreset() || null,
        size: this.pageSize() !== this.defaultPageSize ? this.pageSize() : null,
        page: this.currentPage() > 1 ? this.currentPage() : null,
        sort: this.sortOrder() !== 'newest' ? this.sortOrder() : null,
        // Untracked so typing in the client-only "Filter displayed logs" box does not re-trigger this effect / ES reload.
        q: untracked(() => this.clientSearchQuery().trim()) || null,
        searched: this.hasSearched() ? '1' : null,
        focusSec: this.focusWindowSeconds() !== 30 ? this.focusWindowSeconds() : null
      }
    }).finally(() => {
      this.syncingRoute = false;
    });
  }

  private parsePositiveNumber(value: string | null): number | null {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }
    return parsed;
  }

  private parseDateParam(value: string | null): Date | null {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  toggleSortOrder(): void {
    this.sortOrder.set(this.sortOrder() === 'newest' ? 'oldest' : 'newest');
  }

  toggleDetails(index: number): void {
    const expanded = new Set(this.expandedRows());
    if (expanded.has(index)) {
      expanded.delete(index);
    } else {
      expanded.add(index);
    }
    this.expandedRows.set(expanded);
  }

  getMessagePreview(message: string | undefined): string {
    const text = message ?? 'N/A';
    if (text.length <= this.messagePreviewLength) return text;
    return text.slice(0, this.messagePreviewLength) + '...';
  }

  openFullMessage(message: string, event: MouseEvent): void {
    const btn = (event.target as HTMLElement).closest?.('button.btn-show-full-message') as HTMLElement | null;
    const el = btn ?? (event.target as HTMLElement);
    const rect = el.getBoundingClientRect();
    const tableWrapper = document.querySelector('.elasticsearch-logs-table-wrapper') as HTMLElement | null;
    const wrapperRect = tableWrapper?.getBoundingClientRect();
    const wrapperHeight = tableWrapper?.clientHeight ?? window.innerHeight;
    const wrapperWidth = tableWrapper?.clientWidth ?? window.innerWidth;
    const wrapperScrollTop = tableWrapper?.scrollTop ?? window.scrollY;
    const wrapperScrollLeft = tableWrapper?.scrollLeft ?? window.scrollX;
    const padding = 8;
    const popoverMaxWidth = 420;
    const popoverMaxHeight = 2080;
    const popoverMinHeight = 400;
    const anchorTop = rect.top - (wrapperRect?.top ?? 0);
    const anchorBottom = rect.bottom - (wrapperRect?.top ?? 0);
    const anchorLeft = rect.left - (wrapperRect?.left ?? 0);
    const spaceBelow = wrapperHeight - anchorBottom - padding;
    const spaceAbove = anchorTop - padding;
    const popoverHeight = Math.min(popoverMaxHeight, wrapperHeight - padding * 2);
    let top: number;
    if (spaceBelow >= popoverMinHeight || spaceBelow >= spaceAbove) {
      top = anchorBottom + wrapperScrollTop + 6;
    } else {
      top = anchorTop + wrapperScrollTop - popoverHeight - 6;
    }
    let left = anchorLeft + wrapperScrollLeft;
    if (left + popoverMaxWidth > wrapperWidth - padding + wrapperScrollLeft) {
      left = wrapperWidth - popoverMaxWidth - padding + wrapperScrollLeft;
    }
    if (left < padding + wrapperScrollLeft) left = padding + wrapperScrollLeft;
    if (top < padding) top = padding;
    if (top + popoverHeight > wrapperHeight - padding + wrapperScrollTop) {
      top = Math.max(padding + wrapperScrollTop, wrapperHeight - popoverHeight - padding + wrapperScrollTop);
    }
    this.fullMessagePopup.set({ message: message ?? '', top, left });
    this.attachFullMessageScrollListeners();
  }

  closeFullMessagePopup(): void {
    this.detachFullMessageScrollListeners();
    this.fullMessagePopup.set(null);
    this.copyMessageFeedback.set('');
  }

  async copyFullMessageToClipboard(): Promise<void> {
    const popup = this.fullMessagePopup();
    if (!popup?.message) return;
    try {
      await navigator.clipboard.writeText(popup.message);
      this.copyMessageFeedback.set('Copied!');
      setTimeout(() => this.copyMessageFeedback.set(''), 2000);
    } catch {
      this.copyMessageFeedback.set('Failed');
      setTimeout(() => this.copyMessageFeedback.set(''), 2000);
    }
  }

  private attachFullMessageScrollListeners(): void {
    this.detachFullMessageScrollListeners();
    const close = (event?: Event) => {
      const target = event?.target as HTMLElement | null;
      if (target?.closest?.('.full-message-popover')) return;
      this.closeFullMessagePopup();
    };
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.full-message-popover')) return;
      if (target?.closest?.('button.btn-show-full-message')) return;
      this.closeFullMessagePopup();
    };
    const tableWrapper = document.querySelector('.elasticsearch-logs-table-wrapper');
    if (tableWrapper) {
      tableWrapper.addEventListener('scroll', close, { passive: true });
    }
    window.addEventListener('scroll', close, true);
    document.addEventListener('mousedown', closeOnOutsideClick, true);
    this.fullMessageScrollCleanup = () => {
      if (tableWrapper) tableWrapper.removeEventListener('scroll', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('mousedown', closeOnOutsideClick, true);
      this.fullMessageScrollCleanup = null;
    };
  }

  private detachFullMessageScrollListeners(): void {
    if (this.fullMessageScrollCleanup) {
      this.fullMessageScrollCleanup();
      this.fullMessageScrollCleanup = null;
    }
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages() || page === this.currentPage()) {
      return;
    }
    this.currentPage.set(page);
    
    // If there's no client-side filter, reload from server
    if (!this.clientSearchQuery().trim()) {
      this.loadLogs();
    }
    
    // Scroll to top of table
    const tableWrapper = document.querySelector('.elasticsearch-logs-table-wrapper');
    if (tableWrapper) {
      tableWrapper.scrollTop = 0;
    }
  }

  refreshLogs(): void {
    if (this.hasSearched()) {
      this.loadLogs();
    }
  }

  exportLogs(): void {
    if (this.exportingLogs()) {
      return;
    }

    this.exportingLogs.set(true);
    const request = {
      serviceName: this.effectiveServiceName(),
      podName: this.podNameFilter().trim() || undefined,
      logKey: this.logKeyFilter().trim() || undefined,
      message: this.messageFilter().trim() || undefined,
      logLevels: this.getLogLevelsForRequest(),
      timeFrom: this.timeFrom()?.toISOString(),
      timeTo: this.timeTo()?.toISOString(),
      size: this.exportMaxSize,
      from: 0,
    };

    this.elasticsearchService.getLogs(request).subscribe({
      next: (response) => {
        if (!response.logs?.length) {
          this.exportingLogs.set(false);
          alert('No logs found to export for current filters.');
          return;
        }

        const csv = this.convertToCSV(response.logs);
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${this.exportFileNamePrefix}-${new Date().toISOString()}.csv`;
        a.click();
        window.URL.revokeObjectURL(url);

        if (response.total > response.logs.length) {
          alert(`Export was capped at ${response.logs.length.toLocaleString()} rows out of ${response.total.toLocaleString()} total matches.`);
        }
        this.exportingLogs.set(false);
      },
      error: (err) => {
        this.exportingLogs.set(false);
        alert('Failed to export logs: ' + (err.error?.error || err.message || 'Unknown error'));
      }
    });
  }

  convertToCSV(logs: ElasticsearchLogEntry[]): string {
    const headers = ['Timestamp', 'Service Name', 'Process Identifier', 'Log Level', 'Log Key', 'Message', 'Exception'];
    const rows = logs.map(log => [
      log.timestamp,
      log.serviceName || '',
      this.getProcessIdentifier(log.podName),
      log.logLevel || '',
      log.logKey || '',
      (log.message || '').replace(/"/g, '""'),
      (log.exception || '').replace(/"/g, '""'),
    ]);
    
    const csvRows = [
      headers.map(h => `"${h}"`).join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ];
    
    return csvRows.join('\n');
  }

  formatTimestamp(timestamp: string): string {
    try {
      const timestampMs = this.parseTimestampMs(timestamp);
      if (timestampMs === null) {
        return timestamp;
      }
      const date = new Date(timestampMs);

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const hours = String(date.getHours()).padStart(2, '0');
      const minutes = String(date.getMinutes()).padStart(2, '0');
      const seconds = String(date.getSeconds()).padStart(2, '0');
      const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
      return `${month}/${day}/${year}, ${hours}:${minutes}:${seconds}.${milliseconds}`;
    } catch {
      return timestamp;
    }
  }

  formatDateTimeLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
  }

  getProcessIdentifier(podName?: string): string {
    const value = (podName || '').trim();
    if (!value) return 'N/A';
    const idx = value.lastIndexOf('-');
    if (idx < 0 || idx === value.length - 1) return 'N/A';
    return value.slice(idx + 1);
  }

  hasProcessIdentifier(log: ElasticsearchLogEntry): boolean {
    return this.getProcessIdentifier(log.podName) !== 'N/A';
  }

  isFocusActive(): boolean {
    return this.focusAnchorTimestampMs() !== null;
  }

  isPodFocusActive(): boolean {
    return this.podNameFilter().trim().length > 0;
  }

  onFocusWindowSecondsChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const parsed = parseInt(target.value, 10);
    this.focusWindowSeconds.set(!isNaN(parsed) && parsed > 0 ? parsed : 30);
  }

  isLogLevelSelected(level: string): boolean {
    return this.logLevelFilter().includes(level);
  }

  toggleLogLevelDropdown(): void {
    this.isLogLevelDropdownOpen.set(!this.isLogLevelDropdownOpen());
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isLogLevelDropdownOpen()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.log-level-dropdown')) {
      this.isLogLevelDropdownOpen.set(false);
    }
  }

  @HostListener('document:focusin', ['$event'])
  onDocumentFocusIn(event: FocusEvent): void {
    if (!this.isLogLevelDropdownOpen()) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target || !target.closest('.log-level-dropdown')) {
      this.isLogLevelDropdownOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.isLogLevelDropdownOpen()) {
      this.isLogLevelDropdownOpen.set(false);
    }
  }

  isAllLogLevelsSelected(): boolean {
    return this.logLevelFilter().length === this.availableLogLevels.length;
  }

  onAllLogLevelsToggle(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked) {
      this.logLevelFilter.set([...this.availableLogLevels]);
      return;
    }
    this.logLevelFilter.set([]);
  }

  onLogLevelToggle(level: string, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    const selected = new Set(this.logLevelFilter());
    if (checked) {
      selected.add(level);
    } else {
      selected.delete(level);
    }
    this.logLevelFilter.set(Array.from(selected));
  }

  selectedLogLevelsLabel(): string {
    if (this.isAllLogLevelsSelected()) {
      return 'All Levels';
    }
    const selected = this.logLevelFilter();
    if (selected.length === 0) {
      return 'Select Levels';
    }
    if (selected.length === 1) {
      return selected[0];
    }
    return `${selected.length} selected`;
  }

  private getLogLevelsForRequest(): string[] | undefined {
    if (this.isAllLogLevelsSelected()) {
      return ['All'];
    }
    const selected = this.logLevelFilter();
    if (selected.length === 0) {
      return undefined;
    }
    return selected;
  }

  /**
   * Supports both ISO timestamps and numeric epoch-millisecond strings.
   * Examples:
   * - "2026-04-02T10:03:12.0104923Z"
   * - "1775124192010.660960"
   */
  private parseTimestampMs(timestamp?: string | null): number | null {
    const raw = (timestamp ?? '').trim();
    if (!raw) {
      return null;
    }

    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      if (Number.isFinite(numeric)) {
        return Math.trunc(numeric);
      }
      return null;
    }

    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  focusAroundLog(log: ElasticsearchLogEntry): void {
    const timestampMs = this.parseTimestampMs(log.timestamp);
    if (timestampMs === null) {
      return;
    }
    this.focusPreviousRange.set({
      from: this.timeFrom(),
      to: this.timeTo()
    });
    this.focusAnchorTimestampMs.set(timestampMs);
    this.selectedPreset.set(null);
    const windowMs = this.focusWindowSeconds() * 1000;
    const startTime = new Date(timestampMs - windowMs);
    const endTime = new Date(timestampMs + windowMs);
    this.timeFrom.set(startTime);
    this.timeTo.set(endTime);
    this.isFilterExpanded.set(true);
    this.currentPage.set(1);
    this.hasSearched.set(true);
    this.loadLogs();
  }

  applyPodFocus(log: ElasticsearchLogEntry): void {
    const podName = (log.podName || '').trim();
    if (!podName) {
      return;
    }
    this.podNameFilter.set(podName);
    this.currentPage.set(1);
    this.hasSearched.set(true);
    this.loadLogs();
  }

  applyServiceFocus(log: ElasticsearchLogEntry): void {
    const serviceName = (log.serviceName || '').trim();
    if (!serviceName) {
      return;
    }
    if (this.hasFixedServiceName() && this.fixedServiceName?.trim() === serviceName) {
      return;
    }
    this.serviceNameFilter.set(serviceName);
    this.currentPage.set(1);
    this.hasSearched.set(true);
    this.loadLogs();
  }

  applyLogKeyFocus(log: ElasticsearchLogEntry): void {
    const logKey = (log.logKey || '').trim();
    if (!logKey) {
      return;
    }
    this.logKeyFilter.set(logKey);
    this.currentPage.set(1);
    this.hasSearched.set(true);
    this.loadLogs();
  }

  applyLogLevelFocus(log: ElasticsearchLogEntry): void {
    const normalized = this.normalizeLogLevel(log.logLevel);
    if (!normalized) {
      return;
    }
    this.logLevelFilter.set([normalized]);
    this.currentPage.set(1);
    this.hasSearched.set(true);
    this.loadLogs();
  }

  shouldShowServiceFilterLink(log: ElasticsearchLogEntry): boolean {
    const serviceName = (log.serviceName || '').trim();
    if (!serviceName) {
      return false;
    }

    const activeService = (this.fixedServiceName?.trim() || this.serviceNameFilter().trim());
    if (!activeService) {
      return true;
    }

    return serviceName.toLowerCase() !== activeService.toLowerCase();
  }

  shouldShowPodFilterLink(log: ElasticsearchLogEntry): boolean {
    const podName = (log.podName || '').trim();
    if (!podName) {
      return false;
    }
    const activePodName = this.podNameFilter().trim();
    if (!activePodName) {
      return true;
    }
    return podName.toLowerCase() !== activePodName.toLowerCase();
  }

  shouldShowLogKeyFilterLink(log: ElasticsearchLogEntry): boolean {
    const logKey = (log.logKey || '').trim();
    if (!logKey) {
      return false;
    }
    const activeLogKey = this.logKeyFilter().trim();
    if (!activeLogKey) {
      return true;
    }
    return logKey.toLowerCase() !== activeLogKey.toLowerCase();
  }

  shouldShowLogLevelFilterLink(log: ElasticsearchLogEntry): boolean {
    const normalized = this.normalizeLogLevel(log.logLevel);
    if (!normalized) {
      return false;
    }
    const selected = this.logLevelFilter();
    if (this.isAllLogLevelsSelected() || selected.length === 0) {
      return true;
    }
    return !selected.some(level => level.toLowerCase() === normalized.toLowerCase());
  }

  private normalizeLogLevel(logLevel?: string): string | null {
    const value = (logLevel || '').toLowerCase();
    if (!value) return null;
    if (value.includes('trace')) return 'Trace';
    if (value.includes('info')) return 'Information';
    if (value.includes('debug')) return 'Debug';
    if (value.includes('error')) return 'Error';
    if (value.includes('warn')) return 'Warning';
    return null;
  }

  clearPodFocus(): void {
    if (!this.podNameFilter().trim()) {
      return;
    }
    this.podNameFilter.set('');
    this.currentPage.set(1);
    if (this.hasSearched()) {
      this.loadLogs();
    }
  }

  clearFocusWindow(): void {
    const previousRange = this.focusPreviousRange();
    if (previousRange) {
      this.timeFrom.set(previousRange.from);
      this.timeTo.set(previousRange.to);
    }
    this.focusAnchorTimestampMs.set(null);
    this.focusPreviousRange.set(null);
    this.selectedPreset.set(null);
    this.currentPage.set(1);
    if (this.hasSearched()) {
      this.loadLogs();
    }
  }

  formatFocusAnchorTimestamp(): string {
    const anchor = this.focusAnchorTimestampMs();
    if (anchor === null) {
      return '';
    }
    return this.formatTimestamp(new Date(anchor).toISOString());
  }

  isFocusAnchor(log: ElasticsearchLogEntry): boolean {
    const anchor = this.focusAnchorTimestampMs();
    if (anchor === null) {
      return false;
    }
    const ts = this.parseTimestampMs(log.timestamp);
    return ts !== null && ts === anchor;
  }
}

