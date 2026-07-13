import { Component, Input, OnInit, OnDestroy, OnChanges, SimpleChanges, inject, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { KafkaStateService } from '../../../services/kafka-state.service';
import { KafkaService } from '../../../../../core/services/api/kafka.service';
import { AuthService } from '../../../../../core/services/auth.service';
import { ViewportScaleService } from '../../../../../core/services/viewport-scale.service';
import {
  MessageSearchRequest,
  MessageSearchResponse,
  KafkaMessage,
  TimeRange,
  TopicInfo,
  RequeueRequest,
  SearchProgress,
  KafkaConfig,
} from '../../../../../core/models/kafka.models';
import { BulkRequeueProgressComponent, BulkRequeueItem } from '../../bulk-requeue-progress/bulk-requeue-progress.component';

@Component({
  selector: 'app-messages-tab',
  standalone: true,
  imports: [CommonModule, FormsModule, BulkRequeueProgressComponent],
  template: `
    <div class="messages-tab">
      <div class="search-form">
        <div
          class="filter-toggle-header"
          (click)="isFilterExpanded.set(!isFilterExpanded())"
          [title]="isFilterExpanded() ? 'Click to minimize filters' : 'Click to expand filters'"
          >
          <div class="btn-toggle-filter">
            <i class="fas" [class.fa-minus]="isFilterExpanded()" [class.fa-plus]="!isFilterExpanded()"></i>
          </div>
    
          <h3>
            <i class="fas fa-filter"></i>
            Search Filters
          </h3>
    
          <!-- Quick Key Search in header row - right half -->
          <div class="quick-search-inline" (click)="$event.stopPropagation()">
            <div class="search-input-group">
              <i class="fas fa-key"></i>
              <input
                type="text"
                class="quick-search-input"
                [(ngModel)]="quickKeySearch"
                [disabled]="isStreamingSearch()"
                placeholder="Search in keys and values..."
                (keyup.enter)="startQuickKeySearch()"
                />
                @if (quickKeySearch()) {
                  <button
                    class="btn-clear-quick-search"
                    (click)="quickKeySearch.set('')"
                    [disabled]="isStreamingSearch()"
                    title="Clear key/value search text"
                    aria-label="Clear key and value search text"
                    >
                    <i class="fas fa-times"></i>
                  </button>
                }
              </div>
    
              @if (!isStreamingSearch()) {
                <button
                  class="btn-quick-search"
                  (click)="startQuickKeySearch()"
                  title="Search keys and values"
                  aria-label="Search keys and values"
                  [disabled]="!quickKeySearch() || quickKeySearch().trim() === ''"
                  >
                  <i class="fas fa-search"></i>
                  Search Keys/Values
                </button>
              } @else {
                <button class="btn-cancel-search" (click)="cancelStreamingSearch()">
                  <i class="fas fa-stop"></i>
                  Cancel
                </button>
              }
            </div>
          </div>
    
          @if (isFilterExpanded()) {
            <div class="form-row">
              <div class="form-group">
                <label for="pageSize">Messages per Load</label>
                <select
                  id="pageSize"
                  [(ngModel)]="pageSize"
                  [disabled]="isLoading()"
                  class="page-size-select"
                  >
                  <option [value]="100">100 messages</option>
                  <option [value]="500">500 messages</option>
                  <option [value]="1000">1000 messages</option>
                  <option [value]="5000">5000 messages</option>
                </select>
              </div>
            </div>

            <div class="advanced-filters-toggle-row">
              <button
                type="button"
                class="btn-advanced-filters-toggle"
                [disabled]="isLoading()"
                (click)="isAdvancedFiltersExpanded.set(!isAdvancedFiltersExpanded())"
              >
                <i class="fas" [class.fa-chevron-down]="!isAdvancedFiltersExpanded()" [class.fa-chevron-up]="isAdvancedFiltersExpanded()"></i>
                {{ isAdvancedFiltersExpanded() ? 'Hide advanced filters' : 'Show advanced filters' }}
              </button>
            </div>

            @if (isAdvancedFiltersExpanded()) {
              <div class="form-row">
              <div class="form-group">
                <label for="partition">Partition (Optional)</label>
                <input
                  type="number"
                  id="partition"
                  [(ngModel)]="searchRequest.partition"
                  [disabled]="isLoading()"
                  min="0"
                  />
                </div>
    
                <div class="form-group">
                  <label for="key">Key Filter (Optional)</label>
                  <input
                    type="text"
                    id="key"
                    [(ngModel)]="searchRequest.key"
                    [disabled]="isLoading()"
                    placeholder="Search by message key..."
                    />
                  </div>
    
                  <div class="form-group">
                    <label for="value">Value Filter (Optional)</label>
                    <input
                      type="text"
                      id="value"
                      [(ngModel)]="searchRequest.value"
                      [disabled]="isLoading()"
                      placeholder="Search in message value..."
                      />
                    </div>
                  </div>
                }
    
                  <div class="form-row time-range-row">
                    <div class="form-group">
                      <label for="startTime">Start Time</label>
                      <input
                        type="datetime-local"
                        id="startTime"
                        [ngModel]="startTimeLocal()"
                        (ngModelChange)="onStartTimeChangeValue($event)"
                        [disabled]="isLoading()"
                        [min]="startTimeMinLocal()"
                        [max]="startTimeMaxLocal()"
                        />
                      </div>
                      <div class="form-group">
                        <label for="endTime">End Time</label>
                        <input
                          type="datetime-local"
                          id="endTime"
                          [ngModel]="endTimeLocal()"
                          (ngModelChange)="onEndTimeChangeValue($event)"
                          [disabled]="isLoading()"
                          [min]="endTimeMinLocal()"
                          [max]="endTimeMaxLocal()"
                          />
                        </div>
                      </div>
                      <div class="info-and-presets-row">
                        <div class="time-presets">
                          <button
                            type="button"
                            class="btn-time-preset"
                            [class.active]="selectedPreset() === '1h'"
                            (click)="setTimePreset(1, '1h')"
                            title="Last 1 hour"
                            [disabled]="isLoading()"
                            >
                            1h
                          </button>
                          <button
                            type="button"
                            class="btn-time-preset"
                            [class.active]="selectedPreset() === '3h'"
                            (click)="setTimePreset(3, '3h')"
                            title="Last 3 hours"
                            [disabled]="isLoading()"
                            >
                            3h
                          </button>
                          <button
                            type="button"
                            class="btn-time-preset"
                            [class.active]="selectedPreset() === '24h'"
                            (click)="setTimePreset(24, '24h')"
                            title="Last 24 hours"
                            [disabled]="isLoading()"
                            >
                            24h
                          </button>
                          <button
                            type="button"
                            class="btn-time-preset"
                            [class.active]="selectedPreset() === '7d'"
                            (click)="setTimePreset7Days()"
                            title="Last 7 days (max range)"
                            [disabled]="isLoading()"
                            >
                            7d
                          </button>
                        </div>
                        <div class="info-message">
                          <i class="fas fa-info-circle"></i>
                          <span>
                            If duration exceeds the maximum range ({{ kafkaConfig()?.maxRangeDays ?? 7 }} day(s)), the time range will be auto-adjusted.
                          </span>
                          @if (durationInfo()) {
                            <span class="duration-badge" [class.duration-warning]="durationInfo()!.exceedsMax">
                              Duration: {{ durationInfo()!.formatted }}
                            </span>
                          }
                        </div>
                      </div>
                      @if (timeRangeError()) {
                        <div class="error-message-row">
                          <div class="error-message">{{ timeRangeError() }}</div>
                        </div>
                      }
    
                      <div class="form-actions">
                        <button class="btn-search" (click)="searchMessages()" [disabled]="isLoading() || !canSearch()">
                          <i class="fas fa-search"></i>
                          Search Topic Messages
                        </button>
                        <button class="btn-clear" (click)="clearSearch()" [disabled]="isLoading()">
                          Clear Topic Filters
                        </button>
                      </div>
                    }
                  </div>
    
                  @if (isLoading() || searchResults() || isStreamingSearch()) {
                    <div class="results-section">
                      <div class="results-header">
                        <div class="results-info">
                          <span class="results-count">
                            Loaded {{ allLoadedMessages().length }}
                            @if (exactTotalCount() !== null) {
                              of <strong>{{ exactTotalCount() }}</strong> total
                            } @else if (isCountLoading()) {
                              <span class="count-loading">
                                <i class="fas fa-spinner fa-spin"></i> counting...
                              </span>
                            }
                            message(s)
                          </span>
    
                          @if (clientSearchQuery()) {
                            <span class="filtered-count"> - Filtered to {{ filteredMessages().length }}</span>
                          }
    
                          @if (searchResults()?.hasMore) {
                            <button
                              class="btn-load-more-inline"
                              (click)="loadMoreMessages()"
                              [disabled]="isLoadingMore()"
                              >
                              @if (isLoadingMore()) {
                                <i class="fas fa-spinner fa-spin"></i>
                                Loading...
                              } @else {
                                <i class="fas fa-arrow-down"></i>
                                Load More
                              }
                            </button>
                          }
                        </div>
    
                        <!-- Streaming Search Progress Display -->
                        @if (isStreamingSearch() || streamingProgress()) {
                          <div class="streaming-progress-inline"
                            [class.finding-results]="(streamingProgress()?.totalMessagesFound || 0) > 0"
                            [class.complete-no-results]="streamingProgress()?.status === 'complete' && allLoadedMessages().length === 0">
                            <div class="progress-stat">
                              <i class="fas fa-layer-group"></i>
                              <span class="stat-label">Polling:</span>
                              <span class="stat-value">[{{ getScannedPartitions() }}]</span>
                            </div>
    
                            <div class="progress-stat">
                              <i class="fas fa-clock"></i>
                              <span class="stat-value">{{ elapsedTime() }}</span>
                            </div>
    
                            <div class="progress-stat">
                              <i class="fas fa-arrow-down"></i>
                              <span class="stat-value">{{ formatBytes(streamingProgress()?.totalBytes || 0) }}</span>
                            </div>
    
                            <div class="progress-stat">
                              <i class="fas fa-file"></i>
                              <span class="stat-value">{{ streamingProgress()?.totalMessagesFound || 0 }} consumed</span>
                            </div>
                          </div>
                        }
    
                        <div class="header-controls">
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
                              placeholder="Filter displayed messages..."
                              [(ngModel)]="clientSearchQuery"
                              class="client-search-input"
                              />
                              @if (clientSearchQuery()) {
                                <button class="btn-clear-search" (click)="clientSearchQuery.set('')" title="Clear filter">
                                  <i class="fas fa-times"></i>
                                </button>
                              }
                            </div>
                          </div>
                        </div>
    
                        <!-- Selection Toolbar -->
                        @if (isAdmin() && !isLoading() && selectedMessages().size > 0) {
                          <div class="selection-toolbar">
                            <span class="selection-count">
                              <i class="fas fa-check-square"></i>
                              {{ selectedMessages().size }} message(s) selected
                            </span>
                            <div class="toolbar-actions">
                              <button class="btn-clear-selection" (click)="clearSelection()">
                                <i class="fas fa-times"></i>
                                Clear Selection
                              </button>
                              @if (isAdmin()) {
                                <button class="btn-bulk-requeue" (click)="startBulkRequeue()">
                                  <i class="fas fa-redo"></i>
                                  Requeue Selected
                                </button>
                              }
                            </div>
                          </div>
                        }
    
                        <div class="table-and-preview-container">
                          <div class="messages-table" #messagesTableContainer>
                            <div class="table-header">
                              <table>
                                <thead>
                                  <tr>
                                    @if (isAdmin()) {
                                      <th class="checkbox-col">
                                        <input
                                          type="checkbox"
                                          [checked]="isAllSelected()"
                                          [indeterminate]="isSomeSelected()"
                                          [disabled]="isLoading()"
                                          (change)="toggleSelectAll()"
                                          title="Select all"
                                          aria-label="Select all messages in current results"
                                          />
                                        </th>
                                    }
                                      <th>Partition</th>
                                      <th>Offset</th>
                                      <th>Timestamp</th>
                                      <th>Key</th>
                                      <th>Value Preview</th>
                                    </tr>
                                  </thead>
                                </table>
                              </div>
                              <div class="table-body-container">
                                <table>
                                  <tbody>
                                    @if (isLoading()) {
                                      @for (row of skeletonRows; track row) {
                                        <tr class="skeleton-row">
                                          @if (isAdmin()) {
                                            <td class="checkbox-col">
                                              <span class="table-skeleton skeleton-checkbox"></span>
                                            </td>
                                          }
                                          <td class="partition-col">
                                            <span class="table-skeleton skeleton-text-sm"></span>
                                          </td>
                                          <td class="offset-col">
                                            <span class="table-skeleton skeleton-text-sm"></span>
                                          </td>
                                          <td class="timestamp-col">
                                            <span class="table-skeleton skeleton-text-md"></span>
                                          </td>
                                          <td class="key-col">
                                            <span class="table-skeleton skeleton-chip"></span>
                                          </td>
                                          <td class="value-col">
                                            <span class="table-skeleton skeleton-text-lg"></span>
                                          </td>
                                        </tr>
                                      }
                                    } @else if (sortedMessages().length > 0) {
                                      @for (message of sortedMessages(); track message.partition + '-' + message.offset + '-' + message.timestamp) {
                                        <tr
                                          [class.row-selected]="isRowSelected(message)"
                                          [class.row-preview-active]="isMessageSelected(message)"
                                          class="clickable-row"
                                          (click)="togglePreview(message)"
                                          >
                                          @if (isAdmin()) {
                                            <td class="checkbox-col" (click)="$event.stopPropagation()">
                                              <input
                                                type="checkbox"
                                                [checked]="isRowSelected(message)"
                                                (change)="toggleMessageSelection(message)"
                                                (click)="$event.stopPropagation()"
                                                [attr.aria-label]="'Select message partition ' + message.partition + ', offset ' + message.offset"
                                                />
                                            </td>
                                          }
                                            <td class="partition-col">{{ message.partition }}</td>
                                            <td class="offset-col">{{ message.offset }}</td>
                                            <td class="timestamp-col">{{ formatTimestamp(message.timestamp) }}</td>
                                            <td class="key-col">
                                              @if (message.key) {
                                                <code>{{ message.key }}</code>
                                              } @else {
                                                <span class="empty">-</span>
                                              }
                                            </td>
                                            <td class="value-col">
                                              <code class="value-preview">{{ getValuePreview(message.value) }}</code>
                                            </td>
                                          </tr>
                                        }
                                      } @else if (!isStreamingSearch()) {
                                        <tr>
                                          <td [attr.colspan]="isAdmin() ? 6 : 5" class="no-results-row">
                                            <div class="no-filter-results">
                                              <i class="fas fa-filter"></i>
                                              <p>No messages match your filter</p>
                                              <span class="hint-text">Try broadening the time range or clearing topic filters.</span>
                                              <div class="empty-state-actions">
                                                <button class="btn-clear" (click)="clearSearch()">Clear Topic Filters</button>
                                                <button class="btn-time-preset" (click)="setTimePreset(1, '1h')">Last 1h</button>
                                                <button class="btn-time-preset" (click)="setTimePreset(24, '24h')">Last 24h</button>
                                              </div>
                                            </div>
                                          </td>
                                        </tr>
                                      }
                                    </tbody>
                                  </table>
                                </div>
                              </div>
    
                              @if (previewMessage()) {
                                <!-- Backdrop for maximized state -->
                                @if (isPreviewMaximized()) {
                                  <div class="preview-backdrop" (click)="togglePreviewMaximized()"></div>
                                }
    
                                <div
                                  class="message-preview-sidebar"
                                  [class.maximized]="isPreviewMaximized()"
                                  [ngStyle]="isPreviewMaximized() ? previewModalStyle() : null"
                                  (click)="$event.stopPropagation()"
                                  >
                                  <!-- Header -->
                                  <div class="preview-header">
                                    <span class="preview-title">Message Preview</span>
                                    <div class="preview-header-actions">
                                      <button
                                        class="btn-copy-link-preview"
                                        (click)="copyMessageLink()"
                                        [title]="linkCopied() ? 'Link Copied!' : 'Copy Link'"
                                        >
                                        @if (linkCopied()) {
                                          <i class="fas fa-check"></i>
                                        } @else {
                                          <i class="fas fa-link"></i>
                                        }
                                      </button>
                                      <button
                                        class="btn-open-new-tab"
                                        (click)="openMessageInNewTab()"
                                        title="Open in New Tab"
                                        >
                                        <i class="fas fa-external-link-alt"></i>
                                      </button>
                                      <button
                                        class="btn-maximize-preview"
                                        (click)="togglePreviewMaximized()"
                                        [title]="isPreviewMaximized() ? 'Restore' : 'Maximize'"
                                        >
                                        <i class="fas" [class.fa-compress]="isPreviewMaximized()" [class.fa-expand]="!isPreviewMaximized()"></i>
                                      </button>
                                      <button class="btn-close-preview" (click)="closePreview($event)">
                                        <i class="fas fa-times"></i>
                                      </button>
                                    </div>
                                  </div>
    
                                  <!-- Tabs -->
                                  <div class="preview-tabs">
                                    <button
                                      class="preview-tab"
                                      [class.active]="previewTab() === 'metadata'"
                                      (click)="setPreviewTab('metadata')"
                                      >
                                      <i class="fas fa-info-circle"></i> Metadata
                                    </button>
    
                                    <!-- Dynamic tabs for special keys (payload, body, etc.) -->
                                    @for (dynamicTab of availableDynamicTabs(); track dynamicTab.key) {
                                      <button
                                        class="preview-tab"
                                        [class.active]="previewTab() === 'dynamic' && activeDynamicTabKey() === dynamicTab.key"
                                        (click)="setDynamicTab(dynamicTab.key)"
                                        >
                                        <i class="fas fa-database"></i> {{ dynamicTab.displayName }}
                                      </button>
                                    }
    
                                    <button
                                      class="preview-tab"
                                      [class.active]="previewTab() === 'message'"
                                      (click)="setPreviewTab('message')"
                                      >
                                      <i class="fas fa-envelope"></i> Message
                                    </button>
                                    <button
                                      class="preview-tab"
                                      [class.active]="previewTab() === 'raw'"
                                      (click)="setPreviewTab('raw')"
                                      >
                                      <i class="fas fa-file-alt"></i> Raw
                                    </button>
                                  </div>
    
                                  <!-- Search Bar (only for value tabs) -->
                                  @if (previewTab() !== 'metadata') {
                                    <div class="preview-search">
                                      <i class="fas fa-search"></i>
                                      <input
                                        type="text"
                                        placeholder="Search in value..."
                                        [(ngModel)]="previewSearch"
                                        />
                                        @if (previewSearch()) {
                                          <button class="btn-clear-search" (click)="clearPreviewSearch()">
                                            <i class="fas fa-times"></i>
                                          </button>
                                        }
                                      </div>
                                    }
    
                                    <!-- Content Area -->
                                    <div class="preview-content">
                                        <!-- Metadata Tab -->
                                        @if (previewTab() === 'metadata') {
                                          <div class="metadata-view">
                                            <div class="metadata-section">
                                              <div class="metadata-title">
                                                <i class="fas fa-info-circle"></i>
                                                Message Details
                                              </div>
                                              <div class="metadata-grid">
                                                <div class="metadata-item">
                                                  <span class="metadata-label">Partition:</span>
                                                  <span class="metadata-value">{{ previewMessage()!.partition }}</span>
                                                  <button
                                                    class="btn-copy-metadata"
                                                    (click)="copyField(previewMessage()!.partition, 'partition', $event)"
                                                    [title]="copiedField() === 'partition' ? 'Copied!' : 'Copy'"
                                                    >
                                                    @if (copiedField() === 'partition') {
                                                      <i class="fas fa-check"></i>
                                                    } @else {
                                                      <i class="far fa-copy"></i>
                                                    }
                                                  </button>
                                                </div>
                                                <div class="metadata-item">
                                                  <span class="metadata-label">Offset:</span>
                                                  <span class="metadata-value">{{ previewMessage()!.offset }}</span>
                                                  <button
                                                    class="btn-copy-metadata"
                                                    (click)="copyField(previewMessage()!.offset, 'offset', $event)"
                                                    [title]="copiedField() === 'offset' ? 'Copied!' : 'Copy'"
                                                    >
                                                    @if (copiedField() === 'offset') {
                                                      <i class="fas fa-check"></i>
                                                    } @else {
                                                      <i class="far fa-copy"></i>
                                                    }
                                                  </button>
                                                </div>
                                                <div class="metadata-item">
                                                  <span class="metadata-label">Timestamp:</span>
                                                  <span class="metadata-value">{{ formatTimestamp(previewMessage()!.timestamp) }}</span>
                                                  <button
                                                    class="btn-copy-metadata"
                                                    (click)="copyField(previewMessage()!.timestamp, 'timestamp', $event)"
                                                    [title]="copiedField() === 'timestamp' ? 'Copied!' : 'Copy'"
                                                    >
                                                    @if (copiedField() === 'timestamp') {
                                                      <i class="fas fa-check"></i>
                                                    } @else {
                                                      <i class="far fa-copy"></i>
                                                    }
                                                  </button>
                                                </div>
                                                <div class="metadata-item">
                                                  <span class="metadata-label">Timestamp Type:</span>
                                                  <span class="metadata-value">{{ previewMessage()!.timestampType }}</span>
                                                  <button
                                                    class="btn-copy-metadata"
                                                    (click)="copyField(previewMessage()!.timestampType, 'timestampType', $event)"
                                                    [title]="copiedField() === 'timestampType' ? 'Copied!' : 'Copy'"
                                                    >
                                                    @if (copiedField() === 'timestampType') {
                                                      <i class="fas fa-check"></i>
                                                    } @else {
                                                      <i class="far fa-copy"></i>
                                                    }
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                            <!-- Key Section -->
                                            <div class="metadata-section">
                                              <div class="metadata-title">
                                                <i class="fas fa-key"></i>
                                                Message Key
                                              </div>
                                              @if (previewMessage()!.key) {
                                                <div class="metadata-key-value">
                                                  <code>{{ previewMessage()!.key }}</code>
                                                  <button
                                                    class="btn-copy-metadata"
                                                    (click)="copyField(previewMessage()!.key, 'key', $event)"
                                                    [title]="copiedField() === 'key' ? 'Copied!' : 'Copy'"
                                                    >
                                                    @if (copiedField() === 'key') {
                                                      <i class="fas fa-check"></i>
                                                    } @else {
                                                      <i class="far fa-copy"></i>
                                                    }
                                                  </button>
                                                </div>
                                              } @else {
                                                <div class="metadata-empty">No key</div>
                                              }
                                            </div>
                                            <!-- Headers Section -->
                                            <div class="metadata-section">
                                              <div class="metadata-title">
                                                <i class="fas fa-tags"></i>
                                                Headers
                                                @if (previewMessage()!.headers && getHeaders(previewMessage()!.headers).length > 0) {
                                                  <span class="header-count">({{ getHeaders(previewMessage()!.headers).length }})</span>
                                                }
                                              </div>
                                              @if (previewMessage()!.headers && getHeaders(previewMessage()!.headers).length > 0) {
                                                <div class="headers-list">
                                                  @for (header of getHeaders(previewMessage()!.headers); track header.key + '-' + $index) {
                                                    <div class="header-item">
                                                      <span class="header-key">{{ header.key }}:</span>
                                                      <span class="header-value">{{ header.value }}</span>
                                                      <button
                                                        class="btn-copy-metadata"
                                                        (click)="copyField(header.value, 'header-' + header.key, $event)"
                                                        [title]="copiedField() === 'header-' + header.key ? 'Copied!' : 'Copy'"
                                                        >
                                                        @if (copiedField() === 'header-' + header.key) {
                                                          <i class="fas fa-check"></i>
                                                        } @else {
                                                          <i class="far fa-copy"></i>
                                                        }
                                                      </button>
                                                    </div>
                                                  }
                                                </div>
                                              } @else {
                                                <div class="metadata-empty">No headers</div>
                                              }
                                            </div>
                                          </div>
                                        }
                                        <!-- Dynamic Tab Content (for special keys like payload, body, data, etc.) -->
                                        @if (previewTab() === 'dynamic' && activeDynamicTabKey()) {
                                          <div class="payload-view">
                                            @if (isValidJson(previewMessage()!.value)) {
                                              @let parsed = parseJson(previewMessage()!.value);
                                              @let dynamicValue = getDynamicKeyValue(parsed, activeDynamicTabKey()!);
                                              @if (dynamicValue !== null) {
                                                @let parsedDynamic = parsePayloadValue(dynamicValue);
                                                @if (parsedDynamic !== null) {
                                                  <!-- Dynamic key is valid JSON - show with toggle -->
                                                  <div class="formatted-view">
                                                    <div class="formatted-header">
                                                      <div class="view-toggle">
                                                        <button
                                                          class="toggle-btn"
                                                          [class.active]="payloadViewMode() === 'tree'"
                                                          (click)="setPayloadViewMode('tree')"
                                                          >
                                                          <i class="fas fa-sitemap"></i> Tree
                                                        </button>
                                                        <button
                                                          class="toggle-btn"
                                                          [class.active]="payloadViewMode() === 'json'"
                                                          (click)="setPayloadViewMode('json')"
                                                          >
                                                          <i class="fas fa-code"></i> JSON
                                                        </button>
                                                      </div>
                                                      <button
                                                        class="btn-copy-all"
                                                        (click)="copyFormattedJson(parsedDynamic, $event)"
                                                        [title]="isCopied() ? 'Copied!' : 'Copy all'"
                                                        >
                                                        @if (isCopied()) {
                                                          <i class="fas fa-check"></i> Copied
                                                        } @else {
                                                          <i class="far fa-copy"></i> Copy All
                                                        }
                                                      </button>
                                                    </div>
                                                    @if (payloadViewMode() === 'tree') {
                                                      <div class="tree-view-in-formatted">
                                                        <div class="tree-nodes">
                                                          @let dynamicPath = capitalizeFirstLetter(activeDynamicTabKey()!);
                                                          @for (item of renderTreeNode(parsedDynamic, dynamicPath, 0, previewSearch()); track item.path) {
                                                            <div class="tree-node" [style.padding-left]="(item.depth * 1.5 + 1) + 'rem'">
                                                              <div class="tree-node-header">
                                                                @if (item.hasChildren) {
                                                                  <button
                                                                    class="tree-toggle"
                                                                    (click)="toggleNode(item.path)"
                                                                    >
                                                                    <i
                                                                      class="fas"
                                                                      [class.fa-chevron-right]="!isNodeExpanded(item.path)"
                                                                      [class.fa-chevron-down]="isNodeExpanded(item.path)"
                                                                    ></i>
                                                                  </button>
                                                                } @else {
                                                                  <span class="tree-toggle-spacer"></span>
                                                                }
                                                                <span class="tree-key">{{ item.key }}:</span>
                                                                <span class="tree-type-badge" [attr.data-type]="item.type">
                                                                  {{ item.type }}
                                                                </span>
                                                                @if (item.hasChildren) {
                                                                  <span class="tree-value-summary">{{ item.display }}</span>
                                                                } @else {
                                                                  <span class="tree-value">{{ item.display }}</span>
                                                                }
                                                                <button
                                                                  class="btn-copy-field"
                                                                  (click)="copyField(item.value, item.path, $event)"
                                                                  [title]="copiedField() === item.path ? 'Copied!' : 'Copy value'"
                                                                  >
                                                                  @if (copiedField() === item.path) {
                                                                    <i class="fas fa-check"></i>
                                                                  } @else {
                                                                    <i class="far fa-copy"></i>
                                                                  }
                                                                </button>
                                                              </div>
                                                            </div>
                                                          }
                                                        </div>
                                                      </div>
                                                    } @else {
                                                      <pre class="json-preview">{{ formatJsonObject(parsedDynamic) }}</pre>
                                                    }
                                                  </div>
                                                } @else {
                                                  <!-- Dynamic key is not valid JSON - show raw view -->
                                                  <div class="payload-raw-view">
                                                    <div class="payload-header">
                                                      <span class="payload-label">{{ capitalizeFirstLetter(activeDynamicTabKey()!) }} (Raw):</span>
                                                      <button
                                                        class="btn-copy-all"
                                                        (click)="copyMessageValue(dynamicValue.toString(), $event)"
                                                        [title]="isCopied() ? 'Copied!' : 'Copy'"
                                                        >
                                                        @if (isCopied()) {
                                                          <i class="fas fa-check"></i> Copied
                                                        } @else {
                                                          <i class="far fa-copy"></i> Copy
                                                        }
                                                      </button>
                                                    </div>
                                                    <pre class="payload-raw-content">{{ dynamicValue }}</pre>
                                                  </div>
                                                }
                                              } @else {
                                                <div class="no-tree-data">
                                                  <i class="fas fa-info-circle"></i>
                                                  <p>No {{ capitalizeFirstLetter(activeDynamicTabKey()!) }} found in message</p>
                                                </div>
                                              }
                                            } @else {
                                              <div class="tree-view-error">
                                                <i class="fas fa-exclamation-triangle"></i>
                                                <p>Cannot parse as JSON</p>
                                                <span class="hint-text">This message is not valid JSON. Try "Raw" tab.</span>
                                              </div>
                                            }
                                          </div>
                                        }
                                        <!-- Message Tab -->
                                        @if (previewTab() === 'message') {
                                          <div class="formatted-view">
                                            @if (isValidJson(previewMessage()!.value)) {
                                              <div class="formatted-header">
                                                <div class="view-toggle">
                                                  <button
                                                    class="toggle-btn"
                                                    [class.active]="messageViewMode() === 'tree'"
                                                    (click)="setMessageViewMode('tree')"
                                                    >
                                                    <i class="fas fa-sitemap"></i> Tree
                                                  </button>
                                                  <button
                                                    class="toggle-btn"
                                                    [class.active]="messageViewMode() === 'json'"
                                                    (click)="setMessageViewMode('json')"
                                                    >
                                                    <i class="fas fa-code"></i> JSON
                                                  </button>
                                                </div>
                                                <button
                                                  class="btn-copy-all"
                                                  (click)="copyFormattedMessageValue($event)"
                                                  [title]="isCopied() ? 'Copied!' : 'Copy all'"
                                                  >
                                                  @if (isCopied()) {
                                                    <i class="fas fa-check"></i> Copied
                                                  } @else {
                                                    <i class="far fa-copy"></i> Copy All
                                                  }
                                                </button>
                                              </div>
                                              @if (messageViewMode() === 'tree') {
                                                <div class="tree-view-in-formatted">
                                                  @let treeData = parseMessageToTree(previewMessage()!.value);
                                                  @if (treeData && getTreeEntries(treeData).length > 0) {
                                                    <div class="tree-nodes">
                                                      @for (item of renderTreeNode(treeData, 'root', 0, previewSearch()); track item.path) {
                                                        <div class="tree-node" [style.padding-left]="(item.depth * 1.5 + 1) + 'rem'">
                                                          <div class="tree-node-header">
                                                            @if (item.hasChildren) {
                                                              <button
                                                                class="tree-toggle"
                                                                (click)="toggleNode(item.path)"
                                                                >
                                                                <i
                                                                  class="fas"
                                                                  [class.fa-chevron-right]="!isNodeExpanded(item.path)"
                                                                  [class.fa-chevron-down]="isNodeExpanded(item.path)"
                                                                ></i>
                                                              </button>
                                                            } @else {
                                                              <span class="tree-toggle-spacer"></span>
                                                            }
                                                            <span class="tree-key">{{ item.key }}:</span>
                                                            <span class="tree-type-badge" [attr.data-type]="item.type">
                                                              {{ item.type }}
                                                            </span>
                                                            @if (item.hasChildren) {
                                                              <span class="tree-value-summary">{{ item.display }}</span>
                                                            } @else {
                                                              <span class="tree-value">{{ item.display }}</span>
                                                            }
                                                            <button
                                                              class="btn-copy-field"
                                                              (click)="copyField(item.value, item.path, $event)"
                                                              [title]="copiedField() === item.path ? 'Copied!' : 'Copy value'"
                                                              >
                                                              @if (copiedField() === item.path) {
                                                                <i class="fas fa-check"></i>
                                                              } @else {
                                                                <i class="far fa-copy"></i>
                                                              }
                                                            </button>
                                                          </div>
                                                        </div>
                                                      }
                                                    </div>
                                                  } @else {
                                                    <div class="no-tree-data">
                                                      <i class="fas fa-info-circle"></i>
                                                      <p>No structured data to display</p>
                                                    </div>
                                                  }
                                                </div>
                                              } @else {
                                                <pre class="json-preview">{{ formatJson(previewMessage()!.value) }}</pre>
                                              }
                                            } @else {
                                              <div class="formatted-error">
                                                <i class="fas fa-exclamation-triangle"></i>
                                                <p>Cannot format as JSON</p>
                                                <span class="hint-text">This message is not valid JSON. Try "Raw" tab.</span>
                                              </div>
                                            }
                                          </div>
                                        }
                                        <!-- Raw Tab -->
                                        @if (previewTab() === 'raw') {
                                          <div class="raw-view">
                                            <div class="copy-all-wrapper">
                                              <button
                                                class="btn-copy-all"
                                                (click)="copyMessageValue(previewMessage()!.value, $event)"
                                                [title]="isCopied() ? 'Copied!' : 'Copy all'"
                                                >
                                                @if (isCopied()) {
                                                  <i class="fas fa-check"></i> Copied
                                                } @else {
                                                  <i class="far fa-copy"></i> Copy All
                                                }
                                              </button>
                                            </div>
                                            <pre class="text-preview">{{ previewMessage()!.value }}</pre>
                                          </div>
                                        }
                                    </div>
                                  </div>
                                }
                              </div>
                            </div>
                          } @else if (hasSearched()) {
                            <div class="no-results">
                              <i class="fas fa-inbox"></i>
                              <p>No messages found in the selected time range</p>
                              <span class="hint-text">Try adjusting your search filters or expanding the time range</span>
                            </div>
                          }
                        </div>
    
                        @if (showRequeueProgress()) {
                          <app-bulk-requeue-progress
                            [items]="bulkRequeueItems()"
                            (close)="closeBulkRequeueProgress()"
                            (retry)="retryFailedMessage($event)"
                            />
                          }
    `,
  styles: [
    `
      .messages-tab {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      /* Quick Key Search Styles - Inline in header */
      .quick-search-inline {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        min-width: 0;
        justify-self: end;
      }

      .search-input-group {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        background: var(--theme-bg-app);
        border-radius: 4px;
        padding: 0.375rem 0.5rem;
        gap: 0.375rem;
        border: 1px solid #d1d5db;
        transition: border-color 0.2s, box-shadow 0.2s;
        min-width: 0;
        max-width: 100%;
      }

      .search-input-group:focus-within {
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.12);
      }

      .search-input-group i {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-table-header);
        flex-shrink: 0;
      }

      .quick-search-input {
        flex: 1;
        border: none;
        outline: none;
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-dark);
        background: transparent;
        min-width: 0;
      }

      .quick-search-input::placeholder {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-table-header);
      }

      .btn-clear-quick-search {
        background: none;
        border: none;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 0.25rem;
        display: flex;
        align-items: center;
        transition: color 0.2s;
      }

      .btn-clear-quick-search:hover:not(:disabled) {
        color: #ef4444;
      }

      .btn-clear-quick-search:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }

      .btn-quick-search,
      .btn-cancel-search {
        padding: 0.375rem 0.75rem;
        border: none;
        border-radius: 4px;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-table-header);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        transition: all 0.2s ease;
        white-space: nowrap;
        flex-shrink: 0;
      }

      .btn-quick-search {
        background: var(--theme-button-primary);
        color: white;
      }

      .btn-quick-search:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }

      .btn-quick-search:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-cancel-search {
        background: #ef4444;
        color: white;
      }

      .btn-cancel-search:hover {
        background: #dc2626;
      }

      /* Inline Progress Display (above results table) */
      .streaming-progress-inline {
        display: flex;
        align-items: center;
        gap: 1rem;
        background: var(--theme-bg-app);
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        margin: 0.5rem 0;
        border: 1px solid var(--theme-border-gray);
        font-size: var(--theme-font-table-header);
        flex-wrap: nowrap;
      }

      .streaming-progress-inline.finding-results {
        background: #dcfce7;
        border: 1px solid #bbf7d0;
      }

      .streaming-progress-inline.finding-results .progress-stat i {
        color: #16a34a;
      }

      .streaming-progress-inline.finding-results .progress-stat .stat-label,
      .streaming-progress-inline.finding-results .progress-stat .stat-value {
        color: #15803d;
      }

      .streaming-progress-inline.complete-success {
        background: #dcfce7;
        border: 1px solid #bbf7d0;
      }

      .streaming-progress-inline.complete-success .progress-stat i {
        color: #16a34a;
      }

      .streaming-progress-inline.complete-success .progress-stat .stat-label,
      .streaming-progress-inline.complete-success .progress-stat .stat-value {
        color: #15803d;
      }

      .streaming-progress-inline.complete-no-results {
        background: #fee2e2;
        border: 1px solid #fecaca;
      }

      .streaming-progress-inline.complete-no-results .progress-stat i {
        color: #dc2626;
      }

      .streaming-progress-inline.complete-no-results .progress-stat .stat-label,
      .streaming-progress-inline.complete-no-results .progress-stat .stat-value {
        color: #991b1b;
      }

      .streaming-progress-inline.complete-error {
        background: #fee2e2;
        border: 1px solid #fecaca;
      }

      .streaming-progress-inline.complete-error .progress-stat i {
        color: #dc2626;
      }

      .streaming-progress-inline.complete-error .progress-stat .stat-label,
      .streaming-progress-inline.complete-error .progress-stat .stat-value {
        color: #991b1b;
      }

      .progress-stat {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        white-space: nowrap;
      }

      .progress-stat i {
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
      }

      .progress-stat .stat-label {
        color: var(--theme-text-gray);
        font-weight: var(--theme-font-table-body-weight);
      }

      .progress-stat .stat-value {
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
      }

      .search-complete-message {
        padding: 0.5rem 0.75rem;
        background: #dcfce7;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid #bbf7d0;
        font-size: var(--theme-font-table-header);
        color: #15803d;
        margin: 0.5rem 0;
      }

      .search-complete-message i {
        color: #16a34a;
        font-size: var(--theme-font-body);
        flex-shrink: 0;
      }

      .search-complete-message.no-results {
        background: var(--theme-bg-teal-lighter);
        border: 1px solid #bfdbfe;
        color: #1e40af;
      }

      .search-complete-message.no-results i {
        color: var(--theme-text-teal);
      }

      .search-error-message {
        padding: 0.5rem 0.75rem;
        background: #fee2e2;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        border: 1px solid #fecaca;
        font-size: var(--theme-font-table-header);
        color: #991b1b;
        margin: 0.5rem 0;
      }

      .search-error-message i {
        color: #dc2626;
        font-size: var(--theme-font-body);
        flex-shrink: 0;
      }

      /* Responsive adjustments for Quick Key Search */
      @media (max-width: 1400px) {
        .quick-search-info {
          display: none;
        }
      }

      @media (max-width: 1024px) {
        .filter-toggle-header {
          grid-template-columns: auto 1fr;
          grid-template-rows: auto auto;
        }

        .quick-search-inline {
          grid-column: 1 / -1;
          grid-row: 2;
          margin-top: 0.5rem;
          justify-self: stretch;
        }
      }

      @media (max-width: 768px) {
        .filter-toggle-header {
          grid-template-columns: 1fr;
          grid-template-rows: auto auto auto;
        }

        .btn-toggle-filter {
          grid-row: 1;
          justify-self: start;
        }

        .filter-toggle-header h3 {
          grid-row: 2;
          justify-self: start;
        }

        .quick-search-inline {
          grid-column: 1;
          grid-row: 3;
          margin-top: 0.5rem;
          width: 100%;
          justify-self: stretch;
        }

        .search-input-group {
          flex-direction: row;
        }
        
        .btn-quick-search,
        .btn-cancel-search {
          flex-shrink: 0;
        }
        
        .streaming-progress-inline {
          gap: 0.75rem;
          flex-wrap: wrap;
        }
        
        .progress-stat {
          font-size: var(--theme-font-caption);
        }
      }

      .search-form {
        background: var(--theme-bg-app);
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid var(--theme-border-gray);
      }

      .filter-toggle-header {
        display: grid;
        grid-template-columns: auto 1fr 50%;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
        padding-bottom: 1rem;
        border-bottom: 2px solid #6061ef;
        cursor: pointer;
        transition: background 0.2s;
        padding: 0.75rem;
        margin: -0.75rem -0.75rem 1rem -0.75rem;
        border-radius: 6px 6px 0 0;
        background: var(--theme-bg-app);
        position: relative;
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
        justify-self: start;
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
        justify-self: start;
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
        color: #ef4444;
      }

      .btn-toggle-filter .fa-plus {
        color: #10b981;
      }

      .filter-toggle-header:hover .btn-toggle-filter .fa-minus {
        color: #dc2626;
      }

      .filter-toggle-header:hover .btn-toggle-filter .fa-plus {
        color: #059669;
      }

      .form-row {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 1rem;
        margin-bottom: 1rem;
      }

      .advanced-filters-toggle-row {
        margin: -0.25rem 0 0.75rem;
      }

      .btn-advanced-filters-toggle {
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        color: var(--theme-table-header-color);
        border-radius: 8px;
        padding: 0.38rem 0.65rem;
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

      .form-group input,
      .form-group select {
        padding: 0.5rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        transition: border-color 0.2s, box-shadow 0.2s;
      }

      .form-group input:focus,
      .form-group select:focus {
        outline: none;
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
      }

      .form-group input:disabled,
      .form-group select:disabled {
        background: var(--theme-bg-app);
        cursor: not-allowed;
      }

      .form-group input[type="datetime-local"] {
        min-width: 220px;
        font-family: inherit;
        color: var(--theme-text-gray-dark);
      }

      .form-group input[type="datetime-local"]::-webkit-calendar-picker-indicator {
        cursor: pointer;
        padding: 4px;
        border-radius: 4px;
        transition: background 0.2s;
      }

      .form-group input[type="datetime-local"]::-webkit-calendar-picker-indicator:hover {
        background: var(--theme-bg-app);
      }

      .page-size-select {
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
        background: var(--theme-bg-surface);
        cursor: pointer;
      }

      .page-size-select:focus {
        outline: none;
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
      }

      .time-range-row {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1rem;
      }

      .time-presets {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
        flex-shrink: 0;
      }

      .btn-time-preset {
        padding: 0.375rem 0.625rem;
        border: 1px solid #d1d5db;
        background: var(--theme-bg-app);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
        transition: all 0.2s;
      }

      .btn-time-preset:hover:not(:disabled) {
        background: var(--theme-button-primary);
        color: white;
        border-color: var(--theme-button-primary);
      }

      .btn-time-preset:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-time-preset.active {
        background: var(--theme-button-primary);
        color: white;
        border-color: var(--theme-button-primary);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .btn-time-preset.active:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
        border-color: var(--theme-button-primary-hover);
      }

      .info-and-presets-row {
        grid-column: 1 / -1;
        margin-top: 0.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .info-message {
        color: var(--theme-text-teal);
        font-size: var(--theme-font-caption);
        padding: 0.375rem 0.625rem;
        background: var(--theme-bg-teal-lighter);
        border-left: 3px solid var(--theme-button-primary);
        border-radius: 4px;
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex-wrap: wrap;
        flex-shrink: 1;
        min-width: 0;

        i {
          font-size: var(--theme-font-table-header);
          flex-shrink: 0;
        }

        span {
          flex: 0 1 auto;
          min-width: 0;
        }

        .duration-badge {
          margin-left: 0.5rem;
          padding: 0.125rem 0.375rem;
          background: var(--theme-bg-teal-lighter);
          border-radius: 4px;
          font-weight: var(--theme-font-table-body-weight);
          font-size: var(--theme-font-caption);
          color: #1e40af;
          white-space: nowrap;
          flex-shrink: 0;

          &.duration-warning {
            background: #fef3c7;
            color: #92400e;
          }
        }
      }

      .error-message-row {
        grid-column: 1 / -1;
        margin-top: -0.5rem;
      }

      .error-message {
        color: #ef4444;
        font-size: var(--theme-font-body);
        padding: 0.5rem 0.75rem;
        background: #fef2f2;
        border-left: 3px solid #ef4444;
        border-radius: 4px;
      }

      .form-actions {
        display: flex;
        gap: 1rem;
        margin-top: 1rem;
        position: sticky;
        bottom: 0;
        background: var(--theme-bg-app);
        backdrop-filter: blur(3px);
        padding: 0.5rem 0;
        z-index: 2;
      }

      .btn-search,
      .btn-clear {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 6px;
        font-weight: var(--theme-font-table-body-weight);
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .btn-search {
        background: var(--theme-button-primary);
        color: white;
      }

      .btn-search:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }

      .btn-clear {
        background: var(--theme-text-gray);
        color: white;
      }

      .btn-clear:hover:not(:disabled) {
        background: var(--theme-text-gray-dark);
      }

      .btn-search:disabled,
      .btn-clear:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .results-section {
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }

      .results-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 0;
        padding-top: 0;
        padding-bottom: 0;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .results-info {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }

      .results-count {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray-dark);
        font-size: var(--theme-font-body);
      }

      .has-more {
        color: var(--theme-text-gray);
        font-weight: var(--theme-font-table-body-weight);
      }

      .filtered-count {
        color: var(--theme-text-teal);
        font-weight: var(--theme-font-table-header-weight);
      }

      .count-loading {
        color: var(--theme-text-gray);
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
      }

      .btn-load-more-inline {
        padding: 0.375rem 0.75rem;
        background: var(--theme-button-primary);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-body-weight);
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        transition: all 0.2s;
      }

      .btn-load-more-inline:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
      }

      .btn-load-more-inline:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-load-more-inline i {
        font-size: var(--theme-font-caption);
      }

      .header-controls {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .btn-sort {
        padding: 0.5rem 0.75rem;
        background: var(--theme-bg-app);
        color: var(--theme-text-gray-dark);
        border: 1px solid #d1d5db;
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

      .btn-sort i {
        font-size: var(--theme-font-body);
      }

      .client-search-bar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        background: var(--theme-bg-app);
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        min-width: 300px;
        transition: all 0.2s;
      }

      .client-search-bar:focus-within {
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
      }

      .client-search-bar i.fa-search {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
      }

      .client-search-input {
        flex: 1;
        border: none;
        outline: none;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
        background: transparent;
      }

      .client-search-input::placeholder {
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
        color: #ef4444;
        background: #fee2e2;
      }

      .btn-clear-search i {
        font-size: var(--theme-font-body);
      }

      .messages-table {
        background: var(--theme-bg-surface);
        border-radius: 8px;
        border: 1px solid var(--theme-border-gray);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        display: block;
        max-height: 665px;
        overflow: auto;
      }

      .table-header {
        position: sticky;
        top: 0;
        z-index: 10;
        background: var(--theme-bg-surface);
      }

      .table-header table {
        width: 100%;
        min-width: 1200px;
        border-collapse: collapse;
      }

      .table-body-container {
        display: block;
      }

      table {
        width: 100%;
        min-width: 1200px;
        border-collapse: collapse;
        font-size: var(--theme-font-table-body);
      }

      thead {
        background: var(--theme-bg-app);
        border-bottom: 2px solid var(--theme-border-gray);
      }

      th {
        padding: 0.65rem 0.75rem;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-table-header);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        white-space: nowrap;
      }

      /* Match column widths between header and body */
      .table-header th:nth-child(1),
      .table-body-container td:nth-child(1) { width: 50px; } /* Checkbox */
      .table-header th:nth-child(2),
      .table-body-container td:nth-child(2) { width: 96px; } /* Partition */
      .table-header th:nth-child(3),
      .table-body-container td:nth-child(3) { width: 120px; } /* Offset */
      .table-header th:nth-child(4),
      .table-body-container td:nth-child(4) { width: 180px; } /* Timestamp */
      .table-header th:nth-child(5),
      .table-body-container td:nth-child(5) { width: 150px; } /* Key */
      .table-header th:nth-child(6),
      .table-body-container td:nth-child(6) { width: auto; } /* Value Preview */
      td {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--theme-border-gray);
        vertical-align: top;
        font-size: var(--theme-font-table-body);
      }

      tbody tr.clickable-row {
        cursor: pointer;
        transition: background 0.2s;
      }

      tbody tr.clickable-row:hover {
        background: var(--theme-bg-app);
      }

      tbody tr.row-selected {
        background: var(--theme-bg-teal-lighter) !important;
        border-left: 3px solid var(--theme-button-primary);
      }

      tbody tr.row-preview-active {
        background: var(--theme-bg-teal-lighter) !important;
        border-left: 3px solid var(--theme-text-teal-dark);
      }

      tbody tr.row-selected td:first-child {
        padding-left: calc(0.75rem - 3px);
      }

      tbody tr:last-child td {
        border-bottom: none;
      }

      .skeleton-row {
        pointer-events: none;
      }

      .skeleton-row td {
        vertical-align: middle;
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

      .skeleton-checkbox {
        width: 18px;
        height: 18px;
        border-radius: 4px;
      }

      .skeleton-text-sm {
        width: 64px;
        height: 12px;
      }

      .skeleton-text-md {
        width: 130px;
        height: 12px;
      }

      .skeleton-chip {
        width: 120px;
        height: 22px;
        border-radius: 6px;
      }

      .skeleton-text-lg {
        width: 92%;
        height: 12px;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      .partition-col,
      .offset-col {
        font-weight: var(--theme-font-table-body-weight);
        color: #1e40af;
        font-family: monospace;
      }

      .table-header th:nth-child(2),
      .table-header th:nth-child(3),
      .table-body-container td:nth-child(2),
      .table-body-container td:nth-child(3) {
        text-align: center;
      }

      .timestamp-col {
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
        white-space: nowrap;
      }

      .key-col code {
        background: var(--theme-bg-app);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-body);
        font-family: monospace;
        color: #7c3aed;
      }

      .value-col {
        max-width: 400px;
      }

      .value-preview {
        display: block;
        background: var(--theme-bg-app);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-body);
        font-family: monospace;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--theme-text-gray-dark);
      }

      .empty {
        color: var(--theme-text-gray);
        font-style: italic;
      }

      /* Checkbox column */
      .checkbox-col {
        width: 50px;
        text-align: center;
      }

      .checkbox-col input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: var(--theme-button-primary);
      }

      /* Selection Toolbar */
      .selection-toolbar {
        background: var(--theme-bg-teal-lighter);
        border: 1px solid var(--theme-border-teal);
        border-radius: 8px;
        padding: 1rem 1.5rem;
        margin-bottom: 1rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        animation: slideDown 0.3s ease-out;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateY(-10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      .selection-count {
        font-weight: var(--theme-font-table-header-weight);
        color: #1e40af;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
      }

      .selection-count i {
        color: var(--theme-text-teal);
      }

      .toolbar-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }

      .btn-clear-selection {
        background: var(--theme-bg-app);
        color: var(--theme-text-gray);
        border: 1px solid #d1d5db;
        padding: 0.5rem 1rem;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        transition: all 0.2s;
      }

      .btn-clear-selection:hover {
        background: var(--theme-bg-app);
        border-color: var(--theme-border-gray);
        color: var(--theme-text-gray-dark);
      }

      .btn-bulk-requeue {
        background: var(--theme-button-primary);
        color: white;
        border: none;
        padding: 0.5rem 1.25rem;
        border-radius: 6px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        transition: all 0.2s;
      }

      .btn-bulk-requeue:hover {
        background: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 6px -1px rgba(147, 41, 154, 0.3);
      }

      .btn-bulk-requeue i {
        font-size: var(--theme-font-body);
      }

      .no-results {
        text-align: center;
        padding: 4rem 2rem;
        color: var(--theme-text-gray);
        background: var(--theme-bg-app);
        border-radius: 8px;
        margin: 2rem 0;
      }

      .no-results i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1.5rem;
        opacity: 0.3;
        color: var(--theme-text-gray);
      }

      .no-results p {
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
        margin: 0 0 0.75rem 0;
      }

      .no-results-row {
        border: none !important;
        background: transparent !important;
      }

      .no-results-row:hover {
        background: transparent !important;
      }

      .no-filter-results {
        text-align: center;
        padding: 4rem 2rem;
        color: var(--theme-text-gray);
        background: var(--theme-bg-app);
        border-radius: 8px;
      }

      .no-filter-results i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1.5rem;
        opacity: 0.3;
        color: var(--theme-text-teal);
      }

      .no-filter-results p {
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
        margin: 0 0 0.75rem 0;
      }

      .hint-text {
        display: block;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray);
        margin-top: 0.5rem;
      }

      .empty-state-actions {
        margin-top: 0.9rem;
        display: flex;
        justify-content: center;
        gap: 0.5rem;
        flex-wrap: wrap;
      }

      .table-and-preview-container {
        display: flex;
        gap: 1rem;
        position: relative;
      }

      .table-and-preview-container .messages-table {
        flex: 1;
        min-width: 0;
        scroll-behavior: smooth;
      }

      .message-preview-sidebar {
        position: sticky;
        top: 1rem;
        flex-shrink: 0;
        width: 500px;
        max-height: 600px;
        background: var(--theme-bg-surface);
        border: 2px solid var(--theme-border-teal);
        border-radius: 8px;
        box-shadow: 0 4px 25px rgba(147, 41, 154, 0.25), 0 0 0 3px rgba(147, 41, 154, 0.12);
        display: flex;
        flex-direction: column;
        animation: slideInRight 0.3s ease-out;
        align-self: flex-start;
        overflow: hidden;
      }

      /* Maximized state - centered with full overlay */
      .message-preview-sidebar.maximized {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 90vw;
        max-width: 1400px;
        z-index: var(--z-modal-content, 1000001);
        margin: 0;
        border-radius: 12px;
        border: 1px solid var(--theme-border-gray-light);
        box-shadow: var(--theme-shadow-lg);
        animation: maximizeIn 0.3s ease-out;
      }

      @keyframes maximizeIn {
        from {
          opacity: 0;
          transform: translate(-50%, -50%) scale(0.9);
        }
        to {
          opacity: 1;
          transform: translate(-50%, -50%) scale(1);
        }
      }

      /* Backdrop overlay - full screen */
      .preview-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        height: calc(100vh * 20);
        background: var(--theme-bg-overlay-backdrop);
        z-index: var(--z-modal-backdrop, 1000000);
        animation: fadeIn 0.2s ease-out;
        cursor: pointer;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      /* When maximized, adjust internal content */
      .message-preview-sidebar.maximized .preview-content {
        max-height: calc(90vh - 150px);
        overflow-y: auto;
      }

      .message-preview-sidebar.maximized .tree-view-in-formatted,
      .message-preview-sidebar.maximized .json-preview,
      .message-preview-sidebar.maximized .text-preview,
      .message-preview-sidebar.maximized .payload-raw-content {
        max-height: calc(90vh - 300px);
      }

      @keyframes slideInRight {
        from {
          opacity: 0;
          transform: translateX(20px);
        }
        to {
          opacity: 1;
          transform: translateX(0);
        }
      }

      .preview-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.75rem 1rem;
        background: var(--theme-header-gradient);
        color: var(--theme-bg-surface);
        border-bottom: 1px solid var(--theme-border-teal-dark);
        box-shadow: var(--theme-shadow-md);
        flex-shrink: 0;
      }

      .preview-title {
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        color: var(--theme-bg-surface);
      }

      .preview-header-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .btn-copy-link-preview,
      .btn-open-new-tab,
      .btn-maximize-preview,
      .btn-close-preview {
        background: var(--theme-bg-overlay-light);
        border: none;
        color: var(--theme-bg-surface);
        cursor: pointer;
        padding: 0.25rem;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        transition: all 0.2s;
      }

      .btn-copy-link-preview:hover,
      .btn-open-new-tab:hover,
      .btn-maximize-preview:hover,
      .btn-close-preview:hover {
        background: var(--theme-bg-overlay-light);
        transform: scale(1.05);
      }

      .btn-copy-link-preview .fa-check {
        color: var(--theme-button-success);
      }

      /* Tabs */
      .preview-tabs {
        display: flex;
        background: var(--theme-bg-app);
        border-bottom: 2px solid var(--theme-border-gray);
        flex-shrink: 0;
      }

      .preview-tab {
        flex: 1;
        background: none;
        border: none;
        padding: 0.75rem 1rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        cursor: pointer;
        transition: all 0.2s;
        border-bottom: 3px solid transparent;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
      }

      .preview-tab:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-gray-dark);
      }

      .preview-tab.active {
        color: var(--theme-text-teal);
        background: var(--theme-bg-app);
        border-bottom-color: var(--theme-button-primary);
      }

      .preview-tab i {
        font-size: var(--theme-font-body);
      }

      /* Message Metadata Section */
      /* Metadata View (inside content area) */
      .metadata-view {
        padding: 1rem;
        overflow-y: auto;
      }

      .metadata-section {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        border-radius: 6px;
        margin-bottom: 1rem;
      }

      .metadata-section:last-child {
        margin-bottom: 0;
      }

      .metadata-title {
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray-dark);
        margin-bottom: 0.5rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .metadata-title i {
        color: var(--theme-text-teal);
        font-size: var(--theme-font-body);
      }

      .header-count {
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        font-size: var(--theme-font-caption);
      }

      .metadata-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.5rem;
      }

      .metadata-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray);
        border-radius: 4px;
        font-size: var(--theme-font-body);
      }

      .metadata-label {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray);
        flex-shrink: 0;
      }

      .metadata-value {
        color: var(--theme-text-gray-dark);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .metadata-key-value {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray);
        border-radius: 4px;
      }

      .metadata-key-value code {
        flex: 1;
        background: var(--theme-bg-app);
        padding: 0.25rem 0.5rem;
        border-radius: 3px;
        font-size: var(--theme-font-body);
        color: var(--theme-text-gray-dark);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .metadata-empty {
        padding: 0.5rem;
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        font-style: italic;
        text-align: center;
        background: var(--theme-bg-surface);
        border: 1px dashed var(--theme-border-gray);
        border-radius: 4px;
      }

      .headers-list {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
      }

      .header-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem;
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray);
        border-radius: 4px;
        font-size: var(--theme-font-body);
      }

      .header-key {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray);
        flex-shrink: 0;
      }

      .header-value {
        color: var(--theme-text-gray-dark);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .btn-copy-metadata {
        background: none;
        border: none;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 0.25rem;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .btn-copy-metadata:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-teal);
      }

      .btn-copy-metadata i.fa-check {
        color: #10b981;
      }

      /* Search Bar */
      .preview-search {
        display: flex;
        align-items: center;
        padding: 0.75rem 1rem;
        background: var(--theme-bg-app);
        border-bottom: 1px solid var(--theme-border-gray);
        gap: 0.5rem;
        flex-shrink: 0;
      }

      .preview-search i.fa-search {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
      }

      .preview-search input {
        flex: 1;
        border: 1px solid var(--theme-border-gray);
        border-radius: 6px;
        padding: 0.5rem 0.75rem;
        font-size: var(--theme-font-body);
        outline: none;
        transition: all 0.2s;
      }

      .preview-search input:focus {
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
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
        transition: color 0.2s;
      }

      .btn-clear-search:hover {
        color: var(--theme-text-gray-dark);
      }

      /* Content Area */
      .preview-content {
        flex: 1;
        overflow: auto;
        background: var(--theme-bg-surface);
        min-height: 0;
      }

      /* Tree View */
      .tree-view {
        padding: 1rem;
      }

      /* Payload View */
      .payload-view {
        padding: 1rem;
      }

      .payload-raw-view {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }

      .payload-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid var(--theme-border-gray);
      }

      .payload-label {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray-dark);
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .payload-raw-content {
        margin: 0;
        padding: 1rem;
        background: var(--theme-text-dark);
        color: #fbbf24;
        border-radius: 6px;
        font-family: 'Courier New', Courier, monospace;
        font-size: var(--theme-font-body);
        line-height: 1.6;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 400px;
        overflow-y: auto;
      }

      .tree-nodes {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .tree-node {
        font-size: var(--theme-font-body);
        line-height: 1.5;
      }

      .tree-node-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.375rem 0.5rem;
        border-radius: 4px;
        transition: background 0.2s;
      }

      .tree-node-header:hover {
        background: var(--theme-bg-app);
      }

      .tree-toggle {
        background: none;
        border: none;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 0;
        width: 16px;
        height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        transition: color 0.2s;
      }

      .tree-toggle:hover {
        color: var(--theme-text-gray-dark);
      }

      .tree-toggle i {
        font-size: var(--theme-font-caption);
      }

      .tree-toggle-spacer {
        width: 16px;
        flex-shrink: 0;
      }

      .tree-key {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray-dark);
        flex-shrink: 0;
      }

      .tree-type-badge {
        font-size: var(--theme-font-caption);
        padding: 0.125rem 0.375rem;
        border-radius: 3px;
        font-weight: var(--theme-font-table-body-weight);
        text-transform: uppercase;
        flex-shrink: 0;
      }

      .tree-type-badge[data-type="string"] {
        background: var(--theme-bg-teal-lighter);
        color: #1e40af;
      }

      .tree-type-badge[data-type="number"] {
        background: #fef3c7;
        color: #92400e;
      }

      .tree-type-badge[data-type="boolean"] {
        background: #e0e7ff;
        color: var(--theme-text-teal-dark);
      }

      .tree-type-badge[data-type="object"] {
        background: #f3e8ff;
        color: #6b21a8;
      }

      .tree-type-badge[data-type="array"] {
        background: #fce7f3;
        color: #9f1239;
      }

      .tree-type-badge[data-type="nested-json"] {
        background: #d1fae5;
        color: #065f46;
      }

      .tree-type-badge[data-type="null"] {
        background: var(--theme-bg-app);
        color: var(--theme-text-gray);
      }

      .tree-value {
        color: var(--theme-text-gray);
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .tree-value-summary {
        color: var(--theme-text-gray);
        flex: 1;
        font-style: italic;
        font-size: var(--theme-font-table-header);
      }

      .btn-copy-field {
        background: none;
        border: none;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 0.25rem;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 3px;
        opacity: 0;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .tree-node-header:hover .btn-copy-field {
        opacity: 1;
      }

      .btn-copy-field:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-teal);
      }

      .btn-copy-field i.fa-check {
        color: #10b981;
      }

      .tree-children {
        margin-top: 0.25rem;
        border-left: 2px solid var(--theme-border-gray);
        margin-left: 0.5rem;
      }

      .no-tree-data,
      .tree-view-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 1rem;
        text-align: center;
        color: var(--theme-text-gray);
      }

      .no-tree-data i,
      .tree-view-error i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        color: var(--theme-border-gray);
      }

      .no-tree-data p,
      .tree-view-error p {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        margin: 0 0 0.5rem 0;
      }

      .hint-text {
        font-size: var(--theme-font-table-header);
        color: var(--theme-text-gray);
      }

      /* Formatted View */
      .formatted-view,
      .raw-view {
        padding: 1rem;
      }

      .formatted-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.75rem;
        gap: 1rem;
      }

      .view-toggle {
        display: flex;
        gap: 0.5rem;
        background: var(--theme-bg-app);
        padding: 0.25rem;
        border-radius: 6px;
      }

      .view-toggle .toggle-btn {
        padding: 0.5rem 0.75rem;
        background: transparent;
        border: none;
        border-radius: 4px;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        cursor: pointer;
        transition: all 0.2s;
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }

      .view-toggle .toggle-btn:hover {
        color: var(--theme-text-gray-dark);
        background: var(--theme-bg-app);
      }

      .view-toggle .toggle-btn.active {
        background: var(--theme-bg-app);
        color: var(--theme-text-teal);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .view-toggle .toggle-btn i {
        font-size: var(--theme-font-caption);
      }

      .tree-view-in-formatted {
        background: var(--theme-bg-app);
        border-radius: 6px;
        padding: 0.5rem;
        max-height: 450px;
        overflow-y: auto;
      }

      .copy-all-wrapper {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 0.75rem;
      }

      .btn-copy-all {
        background: var(--theme-button-primary);
        color: white;
        border: none;
        padding: 0.5rem 0.75rem;
        border-radius: 6px;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-body-weight);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s;
      }

      .btn-copy-all:hover {
        background: var(--theme-button-primary-hover);
      }

      .btn-copy-all i.fa-check {
        color: #10b981;
      }

      .json-preview,
      .text-preview {
        margin: 0;
        padding: 1rem;
        background: var(--theme-text-dark);
        color: var(--theme-border-gray-light);
        border-radius: 6px;
        font-family: 'Courier New', Courier, monospace;
        font-size: var(--theme-font-body);
        line-height: 1.6;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .json-preview {
        color: #a5f3fc;
      }

      .text-preview {
        color: #fbbf24;
      }

      .formatted-error {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 3rem 1rem;
        text-align: center;
        color: var(--theme-text-gray);
      }

      .formatted-error i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        color: #fbbf24;
      }

      .formatted-error p {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        margin: 0 0 0.5rem 0;
      }
    `,
  ],
})
export class MessagesTabComponent implements OnInit, OnDestroy, OnChanges {
  @Input({ required: true }) topicName!: string;
  @ViewChild('messagesTableContainer') messagesTableContainer?: ElementRef<HTMLDivElement>;

  private stateService = inject(KafkaStateService);
  private kafkaService = inject(KafkaService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private viewportScaleService = inject(ViewportScaleService);

  topics = this.stateService.topics;

  searchRequest: MessageSearchRequest = {
    topic: '',
    pageSize: 500,
    pageNumber: 1,
  };

  pageSize = signal<number>(500);
  isAdmin = computed(() => this.authService.isUserAdmin());
  readonly skeletonRows = [1, 2, 3, 4, 5, 6];

  searchResults = signal<MessageSearchResponse | null>(null);
  allLoadedMessages = signal<KafkaMessage[]>([]);
  isLoading = signal(false);
  isLoadingMore = signal(false);
  isCountLoading = signal(false);
  exactTotalCount = signal<number | null>(null);
  hasSearched = signal(false);
  isFilterExpanded = signal(true);
  isAdvancedFiltersExpanded = signal(false);
  clientSearchQuery = signal<string>('');
  sortOrder = signal<'newest' | 'oldest'>('newest');
  previewMessage = signal<KafkaMessage | null>(null);
  isPreviewMaximized = signal<boolean>(false);
  isCopied = signal<boolean>(false);
  previewTab = signal<'metadata' | 'message' | 'raw' | 'dynamic'>('metadata');
  previewSearch = signal<string>('');
  expandedNodes = signal<Set<string>>(new Set());
  copiedField = signal<string | null>(null);
  messageViewMode = signal<'json' | 'tree'>('tree');
  payloadViewMode = signal<'json' | 'tree'>('tree');
  linkCopied = signal<boolean>(false);
  
  // Quick Key Search properties
  quickKeySearch = signal('');
  isStreamingSearch = signal(false);
  streamingProgress = signal<SearchProgress | null>(null);
  searchStartTime: number | null = null;
  elapsedTime = signal<string>('0 ms'); // Signal for elapsed time to avoid change detection issues
  private streamCleanup: (() => void) | null = null;
  private elapsedTimeInterval: any = null;
  scannedPartitionIds = signal<number[]>([]);
  
  // List of keys to create dynamic tabs for
  dynamicTabKeys = ['payload'];
  
  // Current active dynamic tab key (if any)
  activeDynamicTabKey = signal<string | null>(null);
  
  // Computed signal to find which dynamic keys exist in the current message
  availableDynamicTabs = computed(() => {
    const message = this.previewMessage();
    if (!message || !this.isValidJson(message.value)) {
      return [];
    }
    
    const parsed = this.parseJson(message.value);
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }
    
    const found: Array<{ key: string; displayName: string }> = [];
    
    for (const dynamicKey of this.dynamicTabKeys) {
      // Check both lowercase and capitalized versions
      const lowerKey = dynamicKey.toLowerCase();
      const capitalizedKey = lowerKey.charAt(0).toUpperCase() + lowerKey.slice(1);
      
      if (lowerKey in parsed || capitalizedKey in parsed) {
        found.push({
          key: lowerKey,
          displayName: capitalizedKey
        });
      }
    }
    
    return found;
  });
  
  // Bulk requeue state
  selectedMessages = signal<Set<string>>(new Set()); // key: "partition:offset"
  bulkRequeueItems = signal<BulkRequeueItem[]>([]);
  showRequeueProgress = signal(false);

  timeRangeError = signal<string | null>(null);

  // Track selected preset (null = no preset, '1h' | '3h' | '24h' | '7d')
  selectedPreset = signal<string | null>(null);

  // Kafka configuration (loaded from backend)
  kafkaConfig = signal<KafkaConfig | null>(null);

  // Filtered messages based on client-side search
  filteredMessages = computed(() => {
    const messages = this.allLoadedMessages();
    if (!messages.length) return [];
    
    const query = this.clientSearchQuery().toLowerCase().trim();
    if (!query) return messages;
    
    return messages.filter(message => {
      // Search in key
      if (message.key?.toLowerCase().includes(query)) return true;
      
      // Search in value
      if (message.value?.toLowerCase().includes(query)) return true;
      
      // Search in offset
      if (message.offset.toString().includes(query)) return true;
      
      // Search in headers
      if (message.headers) {
        const headersMatch = Object.entries(message.headers).some(([key, value]) => 
          key.toLowerCase().includes(query) || value.toLowerCase().includes(query)
        );
        if (headersMatch) return true;
      }
      
      return false;
    });
  });

  previewModalStyle = computed(() => {
    if (typeof window === 'undefined' || !this.isPreviewMaximized()) {
      return {};
    }

    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const visibleHeight = viewportHeight / scale;
    const topSafeOffset = 120;
    const maxHeight = Math.min(94 * baseHeight / 100, Math.max(320, visibleHeight - topSafeOffset - 24));

    return {
      maxHeight: `${maxHeight}px`,
    };
  });

  // Sorted messages based on timestamp
  sortedMessages = computed(() => {
    const messages = [...this.filteredMessages()];
    const order = this.sortOrder();
    
    return messages.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      
      return order === 'newest' ? timeB - timeA : timeA - timeB;
    });
  });

  toggleSortOrder(): void {
    this.sortOrder.set(this.sortOrder() === 'newest' ? 'oldest' : 'newest');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    // Close preview when clicking outside
    if (this.previewMessage()) {
      const target = event.target as HTMLElement;
      const clickedInsidePreview = target.closest('.message-preview-sidebar');
      const clickedOnRow = target.closest('.clickable-row');
      
      if (!clickedInsidePreview && !clickedOnRow) {
        this.closePreview();
      }
    }
  }
  
  // Initialize with default 24 hour range
  private getDefaultStartTime(): Date {
    return new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
  }

  private getDefaultEndTime(): Date {
    return new Date(); // now
  }

  startTime = signal<Date | null>(this.getDefaultStartTime());
  endTime = signal<Date | null>(this.getDefaultEndTime());

  startTimeLocal = computed(() => {
    const time = this.startTime();
    if (!time) return '';
    const local = new Date(time.getTime() - time.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });

  endTimeLocal = computed(() => {
    const time = this.endTime();
    if (!time) return '';
    const local = new Date(time.getTime() - time.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });

  // Min date: maxDaysBack from now (from config)
  minDateTimeLocal = computed(() => {
    const config = this.kafkaConfig();
    const maxDaysBack = config?.maxDaysBack ?? 60;
    const dateBack = new Date();
    dateBack.setDate(dateBack.getDate() - maxDaysBack);
    const local = new Date(dateBack.getTime() - dateBack.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });

  // Max date: now
  maxDateTimeLocal = computed(() => {
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });

  // Start date min: maxDaysBack from now (from config)
  // Start date max: current date/time (cannot be in future)
  startTimeMinLocal = computed(() => {
    return this.minDateTimeLocal();
  });

  startTimeMaxLocal = computed(() => {
    // Start date cannot exceed current date/time
    return this.maxDateTimeLocal();
  });

  // End date min: start date (if set) or minDateTimeLocal, whichever is later
  // End date max: current date/time (cannot be in future)
  endTimeMinLocal = computed(() => {
    const start = this.startTime();
    const config = this.kafkaConfig();
    
    if (start && config) {
      // End date should be at least the start date
      const startLocal = new Date(start.getTime() - start.getTimezoneOffset() * 60000);
      const minLocal = this.minDateTimeLocal();
      // Return the later of start date or minimum allowed date
      return startLocal.toISOString().slice(0, 16) > minLocal 
        ? startLocal.toISOString().slice(0, 16) 
        : minLocal;
    }
    
    return this.minDateTimeLocal();
  });

  endTimeMaxLocal = computed(() => {
    // End date cannot exceed current date/time
    return this.maxDateTimeLocal();
  });

  // Calculate duration between start and end time
  durationInfo = computed(() => {
    const start = this.startTime();
    const end = this.endTime();
    const config = this.kafkaConfig();
    
    if (!start || !end || start > end) {
      return null;
    }
    
    const durationMs = end.getTime() - start.getTime();
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    
    // Use maxRangeDays from config to determine max duration
    const maxRangeDays = config?.maxRangeDays ?? 7;
    const maxDurationMs = maxRangeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
    const exceedsMax = durationMs > maxDurationMs;
    
    return {
      hours,
      minutes,
      exceedsMax,
      formatted: `${hours}h ${minutes}m`
    };
  });

  canSearch = computed(() => {
    return !!this.topicName;
  });

  ngOnInit(): void {
    this.stateService.registerRefreshCallback('messages-tab', async () => {
      await this.refreshMessagesForContext();
    });

    this.searchRequest.topic = this.topicName;
    // Set initial preset to match default 24 hour range
    this.selectedPreset.set('24h');
    // Load Kafka configuration first
    this.loadKafkaConfig();
    // Automatically load initial messages from starting offset
    this.loadInitialMessages();
  }

  async loadKafkaConfig(): Promise<void> {
    try {
      const config = await this.kafkaService.getKafkaConfig().toPromise();
      if (config) {
        this.kafkaConfig.set(config);
      }
    } catch (error) {
      console.error('Error loading Kafka config, using defaults:', error);
      // Set defaults if config fails to load
      this.kafkaConfig.set({
        maxDaysBack: 60,
        maxRangeDays: 7,
        defaultRangeDays: 1
      });
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Reset all state when topic changes
    if (changes['topicName'] && !changes['topicName'].firstChange) {
      this.resetComponentState();
    }
  }

  ngOnDestroy(): void {
    this.stateService.unregisterRefreshCallback('messages-tab');
    // Cleanup streaming search if active
    this.cancelStreamingSearch();
    // Ensure timer is stopped
    this.stopElapsedTimeTimer();
  }

  private resetComponentState(): void {
    // Cancel any active streaming search
    this.cancelStreamingSearch();
    
    // Reset search request
    this.searchRequest = {
      topic: this.topicName,
      pageSize: 500,
      pageNumber: 1,
    };
    
    // Reset all signals
    this.searchResults.set(null);
    this.allLoadedMessages.set([]);
    this.isLoading.set(false);
    this.isLoadingMore.set(false);
    this.isCountLoading.set(false);
    this.exactTotalCount.set(null);
    this.hasSearched.set(false);
    this.isFilterExpanded.set(true);
    this.clientSearchQuery.set('');
    this.sortOrder.set('newest');
    this.previewMessage.set(null);
    this.isPreviewMaximized.set(false);
    this.isCopied.set(false);
    this.previewTab.set('metadata');
    this.previewSearch.set('');
    this.expandedNodes.set(new Set());
    this.copiedField.set(null);
    this.messageViewMode.set('tree');
    this.payloadViewMode.set('tree');
    this.linkCopied.set(false);
    
    // Reset Quick Key Search state
    this.quickKeySearch.set('');
    this.isStreamingSearch.set(false);
    this.streamingProgress.set(null);
    this.searchStartTime = null;
    this.elapsedTime.set('0 ms');
    this.scannedPartitionIds.set([]);
    
    // Reset selection state
    this.selectedMessages.set(new Set());
    this.bulkRequeueItems.set([]);
    this.showRequeueProgress.set(false);
    
    // Reset time range to defaults
    this.startTime.set(this.getDefaultStartTime());
    this.endTime.set(this.getDefaultEndTime());
    this.selectedPreset.set('24h'); // Set to 24h preset
    this.timeRangeError.set(null);
    
    // Reset page size
    this.pageSize.set(500);
    
    // Ensure config is loaded (if not already)
    if (!this.kafkaConfig()) {
      this.loadKafkaConfig();
    }
    
    // Update search request topic
    this.searchRequest.topic = this.topicName;
    
    // Automatically load initial messages for the new topic
    this.loadInitialMessages();
  }

  // Quick Key Search Methods
  startQuickKeySearch(): void {
    const key = this.quickKeySearch().trim();
    if (!key) return;

    // Close any open message preview
    this.previewMessage.set(null);

    // Cancel any active streaming search first
    this.cancelStreamingSearch();

    // Reset search filters (both UI and data)
    this.searchRequest = {
      topic: this.topicName,
      pageSize: this.pageSize(),
      pageNumber: 1,
      // Clear partition, key, and value filters
      partition: undefined,
      key: undefined,
      value: undefined,
    };
    
    // Reset time range to defaults
    this.startTime.set(this.getDefaultStartTime());
    this.endTime.set(this.getDefaultEndTime());
    this.selectedPreset.set('24h'); // Set to 24h preset
    this.timeRangeError.set(null);

    // Collapse the search filters
    this.isFilterExpanded.set(false);

    // Clear previous results and initialize empty table structure
    this.allLoadedMessages.set([]);
    this.searchResults.set({
      messages: [],
      totalCount: 0,
      exactTotalCount: 0,
      hasMore: false,
      pageNumber: 1,
      pageSize: this.pageSize(),
      continuationToken: undefined,
      previousToken: undefined
    });
    this.isStreamingSearch.set(true);
    this.searchStartTime = Date.now();
    this.elapsedTime.set('0 ms');
    this.scannedPartitionIds.set([]);
    this.streamingProgress.set({
      status: 'searching',
      partitionsScanned: 0,
      totalPartitions: 0,
      totalMessagesFound: 0,
      totalBytes: 0
    });

    // Start timer to update elapsed time every 100ms
    this.startElapsedTimeTimer();

    // Scroll to results section after filters collapse
    setTimeout(() => {
      const resultsSection = document.querySelector('.results-section');
      if (resultsSection) {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 150);

    // Quick search uses maxDaysBack from config for time range
    // This ignores the filter panel's time range but still prevents scanning very old data
    const config = this.kafkaConfig();
    const maxDaysBack = config?.maxDaysBack ?? 60;
    const daysAgo = new Date();
    daysAgo.setDate(daysAgo.getDate() - maxDaysBack);

    const request: MessageSearchRequest = {
      topic: this.topicName,
      key: key,
      pageSize: 10000, // Large number to get all matching messages
      pageNumber: 1,
      timeRange: {
        startTime: daysAgo.toISOString(),
        endTime: new Date().toISOString(),
        maxRangeDays: maxDaysBack // Use maxDaysBack from config
      }
    };

    this.streamCleanup = this.kafkaService.searchMessagesStream(
      request,
      (update) => {
        // Handle progress update
        this.streamingProgress.set(update);
        
        // Track scanned partitions
        if (update.partitionId !== undefined) {
          const current = this.scannedPartitionIds();
          if (!current.includes(update.partitionId)) {
            this.scannedPartitionIds.set([...current, update.partitionId].sort((a, b) => a - b));
          }
        }
        
        if (update.messages && update.messages.length > 0) {
          // Add new messages
          const current = this.allLoadedMessages();
          this.allLoadedMessages.set([...current, ...update.messages]);
        }
      },
      () => {
        // Complete
        this.stopElapsedTimeTimer();
        this.isStreamingSearch.set(false);
        this.streamCleanup = null;
        
        // Update final progress
        const finalProgress = this.streamingProgress();
        if (finalProgress) {
          this.streamingProgress.set({
            ...finalProgress,
            status: 'complete'
          });
        }

        // Set search results for display
        this.searchResults.set({
          messages: this.allLoadedMessages(),
          totalCount: this.allLoadedMessages().length,
          exactTotalCount: this.allLoadedMessages().length,
          hasMore: false,
          pageNumber: 1,
          pageSize: this.pageSize(),
          continuationToken: undefined,
          previousToken: undefined
        });
        
        this.hasSearched.set(true);
      },
      (error) => {
        // Error
        console.error('Streaming search error:', error);
        this.stopElapsedTimeTimer();
        this.isStreamingSearch.set(false);
        this.streamCleanup = null;
        
        const errorProgress = this.streamingProgress();
        if (errorProgress) {
          this.streamingProgress.set({
            ...errorProgress,
            status: 'error',
            error: error
          });
        }
      }
    );
  }

  cancelStreamingSearch(): void {
    this.stopElapsedTimeTimer();
    if (this.streamCleanup) {
      this.streamCleanup();
      this.streamCleanup = null;
    }
    this.isStreamingSearch.set(false);
    this.searchStartTime = null;
  }

  private startElapsedTimeTimer(): void {
    // Stop any existing timer
    this.stopElapsedTimeTimer();
    
    // Update elapsed time every 100ms
    this.elapsedTimeInterval = setInterval(() => {
      if (this.searchStartTime) {
        this.elapsedTime.set(this.calculateElapsedTime());
      }
    }, 100);
  }

  private stopElapsedTimeTimer(): void {
    if (this.elapsedTimeInterval) {
      clearInterval(this.elapsedTimeInterval);
      this.elapsedTimeInterval = null;
    }
  }

  private calculateElapsedTime(): string {
    if (!this.searchStartTime) return '0 ms';
    const elapsed = Date.now() - this.searchStartTime;
    
    if (elapsed < 1000) {
      return `${elapsed} ms`;
    } else if (elapsed < 60000) {
      return `${(elapsed / 1000).toFixed(1)} s`;
    } else {
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      return `${minutes}m ${seconds}s`;
    }
  }

  getProgressPercentage(): number {
    const progress = this.streamingProgress();
    if (!progress || progress.totalPartitions === 0) return 0;
    return (progress.partitionsScanned / progress.totalPartitions) * 100;
  }

  getScannedPartitions(): string {
    const ids = this.scannedPartitionIds();
    return ids.length > 0 ? ids.join(', ') : '...';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  onStartTimeChangeValue(value: string): void {
    if (value) {
      const newStartDate = new Date(value);
      const config = this.kafkaConfig();
      
      if (!config) {
        // Config not loaded yet, just set the value
        this.startTime.set(newStartDate);
        this.validateTimeRange();
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      // Always adjust end date to maintain maxRangeDays difference
      const maxDurationMs = config.maxRangeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
      const calculatedEndDate = new Date(newStartDate.getTime() + maxDurationMs);
      const now = new Date();
      
      // Ensure end date doesn't exceed current date/time
      const adjustedEndDate = calculatedEndDate > now ? now : calculatedEndDate;
      
      // Ensure start date is not before minimum allowed date
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - config.maxDaysBack);
      const finalStartDate = newStartDate < minDate ? minDate : newStartDate;
      
      this.startTime.set(finalStartDate);
      
      // If we had to adjust start date, recalculate end date
      if (finalStartDate !== newStartDate) {
        const recalculatedEndDate = new Date(finalStartDate.getTime() + maxDurationMs);
        this.endTime.set(recalculatedEndDate > now ? now : recalculatedEndDate);
      } else {
        this.endTime.set(adjustedEndDate);
      }
    } else {
      this.startTime.set(null);
    }
    // Clear preset since user manually changed time
    this.selectedPreset.set(null);
    this.validateTimeRange();
  }

  onEndTimeChangeValue(value: string): void {
    if (value) {
      const newEndDate = new Date(value);
      const config = this.kafkaConfig();
      
      if (!config) {
        // Config not loaded yet, just set the value
        this.endTime.set(newEndDate);
        this.validateTimeRange();
        // Clear preset since user manually changed time
        this.selectedPreset.set(null);
        return;
      }
      
      const now = new Date();
      
      // Ensure end date doesn't exceed current date/time
      const finalEndDate = newEndDate > now ? now : newEndDate;
      
      // Always adjust start date to maintain maxRangeDays difference
      const maxDurationMs = config.maxRangeDays * 24 * 60 * 60 * 1000; // Convert days to milliseconds
      const calculatedStartDate = new Date(finalEndDate.getTime() - maxDurationMs);
      
      // Ensure start date is not before minimum allowed date
      const minDate = new Date();
      minDate.setDate(minDate.getDate() - config.maxDaysBack);
      
      if (calculatedStartDate < minDate) {
        // If calculated start would be before minimum, adjust both dates
        // Set start to minimum, and adjust end to maintain maxRangeDays
        const adjustedStartDate = minDate;
        const recalculatedEndDate = new Date(adjustedStartDate.getTime() + maxDurationMs);
        // Ensure recalculated end doesn't exceed now
        const finalAdjustedEndDate = recalculatedEndDate > now ? now : recalculatedEndDate;
        
        this.startTime.set(adjustedStartDate);
        this.endTime.set(finalAdjustedEndDate);
      } else {
        // Normal case: calculated start is valid
        this.endTime.set(finalEndDate);
        this.startTime.set(calculatedStartDate);
      }
    } else {
      this.endTime.set(null);
    }
    // Clear preset since user manually changed time
    this.selectedPreset.set(null);
    this.validateTimeRange();
  }

  validateTimeRange(): void {
    this.timeRangeError.set(null);
    const start = this.startTime();
    const end = this.endTime();

    if (!start || !end) return;

    const config = this.kafkaConfig();
    if (!config) {
      // Config not loaded yet, skip validation
      return;
    }

    if (start > end) {
      this.timeRangeError.set('Start time must be before end time');
      return;
    }

    const maxDaysBack = config.maxDaysBack;
    const maxRangeDays = config.maxRangeDays;
    const now = new Date();

    if (start > now || end > now) {
      this.timeRangeError.set('Time range cannot be in the future');
      return;
    }

    const daysBack = (now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (daysBack > maxDaysBack) {
      this.timeRangeError.set(`Time range cannot go back more than ${maxDaysBack} days`);
      return;
    }

    const rangeDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (rangeDays > maxRangeDays) {
      this.timeRangeError.set(`Time range cannot exceed ${maxRangeDays} day(s)`);
      return;
    }
  }

  async loadInitialMessages(): Promise<void> {
    if (!this.canSearch()) return;

    // Cancel any active streaming search
    this.cancelStreamingSearch();

    // Reset quick key search (both UI and data)
    this.quickKeySearch.set('');
    this.streamingProgress.set(null);
    this.scannedPartitionIds.set([]);
    this.elapsedTime.set('0 ms');
    this.searchStartTime = null;

    // Clear search filters for initial load (load from earliest available offset)
    this.searchRequest = {
      topic: this.topicName,
      pageSize: this.pageSize(),
      pageNumber: 1,
      partition: undefined,
      key: undefined,
      value: undefined,
    };

    this.isLoading.set(true);
    this.timeRangeError.set(null);
    this.exactTotalCount.set(null);

    try {
      // Load messages without time range to get messages from earliest available offset
      const request: MessageSearchRequest = {
        topic: this.topicName,
        pageSize: this.pageSize(),
        pageNumber: 1,
      };

      const response = await this.kafkaService.searchMessages(request).toPromise();
      if (response) {
        this.searchResults.set(response);
        this.allLoadedMessages.set([...response.messages]);
        this.hasSearched.set(true);
        
        // Keep filters expanded initially, but scroll to table if there are results
        if (response.messages.length > 0) {
          setTimeout(() => {
            this.scrollToTable();
          }, 100);
        }
        
        // Automatically get exact count without filters on initial load
        this.getExactCount(false);
      }
    } catch (error: any) {
      console.error('Error loading initial messages:', error);
      // Don't set timeRangeError for initial load failures, just log
    } finally {
      this.isLoading.set(false);
    }
  }

  async searchMessages(): Promise<void> {
    if (!this.canSearch()) return;

    // Close any open message preview
    this.previewMessage.set(null);

    // Cancel any active streaming search
    this.cancelStreamingSearch();

    // Reset quick key search (both UI and data)
    this.quickKeySearch.set('');
    this.streamingProgress.set(null);
    this.scannedPartitionIds.set([]);
    this.elapsedTime.set('0 ms');
    this.searchStartTime = null;

    this.isLoading.set(true);
    this.timeRangeError.set(null);
    this.exactTotalCount.set(null);

    try {
      const request: MessageSearchRequest = {
        ...this.searchRequest,
        topic: this.topicName,
        pageSize: this.pageSize(),
      };

      if (this.startTime() && this.endTime()) {
        const config = this.kafkaConfig();
        request.timeRange = {
          startTime: this.startTime()!.toISOString(),
          endTime: this.endTime()!.toISOString(),
          maxRangeDays: config?.maxRangeDays ?? 7,
        };
      }

      const response = await this.kafkaService.searchMessages(request).toPromise();
      if (response) {
        this.searchResults.set(response);
        this.allLoadedMessages.set([...response.messages]);
        this.hasSearched.set(true);
        
        // Only minimize filter section if there are results
        if (response.messages.length > 0) {
          this.isFilterExpanded.set(false);
          
          // Scroll to table after a short delay to allow DOM update
          setTimeout(() => {
            this.scrollToTable();
          }, 100);
        }
        
        // Automatically get exact count with filters (user explicitly searched)
        this.getExactCount();
      }
    } catch (error: any) {
      console.error('Error searching messages:', error);
      this.timeRangeError.set(error?.error?.error || error?.message || 'Failed to search messages');
    } finally {
      this.isLoading.set(false);
    }
  }

  async loadMoreMessages(): Promise<void> {
    const currentResults = this.searchResults();
    if (!currentResults?.continuationToken || !currentResults.hasMore) return;
    
    this.isLoadingMore.set(true);
    
    try {
      const request: MessageSearchRequest = {
        ...this.searchRequest,
        topic: this.topicName,
        pageSize: this.pageSize(),
        continuationToken: currentResults.continuationToken,
      };
      
      if (this.startTime() && this.endTime()) {
        const config = this.kafkaConfig();
        request.timeRange = {
          startTime: this.startTime()!.toISOString(),
          endTime: this.endTime()!.toISOString(),
          maxRangeDays: config?.maxRangeDays ?? 7,
        };
      }
      
      const response = await this.kafkaService.searchMessages(request).toPromise();
      if (response) {
        const allMessages = [...this.allLoadedMessages(), ...response.messages];
        this.allLoadedMessages.set(allMessages);
        
        this.searchResults.set({
          ...response,
          messages: allMessages,
        });
      }
    } catch (error: any) {
      console.error('Error loading more messages:', error);
    } finally {
      this.isLoadingMore.set(false);
    }
  }

  private async refreshMessagesForContext(): Promise<void> {
    // Avoid interfering with active streaming/manual operations.
    if (this.isStreamingSearch() || this.isLoading() || this.isLoadingMore()) {
      return;
    }

    if (this.hasSearched()) {
      await this.searchMessages();
    } else {
      await this.loadInitialMessages();
    }
  }

  async getExactCount(includeFilters: boolean = true): Promise<void> {
    this.isCountLoading.set(true);
    
    try {
      const request: MessageSearchRequest = {
        topic: this.topicName,
        pageSize: 1, // Not used for count
        pageNumber: 1, // Not used for count
      };
      
      // Only include filters if explicitly requested
      if (includeFilters) {
        request.partition = this.searchRequest.partition;
        request.key = this.searchRequest.key;
        request.value = this.searchRequest.value;
        
        if (this.startTime() && this.endTime()) {
          const config = this.kafkaConfig();
          request.timeRange = {
            startTime: this.startTime()!.toISOString(),
            endTime: this.endTime()!.toISOString(),
            maxRangeDays: config?.maxRangeDays ?? 7,
          };
        }
      }
      
      const count = await this.kafkaService.getMessageCount(request).toPromise();
      this.exactTotalCount.set(count ?? null);
    } catch (error) {
      console.error('Error getting exact count:', error);
    } finally {
      this.isCountLoading.set(false);
    }
  }

  clearSearch(): void {
    this.searchRequest = {
      topic: this.topicName,
      pageSize: 500,
      pageNumber: 1,
    };
    // Reset to default 24 hour range
    this.startTime.set(this.getDefaultStartTime());
    this.endTime.set(this.getDefaultEndTime());
    this.selectedPreset.set('24h'); // Set to 24h preset
    this.searchResults.set(null);
    this.allLoadedMessages.set([]);
    this.hasSearched.set(false);
    this.timeRangeError.set(null);
    this.clientSearchQuery.set('');
    this.isFilterExpanded.set(true);
    this.exactTotalCount.set(null);
  }

  setTimePreset(hours: number, presetKey: string): void {
    const now = new Date();
    const config = this.kafkaConfig();
    const maxDaysBack = config?.maxDaysBack ?? 60;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - maxDaysBack);
    
    const from = new Date(now.getTime() - hours * 60 * 60 * 1000);
    
    // Ensure preset doesn't go beyond maxDaysBack
    const actualFrom = from < minDate ? minDate : from;
    
    this.startTime.set(actualFrom);
    this.endTime.set(now);
    this.selectedPreset.set(presetKey);
    this.validateTimeRange();
  }

  setTimePreset7Days(): void {
    const now = new Date();
    const config = this.kafkaConfig();
    const maxDaysBack = config?.maxDaysBack ?? 60;
    const maxRangeDays = config?.maxRangeDays ?? 7;
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - maxDaysBack);
    
    // Set range to 7 days - 1 second to respect maxRangeDays limit
    const maxDurationMs = (maxRangeDays * 24 * 60 * 60 * 1000) - 1000; // 7 days - 1 second
    const from = new Date(now.getTime() - maxDurationMs);
    
    // Ensure preset doesn't go beyond maxDaysBack
    const actualFrom = from < minDate ? minDate : from;
    
    // Recalculate end time if start was adjusted
    if (actualFrom !== from) {
      const recalculatedEndDate = new Date(actualFrom.getTime() + maxDurationMs);
      this.endTime.set(recalculatedEndDate > now ? now : recalculatedEndDate);
    } else {
      this.endTime.set(now);
    }
    
    this.startTime.set(actualFrom);
    this.selectedPreset.set('7d');
    this.validateTimeRange();
  }

  scrollToTable(): void {
    const tableElement = document.querySelector('.messages-table');
    if (tableElement) {
      tableElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // Selection methods
  getMessageKey(message: KafkaMessage): string {
    return `${message.partition}:${message.offset}`;
  }

  isRowSelected(message: KafkaMessage): boolean {
    return this.selectedMessages().has(this.getMessageKey(message));
  }

  toggleMessageSelection(message: KafkaMessage): void {
    const key = this.getMessageKey(message);
    const selected = new Set(this.selectedMessages());
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
    this.selectedMessages.set(selected);
  }

  isAllSelected(): boolean {
    const messages = this.sortedMessages();
    return messages.length > 0 && messages.every(m => this.isRowSelected(m));
  }

  isSomeSelected(): boolean {
    const messages = this.sortedMessages();
    return messages.some(m => this.isRowSelected(m)) && !this.isAllSelected();
  }

  toggleSelectAll(): void {
    const messages = this.sortedMessages();
    if (this.isAllSelected()) {
      // Deselect all
      this.selectedMessages.set(new Set());
    } else {
      // Select all
      const allKeys = messages.map(m => this.getMessageKey(m));
      this.selectedMessages.set(new Set(allKeys));
    }
  }

  clearSelection(): void {
    this.selectedMessages.set(new Set());
  }

  // Bulk requeue methods
  startBulkRequeue(): void {
    if (!this.isAdmin()) {
      return;
    }

    const messageCount = this.selectedMessages().size;
    const confirmed = window.confirm(
      `Are you sure you want to requeue ${messageCount} message${messageCount !== 1 ? 's' : ''}?\n\nThis action will resend the selected messages to the topic.`
    );
    
    if (!confirmed) {
      return;
    }

    const selected = Array.from(this.selectedMessages());
    const items: BulkRequeueItem[] = selected.map(key => {
      const [partition, offset] = key.split(':');
      const message = this.allLoadedMessages().find(m => 
        m.partition.toString() === partition && m.offset.toString() === offset
      );
      return {
        partition: parseInt(partition),
        offset: parseInt(offset),
        key: message?.key,
        messageValue: message?.value,
        status: 'pending' as const
      };
    });
    
    this.bulkRequeueItems.set(items);
    this.showRequeueProgress.set(true);
    this.processBulkRequeue();
  }

  async processBulkRequeue(): Promise<void> {
    const totalItems = this.bulkRequeueItems().length;
    
    for (let i = 0; i < totalItems; i++) {
      // Get fresh items from signal on each iteration
      const currentItems = this.bulkRequeueItems();
      const item = currentItems[i];
      
      if (item.status !== 'pending') continue;

      // Update status to processing
      const processingItems = [...currentItems];
      processingItems[i] = { ...item, status: 'processing' as const };
      this.bulkRequeueItems.set(processingItems);

      try {
        const request: RequeueRequest = {
          sourceTopic: this.topicName,
          targetTopic: this.topicName,
          messages: [{
            partition: item.partition,
            offset: item.offset,
            messageText: item.messageValue
          }],
          preserveHeaders: true,
          addRequeueMetadata: true
        };

        const response = await this.kafkaService.requeueMessages(request).toPromise();

        // Get fresh items again after API call
        const freshItems = [...this.bulkRequeueItems()];
        if (response && response.requeuedCount > 0) {
          freshItems[i] = { ...freshItems[i], status: 'success' as const };
        } else {
          freshItems[i] = { 
            ...freshItems[i], 
            status: 'error' as const,
            errorMessage: response?.errors?.[0] || 'Failed to requeue message'
          };
        }
        this.bulkRequeueItems.set(freshItems);
      } catch (error: any) {
        // Get fresh items after error
        const errorItems = [...this.bulkRequeueItems()];
        errorItems[i] = { 
          ...errorItems[i], 
          status: 'error' as const,
          errorMessage: error?.error?.error || 'An error occurred while requeuing'
        };
        this.bulkRequeueItems.set(errorItems);
      }
    }
  }

  async retryFailedMessage(item: BulkRequeueItem): Promise<void> {
    const items = this.bulkRequeueItems();
    const index = items.findIndex(i => i.partition === item.partition && i.offset === item.offset);
    
    if (index === -1) return;

    // Reset status to pending
    const updatedItems = [...items];
    updatedItems[index] = { ...item, status: 'pending' as const, errorMessage: undefined };
    this.bulkRequeueItems.set(updatedItems);

    // Process this single item
    await this.processBulkRequeue();
  }

  closeBulkRequeueProgress(): void {
    this.showRequeueProgress.set(false);
    this.clearSelection();
    // Optionally refresh the message list
  }

  getHeaders(headers: Record<string, string>): Array<{ key: string; value: string }> {
    return Object.entries(headers).map(([key, value]) => ({ key, value }));
  }

  getValuePreview(value: string): string {
    if (!value) return '';
    const maxLength = 100;
    return value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
  }

  formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  togglePreview(message: KafkaMessage): void {
    const currentPreview = this.previewMessage();
    const wasPreviewOpen = !!currentPreview;
    
    // If clicking the same message, close it
    if (currentPreview?.offset === message.offset && currentPreview?.partition === message.partition) {
      this.previewMessage.set(null);
    } else {
      // Show preview for the clicked message
      this.previewMessage.set(message);
      
      // Scroll preview into view and center table horizontally when preview opens
      setTimeout(() => {
        // Scroll the preview sidebar into view so it's fully visible
        const previewSidebar = document.querySelector('.message-preview-sidebar');
        if (previewSidebar) {
          previewSidebar.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        
        // Center table horizontally if needed (only when preview first opens)
        if (!wasPreviewOpen && this.messagesTableContainer) {
          const container = this.messagesTableContainer?.nativeElement;
          if (container) {
            const scrollWidth = container.scrollWidth;
            const clientWidth = container.clientWidth;
            const centerPosition = (scrollWidth - clientWidth) / 2;
            container.scrollLeft = centerPosition;
          }
        }
      }, 100);
    }
  }

  isMessageSelected(message: KafkaMessage): boolean {
    const preview = this.previewMessage();
    return preview?.offset === message.offset && preview?.partition === message.partition;
  }

  closePreview(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.previewMessage.set(null);
    this.isPreviewMaximized.set(false);
    this.isCopied.set(false);
    this.linkCopied.set(false);
  }

  togglePreviewMaximized(): void {
    this.isPreviewMaximized.update(v => !v);
  }

  /**
   * Get the base path from current location (e.g., "/dashboard" or "")
   * This preserves the base href when constructing URLs
   */
  private getBasePath(): string {
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    
    // Check if pathname starts with known base paths
    // In production, baseHref is "/dashboard/" so pathname will be "/dashboard/messages" etc.
    if (currentPath.startsWith('/dashboard/') || currentPath.startsWith('/dashboard')) {
      return '/dashboard';
    }
    
    // No base path (development mode or different deployment)
    return '';
  }

  openMessageInNewTab(): void {
    const message = this.previewMessage();
    if (!message) return;

    // Use window.location.pathname to get the full path including base href
    const basePath = this.getBasePath();
    const queryParams = new URLSearchParams({
      topic: this.topicName,
      partition: message.partition.toString(),
      offset: message.offset.toString()
    });
    
    const fullUrl = `${window.location.origin}${basePath}/messages/message-detail?${queryParams.toString()}`;
    window.open(fullUrl, '_blank');
  }

  async copyMessageLink(): Promise<void> {
    const message = this.previewMessage();
    if (!message) return;

    // Use window.location.pathname to get the full path including base href
    const basePath = this.getBasePath();
    const queryParams = new URLSearchParams({
      topic: this.topicName,
      partition: message.partition.toString(),
      offset: message.offset.toString()
    });
    
    const url = `${window.location.origin}${basePath}/messages/message-detail?${queryParams.toString()}`;
    
    try {
      await navigator.clipboard.writeText(url);
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  }

  @HostListener('document:keydown', ['$event'])
  onEscapeKey(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.previewMessage()) {
      if (this.isPreviewMaximized()) {
        this.isPreviewMaximized.set(false);
      } else {
        this.closePreview();
      }
      event.preventDefault();
    }
  }

  async copyMessageValue(value: string, event?: Event): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    try {
      await navigator.clipboard.writeText(value);
      this.isCopied.set(true);
      
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        this.isCopied.set(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy message:', error);
    }
  }
  
  async copyFormattedJson(obj: any, event?: Event): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    try {
      const formattedJson = this.formatJsonObject(obj);
      await navigator.clipboard.writeText(formattedJson);
      this.isCopied.set(true);
      
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        this.isCopied.set(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy formatted JSON:', error);
    }
  }
  
  async copyFormattedMessageValue(event?: Event): Promise<void> {
    if (event) {
      event.stopPropagation();
    }

    try {
      const message = this.previewMessage();
      if (!message) return;
      
      const formattedJson = this.formatJson(message.value);
      await navigator.clipboard.writeText(formattedJson);
      this.isCopied.set(true);
      
      // Reset the copied state after 2 seconds
      setTimeout(() => {
        this.isCopied.set(false);
      }, 2000);
    } catch (error) {
      console.error('Failed to copy formatted message:', error);
    }
  }

  isValidJson(value: string): boolean {
    if (!value) return false;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  formatJson(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }
  
  formatJsonObject(obj: any): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  // Tree view methods
  parseMessageToTree(value: string): any {
    try {
      const parsed = JSON.parse(value);
      return this.detectNestedJson(parsed);
    } catch {
      return { _raw: value, _type: 'text' };
    }
  }

  detectNestedJson(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      // Try to detect and parse escaped JSON
      try {
        // Check for escaped JSON patterns
        if ((obj.includes('\\u0022') || obj.includes('\\"') || obj.includes('{"')) && 
            (obj.startsWith('{') || obj.startsWith('['))) {
          const unescaped = obj
            .replace(/\\u0022/g, '"')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          const parsed = JSON.parse(unescaped);
          return {
            _value: obj,
            _parsed: this.detectNestedJson(parsed),
            _type: 'nested-json'
          };
        }
      } catch {}
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.detectNestedJson(item));
    }
    
    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.detectNestedJson(value);
      }
      return result;
    }
    
    return obj;
  }

  toggleNode(path: string): void {
    const expanded = this.expandedNodes();
    const newExpanded = new Set(expanded);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    this.expandedNodes.set(newExpanded);
  }

  isNodeExpanded(path: string): boolean {
    return this.expandedNodes().has(path);
  }

  getNodeType(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object' && value._type === 'nested-json') return 'nested-json';
    if (typeof value === 'object' && value._type === 'text') return 'text';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'unknown';
  }

  getNodeDisplay(value: any): string {
    const type = this.getNodeType(value);
    
    if (type === 'nested-json') {
      return 'Nested JSON (parsed)';
    }
    if (type === 'text') {
      return value._raw.substring(0, 100) + (value._raw.length > 100 ? '...' : '');
    }
    if (type === 'null') return 'null';
    if (type === 'undefined') return 'undefined';
    if (type === 'array') return `Array (${value.length} items)`;
    if (type === 'object') {
      const keys = Object.keys(value).filter(k => !k.startsWith('_'));
      return `Object (${keys.length} ${keys.length === 1 ? 'property' : 'properties'})`;
    }
    if (type === 'string') {
      const str = value.toString();
      return str.length > 50 ? `"${str.substring(0, 50)}..."` : `"${str}"`;
    }
    return value.toString();
  }

  getTreeEntries(obj: any): [string, any][] {
    if (this.getNodeType(obj) === 'nested-json') {
      return Object.entries(obj._parsed);
    }
    if (this.getNodeType(obj) === 'text') {
      return [];
    }
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return Object.entries(obj).filter(([key]) => !key.startsWith('_'));
    }
    if (Array.isArray(obj)) {
      return obj.map((item, index) => [index.toString(), item]);
    }
    return [];
  }

  matchesSearchFilter(key: string, value: any, query: string): boolean {
    if (!query) return true;
    
    const lowerQuery = query.toLowerCase();
    
    // Match key
    if (key.toLowerCase().includes(lowerQuery)) return true;
    
    // Match value
    if (typeof value === 'string' && value.toLowerCase().includes(lowerQuery)) return true;
    if (typeof value === 'number' && value.toString().includes(lowerQuery)) return true;
    
    return false;
  }

  copyField(value: any, field: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    
    let textToCopy = '';
    if (typeof value === 'object' && value !== null) {
      textToCopy = JSON.stringify(value, null, 2);
    } else {
      textToCopy = value?.toString() || '';
    }
    
    navigator.clipboard.writeText(textToCopy).then(() => {
      this.copiedField.set(field);
      setTimeout(() => {
        if (this.copiedField() === field) {
          this.copiedField.set(null);
        }
      }, 2000);
    });
  }

  setPreviewTab(tab: 'metadata' | 'message' | 'raw' | 'dynamic'): void {
    this.previewTab.set(tab);
    
    // Clear dynamic tab key if not on dynamic tab
    if (tab !== 'dynamic') {
      this.activeDynamicTabKey.set(null);
    }
    
    // Auto-expand root level on message tree view
    if (tab === 'message' && this.messageViewMode() === 'tree' && this.previewMessage()) {
      const expanded = new Set<string>();
      expanded.add('root');
      this.expandedNodes.set(expanded);
    }
  }
  
  setDynamicTab(key: string): void {
    this.previewTab.set('dynamic');
    this.activeDynamicTabKey.set(key);
    
    // Auto-expand root level on dynamic tab tree view
    if (this.payloadViewMode() === 'tree' && this.previewMessage()) {
      const expanded = new Set<string>();
      expanded.add(this.capitalizeFirstLetter(key));
      this.expandedNodes.set(expanded);
    }
  }
  
  getDynamicKeyValue(parsed: any, key: string): any {
    if (!parsed || typeof parsed !== 'object') return null;
    
    const lowerKey = key.toLowerCase();
    const capitalizedKey = lowerKey.charAt(0).toUpperCase() + lowerKey.slice(1);
    
    // Check both lowercase and capitalized versions
    if (capitalizedKey in parsed) {
      return parsed[capitalizedKey];
    }
    
    if (lowerKey in parsed) {
      return parsed[lowerKey];
    }
    
    return null;
  }
  
  capitalizeFirstLetter(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  getPayloadValue(parsed: any): any {
    if (!parsed || typeof parsed !== 'object') return null;
    
    // Check for 'Payload' (capitalized)
    if ('Payload' in parsed) {
      return parsed.Payload;
    }
    
    // Check for 'payload' (lowercase) as fallback
    if ('payload' in parsed) {
      return parsed.payload;
    }
    
    return null;
  }
  
  parsePayloadValue(payloadValue: any): any {
    // If it's already an object or array, return it
    if (typeof payloadValue === 'object' && payloadValue !== null) {
      return payloadValue;
    }
    
    // If it's a string, try to parse it as JSON
    if (typeof payloadValue === 'string') {
      try {
        return JSON.parse(payloadValue);
      } catch {
        return null; // Not valid JSON
      }
    }
    
    // For other types (number, boolean), return null to show raw view
    return null;
  }
  
  parseJson(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  
  renderTreeNode(value: any, basePath: string, depth: number, searchQuery: string): Array<{
    key: string;
    value: any;
    path: string;
    type: string;
    display: string;
    hasChildren: boolean;
    depth: number;
  }> {
    const result: Array<{
      key: string;
      value: any;
      path: string;
      type: string;
      display: string;
      hasChildren: boolean;
      depth: number;
    }> = [];
    
    const entries = this.getTreeEntries(value);
    
    for (const [key, val] of entries) {
      const path = `${basePath}.${key}`;
      const type = this.getNodeType(val);
      const hasChildren = (type === 'object' || type === 'array' || type === 'nested-json');
      
      // Apply search filter
      if (!this.matchesSearchFilter(key, val, searchQuery)) {
        continue;
      }
      
      result.push({
        key,
        value: val,
        path,
        type,
        display: this.getNodeDisplay(val),
        hasChildren,
        depth
      });
      
      // If expanded and has children, recursively add children
      if (hasChildren && this.isNodeExpanded(path)) {
        const children = this.renderTreeNode(val, path, depth + 1, searchQuery);
        result.push(...children);
      }
    }
    
    return result;
  }

  clearPreviewSearch(): void {
    this.previewSearch.set('');
  }
  
  setMessageViewMode(mode: 'json' | 'tree'): void {
    this.messageViewMode.set(mode);
    // Auto-expand root level when switching to tree view
    if (mode === 'tree' && this.previewMessage()) {
      const expanded = new Set<string>();
      expanded.add('root');
      this.expandedNodes.set(expanded);
    }
  }
  
  setPayloadViewMode(mode: 'json' | 'tree'): void {
    this.payloadViewMode.set(mode);
    // Auto-expand root level when switching to tree view
    if (mode === 'tree' && this.previewMessage()) {
      const expanded = new Set<string>();
      expanded.add('Payload');
      this.expandedNodes.set(expanded);
    }
  }
}



