import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Component, OnDestroy, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HeaderComponent } from '../../layout/header/header.component';
import { AuthService } from '../../core/services/auth.service';
import { AdminAuditApiService } from '../../core/services/api/admin-audit-api.service';
import { AdminAuditEvent } from '../../core/models/admin-audit.models';
import { ViewportScaleService } from '../../core/services/viewport-scale.service';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';

type SortColumn = 'timestamp' | 'event' | 'resource' | 'namespace' | 'actor' | 'status' | 'actionPerformed';
type SortDirection = 'asc' | 'desc';

@Component({
  selector: 'app-admin-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent],
  template: `
    <div class="audit-container">
      <app-header
        [headerMode]="'dashboard'"
        [currentView]="'scanning'"
        [healthFilter]="[]"
        [autoRefreshEnabled]="autoRefreshEnabled()"
        [autoRefreshInterval]="autoRefreshInterval()"
        [showRouteContext]="true"
        [showHealthFilter]="false"
        [showSearch]="false"
        [showStats]="false"
        [showViewToggle]="false"
        [showDashboardQuickActions]="true"
        [externalIsRefreshing]="loading()"
        (searchChange)="noop()"
        (viewChange)="noop()"
        (healthFilterChange)="noop()"
        (autoRefreshEnabledChange)="onAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onAutoRefreshIntervalChange($event)"
        (refreshClick)="loadAudits()"
      />
      @if (fullActionMessagePopup(); as popupMessage) {
        <div class="modal-overlay" (click)="closeFullActionMessagePopup()">
          <div class="modal-container full-message-modal" [ngStyle]="fullMessageModalStyle()" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <h2>
                <i class="fas fa-file-alt"></i>
                Full Message
              </h2>
              <button type="button" class="modal-close" (click)="closeFullActionMessagePopup()" aria-label="Close full message modal">&times;</button>
            </div>
            <div class="modal-content full-message-content">
              <div class="full-message-toolbar">
                <button type="button" class="btn-copy-popover" (click)="copyFullActionMessageToClipboard()" [title]="copyActionMessageFeedback() || 'Copy message'">
                  <i class="fas fa-copy"></i> {{ copyActionMessageFeedback() || 'Copy' }}
                </button>
              </div>
              <div class="full-message-body">
                <pre class="full-message-popover-text">{{ formattedFullActionMessage() }}</pre>
              </div>
            </div>
          </div>
        </div>
      }

      <div class="view-container">
        @if (!isAdmin()) {
          <div class="empty-state">
            <i class="fas fa-lock"></i>
            <h2>Admin access required</h2>
            <p>You are not authorized to view audit logs.</p>
            <a routerLink="/" class="back-link"><i class="fas fa-arrow-left"></i> Back to Dashboard</a>
          </div>
        } @else {
          <div class="audit-content" [ngStyle]="containerHeightStyle()">
            <div class="audit-header">
              <div>
                <h1><i class="fas fa-clipboard-list"></i> Admin Audit Log</h1>
                <p>Track administrative mutations with time-based filtering (max 90 days lookback).</p>
              </div>
            </div>

            <div class="filters-card elasticsearch-filters-toolbar">
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
                    <div class="form-group">
                      <label>Namespace (Optional)</label>
                      <details class="multi-select-dropdown">
                        <summary>
                          <span class="namespace-summary-text">{{ namespaceSummaryLabel() }}</span>
                          <i class="fas fa-chevron-down namespace-summary-icon"></i>
                        </summary>
                        <div class="dropdown-panel">
                          <label class="dropdown-item">
                            <input type="checkbox" [checked]="isAllNamespacesSelected()" (change)="toggleAllNamespaces($event)" />
                            <span>All namespaces</span>
                          </label>
                          @for (item of namespaceOptions(); track item) {
                            <label class="dropdown-item">
                              <input type="checkbox" [checked]="isNamespaceSelected(item)" (change)="toggleNamespace(item, $event)" />
                              <span>{{ item }}</span>
                            </label>
                          }
                        </div>
                      </details>
                    </div>
                    <div class="form-group">
                      <label>User (Optional)</label>
                      <input
                        type="text"
                        placeholder="Search by user name or email"
                        [ngModel]="userFilter()"
                        (ngModelChange)="onUserFilterChange($event)"
                      />
                    </div>
                    <div class="form-group">
                      <label>Action (Optional)</label>
                      <input
                        type="text"
                        placeholder="Search by action"
                        [ngModel]="actionFilter()"
                        (ngModelChange)="onActionFilterChange($event)"
                      />
                    </div>
                    <div class="form-group">
                      <label>Resource Name (Optional)</label>
                      <input
                        type="text"
                        placeholder="Search by resource name"
                        [ngModel]="resourceNameFilter()"
                        (ngModelChange)="onResourceNameFilterChange($event)"
                      />
                    </div>
                  </div>
                }

                <div class="form-row">
                  <div class="form-group">
                    <label>Logs per Page</label>
                    <select [ngModel]="limit()" (ngModelChange)="onLimitChange($event)">
                      @for (item of limitOptions; track item) {
                        <option [ngValue]="item">{{ item }}</option>
                      }
                    </select>
                  </div>
                </div>

                <div class="form-row time-range-row">
                  <div class="form-group">
                    <label>Start Time</label>
                    <input type="datetime-local" step="1" [ngModel]="startInput()" (ngModelChange)="onStartInputChange($event)" />
                  </div>
                  <div class="form-group">
                    <label>End Time</label>
                    <input type="datetime-local" step="1" [ngModel]="endInput()" (ngModelChange)="onEndInputChange($event)" />
                  </div>
                </div>

                <div class="duration-display">
                  <i class="fas fa-clock"></i>
                  <span>Selected Duration: <strong>{{ selectedDuration() }}</strong></span>
                </div>

                <div class="time-presets-row">
                  <div class="time-presets">
                    <button type="button" class="btn-time-preset" (click)="applyPresetDays(7)" [class.active]="activePresetDays() === 7">7d</button>
                    <button type="button" class="btn-time-preset" (click)="applyPresetDays(30)" [class.active]="activePresetDays() === 30">30d</button>
                    <button type="button" class="btn-time-preset" (click)="applyPresetDays(60)" [class.active]="activePresetDays() === 60">60d</button>
                    <button type="button" class="btn-time-preset" (click)="applyPresetDays(90)" [class.active]="activePresetDays() === 90">90d</button>
                  </div>
                  <div class="form-actions">
                    <button type="button" class="btn-search" (click)="applyFilters()" [disabled]="loading()">
                      <i class="fas fa-search"></i>
                      Load
                    </button>
                    <button type="button" class="btn-export" (click)="downloadVisibleAsCsv()" [disabled]="loading() || filteredSortedAudits().length === 0">
                      <i class="fas fa-download"></i>
                      Export CSV
                    </button>
                    <button type="button" class="btn-clear" (click)="resetFilters()" [disabled]="loading()">Clear Filters</button>
                  </div>
                </div>
              }
            </div>

            @if (error(); as e) {
              <div class="error-state">
                <i class="fas fa-exclamation-triangle"></i>
                <span>{{ e }}</span>
              </div>
            }

            <div class="table-card">
              @if (!loading() && filteredSortedAudits().length === 0) {
                <div class="empty-table">No audit events found for the selected range.</div>
              } @else {
                <div class="table-scroll">
                  <div class="table-inline-search">
                    <div class="form-group">
                      <input
                        type="text"
                        placeholder="Search all table columns and action performed"
                        [ngModel]="frontendSearch()"
                        (ngModelChange)="onFrontendSearchChange($event)"
                      />
                    </div>
                  </div>
                  <table>
                    <colgroup>
                      <col class="col-time" />
                      <col class="col-resource" />
                      <col class="col-namespace" />
                      <col class="col-event" />
                      <col class="col-actor" />
                      <col class="col-status" />
                      <col class="col-action-performed" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th (click)="setSort('timestamp')" [class.sortable]="true">
                          <span>Timestamp (EST/EDT)</span>
                          <span class="sort-indicator">{{ sortIndicator('timestamp') }}</span>
                        </th>
                        <th (click)="setSort('resource')" [class.sortable]="true">
                          <span>Resource</span>
                          <span class="sort-indicator">{{ sortIndicator('resource') }}</span>
                        </th>
                        <th (click)="setSort('namespace')" [class.sortable]="true">
                          <span>Namespace</span>
                          <span class="sort-indicator">{{ sortIndicator('namespace') }}</span>
                        </th>
                        <th (click)="setSort('event')" [class.sortable]="true">
                          <span>Event</span>
                          <span class="sort-indicator">{{ sortIndicator('event') }}</span>
                        </th>
                        <th (click)="setSort('actor')" [class.sortable]="true">
                          <span>Actor</span>
                          <span class="sort-indicator">{{ sortIndicator('actor') }}</span>
                        </th>
                        <th (click)="setSort('status')" [class.sortable]="true">
                          <span>Status</span>
                          <span class="sort-indicator">{{ sortIndicator('status') }}</span>
                        </th>
                        <th (click)="setSort('actionPerformed')" [class.sortable]="true">
                          <span>Action Performed</span>
                          <span class="sort-indicator">{{ sortIndicator('actionPerformed') }}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @if (loading()) {
                        @for (row of skeletonRows; track row) {
                          <tr class="skeleton-row">
                            <td><span class="skeleton-cell"></span></td>
                            <td><span class="skeleton-cell"></span></td>
                            <td><span class="skeleton-cell"></span></td>
                            <td><span class="skeleton-cell"></span></td>
                            <td><span class="skeleton-cell"></span></td>
                            <td><span class="skeleton-cell small"></span></td>
                            <td><span class="skeleton-cell"></span></td>
                          </tr>
                        }
                      } @else {
                        @for (item of filteredSortedAudits(); track item.eventId) {
                          <tr>
                            <td>{{ formatUtc(item.timestampUtc) }}</td>
                            <td>
                              @if (hasResourceDetailsLink(item)) {
                                <button
                                  type="button"
                                  class="resource-link"
                                  (click)="openResourceDetails(item)"
                                  [title]="resourceLinkTitle(item)"
                                >
                                  {{ displayResource(item) }}
                                </button>
                              } @else {
                                {{ displayResource(item) }}
                              }
                            </td>
                            <td>
                              {{ item.namespace || '-' }}
                            </td>
                            <td>
                              <span class="event-badge" [ngClass]="eventBadgeClass(item)">
                                {{ displayEvent(item) }}
                              </span>
                            </td>
                            <td>{{ item.actor }}</td>
                            <td>
                              <span
                                class="status-badge"
                                [class.status-success]="normalizeStatus(item) === 'success'"
                                [class.status-failed]="normalizeStatus(item) === 'failed'"
                              >
                                {{ displayStatus(item) }}
                              </span>
                            </td>
                            <td [title]="displayActionPerformedOn(item)">
                              {{ getActionPerformedCompact(item) }}
                              @if (hasFullActionPerformedText(item)) {
                                <button
                                  type="button"
                                  class="btn-show-full-message"
                                  (click)="openFullActionMessage(item)"
                                  title="Show full message"
                                >
                                  <i class="fas fa-expand-alt"></i> Full message
                                </button>
                              }
                            </td>
                          </tr>
                        }
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .audit-container { width: 100%; background: var(--theme-bg-app); padding: 0 1rem; }
    .view-container { padding: 1rem 0; }
    .audit-content {
      width: var(--base-viewport-width);
      padding-right: 1.5rem;
      position: fixed;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .audit-header h1 { margin: 0; font-size: var(--theme-font-page-title); color: var(--theme-text-dark); display: flex; align-items: center; gap: .5rem; }
    .audit-header p { margin: .35rem 0 1rem; color: var(--theme-text-gray); }
    .filters-card, .table-card, .error-state, .empty-state {
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 10px;
      box-shadow: 0 1px 2px rgba(0,0,0,.05);
      padding: 0.75rem;
      margin-bottom: 1rem;
    }
    .elasticsearch-filters-toolbar {
      background: var(--theme-bg-app);
      padding: 0.5rem;
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
      padding: 0.55rem 0.65rem;
      margin: -0.5rem -0.5rem 0 -0.5rem;
      border-radius: 6px 6px 0 0;
      background-color: var(--theme-bg-app);
    }
    .filter-toggle-header.expanded {
      margin-bottom: 0.65rem;
      padding-bottom: 0.65rem;
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
      border: 1px solid #d1d5db;
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
    .btn-toggle-filter .fa-minus {
      color: #ef4444;
    }
    .btn-toggle-filter .fa-plus {
      color: #10b981;
    }
    .advanced-filters-toggle-row {
      margin: 0 0 0.55rem;
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
    .form-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 0.65rem;
      margin-bottom: 0.65rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .form-group label {
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-gray-dark);
    }
    .form-group input[type="text"],
    .form-group input[type="datetime-local"],
    .form-group select {
      padding: 0.4rem 0.65rem;
      border: 2px solid #d1d5db;
      border-radius: 6px;
      font-size: var(--theme-font-body);
      background: var(--theme-bg-surface);
      transition: all 0.2s;
    }
    .form-group input[type="text"]:focus,
    .form-group input[type="datetime-local"]:focus,
    .form-group select:focus {
      outline: none;
      border-color: var(--theme-button-primary);
      box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
    }
    .multi-select-dropdown {
      position: relative;
      width: 100%;
    }
    .multi-select-dropdown summary {
      list-style: none;
      border: 2px solid #d1d5db;
      border-radius: 6px;
      padding: 0.38rem 0.65rem;
      min-height: 34px;
      background: var(--theme-bg-surface);
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
      color: var(--theme-text-gray-dark);
      font-size: var(--theme-font-body);
      line-height: 1.25;
      box-sizing: border-box;
      transition: all 0.2s;
    }
    .namespace-summary-text {
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .namespace-summary-icon {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      transition: transform 0.2s;
      flex-shrink: 0;
    }
    .multi-select-dropdown summary::-webkit-details-marker { display: none; }
    .multi-select-dropdown[open] summary {
      border-color: var(--theme-button-primary);
      box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
    }
    .multi-select-dropdown[open] .namespace-summary-icon {
      transform: rotate(180deg);
    }
    .dropdown-panel {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      right: 0;
      z-index: 20;
      max-height: 180px;
      overflow: auto;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: var(--theme-bg-surface);
      box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
      padding: 0.35rem;
    }
    .dropdown-item {
      display: flex;
      align-items: center;
      gap: .5rem;
      padding: .25rem .4rem;
      font-size: var(--theme-font-table-header);
      color: var(--theme-text-dark);
      cursor: pointer;
      border-radius: 6px;
    }
    .dropdown-item:hover {
      background: var(--theme-bg-app);
    }
    .time-range-row {
      margin-bottom: 0.35rem;
    }
    .duration-display {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      background: var(--theme-bg-teal-lighter);
      border: 1px solid #d7b7de;
      border-radius: 6px;
      margin-bottom: 0.35rem;
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
      margin-top: .35rem;
      gap: 0.65rem;
      flex-wrap: wrap;
    }
    .time-presets {
      display: flex;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .btn-time-preset {
      padding: 0.38rem 0.6rem;
      border: 2px solid #d1d5db;
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
      color: white;
      border-color: var(--theme-button-primary);
    }
    .btn-time-preset.active {
      background: var(--theme-button-primary);
      color: white;
      border-color: var(--theme-button-primary);
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    .form-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0;
    }
    .btn-search,
    .btn-clear,
    .btn-export {
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
    .btn-export {
      background: var(--theme-bg-teal-lighter);
      color: var(--theme-text-teal-dark);
      border: 2px solid #d7b7de;
    }
    .btn-export:hover:not(:disabled) {
      background: var(--theme-bg-teal-light);
      border-color: #c79bcf;
    }
    .btn-clear {
      background: var(--theme-bg-app);
      color: var(--theme-text-gray-dark);
      border: 2px solid #d1d5db;
    }
    .btn-clear:hover:not(:disabled) {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .error-state { color: #991b1b; display: flex; gap: .5rem; align-items: center; }
    .loading-state { color: var(--theme-table-header-color); padding: .75rem; }
    .table-card .empty-table {
      color: var(--theme-text-teal-dark);
      background: var(--theme-bg-teal-lighter);
      border: 1px solid #c79bcf;
      border-radius: 8px;
      padding: 1rem 1.1rem;
      min-height: 88px;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      font-weight: var(--theme-font-table-header-weight);
      box-shadow: inset 0 0 0 1px rgba(147, 41, 154, 0.12);
    }
    .table-scroll {
      overflow: auto;
      max-height: min(80vh, 720px);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
    }
    .table-inline-search {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: 0.5rem 0.6rem;
      border-bottom: 1px solid var(--theme-border-gray-light);
      background: var(--theme-bg-app);
    }
    .table-inline-search .form-group {
      width: min(420px, 100%);
      margin: 0;
    }
    table {
      width: 100%;
      min-width: 1240px;
      table-layout: fixed;
      border-collapse: collapse;
      font-size: var(--theme-font-table-body);
    }
    .col-time { width: 130px; }
    .col-event { width: 82px; }
    .col-resource { width: 200px; }
    .col-namespace { width: 110px; }
    .col-actor { width: 120px; }
    .col-status { width: 64px; }
    .col-action-performed { width: 541px; }
    th, td {
      text-align: left;
      padding: .6rem .65rem;
      border-bottom: 1px solid var(--theme-border-gray-light);
      vertical-align: top;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    thead th {
      background: var(--theme-bg-app);
      position: sticky;
      top: 0;
      z-index: 2;
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-table-header);
    }
    th.sortable { cursor: pointer; user-select: none; }
    th.sortable:hover { background: var(--theme-bg-teal-lighter); }
    .sort-indicator {
      margin-left: .45rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }
    .status-badge { padding: .2rem .45rem; border-radius: 999px; font-weight: var(--theme-font-table-header-weight); font-size: var(--theme-font-caption); display: inline-block; }
    .status-success { background: #dcfce7; color: #166534; }
    .status-failed { background: #fee2e2; color: #991b1b; }
    .event-badge {
      display: inline-block;
      padding: .2rem .45rem;
      border-radius: 999px;
      font-weight: var(--theme-font-table-header-weight);
      font-size: var(--theme-font-caption);
      border: 1px solid transparent;
    }
    .event-positive { background: #dcfce7; color: #166534; border-color: #86efac; }
    .event-warning { background: #fef3c7; color: #92400e; border-color: #fde68a; }
    .event-info { background: var(--theme-bg-teal-lighter); color: #1e40af; border-color: #93c5fd; }
    .event-danger { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
    .event-neutral { background: var(--theme-bg-teal-lighter); color: var(--theme-table-header-color); border-color: var(--theme-border-gray); }
    .resource-link {
      border: none;
      background: none;
      padding: 0;
      margin: 0;
      max-width: 100%;
      color: var(--theme-text-teal);
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
      font: inherit;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .resource-link:hover {
      color: var(--theme-text-teal-dark);
    }
    .btn-show-full-message {
      margin-left: .65rem;
      border: none;
      background: transparent;
      color: var(--theme-button-primary);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 2px;
      font-size: var(--theme-font-caption);
      padding: 0;
    }
    .btn-show-full-message:hover {
      color: var(--theme-text-teal-dark);
    }
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(100vh*20);
      background: rgba(0, 0, 0, 0.5);
      z-index: 20000;
      pointer-events: auto;
      overflow-y: auto;
      padding: 0;
    }

    .modal-container.full-message-modal {
      background: var(--theme-bg-surface);
      border-radius: 12px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
      color: white;
    }

    .modal-header h2 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      display: flex;
      align-items: center;
      gap: 0.55rem;
    }

    .modal-close {
      background: none;
      border: none;
      font-size: var(--theme-font-page-title);
      line-height: 1;
      color: rgba(255, 255, 255, 0.95);
      cursor: pointer;
      padding: 0.25rem;
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: background-color 0.2s;
    }

    .modal-close:hover {
      background-color: rgba(255, 255, 255, 0.2);
      color: #fff;
    }

    .modal-content.full-message-content {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1;
      padding: 0;
    }

    .full-message-toolbar {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      padding: 0.6rem 0.9rem;
      border-bottom: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-app);
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
      background: rgba(147, 41, 154, 0.08);
    }

    .full-message-body {
      padding: 0.85rem 1rem;
      overflow-y: auto;
      overflow-x: hidden;
      flex: 1;
      min-height: 0;
      background: #0b1220;
      border-top: 1px solid var(--theme-text-dark);
    }
    .full-message-popover-text {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      font-size: var(--theme-font-table-header);
      line-height: 1.45;
      font-family: 'Consolas', 'Courier New', monospace;
      color: #d1fae5;
    }
    .skeleton-row td { padding: .68rem .65rem; }
    .skeleton-cell {
      display: inline-block;
      width: 100%;
      height: .85rem;
      border-radius: 4px;
      background: linear-gradient(90deg, var(--theme-skeleton-base) 25%, var(--theme-skeleton-highlight) 50%, var(--theme-skeleton-base) 75%);
      background-size: 200% 100%;
      animation: skeleton-loading 1.4s ease-in-out infinite;
    }
    .skeleton-cell.small { width: 70px; }
    @keyframes skeleton-loading {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .empty-state { text-align: center; max-width: 480px; margin: 2rem auto; }
    .empty-state i { font-size: var(--theme-font-page-title); color: var(--theme-text-gray); margin-bottom: .6rem; }
    .back-link { display: inline-flex; align-items: center; gap: .4rem; color: var(--theme-text-teal); text-decoration: none; font-weight: var(--theme-font-table-header-weight); }
    @media (max-width: 1100px) {
      .time-presets-row {
        align-items: flex-start;
      }
      .form-actions {
        width: 100%;
        justify-content: flex-end;
      }
    }
  `]
})
export class AdminAuditComponent implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly adminAuditApi = inject(AdminAuditApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly viewportScaleService = inject(ViewportScaleService);
  private readonly refreshPreferences = inject(RefreshPreferencesService);
  private readonly platformId = inject(PLATFORM_ID);
  private syncingRoute = false;

  readonly isAdmin = this.auth.isUserAdmin;
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly audits = signal<AdminAuditEvent[]>([]);
  readonly limitOptions = [100, 300, 500, 1000];
  readonly limit = signal(100);
  readonly autoRefreshEnabled = this.refreshPreferences.autoRefreshEnabled;
  readonly autoRefreshInterval = this.refreshPreferences.autoRefreshInterval;
  readonly activePresetDays = signal(7);
  readonly isFilterExpanded = signal(true);
  readonly isAdvancedFiltersExpanded = signal(false);
  readonly userFilter = signal<string>('');
  readonly actionFilter = signal<string>('');
  readonly resourceNameFilter = signal<string>('');
  readonly frontendSearch = signal<string>('');
  readonly selectedNamespaces = signal<string[]>([]);
  readonly sortColumn = signal<SortColumn>('timestamp');
  readonly sortDirection = signal<SortDirection>('desc');
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly fullActionMessagePopup = signal<string | null>(null);
  readonly copyActionMessageFeedback = signal<string>('');
  readonly formattedFullActionMessage = computed(() => this.formatMessageForModal(this.fullActionMessagePopup()));

  readonly endUtc = signal<Date>(this.nowCeiledToMinute());
  readonly startUtc = signal<Date>(new Date(this.endUtc().getTime() - 7 * 24 * 60 * 60 * 1000));

  private readonly componentOffsetTop = signal<number>(220);
  readonly containerHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const availableHeight = Math.max(baseHeight - this.componentOffsetTop(), 300);
    return { height: `${availableHeight}px` };
  });
  readonly fullMessageModalStyle = computed(() => {
    if (!isPlatformBrowser(this.platformId) || !this.fullActionMessagePopup()) {
      return {};
    }

    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const visibleHeight = viewportHeight / scale;
    const maxHeight = Math.min(94 * baseHeight / 100, visibleHeight * 0.94);

    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      width: '90%',
      maxWidth: '920px',
      maxHeight: `${maxHeight}px`
    };
  });

  readonly startInput = computed(() => this.toDateTimeLocal(this.startUtc()));
  readonly endInput = computed(() => this.toDateTimeLocal(this.endUtc()));
  readonly namespaceOptions = computed(() => {
    return [...this.auth.namespaces()].filter(Boolean).sort((left, right) => left.localeCompare(right));
  });
  readonly namespaceSummaryLabel = computed(() => {
    const options = this.namespaceOptions();
    const selected = this.selectedNamespaces();

    if (!options.length) return 'No namespaces';
    if (selected.length === 0 || selected.length === options.length) return 'All namespaces';
    if (selected.length === 1) return selected[0];
    return `${selected.length} selected`;
  });
  readonly selectedDuration = computed(() => {
    const from = this.startUtc();
    const to = this.endUtc();
    const diffMs = to.getTime() - from.getTime();
    if (diffMs <= 0) {
      return 'Invalid range';
    }

    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) {
      const hours = diffHours % 24;
      return hours > 0
        ? `${diffDays} day${diffDays !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`
        : `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    }

    return `${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
  });

  readonly filteredSortedAudits = computed(() => {
    const query = this.frontendSearch().trim();
    const sortColumn = this.sortColumn();
    const sortDirection = this.sortDirection();

    const filtered = this.audits().filter(item => {
      return this.matchesGlobalSearch(item, query);
    });

    return [...filtered].sort((left, right) => {
      const result = this.compareByColumn(left, right, sortColumn);
      return sortDirection === 'asc' ? result : -result;
    });
  });

  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    if (!this.isAdmin()) {
      this.router.navigate(['/']);
      return;
    }

    if (isPlatformBrowser(this.platformId)) {
      setTimeout(() => this.calculateOffset(), 0);
      window.addEventListener('resize', this.handleResize);
      this.syncAutoRefreshTimer();
    }
    this.selectedNamespaces.set([...this.namespaceOptions()]);
    this.applyRouteFilters();
    this.route.queryParamMap.subscribe(() => {
      if (this.syncingRoute) return;
      this.applyRouteFilters();
      this.loadAudits();
    });
  }

  noop(): void {}

  applyPresetDays(days: number): void {
    const safeDays = Math.min(90, Math.max(1, days));
    const end = this.nowCeiledToMinute();
    const start = new Date(end.getTime() - safeDays * 24 * 60 * 60 * 1000);
    this.activePresetDays.set(safeDays);
    this.endUtc.set(end);
    this.startUtc.set(start);
    this.syncFiltersToRoute();
  }

  onStartInputChange(value: string): void {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    const maxAgeMs = 90 * 24 * 60 * 60 * 1000;
    const end = this.endUtc();
    const minStart = new Date(end.getTime() - maxAgeMs);
    this.startUtc.set(parsed < minStart ? minStart : parsed > end ? end : parsed);
    this.activePresetDays.set(0);
    this.syncFiltersToRoute();
  }

  onEndInputChange(value: string): void {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return;
    const now = this.nowCeiledToMinute();
    const end = parsed > now ? now : parsed;
    const start = this.startUtc();
    const maxAgeMs = 90 * 24 * 60 * 60 * 1000;
    const boundedStart = start < new Date(end.getTime() - maxAgeMs)
      ? new Date(end.getTime() - maxAgeMs)
      : start;
    this.endUtc.set(end);
    this.startUtc.set(boundedStart > end ? end : boundedStart);
    this.activePresetDays.set(0);
    this.syncFiltersToRoute();
  }

  onLimitChange(value: string | number): void {
    const parsed = typeof value === 'number' ? value : parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    if (this.limitOptions.includes(parsed)) {
      this.limit.set(parsed);
      this.syncFiltersToRoute();
      return;
    }

    this.limit.set(100);
    this.syncFiltersToRoute();
  }

  onAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    this.syncAutoRefreshTimer();
  }

  onAutoRefreshIntervalChange(intervalSeconds: number): void {
    this.refreshPreferences.setAutoRefreshInterval(intervalSeconds);
    this.syncAutoRefreshTimer();
  }

  applyFilters(): void {
    this.isFilterExpanded.set(false);
    this.syncFiltersToRoute();
    this.loadAudits();
  }

  downloadVisibleAsCsv(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    const rows = this.filteredSortedAudits();
    if (!rows.length) {
      return;
    }

    const header = ['Timestamp (EST/EDT)', 'Resource', 'Namespace', 'Event', 'Actor', 'Status', 'Action Performed'];
    const csvRows = rows.map(item => [
      this.formatUtc(item.timestampUtc),
      this.displayResource(item),
      item.namespace || '-',
      this.displayEvent(item),
      item.actor || '',
      this.displayStatus(item),
      this.displayActionPerformedOn(item)
    ]);

    const lines = [header, ...csvRows]
      .map(columns => columns.map(value => this.escapeCsv(value)).join(','))
      .join('\r\n');
    const csv = `\uFEFF${lines}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    try {
      link.href = url;
      link.download = `admin-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  resetFilters(): void {
    const end = this.nowCeiledToMinute();
    const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
    this.endUtc.set(end);
    this.startUtc.set(start);
    this.activePresetDays.set(7);
    this.limit.set(100);
    this.userFilter.set('');
    this.actionFilter.set('');
    this.resourceNameFilter.set('');
    this.frontendSearch.set('');
    this.selectedNamespaces.set([...this.namespaceOptions()]);
    this.sortColumn.set('timestamp');
    this.sortDirection.set('desc');
    this.syncFiltersToRoute();
  }

  setSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      this.syncFiltersToRoute();
      return;
    }

    this.sortColumn.set(column);
    this.sortDirection.set(column === 'timestamp' ? 'desc' : 'asc');
    this.syncFiltersToRoute();
  }

  sortIndicator(column: SortColumn): string {
    if (this.sortColumn() !== column) return '↕';
    return this.sortDirection() === 'asc' ? '↑' : '↓';
  }

  loadAudits(): void {
    if (!this.isAdmin()) return;
    if (this.loading()) return;

    this.refreshRangeForActivePreset();
    this.loading.set(true);
    this.error.set(null);

    this.ensureDefaultNamespacesSelected();
    this.adminAuditApi.getAudits({
      startUtc: this.startUtc().toISOString(),
      endUtc: this.endUtc().toISOString(),
      limit: this.limit(),
      user: this.userFilter().trim() || undefined,
      action: this.actionFilter().trim() || undefined,
      resourceName: this.resourceNameFilter().trim() || undefined,
      namespaces: this.getNamespacesForRequest()
    }).subscribe({
      next: response => {
        this.audits.set(response.items || []);
        this.loading.set(false);
      },
      error: err => {
        this.loading.set(false);
        this.audits.set([]);
        this.error.set(err?.error?.error || 'Failed to load audits.');
      }
    });
  }

  fallbackEvent(item: AdminAuditEvent): string {
    return (item.action || item.httpMethod || 'updated').toString();
  }

  fallbackActionPerformedOn(item: AdminAuditEvent): string {
    const resourceLabel = item.resourceType ? `${item.resourceType} ` : '';
    const resourceName = item.resourceName || 'resource';
    const namespace = item.namespace ? ` in namespace ${item.namespace}` : '';
    return `${resourceLabel}${resourceName}${namespace}`.trim();
  }

  displayResource(item: AdminAuditEvent): string {
    return (item.resourceName || item.actionPerformedOn || this.fallbackActionPerformedOn(item) || '-').toString();
  }

  displayActionPerformedOn(item: AdminAuditEvent): string {
    return (item.actionPerformedOn || this.fallbackActionPerformedOn(item) || '-').toString();
  }

  getActionPerformedCompact(item: AdminAuditEvent): string {
    const message = this.displayActionPerformedOn(item);
    if (message.length <= 100) {
      return message;
    }

    return `${message.slice(0, 100)}...`;
  }

  hasFullActionPerformedText(item: AdminAuditEvent): boolean {
    return this.displayActionPerformedOn(item).length > 100;
  }

  isRequeuedEvent(item: AdminAuditEvent): boolean {
    return this.displayEvent(item).toLowerCase() === 'requeued';
  }

  openFullActionMessage(item: AdminAuditEvent): void {
    this.copyActionMessageFeedback.set('');
    this.fullActionMessagePopup.set(this.displayActionPerformedOn(item));
  }

  closeFullActionMessagePopup(): void {
    this.fullActionMessagePopup.set(null);
    this.copyActionMessageFeedback.set('');
  }

  async copyFullActionMessageToClipboard(): Promise<void> {
    const message = this.fullActionMessagePopup();
    if (!message) {
      return;
    }

    try {
      await navigator.clipboard.writeText(message);
      this.copyActionMessageFeedback.set('Copied!');
      setTimeout(() => this.copyActionMessageFeedback.set(''), 2000);
    } catch {
      this.copyActionMessageFeedback.set('Failed');
      setTimeout(() => this.copyActionMessageFeedback.set(''), 2000);
    }
  }

  private formatMessageForModal(message: string | null): string {
    if (!message) {
      return '';
    }

    const text = message.trim();
    if (!text) {
      return message;
    }

    const looksLikeJson = (text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'));
    if (!looksLikeJson) {
      return message;
    }

    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return message;
    }
  }

  hasResourceDetailsLink(item: AdminAuditEvent): boolean {
    if (this.isRequeuedEvent(item)) {
      const topic = (item.resourceName || this.displayResource(item)).trim();
      return !!topic && topic !== '-';
    }

    return !!item.namespace?.trim();
  }

  resourceLinkTitle(item: AdminAuditEvent): string {
    return this.isRequeuedEvent(item) ? 'Open messaging deep dive' : 'Open cluster details';
  }

  openResourceDetails(item: AdminAuditEvent): void {
    if (this.isRequeuedEvent(item)) {
      const topic = (item.resourceName || this.displayResource(item)).trim();
      if (!topic || topic === '-') {
        return;
      }

      this.router.navigate(['/messages'], {
        queryParams: {
          view: 'deepdive',
          topic,
          tab: 'messages'
        }
      });
      return;
    }

    const namespace = item.namespace?.trim();
    if (!namespace) {
      return;
    }

    const resource = (item.resourceName || '').trim() || this.displayResource(item).trim();
    const queryParams: Record<string, string> = {
      namespace,
      view: 'deepdive'
    };

    if (resource && resource !== '-') {
      queryParams['resource'] = resource;
    }

    this.router.navigate(['/cluster'], { queryParams });
  }

  normalizeStatus(item: AdminAuditEvent): 'success' | 'failed' {
    const raw = (item.eventStatus || '').toString().toLowerCase();
    if (raw === 'success' || raw === 'ok') return 'success';
    if (raw === 'failed') return 'failed';
    return item.success ? 'success' : 'failed';
  }

  displayStatus(item: AdminAuditEvent): string {
    const normalized = this.normalizeStatus(item);
    return normalized === 'success' ? 'Success' : 'Failed';
  }

  displayEvent(item: AdminAuditEvent): string {
    return (item.eventType || this.fallbackEvent(item) || 'Updated').toString();
  }

  eventBadgeClass(item: AdminAuditEvent): string {
    const event = this.displayEvent(item).toLowerCase();
    if (event === 'started' || event === 'resumed' || event === 'unsuppressed' || event === 'enabled' || event === 'created') {
      return 'event-positive';
    }

    if (event === 'stopped' || event === 'paused' || event === 'disabled') {
      return 'event-warning';
    }

    if (event === 'deleted' || event === 'suppressed' || event === 'failed') {
      return 'event-danger';
    }

    if (event === 'restarted' || event === 'requeued' || event === 'updated') {
      return 'event-info';
    }

    return 'event-neutral';
  }

  formatUtc(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    try {
      return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        timeZoneName: 'short'
      }).format(date);
    } catch {
      const iso = date.toISOString();
      return `${iso.slice(0, 19).replace('T', ' ')} UTC`;
    }
  }

  private nowCeiledToMinute(): Date {
    const now = new Date();
    now.setMilliseconds(0);
    return now;
  }

  private toDateTimeLocal(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  private calculateOffset(): void {
    if (!isPlatformBrowser(this.platformId)) return;
    const element = document.querySelector('.audit-content');
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const scale = this.viewportScaleService.scaleFactor();
    this.componentOffsetTop.set(rect.top / scale);
  }

  private handleResize = (): void => this.calculateOffset();

  private compareByColumn(left: AdminAuditEvent, right: AdminAuditEvent, column: SortColumn): number {
    switch (column) {
      case 'timestamp':
        return this.compareNumbers(Date.parse(left.timestampUtc), Date.parse(right.timestampUtc));
      case 'event':
        return this.compareText((left.eventType || this.fallbackEvent(left)).toString(), (right.eventType || this.fallbackEvent(right)).toString());
      case 'resource':
        return this.compareText(this.displayResource(left), this.displayResource(right));
      case 'namespace':
        return this.compareText(left.namespace || '', right.namespace || '');
      case 'actor':
        return this.compareText(left.actor || '', right.actor || '');
      case 'status':
        return this.compareText(this.displayStatus(left), this.displayStatus(right));
      case 'actionPerformed':
        return this.compareText(this.displayActionPerformedOn(left), this.displayActionPerformedOn(right));
      default:
        return 0;
    }
  }

  private compareText(left: string, right: string): number {
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  }

  private compareNumbers(left: number, right: number): number {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }

  private escapeCsv(value: string): string {
    const text = (value ?? '').toString();
    if (!/[",\r\n]/.test(text)) {
      return text;
    }

    return `"${text.replace(/"/g, '""')}"`;
  }

  isNamespaceSelected(namespace: string): boolean {
    return this.selectedNamespaces().includes(namespace);
  }

  isAllNamespacesSelected(): boolean {
    const options = this.namespaceOptions();
    const selected = this.selectedNamespaces();
    return options.length > 0 && selected.length === options.length;
  }

  toggleNamespace(namespace: string, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const checked = !!input?.checked;
    const current = new Set(this.selectedNamespaces());

    if (checked) {
      current.add(namespace);
    } else {
      current.delete(namespace);
    }

    this.selectedNamespaces.set([...current]);
    this.syncFiltersToRoute();
  }

  toggleAllNamespaces(event: Event): void {
    const input = event.target as HTMLInputElement | null;
    const checked = !!input?.checked;
    this.selectedNamespaces.set(checked ? [...this.namespaceOptions()] : []);
    this.syncFiltersToRoute();
  }

  onUserFilterChange(value: unknown): void {
    this.userFilter.set((value ?? '').toString());
    this.syncFiltersToRoute();
  }

  onActionFilterChange(value: unknown): void {
    this.actionFilter.set((value ?? '').toString());
    this.syncFiltersToRoute();
  }

  onResourceNameFilterChange(value: unknown): void {
    this.resourceNameFilter.set((value ?? '').toString());
    this.syncFiltersToRoute();
  }

  onFrontendSearchChange(value: unknown): void {
    this.frontendSearch.set((value ?? '').toString());
    this.syncFiltersToRoute();
  }

  private ensureDefaultNamespacesSelected(): void {
    if (this.selectedNamespaces().length > 0) {
      return;
    }

    this.selectedNamespaces.set([...this.namespaceOptions()]);
  }

  private getNamespacesForRequest(): string[] | undefined {
    const options = this.namespaceOptions();
    const selected = this.selectedNamespaces();

    // "All selected" means no namespace restriction, so docs with null/missing namespace are included.
    if (selected.length === 0 || (options.length > 0 && selected.length === options.length)) {
      return undefined;
    }

    return selected;
  }

  private applyRouteFilters(): void {
    const params = this.route.snapshot.queryParamMap;
    const routeUser = (params.get('user') || '').trim();
    const routeAction = (params.get('action') || '').trim();
    const routeResource = (params.get('resource') || '').trim();
    const routeSearch = (params.get('q') || '').trim();
    const routeSort = (params.get('sort') || '').trim() as SortColumn;
    const routeDir = (params.get('dir') || '').trim() as SortDirection;
    const routePreset = this.parsePositiveInt(params.get('preset'));
    const routeLimit = this.parsePositiveInt(params.get('limit'));
    const routeStart = params.get('start');
    const routeEnd = params.get('end');
    const routeNamespaces = (params.get('namespaces') || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);

    this.userFilter.set(routeUser);
    this.actionFilter.set(routeAction);
    this.resourceNameFilter.set(routeResource);
    this.frontendSearch.set(routeSearch);

    if (this.isSortColumn(routeSort)) {
      this.sortColumn.set(routeSort);
    } else {
      this.sortColumn.set('timestamp');
    }
    if (routeDir === 'asc' || routeDir === 'desc') {
      this.sortDirection.set(routeDir);
    } else {
      this.sortDirection.set('desc');
    }

    if (routeLimit && this.limitOptions.includes(routeLimit)) {
      this.limit.set(routeLimit);
    } else {
      this.limit.set(100);
    }

    const parsedStart = routeStart ? new Date(routeStart) : null;
    const parsedEnd = routeEnd ? new Date(routeEnd) : null;
    const hasValidStart = !!parsedStart && !Number.isNaN(parsedStart.getTime());
    const hasValidEnd = !!parsedEnd && !Number.isNaN(parsedEnd.getTime());
    if (hasValidStart && hasValidEnd) {
      this.startUtc.set(parsedStart!);
      this.endUtc.set(parsedEnd!);
      this.activePresetDays.set(0);
    } else {
      const presetDays = routePreset && routePreset <= 90 ? routePreset : 7;
      const end = this.nowCeiledToMinute();
      const start = new Date(end.getTime() - presetDays * 24 * 60 * 60 * 1000);
      this.endUtc.set(end);
      this.startUtc.set(start);
      this.activePresetDays.set(presetDays);
    }

    const options = this.namespaceOptions();
    if (routeNamespaces.length > 0) {
      const valid = routeNamespaces.filter(item => options.includes(item));
      this.selectedNamespaces.set(valid.length ? valid : [...options]);
    } else {
      this.selectedNamespaces.set([...options]);
    }
  }

  private syncFiltersToRoute(): void {
    if (!isPlatformBrowser(this.platformId) || this.syncingRoute) {
      return;
    }

    const namespacesForRoute = this.getNamespacesForRoute();
    const preset = this.activePresetDays();
    const includeCustomRange = preset <= 0;

    this.syncingRoute = true;
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        user: this.userFilter().trim() || null,
        action: this.actionFilter().trim() || null,
        resource: this.resourceNameFilter().trim() || null,
        q: this.frontendSearch().trim() || null,
        limit: this.limit() !== 100 ? this.limit() : null,
        sort: this.sortColumn() !== 'timestamp' ? this.sortColumn() : null,
        dir: this.sortDirection() !== 'desc' ? this.sortDirection() : null,
        preset: preset > 0 && preset !== 7 ? preset : null,
        start: includeCustomRange ? this.startUtc().toISOString() : null,
        end: includeCustomRange ? this.endUtc().toISOString() : null,
        namespaces: namespacesForRoute
      }
    }).finally(() => {
      this.syncingRoute = false;
    });
  }

  private getNamespacesForRoute(): string | null {
    const options = this.namespaceOptions();
    const selected = this.selectedNamespaces();
    if (selected.length === 0 || selected.length === options.length) {
      return null;
    }

    return selected.join(',');
  }

  private parsePositiveInt(value: string | null): number | null {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return null;
    }

    return parsed;
  }

  private isSortColumn(value: string): value is SortColumn {
    return value === 'timestamp' ||
      value === 'event' ||
      value === 'resource' ||
      value === 'namespace' ||
      value === 'actor' ||
      value === 'status' ||
      value === 'actionPerformed';
  }

  private refreshRangeForActivePreset(): void {
    const presetDays = this.activePresetDays();
    if (presetDays <= 0) {
      return;
    }

    const end = this.nowCeiledToMinute();
    const start = new Date(end.getTime() - presetDays * 24 * 60 * 60 * 1000);
    this.endUtc.set(end);
    this.startUtc.set(start);
  }

  private matchesSearchText(source: string, query: string): boolean {
    if (!query) return true;
    const sourceValue = source.toLowerCase();
    const queryValue = query.toLowerCase().trim();
    if (!queryValue) return true;
    return sourceValue.includes(queryValue);
  }

  private matchesGlobalSearch(item: AdminAuditEvent, query: string): boolean {
    if (!query) {
      return true;
    }

    const normalizedQuery = query.toLowerCase();
    const fields = [
      this.formatUtc(item.timestampUtc),
      (item.eventType || this.fallbackEvent(item)).toString(),
      this.displayResource(item),
      this.displayActionPerformedOn(item),
      item.actor || '',
      item.actorEmail || '',
      item.action || '',
      item.resourceName || '',
      item.namespace || '',
      this.displayStatus(item)
    ];

    return fields.some(field => this.matchesSearchText(field, normalizedQuery));
  }

  ngOnDestroy(): void {
    this.clearAutoRefreshTimer();
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', this.handleResize);
    }
  }

  private syncAutoRefreshTimer(): void {
    if (!isPlatformBrowser(this.platformId)) return;

    this.clearAutoRefreshTimer();
    if (!this.autoRefreshEnabled()) return;

    const intervalMs = this.autoRefreshInterval() * 1000;
    this.autoRefreshTimer = setInterval(() => this.loadAudits(), intervalMs);
  }

  private clearAutoRefreshTimer(): void {
    if (this.autoRefreshTimer === null) return;
    clearInterval(this.autoRefreshTimer);
    this.autoRefreshTimer = null;
  }
}
