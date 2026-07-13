import { Component, OnInit, OnDestroy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { ElasticsearchLogEntry, ElasticsearchService, ErrorAnalyticsResponse, ErrorGroup, SimilarErrorsResponse } from '../../core/services/api/elasticsearch.service';
import { HeaderComponent } from '../../layout/header/header.component';
import { HealthFilter, ViewMode } from '../../core/models/cluster-info.models';
import { ViewportScaleService } from '../../core/services/viewport-scale.service';
import { RefreshPreferencesService } from '../../core/services/refresh-preferences.service';

type ErrorTableSortField =
  | 'count'
  | 'errorMessage'
  | 'normalizedMessage'
  | 'serviceName'
  | 'firstOccurrence'
  | 'lastOccurrence';

@Component({
  selector: 'app-error-analytics',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, HeaderComponent],
  template: `
    <div class="error-analytics-page">
      <app-header
        [headerMode]="'dashboard'"
        [currentView]="'scanning'"
        [healthFilter]="[]"
        [autoRefreshEnabled]="refreshPreferences.autoRefreshEnabled()"
        [autoRefreshInterval]="refreshPreferences.autoRefreshInterval()"
        [showRouteContext]="true"
        [showHealthFilter]="false"
        [showSearch]="false"
        [showStats]="false"
        [showViewToggle]="false"
        [showDashboardQuickActions]="true"
        [externalIsRefreshing]="loading()"
        (searchChange)="onHeaderSearchChange($event)"
        (viewChange)="onHeaderViewChange($event)"
        (healthFilterChange)="onHeaderHealthFilterChange($event)"
        (autoRefreshEnabledChange)="onHeaderAutoRefreshEnabledChange($event)"
        (autoRefreshIntervalChange)="onHeaderAutoRefreshIntervalChange($event)"
        (refreshClick)="loadErrorAnalytics()"
      />

      <div class="view-container">
        <div class="error-analytics-content">
          <div class="error-header">
            <div>
              <h1><i class="fas fa-triangle-exclamation"></i> Errors</h1>
              <p>Track application errors with time-based filtering and grouped insights.</p>
        </div>
      </div>

          <div class="filters-card">
            <button type="button" class="filters-toggle" (click)="toggleFilters()">
              <span><i class="fas fa-filter"></i> Filters</span>
              <i class="fas" [class.fa-chevron-down]="filtersCollapsed()" [class.fa-chevron-up]="!filtersCollapsed()"></i>
            </button>

            @if (!filtersCollapsed()) {
      <div class="filters-section">
        <div class="filter-group">
          <label for="serviceName">Service Name (Optional)</label>
          <input
            type="text"
            id="serviceName"
                    [(ngModel)]="serviceNameFilterValue"
            placeholder="Filter by service name..."
            (input)="onServiceNameChange($event)"
            [disabled]="loading()"
          />
        </div>

        <div class="filter-group">
          <label for="days">Time Range (Days)</label>
          <select
            id="days"
                    [(ngModel)]="daysFilterValue"
            (change)="onDaysChange($event)"
            [disabled]="loading()"
          >
                    <option [value]="1">Last 24 hours</option>
            <option [value]="3">Last 3 days</option>
            <option [value]="7">Last 7 days</option>
            <option [value]="14">Last 14 days</option>
            <option [value]="30">Last 30 days</option>
          </select>
        </div>

        <div class="filter-group">
          <label for="minCount">Minimum Occurrences</label>
          <input
            type="number"
            id="minCount"
                    [(ngModel)]="minCountFilterValue"
            min="1"
            (change)="onMinCountChange($event)"
            [disabled]="loading()"
          />
        </div>

        <div class="filter-actions">
                  <button class="btn-primary" (click)="onAnalyzeErrorsClick()" [disabled]="loading()">
            <i class="fas fa-search" [class.fa-spin]="loading()"></i>
            {{ loading() ? 'Loading...' : 'Analyze Errors' }}
          </button>
                  <button class="btn-secondary" (click)="clearFilters()" [disabled]="loading()">
            Clear Filters
          </button>
        </div>
              </div>
            }
      </div>

          <div class="results-section">
      @if (loading()) {
              <div class="table-container dashboard-common-table-wrap loading-table-wrap">
                <table class="dashboard-common-table errors-table">
                  <thead>
                    <tr>
                      <th class="count-col">Count</th>
                      <th class="message-col">Error Message</th>
                      <th class="normalized-col">Normalized Pattern</th>
                      <th class="service-col">Service</th>
                      <th class="first-col">First Occurrence</th>
                      <th class="last-col">Last Occurrence</th>
                      <th class="actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of skeletonRows; track row) {
                      <tr>
                        <td><div class="cell-skeleton sm"></div></td>
                        <td><div class="cell-skeleton"></div></td>
                        <td><div class="cell-skeleton"></div></td>
                        <td><div class="cell-skeleton sm"></div></td>
                        <td><div class="cell-skeleton sm"></div></td>
                        <td><div class="cell-skeleton sm"></div></td>
                        <td><div class="cell-skeleton sm"></div></td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else if (error()) {
        <div class="error-message">
          <i class="fas fa-exclamation-triangle"></i>
          {{ error() }}
        </div>
            } @else if (analyticsData() && analyticsData()!.errorGroups.length > 0) {
          <div class="section-header-with-search">
                <div class="summary-stats-inline">
                  <span class="stat-item"><strong>{{ analyticsData()!.totalErrors | number }}</strong> Total Errors</span>
                  <span class="stat-item"><strong>{{ analyticsData()!.totalErrorDocuments | number }}</strong> Error Documents</span>
                  <span class="stat-item"><strong>{{ analyticsData()!.errorGroups.length | number }}</strong> Unique Error Types</span>
                  <span class="stat-item"><strong>{{ formatDateRange() }}</strong></span>
            </div>
            <div class="search-container">
              <i class="fas fa-search search-icon"></i>
              <input
                type="text"
                class="search-input"
                    [ngModel]="tableSearchFilterValue()"
                    (ngModelChange)="onTableSearchChange($event)"
                    placeholder="Search messages, patterns, or services..."
                  />
            </div>
          </div>

              <div class="table-container dashboard-common-table-wrap">
                <table class="dashboard-common-table errors-table">
              <thead>
                <tr>
                      <th class="count-col sortable">
                        <button type="button" class="sort-btn" (click)="setTableSort('count')">
                          Count
                          <i [class]="'fas ' + getSortIcon('count')"></i>
                        </button>
                      </th>
                      <th class="message-col sortable">
                        <button type="button" class="sort-btn" (click)="setTableSort('errorMessage')">
                          Error Message
                          <i [class]="'fas ' + getSortIcon('errorMessage')"></i>
                        </button>
                      </th>
                      <th class="normalized-col sortable">
                        <button type="button" class="sort-btn" (click)="setTableSort('normalizedMessage')">
                          Normalized Pattern
                          <i [class]="'fas ' + getSortIcon('normalizedMessage')"></i>
                        </button>
                      </th>
                      <th class="service-col sortable">
                        <button type="button" class="sort-btn" (click)="setTableSort('serviceName')">
                          Service
                          <i [class]="'fas ' + getSortIcon('serviceName')"></i>
                        </button>
                      </th>
                      <th class="first-col sortable">
                        <button type="button" class="sort-btn" (click)="setTableSort('firstOccurrence')">
                          First Occurrence
                          <i [class]="'fas ' + getSortIcon('firstOccurrence')"></i>
                        </button>
                      </th>
                      <th class="last-col sortable">
                        <button type="button" class="sort-btn" (click)="setTableSort('lastOccurrence')">
                          Last Occurrence
                          <i [class]="'fas ' + getSortIcon('lastOccurrence')"></i>
                        </button>
                      </th>
                  <th class="actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                    @for (group of sortedErrorGroups(); track group.errorMessage + group.count) {
                  <tr>
                    <td class="count-col">
                      <span class="count-badge">{{ group.count | number }}</span>
                    </td>
                    <td class="message-col">
                      <div class="message-content" [title]="group.errorMessage">
                            {{ truncateMessage(group.errorMessage, 120) }}
                      </div>
                    </td>
                    <td class="normalized-col">
                      <div class="normalized-content" [title]="group.normalizedMessage">
                            {{ truncateMessage(group.normalizedMessage, 100) }}
                      </div>
                    </td>
                    <td class="service-col">
                      @if (group.serviceName) {
                        <a
                          [routerLink]="['/cluster']"
                          [queryParams]="{ view: 'deepdive', resource: group.serviceName }"
                          class="service-link"
                            >
                              {{ group.serviceName }}
                            </a>
                      } @else {
                        <span>N/A</span>
                      }
                    </td>
                        <td class="first-col">
                          <div class="occurrence-cell">
                            <span>{{ formatDate(group.firstOccurrence) }}</span>
                      <button
                              type="button"
                              class="btn-occurrence-focus"
                              (click)="openMainTableOccurrenceInGlobalLogs(group, 'first')"
                              title="Focus Global Logs around first occurrence (+/- 1 minute)"
                            >
                              <i class="fas fa-crosshairs"></i>
                      </button>
                          </div>
                        </td>
                        <td class="last-col">
                          <div class="occurrence-cell">
                            <span>{{ formatDate(group.lastOccurrence) }}</span>
                      <button
                              type="button"
                              class="btn-occurrence-focus"
                              (click)="openMainTableOccurrenceInGlobalLogs(group, 'last')"
                              title="Focus Global Logs around last occurrence (+/- 1 minute)"
                            >
                              <i class="fas fa-crosshairs"></i>
                            </button>
                          </div>
                        </td>
                        <td class="actions-col">
                          <button class="btn-icon" (click)="openInGlobalLogs(group)" title="Open this error in Global Logs">
                            <i class="fas fa-search"></i>
                          </button>
                          <button class="btn-icon" (click)="viewSimilarErrors(group)" title="Find similar errors">
                            <i class="fas fa-code-branch"></i>
                          </button>
                          <button class="btn-icon" (click)="viewSampleLogs(group)" title="View sample logs">
                        <i class="fas fa-list"></i>
                      </button>
                    </td>
                  </tr>
                }
                    @if (sortedErrorGroups().length === 0) {
                      <tr class="no-results-row">
                        <td colspan="7" class="no-results-cell">
                          <i class="fas fa-search"></i>
                          <span>No errors match your search criteria.</span>
                        </td>
                      </tr>
                    }
              </tbody>
            </table>
          </div>
            } @else if (analyticsData() && analyticsData()!.errorGroups.length === 0) {
              <div class="empty-state">
          <i class="fas fa-check-circle"></i>
          <p>No errors found for the selected criteria.</p>
        </div>
      }
        </div>

      @if (showSimilarErrorsModal()) {
            <div class="modal-overlay" (click)="closeSimilarErrorsModal()">
              <div class="modal-content" (click)="$event.stopPropagation()" [ngStyle]="modalContentStyle()">
            <div class="modal-header">
                  <div class="modal-title-block">
              <h3>Similar Errors</h3>
                    <p class="modal-subtitle">
                      @if (selectedErrorGroup(); as group) {
                        Similar to "<strong>{{ truncateMessage(group.errorMessage, 120) }}</strong>"
                        @if (group.serviceName) {
                          for <strong>{{ group.serviceName }}</strong>
                        }
                        in the last <strong>{{ daysFilterValue }}</strong> day{{ daysFilterValue === 1 ? '' : 's' }}.
                      }
                    </p>
                  </div>
                  <button class="modal-close" (click)="closeSimilarErrorsModal()" aria-label="Close similar errors">&times;</button>
            </div>
            <div class="modal-body">
                  <div class="similar-toolbar">
                    <div class="similar-context-chips">
                      <span class="context-chip">
                        <i class="fas fa-briefcase"></i>
                        Service: {{ similarErrorsData()?.serviceName || selectedErrorGroup()?.serviceName || 'N/A' }}
                      </span>
                      <span class="context-chip">
                        <i class="fas fa-clock"></i>
                        Window: {{ similarErrorsData()?.days || daysFilterValue }}d
                      </span>
                      <span class="context-chip">
                        <i class="fas fa-sliders-h"></i>
                        Mode: {{ strictSimilarityMode() ? 'Exact pattern' : 'Fuzzy similar' }}
                      </span>
                      <span class="context-chip">
                        <i class="fas fa-project-diagram"></i>
                        Scope: {{ includeAllServicesMode() ? 'All services' : 'Same service' }}
                      </span>
                      @if (similarErrorsData()) {
                        <span class="context-chip">
                          <i class="fas fa-database"></i>
                          Candidates: {{ similarErrorsData()!.candidateCount || 0 }}
                        </span>
                        <span class="context-chip">
                          <i class="fas fa-layer-group"></i>
                          Groups: {{ similarErrorsData()!.groupCount || similarErrorsData()!.similarErrors.length }}
                        </span>
                        <span class="context-chip">
                          <i class="fas fa-stopwatch"></i>
                          Query: {{ formatElapsedMs(similarErrorsData()!.elapsedMs) }}
                        </span>
                      }
                    </div>
                    <div class="similar-mode-toggle">
                      <button
                        type="button"
                        class="btn-mode-toggle"
                        [class.active]="!strictSimilarityMode()"
                        [disabled]="loadingSimilar()"
                        (click)="setSimilarityMode(false)"
                      >
                        Fuzzy
                      </button>
                      <button
                        type="button"
                        class="btn-mode-toggle"
                        [class.active]="strictSimilarityMode()"
                        [disabled]="loadingSimilar()"
                        (click)="setSimilarityMode(true)"
                      >
                        Exact
                      </button>
                    </div>
                    <div class="similar-mode-toggle">
                      <button
                        type="button"
                        class="btn-mode-toggle"
                        [class.active]="!includeAllServicesMode()"
                        [disabled]="loadingSimilar()"
                        (click)="setServiceScopeMode(false)"
                      >
                        Same service
                      </button>
                      <button
                        type="button"
                        class="btn-mode-toggle"
                        [class.active]="includeAllServicesMode()"
                        [disabled]="loadingSimilar()"
                        (click)="setServiceScopeMode(true)"
                      >
                        All services
                      </button>
                    </div>
                  </div>
              @if (loadingSimilar()) {
                    <div class="empty-state"><p>Loading similar errors...</p></div>
                  } @else if (similarErrorsData() && similarErrorsData()!.similarErrors.length === 0) {
                    <div class="empty-state">
                      <p>No similar errors found in the selected window.</p>
                      <p class="similar-empty-hint">{{ getSimilarNoResultHint() }}</p>
                      <div class="similar-empty-actions">
                        <button type="button" class="btn-secondary" (click)="setSimilarDaysAndReload(7)">Try 7 days</button>
                        <button type="button" class="btn-secondary" (click)="setSimilarDaysAndReload(15)">Try 15 days</button>
                        @if (selectedErrorGroup(); as group) {
                          <button type="button" class="btn-primary" (click)="openInGlobalLogs(group)">Open in Global Logs</button>
                        }
                      </div>
                    </div>
              } @else if (similarErrorsData()) {
                    @if (topSimilarGroups().length > 1) {
                      <div class="similar-comparison-wrap">
                        <div class="similar-comparison-title">
                          <i class="fas fa-table"></i>
                          Top Similar Groups
                </div>
                        <div class="similar-comparison-table-wrap dashboard-common-table-wrap">
                          <table class="dashboard-common-table similar-comparison-table">
                            <thead>
                              <tr>
                                <th>Pattern</th>
                                <th>Count</th>
                                <th>Share</th>
                                <th>Score</th>
                                <th>Last Seen</th>
                              </tr>
                            </thead>
                            <tbody>
                              @for (item of topSimilarGroups(); track item.errorMessage + item.count) {
                                <tr>
                                  <td class="similar-compare-pattern">{{ truncateMessage(item.normalizedMessage, 70) }}</td>
                                  <td>{{ item.count }}</td>
                                  <td>{{ getSimilarErrorShare(item.count) }}%</td>
                                  <td>{{ formatSimilarityScore(item.similarityScore) }}</td>
                                  <td>{{ formatDate(item.lastOccurrence.toString()) }}</td>
                                </tr>
                              }
                            </tbody>
                          </table>
                      </div>
                    </div>
                  }
                    <div class="sample-logs-list">
                      @for (item of similarErrorsData()!.similarErrors; track item.errorMessage + item.count) {
                        <div class="sample-log-item">
                          <div class="log-header">
                            <span class="count-badge" title="Total occurrences for this similar error group">{{ item.count }}</span>
                            <span class="similarity-share-badge" title="Share of this group among returned similar groups">{{ getSimilarErrorShare(item.count) }}%</span>
                            <span
                              class="similarity-quality-badge"
                              [class.quality-high]="getSimilarityQuality(item.similarityScore) === 'high'"
                              [class.quality-medium]="getSimilarityQuality(item.similarityScore) === 'medium'"
                              [class.quality-low]="getSimilarityQuality(item.similarityScore) === 'low'"
                              [title]="'Match quality derived from similarity score (' + formatSimilarityScore(item.similarityScore) + ')'"
                            >
                              {{ getSimilarityQualityLabel(item.similarityScore) }}
                            </span>
                            @if (item.serviceName) {
                              <a
                                [routerLink]="['/cluster']"
                                [queryParams]="{ view: 'deepdive', resource: item.serviceName }"
                                class="service-link"
                                title="Open this service in Cluster deep-dive view"
                              >
                                {{ item.serviceName }}
                              </a>
                            } @else {
                              <span>N/A</span>
                            }
                            <button
                              type="button"
                              class="btn-open-global-logs"
                              (click)="openInGlobalLogs(item)"
                              title="Open this error in Global Logs"
                            >
                              <i class="fas fa-search"></i>
                              Global Logs
                            </button>
                </div>
                          <div class="similar-item-hint-row">
                            <span title="How many matching logs this grouped pattern has">Count</span>
                            <span title="This group's percentage share among returned groups">Share %</span>
                            <span title="Relative confidence from Elasticsearch similarity score">Quality</span>
                            <span title="Raw averaged Elasticsearch relevance score for this group">Score</span>
                          </div>
                          <div class="similar-time-meta">
                            <span title="Raw Elasticsearch relevance score (no fixed maximum). Percentage is normalized against top score in this result set.">
                              <strong>Score:</strong>
                              {{ formatSimilarityScore(item.similarityScore) }}
                              <span class="score-context">({{ getNormalizedSimilarityPercent(item.similarityScore) }}% of top)</span>
                            </span>
                            <span><strong>First:</strong> {{ formatDate(item.firstOccurrence.toString()) }}</span>
                            <span><strong>Last:</strong> {{ formatDate(item.lastOccurrence.toString()) }}</span>
                          </div>
                          <div class="similar-actions-row">
                            <button
                              type="button"
                              class="btn-drilldown"
                              (click)="openInGlobalLogsAround(item, 'first')"
                              title="Open logs around first occurrence"
                            >
                              <i class="fas fa-crosshairs"></i>
                              Around first
                            </button>
                            <button
                              type="button"
                              class="btn-drilldown"
                              (click)="openInGlobalLogsAround(item, 'last')"
                              title="Open logs around last occurrence"
                            >
                              <i class="fas fa-crosshairs"></i>
                              Around last
                            </button>
                            @if (item.logKey) {
                              <button
                                type="button"
                                class="btn-pivot-chip"
                                (click)="openInGlobalLogsWithPivot(item, item.logKey, null)"
                                title="Open in Global Logs filtered by log key"
                              >
                                <i class="fas fa-key"></i>
                                Key: {{ item.logKey }}
                              </button>
                            }
                            @for (level of getSimilarItemLogLevels(item); track level) {
                              <button
                                type="button"
                                class="btn-pivot-chip"
                                (click)="openInGlobalLogsWithPivot(item, null, level)"
                                title="Open in Global Logs filtered by level"
                              >
                                <i class="fas fa-layer-group"></i>
                                {{ level }}
                              </button>
              }
            </div>
                          <div class="similar-message-row">
                            <span class="similar-message-label">Message:</span>
                            <a
                              href="#"
                              class="error-filter-link"
                              (click)="applyErrorSearchFilter(item.errorMessage, $event)"
                              [title]="'Filter errors by this message'"
                            >
                              {{ item.errorMessage }}
                            </a>
                          </div>
                          @if (hasDistinctNormalizedMessage(item)) {
                            <div class="normalized-preview">
                              <strong>Pattern:</strong> {{ truncateMessage(item.normalizedMessage, 180) }}
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
          </div>
        </div>
      }

      @if (showSampleLogsModal() && selectedErrorGroup()) {
            <div class="modal-overlay" (click)="closeSampleLogsModal()">
              <div class="modal-content" (click)="$event.stopPropagation()" [ngStyle]="modalContentStyle()">
            <div class="modal-header">
              <h3>Sample Logs</h3>
                  <button class="modal-close" (click)="closeSampleLogsModal()" aria-label="Close sample logs">&times;</button>
            </div>
            <div class="modal-body">
              <div class="sample-logs-list">
                    @for (log of selectedErrorGroup()!.sampleLogs; track log.timestamp + (log.logKey || '')) {
                  <div class="sample-log-item">
                    <div class="log-header">
                          <span>{{ formatDate(log.timestamp) }}</span>
                          @if (log.serviceName) {
                            <a
                              [routerLink]="['/cluster']"
                              [queryParams]="{ view: 'deepdive', resource: log.serviceName }"
                              class="service-link"
                              title="Open service in Cluster deep-dive"
                            >
                              {{ log.serviceName }}
                            </a>
                          } @else {
                            <span>N/A</span>
                          }
                          @if (log.logKey && log.logKey !== log.serviceName) {
                            <span>Key: {{ log.logKey }}</span>
                          }
                          <div class="sample-log-actions">
                            <button
                              type="button"
                              class="btn-sample-log-link"
                              (click)="openSampleLogInGlobalLogs(log)"
                              title="Open this sample log in Global Logs"
                            >
                              <i class="fas fa-search"></i>
                              Global Logs
                            </button>
                            <button
                              type="button"
                              class="btn-sample-log-link"
                              (click)="focusSampleLogInGlobalLogs(log)"
                              title="Focus around this sample log (+/- 1 minute)"
                            >
                              <i class="fas fa-crosshairs"></i>
                              Focus (+/-1m)
                            </button>
                          </div>
                    </div>
                    <div class="log-message">{{ log.message || 'N/A' }}</div>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .error-analytics-page {
      width: 100%;
      background: var(--theme-bg-app);
      padding: 0 1rem;
    }
    .view-container {
      padding: 0.6rem 0 1rem;
      max-width: 100%;
    }
    .error-analytics-content {
      width: var(--base-viewport-width);
      height: calc(var(--base-viewport-height) - 120px);
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding-right: 1.5rem;
      padding-bottom: 1rem;
      overflow: hidden;
    }
    .error-header h1 { margin: 0; font-size: var(--theme-font-page-title); color: var(--theme-text-dark); display: flex; align-items: center; gap: .5rem; }
    .error-header p { margin: .25rem 0 0; color: var(--theme-text-gray); }
    .filters-card {
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 12px;
      overflow: hidden;
    }
    .filters-toggle {
      width: 100%;
      height: 42px;
      padding: 0 0.9rem;
      border: 0;
      border-bottom: 1px solid var(--theme-border-gray-light);
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
    }
    .filters-toggle span {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }
    .filters-toggle i.fa-chevron-down,
    .filters-toggle i.fa-chevron-up {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }
    .filters-section {
      padding: 1rem;
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.75rem;
      align-items: end;
    }
    .filter-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .filter-group label {
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-table-header-color);
    }
    .filter-group input,
    .filter-group select {
      height: 36px;
      border: 1px solid var(--theme-border-gray);
      border-radius: 8px;
      padding: 0 0.75rem;
      font-size: var(--theme-font-body);
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
    }
    .filter-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .btn-primary,
    .btn-secondary {
      height: 36px;
      border-radius: 8px;
      padding: 0 0.8rem;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      border: 1px solid transparent;
    }
    .btn-primary {
      background: var(--theme-button-primary);
      color: #fff;
    }
    .btn-secondary {
      background: var(--theme-bg-app);
      color: var(--theme-table-header-color);
      border-color: var(--theme-border-gray);
    }
    .results-section {
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 12px;
      padding: 0.9rem;
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .section-header-with-search {
      display: flex;
      justify-content: space-between;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .summary-stats-inline {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      font-size: var(--theme-font-caption);
      color: var(--theme-table-header-color);
    }
    .stat-item strong {
      color: var(--theme-text-dark);
    }
    .search-container {
      position: relative;
      min-width: 320px;
      flex: 1;
      max-width: 480px;
    }
    .search-icon {
      position: absolute;
      left: 0.7rem;
      top: 50%;
      transform: translateY(-50%);
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
    }
    .search-input {
      width: 100%;
      height: 36px;
      border: 1px solid var(--theme-border-gray);
      border-radius: 8px;
      padding: 0 0.75rem 0 2rem;
      font-size: var(--theme-font-body);
    }
    .table-container {
      overflow-x: auto;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      height: clamp(420px, calc(100vh - 280px), 920px);
      max-height: calc(100vh - 110px);
    }
    .loading-table-wrap {
      min-height: 300px;
    }
    .errors-table th,
    .errors-table td {
      white-space: nowrap;
    }
    .errors-table thead th {
      position: sticky;
      top: 0;
      z-index: 3;
      background: var(--theme-bg-app);
      font-size: var(--theme-font-table-header);
    }
    .errors-table th.sortable {
      padding: 0.24rem 0.35rem;
    }
    .sort-btn {
      width: 100%;
      min-height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.45rem;
      padding: 0.2rem 0.32rem;
      border: 0;
      background: transparent;
      color: var(--theme-table-header-color);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      text-align: left;
    }
    .sort-btn i {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
    }
    .sort-btn:hover {
      color: var(--theme-text-dark);
    }
    .no-results-row td.no-results-cell {
      text-align: center;
      color: var(--theme-text-gray);
      padding: 1rem;
      white-space: normal;
    }
    .no-results-cell i {
      margin-right: 0.45rem;
    }
    .message-col,
    .normalized-col {
      min-width: 290px;
      max-width: 460px;
      white-space: normal !important;
    }
    .count-col { width: 92px; }
    .service-col { width: 180px; }
    .first-col, .last-col { width: 230px; }
    .occurrence-cell {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      max-width: 100%;
    }
    .btn-occurrence-focus {
      height: 24px;
      min-width: 24px;
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex: 0 0 auto;
    }
    .btn-occurrence-focus:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .actions-col { width: 150px; }
    .count-badge {
      display: inline-block;
      padding: 0.12rem 0.55rem;
      border-radius: 999px;
      background: #fee2e2;
      color: #991b1b;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
    }
    .service-link {
      color: var(--theme-text-teal);
      text-decoration: none;
      font-weight: var(--theme-font-table-header-weight);
    }
    .service-link:hover { text-decoration: underline; }
    .message-content,
    .normalized-content {
      word-break: break-word;
      overflow-wrap: anywhere;
      color: var(--theme-text-dark);
      font-size: var(--theme-font-table-header);
      line-height: 1.35;
    }
    .btn-icon {
      height: 28px;
      min-width: 28px;
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      margin-right: 0.35rem;
      cursor: pointer;
    }
    .btn-icon:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .cell-skeleton {
      height: 14px;
      border-radius: 4px;
      background: linear-gradient(
        90deg,
        var(--theme-skeleton-base) 25%,
        var(--theme-skeleton-highlight) 50%,
        var(--theme-skeleton-base) 75%
      );
      background-size: 200% 100%;
      animation: shimmer 1.3s linear infinite;
      width: 100%;
    }
    .cell-skeleton.sm { max-width: 90px; }
    @keyframes shimmer {
      from { background-position: 200% 0; }
      to { background-position: -200% 0; }
    }
    .error-message,
    .empty-state {
      padding: 1.4rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
      text-align: center;
      color: var(--theme-table-header-color);
    }
    .error-message {
      color: #b91c1c;
      background: #fef2f2;
      border-color: #fecaca;
    }
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(100vh * 20);
      background: rgba(15, 23, 42, 0.45);
      z-index: 1000000;
      pointer-events: auto;
      overflow-y: auto;
      padding: 1rem;
    }
    .modal-content {
      width: 90%;
      max-width: 1200px;
      background: var(--theme-bg-app);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      min-height: 0;
      margin: auto;
      margin-top: 5vh;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
    }
    .modal-header {
      padding: 0.9rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
      color: #fff;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }
    .modal-header h3 {
      margin: 0;
      color: #fff;
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
    }
    .modal-title-block {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      min-width: 0;
    }
    .modal-subtitle {
      margin: 0;
      color: rgba(255, 255, 255, 0.92);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-body-weight);
      line-height: 1.35;
    }
    .modal-subtitle strong {
      color: #fff;
      font-weight: var(--theme-font-table-header-weight);
    }
    .modal-close {
      border: none;
      background: none;
      font-size: var(--theme-font-page-title);
      color: rgba(255, 255, 255, 0.95);
      cursor: pointer;
      line-height: 1;
      padding: 0;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: background-color 0.2s;
    }
    .modal-close:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #fff;
    }
    .modal-body {
      padding: 1rem 1.25rem 1.25rem;
      overflow-y: auto;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      background: var(--theme-bg-app);
    }
    .similar-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.7rem;
      flex-wrap: wrap;
      margin-bottom: 0.75rem;
    }
    .similar-context-chips {
      display: flex;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .context-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      border: 1px solid #dbe2ea;
      background: var(--theme-bg-app);
      color: var(--theme-table-header-color);
      border-radius: 999px;
      padding: 0.2rem 0.55rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
    }
    .similar-mode-toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      background: var(--theme-bg-app);
      border: 1px solid #dbe2ea;
      border-radius: 8px;
      padding: 0.2rem;
    }
    .btn-mode-toggle {
      border: none;
      background: transparent;
      color: var(--theme-table-header-color);
      border-radius: 6px;
      padding: 0.22rem 0.55rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
    }
    .btn-mode-toggle.active {
      background: var(--theme-bg-surface);
      color: var(--theme-text-dark);
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
    }
    .btn-mode-toggle:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .sample-logs-list {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .similar-comparison-wrap {
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
      background: var(--theme-bg-surface);
      padding: 0.65rem;
      margin-bottom: 0.75rem;
    }
    .similar-comparison-title {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      margin-bottom: 0.5rem;
    }
    .similar-comparison-table-wrap {
      max-height: 180px;
      overflow: auto;
    }
    .similar-comparison-table th,
    .similar-comparison-table td {
      font-size: var(--theme-font-caption);
      padding: 0.35rem 0.45rem;
      white-space: nowrap;
    }
    .similar-compare-pattern {
      white-space: normal !important;
      max-width: 320px;
      color: var(--theme-table-header-color);
    }
    .sample-log-item {
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
      background: var(--theme-bg-surface);
      padding: 0.7rem;
    }
    .log-header {
      display: flex;
      gap: 0.65rem;
      flex-wrap: wrap;
      align-items: center;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      margin-bottom: 0.35rem;
    }
    .sample-log-actions {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-left: auto;
    }
    .btn-sample-log-link {
      height: 24px;
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0 0.45rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-sample-log-link:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .similarity-share-badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      background: var(--theme-bg-teal-lighter);
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      padding: 0.1rem 0.4rem;
    }
    .similarity-quality-badge {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 0.1rem 0.45rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
    }
    .similarity-quality-badge.quality-high {
      background: #dcfce7;
      color: #166534;
    }
    .similarity-quality-badge.quality-medium {
      background: #fef3c7;
      color: #92400e;
    }
    .similarity-quality-badge.quality-low {
      background: #fee2e2;
      color: #991b1b;
    }
    .similar-time-meta {
      display: flex;
      gap: 0.8rem;
      flex-wrap: wrap;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      margin-bottom: 0.35rem;
    }
    .similar-item-hint-row {
      display: flex;
      gap: 0.6rem;
      flex-wrap: wrap;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      margin-bottom: 0.28rem;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      font-weight: var(--theme-font-table-header-weight);
    }
    .score-context {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      margin-left: 0.2rem;
    }
    .normalized-preview {
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      margin-bottom: 0.28rem;
      line-height: 1.35;
    }
    .normalized-preview strong {
      color: var(--theme-text-dark);
    }
    .similar-message-row {
      display: flex;
      gap: 0.35rem;
      align-items: flex-start;
      margin-bottom: 0.3rem;
      line-height: 1.35;
    }
    .similar-message-label {
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      flex-shrink: 0;
      margin-top: 0.02rem;
    }
    .similar-actions-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: nowrap;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      padding-bottom: 0.15rem;
      margin-bottom: 0.35rem;
      scrollbar-width: thin;
      scrollbar-color: var(--theme-border-gray) transparent;
    }
    .similar-actions-row::-webkit-scrollbar {
      height: 6px;
    }
    .similar-actions-row::-webkit-scrollbar-track {
      background: transparent;
    }
    .similar-actions-row::-webkit-scrollbar-thumb {
      background-color: var(--theme-border-gray);
      border-radius: 999px;
    }
    .btn-drilldown {
      height: 27px;
      border: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      border-radius: 6px;
      padding: 0 0.55rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      flex: 0 0 auto;
    }
    .btn-drilldown:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .btn-drilldown i {
      font-size: var(--theme-font-caption);
      line-height: 1;
    }
    .btn-pivot-chip {
      height: 25px;
      border: 1px solid #d1d5db;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      border-radius: 999px;
      padding: 0 0.55rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.28rem;
      max-width: 320px;
      flex: 0 0 auto;
    }
    .btn-pivot-chip:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .btn-pivot-chip i {
      font-size: var(--theme-font-caption);
      line-height: 1;
    }
    .log-message {
      color: var(--theme-text-dark);
      font-size: var(--theme-font-table-header);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .error-filter-link {
      color: var(--theme-text-dark);
      font-size: var(--theme-font-table-header);
      white-space: pre-wrap;
      word-break: break-word;
      text-decoration: none;
      cursor: pointer;
    }
    .error-filter-link:hover {
      color: var(--theme-text-teal);
      text-decoration: underline;
    }
    .btn-open-global-logs {
      margin-left: auto;
      height: 28px;
      min-width: 28px;
      border: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      border-radius: 6px;
      padding: 0 0.55rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.3rem;
    }
    .btn-open-global-logs i {
      font-size: var(--theme-font-table-header);
      line-height: 1;
    }
    .btn-open-global-logs:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }
    .similar-empty-actions {
      margin-top: 0.8rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      justify-content: center;
    }
    .similar-empty-hint {
      margin: 0.35rem 0 0;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      line-height: 1.35;
    }
    .similar-empty-actions .btn-primary,
    .similar-empty-actions .btn-secondary {
      height: 30px;
      padding: 0 0.7rem;
      font-size: var(--theme-font-caption);
      border-radius: 7px;
    }
  `]
})
export class ErrorAnalyticsComponent implements OnInit, OnDestroy {
  private readonly elasticsearchService = inject(ElasticsearchService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly viewportScaleService = inject(ViewportScaleService);
  readonly refreshPreferences = inject(RefreshPreferencesService);
  private readonly serviceNameSubject = new Subject<string>();
  private readonly similarDrilldownWindowSeconds = 300;
  private readonly mainTableFocusWindowSeconds = 60;
  private readonly similarModalParamKey = 'similar';
  private readonly similarModalServiceParamKey = 'simSvc';
  private readonly similarModalMessageParamKey = 'simMsg';
  private readonly similarModalStrictParamKey = 'simStrict';
  private readonly similarModalScopeParamKey = 'simAll';
  private applyingRouteState = false;
  private autoRefreshTimer?: number;
  private isAutoRefreshActive = false;

  loading = signal(false);
  error = signal<string>('');
  analyticsData = signal<ErrorAnalyticsResponse | null>(null);
  showSimilarErrorsModal = signal(false);
  showSampleLogsModal = signal(false);
  loadingSimilar = signal(false);
  similarErrorsData = signal<SimilarErrorsResponse | null>(null);
  selectedErrorGroup = signal<ErrorGroup | null>(null);
  strictSimilarityMode = signal(false);
  includeAllServicesMode = signal(false);
  filtersCollapsed = signal(true);

  serviceNameFilterValue = '';
  daysFilterValue = 1;
  minCountFilterValue = 1;
  tableSearchFilterValue = signal('');
  tableSortField = signal<ErrorTableSortField>('lastOccurrence');
  tableSortDirection = signal<'asc' | 'desc'>('desc');

  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  readonly modalContentStyle = computed(() => {
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const visibleHeight = viewportHeight / scale;
    const maxHeight = Math.min((94 * baseHeight) / 100, visibleHeight * 0.94);
    return {
      maxHeight: `${maxHeight}px`,
    };
  });

  filteredErrorGroups = computed(() => {
    const data = this.analyticsData();
    const searchTerm = this.tableSearchFilterValue().toLowerCase().trim();
    if (!data || !searchTerm) return data?.errorGroups || [];
    return data.errorGroups.filter(group =>
      (group.errorMessage || '').toLowerCase().includes(searchTerm) ||
      (group.normalizedMessage || '').toLowerCase().includes(searchTerm) ||
      (group.serviceName || '').toLowerCase().includes(searchTerm)
    );
  });
  sortedErrorGroups = computed(() => {
    const rows = [...this.filteredErrorGroups()];
    const sortField = this.tableSortField();
    const sortDirection = this.tableSortDirection();
    const directionFactor = sortDirection === 'asc' ? 1 : -1;

    rows.sort((a, b) => this.compareErrorGroups(a, b, sortField) * directionFactor);
    return rows;
  });
  topSimilarGroups = computed(() => {
    const items = this.similarErrorsData()?.similarErrors ?? [];
    return [...items]
      .sort((a, b) => {
        const scoreDiff = Number(b.similarityScore ?? 0) - Number(a.similarityScore ?? 0);
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return b.count - a.count;
      })
      .slice(0, 5);
  });

  constructor() {
    this.serviceNameSubject
      .pipe(debounceTime(500), distinctUntilChanged())
      .subscribe(() => {
        if (this.analyticsData()) {
          this.loadErrorAnalytics();
        }
      });
  }

  ngOnInit(): void {
    this.applyFiltersFromRoute();

    this.route.queryParamMap.subscribe(() => {
      this.applyFiltersFromRoute();
    });

    this.loadErrorAnalytics();
    this.setupAutoRefresh();
  }

  onHeaderSearchChange(_query: string): void {}
  onHeaderViewChange(_view: ViewMode): void {}
  onHeaderHealthFilterChange(_filter: HealthFilter[]): void {}
  onHeaderAutoRefreshEnabledChange(enabled: boolean): void {
    this.refreshPreferences.setAutoRefreshEnabled(enabled);
    if (enabled) {
      this.setupAutoRefresh();
    } else {
      this.clearAutoRefresh();
    }
  }

  onHeaderAutoRefreshIntervalChange(interval: number): void {
    this.refreshPreferences.setAutoRefreshInterval(interval);
    this.clearAutoRefresh();
    this.setupAutoRefresh();
  }
  toggleFilters(): void {
    this.filtersCollapsed.set(!this.filtersCollapsed());
  }

  onAnalyzeErrorsClick(): void {
    this.loadErrorAnalytics();
    this.filtersCollapsed.set(true);
  }

  onServiceNameChange(event: Event): void {
    this.serviceNameFilterValue = (event.target as HTMLInputElement).value;
    this.serviceNameSubject.next(this.serviceNameFilterValue);
    this.syncRouteWithFilters();
  }

  onDaysChange(event: Event): void {
    this.daysFilterValue = parseInt((event.target as HTMLSelectElement).value, 10);
    this.syncRouteWithFilters();
  }

  onMinCountChange(event: Event): void {
    this.minCountFilterValue = parseInt((event.target as HTMLInputElement).value, 10) || 1;
    this.syncRouteWithFilters();
  }

  onTableSearchChange(value: string): void {
    this.tableSearchFilterValue.set(value ?? '');
    this.syncRouteWithFilters();
  }

  setTableSort(field: ErrorTableSortField): void {
    if (this.tableSortField() === field) {
      const nextDirection = this.tableSortDirection() === 'asc' ? 'desc' : 'asc';
      this.tableSortDirection.set(nextDirection);
    } else {
      this.tableSortField.set(field);
      this.tableSortDirection.set(field === 'lastOccurrence' ? 'desc' : 'asc');
    }
    this.syncRouteWithFilters();
  }

  getSortIcon(field: ErrorTableSortField): 'fa-sort' | 'fa-sort-up' | 'fa-sort-down' {
    if (this.tableSortField() !== field) {
      return 'fa-sort';
    }
    return this.tableSortDirection() === 'asc' ? 'fa-sort-up' : 'fa-sort-down';
  }

  clearFilters(): void {
    this.serviceNameFilterValue = '';
    this.daysFilterValue = 1;
    this.minCountFilterValue = 1;
    this.tableSearchFilterValue.set('');
    this.tableSortField.set('lastOccurrence');
    this.tableSortDirection.set('desc');
    this.syncRouteWithFilters();
    this.loadErrorAnalytics();
  }

  loadErrorAnalytics(): void {
    this.syncRouteWithFilters();
    this.loading.set(true);
    this.error.set('');
    const serviceName = this.serviceNameFilterValue.trim() || undefined;
    this.elasticsearchService.getErrorAnalytics(serviceName, this.daysFilterValue, this.minCountFilterValue).subscribe({
      next: data => {
        this.analyticsData.set(data);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(err.error?.error || err.message || 'Failed to load error analytics');
        this.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.clearAutoRefresh();
  }

  private setupAutoRefresh(): void {
    this.clearAutoRefresh();
    const enabled = this.refreshPreferences.autoRefreshEnabled();
    const interval = this.refreshPreferences.autoRefreshInterval();
    if (!enabled || interval <= 0) {
      return;
    }

    this.isAutoRefreshActive = true;
    this.scheduleNextRefresh(interval);
  }

  private scheduleNextRefresh(intervalSeconds: number): void {
    if (!this.isAutoRefreshActive) {
      return;
    }

    this.autoRefreshTimer = window.setTimeout(() => {
      if (!this.isAutoRefreshActive) {
        return;
      }

      if (!this.loading()) {
        this.loadErrorAnalytics();
      }

      if (this.isAutoRefreshActive) {
        this.scheduleNextRefresh(intervalSeconds);
      }
    }, intervalSeconds * 1000);
  }

  private clearAutoRefresh(): void {
    this.isAutoRefreshActive = false;
    if (this.autoRefreshTimer) {
      window.clearTimeout(this.autoRefreshTimer);
      this.autoRefreshTimer = undefined;
    }
  }

  viewSimilarErrors(group: ErrorGroup): void {
    if (!group.serviceName) return;
    this.selectedErrorGroup.set(group);
    this.showSimilarErrorsModal.set(true);
    this.loadingSimilar.set(true);
    this.similarErrorsData.set(null);
    this.syncRouteWithSimilarModal(group.serviceName, group.errorMessage);

    this.elasticsearchService.getSimilarErrors(
      group.serviceName,
      group.errorMessage,
      this.daysFilterValue,
      10,
      this.strictSimilarityMode(),
      this.includeAllServicesMode()
    ).subscribe({
      next: data => {
        this.similarErrorsData.set(data);
        this.loadingSimilar.set(false);
      },
      error: () => {
        this.loadingSimilar.set(false);
      }
    });
  }

  viewSampleLogs(group: ErrorGroup): void {
    this.selectedErrorGroup.set(group);
    this.showSampleLogsModal.set(true);
  }

  closeSimilarErrorsModal(updateRoute: boolean = true): void {
    this.showSimilarErrorsModal.set(false);
    this.similarErrorsData.set(null);
    this.selectedErrorGroup.set(null);
    this.strictSimilarityMode.set(false);
    this.includeAllServicesMode.set(false);
    if (updateRoute) {
      this.clearSimilarModalRouteParams();
    }
  }

  closeSampleLogsModal(): void {
    this.showSampleLogsModal.set(false);
    this.selectedErrorGroup.set(null);
  }

  openInGlobalLogs(item: ErrorGroup): void {
    if (this.showSimilarErrorsModal()) {
      this.closeSimilarErrorsModal(false);
    }
    const serviceName = (item.serviceName || this.selectedErrorGroup()?.serviceName || '').trim();
    const message = (item.errorMessage || '').trim();
    const now = new Date();
    const days = Math.max(this.daysFilterValue || 1, 1);
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    this.navigateToGlobalLogs({
      serviceName,
      message,
      from,
      to: now
    });
  }

  openMainTableOccurrenceInGlobalLogs(item: ErrorGroup, anchor: 'first' | 'last'): void {
    const anchorRaw = anchor === 'first' ? item.firstOccurrence : item.lastOccurrence;
    const anchorMs = this.parseTimestampMs(anchorRaw);
    const serviceName = (item.serviceName || '').trim();
    const windowMs = this.mainTableFocusWindowSeconds * 1000;

    if (anchorMs === null) {
      const now = new Date();
      this.navigateToGlobalLogs({
        serviceName,
        message: '',
        from: new Date(now.getTime() - windowMs),
        to: new Date(now.getTime() + windowMs),
        focusSec: this.mainTableFocusWindowSeconds
      });
      return;
    }

    this.navigateToGlobalLogs({
      serviceName,
      message: '',
      from: new Date(anchorMs - windowMs),
      to: new Date(anchorMs + windowMs),
      focusSec: this.mainTableFocusWindowSeconds
    });
  }

  openInGlobalLogsAround(item: ErrorGroup, anchor: 'first' | 'last'): void {
    if (this.showSimilarErrorsModal()) {
      this.closeSimilarErrorsModal(false);
    }
    const anchorRaw = anchor === 'first' ? item.firstOccurrence : item.lastOccurrence;
    const anchorMs = this.parseTimestampMs(anchorRaw);
    if (anchorMs === null) {
      this.openInGlobalLogs(item);
      return;
    }

    const serviceName = (item.serviceName || this.selectedErrorGroup()?.serviceName || '').trim();
    const message = (item.errorMessage || '').trim();
    const windowMs = this.similarDrilldownWindowSeconds * 1000;
    const from = new Date(anchorMs - windowMs);
    const to = new Date(anchorMs + windowMs);

    this.navigateToGlobalLogs({
      serviceName,
      message,
      from,
      to,
      focusSec: this.similarDrilldownWindowSeconds
    });
  }

  openInGlobalLogsWithPivot(item: ErrorGroup, logKey: string | null, logLevel: string | null): void {
    if (this.showSimilarErrorsModal()) {
      this.closeSimilarErrorsModal(false);
    }
    const serviceName = (item.serviceName || this.selectedErrorGroup()?.serviceName || '').trim();
    const message = (item.errorMessage || '').trim();
    const now = new Date();
    const days = Math.max(this.daysFilterValue || 1, 1);
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    this.navigateToGlobalLogs({
      serviceName,
      message,
      from,
      to: now,
      logKey: (logKey || '').trim() || null,
      logLevel: (logLevel || '').trim() || null
    });
  }

  openSampleLogInGlobalLogs(log: ElasticsearchLogEntry): void {
    if (this.showSampleLogsModal()) {
      this.closeSampleLogsModal();
    }

    const serviceName = (log.serviceName || this.selectedErrorGroup()?.serviceName || '').trim();
    const message = (log.message || '').trim();
    const now = new Date();
    const days = Math.max(this.daysFilterValue || 1, 1);
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    this.navigateToGlobalLogs({
      serviceName,
      message,
      from,
      to: now
    });
  }

  focusSampleLogInGlobalLogs(log: ElasticsearchLogEntry): void {
    if (this.showSampleLogsModal()) {
      this.closeSampleLogsModal();
    }

    const serviceName = (log.serviceName || this.selectedErrorGroup()?.serviceName || '').trim();
    const message = (log.message || '').trim();
    const centerMs = this.parseTimestampMs(log.timestamp);
    const windowMs = this.mainTableFocusWindowSeconds * 1000;
    const centerDate = centerMs === null ? new Date() : new Date(centerMs);

    this.navigateToGlobalLogs({
      serviceName,
      message,
      from: new Date(centerDate.getTime() - windowMs),
      to: new Date(centerDate.getTime() + windowMs),
      focusSec: this.mainTableFocusWindowSeconds
    });
  }

  applyErrorSearchFilter(errorMessage: string, event: Event): void {
    event.preventDefault();
    this.tableSearchFilterValue.set((errorMessage || '').trim());
    this.syncRouteWithFilters();
    this.closeSimilarErrorsModal();
  }

  setSimilarDaysAndReload(days: number): void {
    this.daysFilterValue = Math.max(days, 1);
    this.syncRouteWithFilters();
    const selected = this.selectedErrorGroup();
    if (selected) {
      this.viewSimilarErrors(selected);
    }
  }

  getSimilarErrorShare(count: number): string {
    const total = this.similarErrorsData()?.similarErrors.reduce((sum, item) => sum + item.count, 0) || 0;
    if (total <= 0) {
      return '0.0';
    }
    return ((count / total) * 100).toFixed(1);
  }

  setSimilarityMode(strictPattern: boolean): void {
    if (this.strictSimilarityMode() === strictPattern) {
      return;
    }
    this.strictSimilarityMode.set(strictPattern);
    const selected = this.selectedErrorGroup();
    if (selected) {
      this.viewSimilarErrors(selected);
    }
  }

  setServiceScopeMode(includeAllServices: boolean): void {
    if (this.includeAllServicesMode() === includeAllServices) {
      return;
    }
    this.includeAllServicesMode.set(includeAllServices);
    const selected = this.selectedErrorGroup();
    if (selected) {
      this.viewSimilarErrors(selected);
    }
  }

  getSimilarityQuality(score?: number): 'high' | 'medium' | 'low' {
    const value = Number(score ?? 0);
    if (value >= 7) {
      return 'high';
    }
    if (value >= 3) {
      return 'medium';
    }
    return 'low';
  }

  getSimilarityQualityLabel(score?: number): string {
    const quality = this.getSimilarityQuality(score);
    if (quality === 'high') {
      return 'High';
    }
    if (quality === 'medium') {
      return 'Medium';
    }
    return 'Low';
  }

  formatSimilarityScore(score?: number): string {
    if (!Number.isFinite(score)) {
      return '0.00';
    }
    return Number(score).toFixed(2);
  }

  getNormalizedSimilarityPercent(score?: number): string {
    const items = this.similarErrorsData()?.similarErrors ?? [];
    const topScore = items.reduce((max, current) => {
      const value = Number(current.similarityScore ?? 0);
      return value > max ? value : max;
    }, 0);
    const value = Number(score ?? 0);
    if (!Number.isFinite(value) || !Number.isFinite(topScore) || topScore <= 0) {
      return '0.0';
    }
    return ((value / topScore) * 100).toFixed(1);
  }

  formatElapsedMs(value?: number): string {
    const ms = Number(value ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) {
      return 'n/a';
    }
    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  getSimilarNoResultHint(): string {
    if (this.strictSimilarityMode()) {
      return 'Exact mode is stricter. Try Fuzzy mode or increase the day window.';
    }
    if (!this.includeAllServicesMode()) {
      return 'Currently limited to the same service. Switch scope to All services to correlate broader incidents.';
    }
    if (this.daysFilterValue <= 1) {
      return 'The window may be too narrow. Try 7d or 15d to broaden candidate logs.';
    }
    return 'Try broadening filters or open in Global Logs for deeper manual investigation.';
  }

  hasDistinctNormalizedMessage(item: ErrorGroup): boolean {
    const raw = (item.errorMessage || '').trim().toLowerCase();
    const normalized = (item.normalizedMessage || '').trim().toLowerCase();
    if (!raw || !normalized) {
      return false;
    }
    return raw !== normalized;
  }

  formatDate(value: string): string {
    const timestampMs = this.parseTimestampMs(value);
    if (timestampMs === null) return value;
    return new Date(timestampMs).toLocaleString();
  }

  formatDateRange(): string {
    const data = this.analyticsData();
    if (!data) return '';
    const fromMs = this.parseTimestampMs(data.timeFrom);
    const toMs = this.parseTimestampMs(data.timeTo);
    if (fromMs === null || toMs === null) return '';
    const from = new Date(fromMs);
    const to = new Date(toMs);
    return `${from.toLocaleDateString()} - ${to.toLocaleDateString()}`;
  }

  truncateMessage(message: string, maxLength: number): string {
    if (!message) return 'N/A';
    return message.length <= maxLength ? message : `${message.slice(0, maxLength)}...`;
  }

  getSimilarItemLogLevels(item: ErrorGroup): string[] {
    const levels = (item.sampleLogs || [])
      .map(log => (log.logLevel || '').trim())
      .filter(level => level.length > 0);
    return Array.from(new Set(levels)).slice(0, 4);
  }

  private navigateToGlobalLogs(options: {
    serviceName: string;
    message: string;
    from: Date;
    to: Date;
    focusSec?: number | null;
    logKey?: string | null;
    logLevel?: string | null;
  }): void {
    this.closeSimilarErrorsModal();
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: false,
      queryParamsHandling: 'merge',
      queryParams: {
        globalLogs: '1',
        svc: options.serviceName || null,
        msg: options.message || null,
        from: options.from.toISOString(),
        to: options.to.toISOString(),
        searched: '1',
        key: options.logKey || null,
        levels: options.logLevel || null,
        focusSec: options.focusSec ?? null,
        // Clear stale global-log modal params from previous sessions.
        pod: null,
        preset: null,
        size: null,
        page: null,
        sort: null,
        q: null,
        // Ensure Similar Errors modal is closed when opening Global Logs.
        [this.similarModalParamKey]: null,
        [this.similarModalServiceParamKey]: null,
        [this.similarModalMessageParamKey]: null,
        [this.similarModalStrictParamKey]: null,
        [this.similarModalScopeParamKey]: null
      }
    });
  }

  private applyFiltersFromRoute(): void {
    if (this.applyingRouteState) {
      return;
    }

    const params = this.route.snapshot.queryParamMap;
    const service = (params.get('service') || '').trim();
    const days = this.parsePositiveInt(params.get('days'), 1);
    const minCount = this.parsePositiveInt(params.get('minCount'), 1);
    const search = (params.get('q') || '').trim();
    const similarOpen = params.get(this.similarModalParamKey) === '1';
    const similarService = (params.get(this.similarModalServiceParamKey) || '').trim();
    const similarMessage = (params.get(this.similarModalMessageParamKey) || '').trim();
    const similarStrict = this.parseBooleanParam(params.get(this.similarModalStrictParamKey));
    const similarAllServices = this.parseBooleanParam(params.get(this.similarModalScopeParamKey));
    const sortField = this.parseTableSortField(params.get('tableSort'));
    const sortDirection = this.parseTableSortDirection(params.get('tableDir'));

    const nextDays = Math.min(Math.max(days, 1), 30);
    const nextMinCount = Math.max(minCount, 1);

    this.serviceNameFilterValue = service;
    this.daysFilterValue = nextDays;
    this.minCountFilterValue = nextMinCount;
    this.tableSearchFilterValue.set(search);
    this.tableSortField.set(sortField);
    this.tableSortDirection.set(sortDirection);

    if (!similarOpen) {
      if (this.showSimilarErrorsModal()) {
        this.closeSimilarErrorsModal(false);
      }
      return;
    }

    if (!similarService || !similarMessage) {
      return;
    }

    const isSameSelection =
      this.showSimilarErrorsModal() &&
      (this.selectedErrorGroup()?.serviceName || '').trim() === similarService &&
      (this.selectedErrorGroup()?.errorMessage || '').trim() === similarMessage &&
      this.strictSimilarityMode() === similarStrict &&
      this.includeAllServicesMode() === similarAllServices;

    if (isSameSelection) {
      return;
    }

    this.strictSimilarityMode.set(similarStrict);
    this.includeAllServicesMode.set(similarAllServices);

    const routeGroup = this.findErrorGroupForSimilarRoute(similarService, similarMessage);
    this.selectedErrorGroup.set(routeGroup);
    this.showSimilarErrorsModal.set(true);
    this.loadingSimilar.set(true);
    this.similarErrorsData.set(null);

    this.elasticsearchService.getSimilarErrors(
      similarService,
      similarMessage,
      this.daysFilterValue,
      10,
      this.strictSimilarityMode(),
      this.includeAllServicesMode()
    ).subscribe({
      next: data => {
        this.similarErrorsData.set(data);
        this.loadingSimilar.set(false);
      },
      error: () => {
        this.loadingSimilar.set(false);
      }
    });
  }

  private syncRouteWithFilters(): void {
    if (this.applyingRouteState) {
      return;
    }

    this.applyingRouteState = true;
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        service: this.serviceNameFilterValue.trim() || null,
        days: this.daysFilterValue !== 1 ? this.daysFilterValue : null,
        minCount: this.minCountFilterValue !== 1 ? this.minCountFilterValue : null,
        q: this.tableSearchFilterValue().trim() || null,
        tableSort: this.tableSortField() !== 'lastOccurrence' ? this.tableSortField() : null,
        tableDir: this.tableSortDirection() !== 'desc' ? this.tableSortDirection() : null
      }
    }).finally(() => {
      this.applyingRouteState = false;
    });
  }

  private syncRouteWithSimilarModal(serviceName: string, errorMessage: string): void {
    if (this.applyingRouteState) {
      return;
    }

    this.applyingRouteState = true;
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        [this.similarModalParamKey]: '1',
        [this.similarModalServiceParamKey]: serviceName.trim() || null,
        [this.similarModalMessageParamKey]: errorMessage.trim() || null,
        [this.similarModalStrictParamKey]: this.strictSimilarityMode() ? '1' : null,
        [this.similarModalScopeParamKey]: this.includeAllServicesMode() ? '1' : null
      }
    }).finally(() => {
      this.applyingRouteState = false;
    });
  }

  private clearSimilarModalRouteParams(): void {
    if (this.applyingRouteState) {
      return;
    }

    this.applyingRouteState = true;
    this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        [this.similarModalParamKey]: null,
        [this.similarModalServiceParamKey]: null,
        [this.similarModalMessageParamKey]: null,
        [this.similarModalStrictParamKey]: null,
        [this.similarModalScopeParamKey]: null
      }
    }).finally(() => {
      this.applyingRouteState = false;
    });
  }

  private parsePositiveInt(value: string | null, fallback: number): number {
    const parsed = Number.parseInt(value || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return parsed;
  }

  private parseBooleanParam(value: string | null): boolean {
    const normalized = (value || '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }

  private findErrorGroupForSimilarRoute(serviceName: string, message: string): ErrorGroup {
    const fromData = (this.analyticsData()?.errorGroups || []).find(group =>
      (group.serviceName || '').trim() === serviceName && (group.errorMessage || '').trim() === message
    );

    if (fromData) {
      return fromData;
    }

    const nowIso = new Date().toISOString();
    return {
      errorMessage: message,
      normalizedMessage: message,
      count: 0,
      serviceName,
      logKey: '',
      firstOccurrence: nowIso,
      lastOccurrence: nowIso,
      sampleLogs: []
    };
  }

  private parseTableSortField(value: string | null): ErrorTableSortField {
    switch ((value || '').trim()) {
      case 'count':
      case 'errorMessage':
      case 'normalizedMessage':
      case 'serviceName':
      case 'firstOccurrence':
      case 'lastOccurrence':
        return value as ErrorTableSortField;
      default:
        return 'lastOccurrence';
    }
  }

  private parseTableSortDirection(value: string | null): 'asc' | 'desc' {
    return (value || '').trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
  }

  private compareErrorGroups(a: ErrorGroup, b: ErrorGroup, field: ErrorTableSortField): number {
    switch (field) {
      case 'count':
        return Number(a.count || 0) - Number(b.count || 0);
      case 'errorMessage':
        return (a.errorMessage || '').localeCompare(b.errorMessage || '');
      case 'normalizedMessage':
        return (a.normalizedMessage || '').localeCompare(b.normalizedMessage || '');
      case 'serviceName':
        return (a.serviceName || '').localeCompare(b.serviceName || '');
      case 'firstOccurrence':
        return this.toEpoch(a.firstOccurrence) - this.toEpoch(b.firstOccurrence);
      case 'lastOccurrence':
        return this.toEpoch(a.lastOccurrence) - this.toEpoch(b.lastOccurrence);
      default:
        return 0;
    }
  }

  private toEpoch(value?: string): number {
    return this.parseTimestampMs(value) ?? 0;
  }

  private parseTimestampMs(value?: string | null): number | null {
    const raw = (value ?? '').trim();
    if (!raw) {
      return null;
    }

    if (/^-?\d+(?:\.\d+)?$/.test(raw)) {
      const numeric = Number(raw);
      return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
    }

    const time = Date.parse(raw);
    return Number.isFinite(time) ? time : null;
  }
}
