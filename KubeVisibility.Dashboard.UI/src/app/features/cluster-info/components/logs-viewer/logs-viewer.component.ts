import { Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges, inject, signal, effect, Injector, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PodsService } from '../../../../core/services/api/pods.service';
import { ClustersService } from '../../../../core/services/api/clusters.service';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { ResourceInfo, PodInfo } from '../../../../core/models/cluster-info.models';

interface StructuredLogEntry {
  index: number;
  timestamp: Date | null;
  level: string;
  category: string;
  message: string;
  exception?: string;
  applicationName?: string;
  environment?: string;
  scope?: string;
  requestId?: string;
  traceId?: string;
  spanId?: string;
  logKey?: string;
  rawJson: string;
}

@Component({
  selector: 'app-logs-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (visible() && resource) {
      <div class="logs-modal" (click)="onBackdropClick($event)">
        <div class="modal-content" (click)="$event.stopPropagation()" [ngStyle]="modalStyle()">
          <div class="modal-header">
            <div class="modal-header-left">
              <h2>
                <i class="fas fa-file-alt"></i> Pod Logs - {{ resourceName() }}
              </h2>
              @if (currentTab() === 'structured' && parsedLogs().length > 0) {
                <div class="logs-stats-header">
                  Showing <strong>{{ filteredLogs().length }}</strong> of <strong>{{ parsedLogs().length }}</strong> JSON logs
                  @if (nonJsonCount() > 0) {
                    <span class="non-json-info">({{ nonJsonCount() }} non-JSON lines)</span>
                  }
                </div>
              }
              @if (actionMessage()) {
                <div class="logs-action-feedback" [class.error]="actionMessageType() === 'error'">
                  <i class="fas" [class.fa-check-circle]="actionMessageType() === 'success'" [class.fa-info-circle]="actionMessageType() === 'info'" [class.fa-exclamation-circle]="actionMessageType() === 'error'"></i>
                  {{ actionMessage() }}
                </div>
              }
            </div>
            <button (click)="close()" class="modal-close" title="Close logs viewer (Esc)" aria-label="Close logs viewer">&times;</button>
          </div>
          <div class="modal-body">
            <!-- Tab Navigation with Controls -->
            <div class="logs-tabs-header">
              <div class="logs-tabs">
                <button
                  class="logs-tab-btn"
                  [class.active]="currentTab() === 'raw'"
                  (click)="switchTab('raw')"
                >
                  <i class="fas fa-file-alt"></i> Raw Logs
                </button>
                <button
                  class="logs-tab-btn"
                  [class.active]="currentTab() === 'structured'"
                  (click)="switchTab('structured')"
                >
                  <i class="fas fa-table"></i> Structured Logs
                </button>
              </div>
              
              <div class="logs-tabs-right">
                <!-- Pod Selector -->
                @if (pods().length > 1) {
                  <div class="pod-selector-container-inline">
                    <label for="podSelector">Pod:</label>
                    <select id="podSelector" [value]="selectedPod()" (change)="onPodChange($event)" [disabled]="loading()">
                      @for (pod of pods(); track pod.name) {
                        <option [value]="pod.name">{{ pod.name }}</option>
                      }
                    </select>
                  </div>
                }
                
                <!-- Show dropdown -->
                <div class="logs-options-inline">
                  <label for="logLinesSelect">Show:</label>
                  <select id="logLinesSelect" [value]="tailLines()" (change)="onTailLinesChange($event)" [disabled]="loading()">
                    <option value="100">Last 100 lines</option>
                    <option value="500">Last 500 lines</option>
                    <option value="1000">Last 1000 lines</option>
                    <option value="5000">Last 5000 lines</option>
                    <option value="999999">All logs</option>
                  </select>
                  @if (loading()) {
                    <i class="fas fa-spinner fa-spin" style="margin-left: 8px; color: var(--theme-button-primary);"></i>
                  }
                </div>
              </div>
            </div>
            
            <!-- Raw Logs Tab Content -->
            @if (currentTab() === 'raw') {
              <div class="logs-tab-content active">
                <div class="logs-controls logs-controls-right">
                  <button class="btn-icon-logs" (click)="refreshLogs()" [disabled]="loading()" title="Refresh logs" aria-label="Refresh logs">
                    <i class="fas fa-sync-alt" [class.fa-spin]="loading()"></i>
                  </button>
                  <button class="btn-icon-logs" (click)="copyLogs()" [disabled]="!rawLogs()" title="Copy visible logs" aria-label="Copy visible logs">
                    <i class="fas fa-copy"></i>
                  </button>
                </div>
                
                <div class="logs-container">
                  @if (loading()) {
                    <div class="loading">Loading logs...</div>
                  } @else if (error()) {
                    <div class="error">{{ error() }}</div>
                  } @else if (rawLogs()) {
                    <pre id="logsContent">{{ rawLogs() }}</pre>
                  } @else {
                    <div class="loading no-content">
                      No logs available for this pod and line range. Try another pod or increase the line count.
                    </div>
                  }
                </div>
              </div>
            }
            
            <!-- Structured Logs Tab Content -->
            @if (currentTab() === 'structured') {
              <div class="logs-tab-content active">
                <!-- Progress Bar -->
                @if (isProcessing()) {
                  <div class="logs-progress-container">
                    <div class="logs-progress-bar-wrapper">
                      <div class="logs-progress-bar" [style.width.%]="progressPercent()"></div>
                    </div>
                    <div class="logs-progress-text">
                      Processing logs... {{ processedLines() }} of {{ totalLines() }} ({{ progressPercent() }}%)
                    </div>
                  </div>
                }
                
                <!-- Filter Toolbar -->
                <div class="structured-logs-toolbar">
                  <!-- Row 1: Search + Actions -->
                  <div class="filter-row-top">
                    <div class="filter-group filter-group-search">
                      <label>Search:</label>
                      <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input
                          type="text"
                          id="logsSearchBox"
                          placeholder="Search in message, category, exception, request ID, log key..."
                          [value]="searchQuery()"
                          (input)="onSearchChange($event)"
                        />
                        @if (searchQuery()) {
                          <button class="clear-search" (click)="clearSearch()">
                            <i class="fas fa-times"></i>
                          </button>
                        }
                      </div>
                    </div>
                    
                    <div class="structured-actions">
                      <button class="btn-icon-logs" (click)="refreshLogs()" [disabled]="loading()" title="Refresh logs" aria-label="Refresh logs">
                        <i class="fas fa-sync-alt" [class.fa-spin]="loading()"></i>
                      </button>
                      <button class="btn-icon-logs" (click)="copyLogs()" [disabled]="filteredLogs().length === 0" title="Copy filtered logs" aria-label="Copy filtered logs">
                        <i class="fas fa-copy"></i>
                      </button>
                      <button class="btn-icon-logs btn-icon-success" (click)="exportFilteredLogs()" [disabled]="filteredLogs().length === 0" title="Export filtered logs" aria-label="Export filtered logs">
                        <i class="fas fa-download"></i>
                      </button>
                    </div>
                  </div>
                  
                  <!-- Row 2: Filters -->
                  <div class="filter-row-bottom">
                    <div class="filter-group">
                      <label>Category:</label>
                      <select id="logsCategoryFilter" [value]="selectedCategory()" (change)="onCategoryChange($event)">
                        <option value="">All Categories</option>
                        @for (category of categories(); track category) {
                          <option [value]="category">{{ category }}</option>
                        }
                      </select>
                    </div>
                    
                    <div class="filter-group">
                      <label>Log Level:</label>
                      <select id="logsLevelFilter" [value]="selectedLevel()" (change)="onLevelChange($event)">
                        <option value="all">All Levels</option>
                        <option value="trace">Trace</option>
                        <option value="information">Information</option>
                        <option value="warning">Warning</option>
                        <option value="error">Error</option>
                      </select>
                    </div>
                    
                    <div class="filter-group">
                      <label>Time Range:</label>
                      <select id="logsTimeRangeFilter" [value]="selectedTimeRange()" (change)="onTimeRangeChange($event)">
                        <option value="0">All Time</option>
                        <option value="1">Last 1 minute</option>
                        <option value="3">Last 3 minutes</option>
                        <option value="15">Last 15 minutes</option>
                        <option value="30">Last 30 minutes</option>
                        <option value="60">Last 1 hour</option>
                        <option value="240">Last 4 hours</option>
                        <option value="720">Last 12 hours</option>
                        <option value="1440">Last 24 hours</option>
                        <option value="10080">Last 7 days</option>
                      </select>
                    </div>
                    
                    <div class="logs-stats">
                      Showing {{ filteredLogs().length }} of {{ parsedLogs().length }} logs
                    </div>
                    @if (hasActiveStructuredFilters()) {
                      <button class="btn-reset-filters" (click)="clearStructuredFilters()" title="Clear all structured filters">
                        Clear filters
                      </button>
                    }
                  </div>
                </div>
                
                <!-- Structured Logs Table -->
                <div class="structured-logs-container">
                  <div class="structured-logs-table-wrapper">
                    <table class="structured-logs-table">
                      <thead>
                        <tr>
                          <th class="sortable" (click)="sortLogs('timestamp')">
                            Timestamp
                            <i class="fas fa-sort" [class.fa-sort-up]="sortColumn() === 'timestamp' && sortAscending()" [class.fa-sort-down]="sortColumn() === 'timestamp' && !sortAscending()"></i>
                          </th>
                          <th class="sortable log-level-col" (click)="sortLogs('level')">
                            Level
                            <i class="fas fa-sort" [class.fa-sort-up]="sortColumn() === 'level' && sortAscending()" [class.fa-sort-down]="sortColumn() === 'level' && !sortAscending()"></i>
                          </th>
                          <th class="sortable category-col" (click)="sortLogs('category')">
                            Category
                            <i class="fas fa-sort" [class.fa-sort-up]="sortColumn() === 'category' && sortAscending()" [class.fa-sort-down]="sortColumn() === 'category' && !sortAscending()"></i>
                          </th>
                          <th class="log-key-col">Log Key</th>
                          <th class="sortable message-col" (click)="sortLogs('message')">
                            Message
                            <i class="fas fa-sort" [class.fa-sort-up]="sortColumn() === 'message' && sortAscending()" [class.fa-sort-down]="sortColumn() === 'message' && !sortAscending()"></i>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        @if (loading() && parsedLogs().length === 0) {
                          <tr>
                            <td colspan="5" class="loading-logs">Loading logs...</td>
                          </tr>
                        } @else if (parsedLogs().length === 0 && !loading()) {
                          <tr>
                            <td colspan="5" class="loading-logs">No JSON-formatted logs found. Use Raw Logs to inspect unstructured output.</td>
                          </tr>
                        } @else if (filteredLogs().length === 0) {
                          <tr>
                            <td colspan="5" class="loading-logs">No logs match the current filters. Clear filters or widen the time range.</td>
                          </tr>
                        } @else {
                          @for (log of filteredLogs(); track log.index) {
                            <tr [class.expanded]="expandedRows().has(log.index)" class="log-row">
                              <td class="timestamp-col">
                                {{ log.timestamp ? formatTimestamp(log.timestamp) : 'N/A' }}
                              </td>
                              <td class="log-level-col">
                                <span class="log-level-badge" [class.level-trace]="log.level === 'trace'" [class.level-information]="log.level === 'information'" [class.level-warning]="log.level === 'warning'" [class.level-error]="log.level === 'error'">
                                  {{ log.level }}
                                </span>
                              </td>
                              <td class="category-col">{{ log.category }}</td>
                              <td class="log-key-col">{{ log.logKey || 'N/A' }}</td>
                              <td class="message-col">
                                <div class="message-content">
                                  <span class="message-text">{{ getMessagePreview(log.message) }}</span>
                                  @if (log.message.length > messagePreviewLength) {
                                    <button type="button" class="btn-show-full-message" (click)="$event.stopPropagation(); toggleFullMessage(log.index)" title="Show full message">
                                      <i class="fas" [class.fa-expand-alt]="!fullMessageRows().has(log.index)" [class.fa-compress-alt]="fullMessageRows().has(log.index)"></i>
                                      {{ fullMessageRows().has(log.index) ? 'Hide' : 'Full message' }}
                                    </button>
                                  }
                                  @if (log.exception || log.requestId || log.traceId || log.logKey) {
                                    <button class="expand-btn" (click)="toggleDetails(log.index)">
                                      <i class="fas" [class.fa-chevron-down]="!expandedRows().has(log.index)" [class.fa-chevron-up]="expandedRows().has(log.index)"></i>
                                    </button>
                                  }
                                </div>
                                @if (fullMessageRows().has(log.index)) {
                                  <div class="log-full-message">{{ log.message }}</div>
                                }
                                @if (expandedRows().has(log.index)) {
                                  <div class="log-details">
                                    @if (log.exception) {
                                      <div class="detail-row">
                                        <strong>Exception:</strong>
                                        <pre>{{ log.exception }}</pre>
                                      </div>
                                    }
                                    @if (log.requestId) {
                                      <div class="detail-row">
                                        <strong>Request ID:</strong> {{ log.requestId }}
                                      </div>
                                    }
                                    @if (log.traceId) {
                                      <div class="detail-row">
                                        <strong>Trace ID:</strong> {{ log.traceId }}
                                      </div>
                                    }
                                    @if (log.spanId) {
                                      <div class="detail-row">
                                        <strong>Span ID:</strong> {{ log.spanId }}
                                      </div>
                                    }
                                    @if (log.applicationName) {
                                      <div class="detail-row">
                                        <strong>Application:</strong> {{ log.applicationName }}
                                      </div>
                                    }
                                    @if (log.environment) {
                                      <div class="detail-row">
                                        <strong>Environment:</strong> {{ log.environment }}
                                      </div>
                                    }
                                    @if (log.logKey) {
                                      <div class="detail-row">
                                        <strong>Log Key:</strong> {{ log.logKey }}
                                      </div>
                                    }
                                    <div class="detail-row">
                                      <strong>Raw JSON:</strong>
                                      <pre class="raw-json">{{ log.rawJson }}</pre>
                                    </div>
                                  </div>
                                }
                              </td>
                            </tr>
                          }
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            }
          </div>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .logs-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        height: calc(100vh*20);
        background: rgba(0, 0, 0, 0.5);
        z-index: var(--z-modal-backdrop, 1000000);
        pointer-events: auto;
      }
      .modal-content {
        background: var(--theme-bg-app);
        border-radius: 16px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        margin: 0;
        pointer-events: auto;
        border: 1px solid var(--theme-border-gray-light);
      }
      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        padding: 0.9rem 1.25rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
        color: white;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        border-radius: 16px 16px 0 0;
      }
      .modal-header-left {
        flex: 1;
      }
      .modal-header-left h2 {
        margin: 0 0 0.25rem 0;
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-header-weight);
        color: white;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        line-height: 1.2;
      }
      .logs-stats-header {
        font-size: var(--theme-font-body);
        color: rgba(255, 255, 255, 0.9);
        margin-top: 0.2rem;
      }
      .logs-action-feedback {
        margin-top: 0.3rem;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.24rem 0.58rem;
        border-radius: 999px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        background: rgba(16, 185, 129, 0.2);
        color: #e6fffa;
      }
      .logs-action-feedback.error {
        background: rgba(239, 68, 68, 0.25);
        color: #fee2e2;
      }
      .non-json-info {
        color: rgba(255, 255, 255, 0.7);
        margin-left: 8px;
      }
      .modal-close {
        background: none;
        border: none;
        font-size: var(--theme-font-page-title);
        cursor: pointer;
        color: rgba(255, 255, 255, 0.95);
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
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
      }
      .modal-body {
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        padding: 0;
        border-radius: 0 0 16px 16px;
        background: var(--theme-bg-app);
      }
      
      /* Tab Navigation */
      .logs-tabs-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: var(--theme-bg-app);
        border-bottom: 2px solid var(--theme-border-gray-light);
        padding: 0 1.25rem 0 0;
      }
      .logs-tabs {
        display: flex;
        gap: 4px;
        padding: 0 0 0 1.25rem;
      }
      .logs-tab-btn {
        padding: 12px 24px;
        background: transparent;
        border: none;
        border-bottom: 3px solid transparent;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        transition: all 0.2s;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .logs-tab-btn:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
      }
      .logs-tab-btn.active {
        color: var(--theme-button-primary);
        border-bottom-color: var(--theme-button-primary);
        background: var(--theme-bg-surface);
      }
      .logs-tabs-right {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 8px 0;
      }
      .pod-selector-container-inline {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .pod-selector-container-inline label {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        white-space: nowrap;
      }
      .pod-selector-container-inline select {
        padding: 6px 10px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        background: var(--theme-bg-surface);
        cursor: pointer;
        min-width: 200px;
      }
      .pod-selector-container-inline select:focus {
        outline: none;
        border-color: var(--theme-button-primary);
      }
      .pod-selector-container-inline select:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: #f5f5f5;
      }
      .logs-options-inline {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .logs-options-inline label {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        white-space: nowrap;
      }
      .logs-options-inline select {
        padding: 6px 10px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        background: var(--theme-bg-surface);
        cursor: pointer;
      }
      .logs-options-inline select:focus {
        outline: none;
        border-color: var(--theme-button-primary);
      }
      .logs-options-inline select:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: #f5f5f5;
      }
      
      /* Tab Content */
      .logs-tab-content {
        display: none;
        flex: 1;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        padding: 1.25rem;
      }
      .logs-tab-content.active {
        display: flex;
      }
      
      /* Raw Logs Controls */
      .logs-controls {
        display: flex;
        gap: 0.5rem;
        margin-bottom: 1rem;
        justify-content: flex-end;
      }
      .logs-controls-right {
        justify-content: flex-end;
      }
      .btn-icon-logs {
        padding: 8px 12px;
        border: 2px solid #ddd;
        background: var(--theme-bg-surface);
        border-radius: 6px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 6px;
        transition: all 0.2s;
      }
      .btn-icon-logs:hover:not(:disabled) {
        background: var(--theme-bg-app);
        border-color: var(--theme-button-primary);
      }
      .btn-icon-logs:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn-icon-success {
        color: #10b981;
        border-color: #10b981;
      }
      .btn-icon-success:hover:not(:disabled) {
        background: #10b981;
        color: white;
      }
      
      /* Raw Logs Container */
      .logs-container {
        flex: 1;
        overflow: auto;
        background: #1e1e1e;
        border-radius: 8px;
        padding: 1.5rem;
      }
      .logs-container pre {
        color: #d4d4d4;
        margin: 0;
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: var(--theme-font-body);
        line-height: 1.5;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
      .loading,
      .error {
        padding: 2rem;
        text-align: center;
        color: #d4d4d4;
      }
      .loading.no-content {
        color: var(--theme-text-gray);
      }
      .error {
        color: #ef4444;
      }
      
      /* Progress Bar */
      .logs-progress-container {
        background: var(--theme-bg-app);
        padding: 20px;
        border-radius: 8px;
        margin-bottom: 16px;
        border: 1px solid var(--theme-border-gray-light);
      }
      .logs-progress-bar-wrapper {
        width: 100%;
        height: 24px;
        background: var(--theme-border-gray-light);
        border-radius: 12px;
        overflow: hidden;
        margin-bottom: 8px;
      }
      .logs-progress-bar {
        height: 100%;
        background: linear-gradient(90deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 100%);
        transition: width 0.3s ease;
      }
      .logs-progress-text {
        text-align: center;
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }
      
      /* Structured Logs Toolbar */
      .structured-logs-toolbar {
        background: var(--theme-bg-app);
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 16px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .filter-row-top {
        display: flex;
        gap: 16px;
        align-items: center;
      }
      .filter-row-top > :last-child {
        margin-left: auto;
      }
      .filter-group-search {
        flex: 1;
      }
      .search-input-wrapper {
        position: relative;
        flex: 1;
      }
      .search-input-wrapper i.fa-search {
        position: absolute;
        left: 12px;
        top: 50%;
        transform: translateY(-50%);
        color: #999;
      }
      #logsSearchBox {
        width: 100%;
        padding: 8px 40px 8px 38px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: var(--theme-font-body);
      }
      #logsSearchBox:focus {
        outline: none;
        border-color: var(--theme-button-primary);
      }
      .clear-search {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        background: transparent;
        border: none;
        color: #999;
        cursor: pointer;
        padding: 4px 8px;
      }
      .clear-search:hover {
        color: var(--theme-text-gray);
      }
      .structured-actions {
        display: flex;
        gap: 6px;
        align-items: center;
      }
      .filter-row-bottom {
        display: flex;
        gap: 16px;
        align-items: center;
        flex-wrap: wrap;
      }
      .filter-row-bottom > :last-child {
        margin-left: auto;
      }
      .filter-group {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .filter-group label {
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        white-space: nowrap;
      }
      .filter-group select {
        padding: 6px 10px;
        border: 2px solid #ddd;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        background: var(--theme-bg-surface);
        cursor: pointer;
        min-width: 150px;
      }
      .filter-group select:focus {
        outline: none;
        border-color: var(--theme-button-primary);
      }
      .logs-stats {
        color: var(--theme-text-gray);
        font-size: var(--theme-font-body);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .btn-reset-filters {
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        border-radius: 6px;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        padding: 6px 10px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      .btn-reset-filters:hover {
        border-color: var(--theme-button-primary);
        color: var(--theme-button-primary);
      }
      
      /* Structured Logs Table */
      .structured-logs-container {
        max-height: 500px;
        overflow-y: auto;
        overflow-x: hidden;
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 8px;
        position: relative;
      }
      .structured-logs-table-wrapper {
        position: relative;
        overflow-x: hidden;
      }
      .structured-logs-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .structured-logs-table thead {
        position: sticky;
        top: 0;
        background: var(--theme-bg-app);
        z-index: var(--z-sticky, 10);
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }
      .structured-logs-table th {
        padding: 3px 7px;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
        border-bottom: 2px solid var(--theme-border-gray-light);
        white-space: nowrap;
        font-size: var(--theme-font-caption);
        line-height: 1.1;
      }
      .structured-logs-table th.sortable {
        cursor: pointer;
        user-select: none;
      }
      .structured-logs-table th.sortable:hover {
        background: var(--theme-bg-app);
      }
      .structured-logs-table th i {
        margin-left: 6px;
        color: #999;
      }
      .structured-logs-table tbody tr {
        border-bottom: 1px solid var(--theme-border-gray);
        transition: background 0.2s;
      }
      .structured-logs-table tbody tr:hover {
        background: var(--theme-bg-app);
      }
      .structured-logs-table tbody tr.expanded {
        background: var(--theme-bg-app);
      }
      .structured-logs-table td {
        padding: 3px 7px;
        vertical-align: top;
        overflow: hidden;
        font-size: var(--theme-font-caption);
        line-height: 1;
      }
      .timestamp-col {
        white-space: nowrap;
        width: 12%;
        min-width: 155px;
      }
      .log-level-col {
        width: 7%;
        min-width: 62px;
      }
      .category-col {
        width: 20%;
        min-width: 145px;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      .log-key-col {
        width: 12%;
        min-width: 90px;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: break-word;
      }
      .message-col {
        width: 49%;
        min-width: 260px;
        word-wrap: break-word;
        word-break: break-word;
        overflow-wrap: anywhere;
        white-space: normal;
      }
      .log-level-badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        text-transform: uppercase;
      }
      .log-level-badge.level-trace {
        background: var(--theme-bg-gray-light);
        color: var(--theme-text-gray);
      }
      .log-level-badge.level-information {
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-button-primary-hover);
      }
      .log-level-badge.level-warning {
        background: #fef3c7;
        color: #92400e;
      }
      .log-level-badge.level-error {
        background: #fee2e2;
        color: #991b1b;
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
      .message-text {
        flex: 1;
        min-width: 0;
        word-break: break-word;
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
        background: rgba(147, 41, 154, 0.08);
      }
      .log-full-message {
        margin-top: 8px;
        padding: 8px;
        border-radius: 6px;
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        white-space: pre-wrap;
        word-break: break-word;
        overflow-wrap: anywhere;
        line-height: 1.35;
      }
      .expand-btn {
        background: transparent;
        border: none;
        color: var(--theme-text-gray);
        cursor: pointer;
        padding: 4px;
        margin-left: auto;
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
      }
      .detail-row pre {
        margin: 0;
        padding: 8px;
        background: var(--theme-bg-app);
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        overflow-x: auto;
      }
      .raw-json {
        font-family: 'Consolas', 'Courier New', monospace;
        font-size: var(--theme-font-caption);
      }
      .loading-logs {
        text-align: center;
        padding: 2rem;
        color: var(--theme-text-gray);
      }
    `,
  ],
})
export class LogsViewerComponent implements OnInit, OnChanges, OnDestroy {
  @Input() namespace = '';
  @Input() resource: ResourceInfo | null = null;
  @Input() resourceType = '';
  @Input() podName?: string; // Optional initial pod name
  @Output() closed = new EventEmitter<void>();
  @Output() podChanged = new EventEmitter<string>();

  private podsService = inject(PodsService);
  private clustersService = inject(ClustersService);
  private stateService = inject(ClusterStateService);
  private viewportScaleService = inject(ViewportScaleService);
  private injector = inject(Injector);

  visible = signal(false);
  rawLogs = signal<string>('');
  loading = signal(false);
  error = signal<string>('');
  tailLines = signal(500);
  resourceName = signal('');
  currentTab = signal<'raw' | 'structured'>('raw');
  selectedPod = signal<string>('');
  pods = signal<PodInfo[]>([]);
  private loadingPods = false;
  private scrollPosition = signal({ top: 0, left: 0 });
  private scrollListener?: () => void;
  private resizeListener?: () => void;
  
  // Structured logs state
  parsedLogs = signal<StructuredLogEntry[]>([]);
  nonJsonCount = signal(0);
  isProcessing = signal(false);
  totalLines = signal(0);
  processedLines = signal(0);
  
  // Filter state
  searchQuery = signal('');
  selectedCategory = signal('');
  selectedLevel = signal('all');
  selectedTimeRange = signal(15);
  sortColumn = signal<'timestamp' | 'level' | 'category' | 'message'>('timestamp');
  sortAscending = signal(false);
  expandedRows = signal<Set<number>>(new Set());
  fullMessageRows = signal<Set<number>>(new Set());
  actionMessage = signal<string | null>(null);
  actionMessageType = signal<'success' | 'info' | 'error'>('info');
  private actionMessageTimer?: number;
  readonly messagePreviewLength = 220;
  
  categories = computed(() => {
    const cats = new Set<string>();
    this.parsedLogs().forEach(log => {
      if (log.category) cats.add(log.category);
    });
    return Array.from(cats).sort();
  });
  
  filteredLogs = computed(() => {
    let logs = [...this.parsedLogs()];
    
    // Apply search filter
    if (this.searchQuery()) {
      const query = this.searchQuery().toLowerCase();
      logs = logs.filter(log => 
        log.message?.toLowerCase().includes(query) ||
        log.category?.toLowerCase().includes(query) ||
        log.exception?.toLowerCase().includes(query) ||
        log.requestId?.toLowerCase().includes(query) ||
        log.traceId?.toLowerCase().includes(query) ||
        log.logKey?.toLowerCase().includes(query)
      );
    }
    
    // Apply category filter
    if (this.selectedCategory()) {
      logs = logs.filter(log => log.category === this.selectedCategory());
    }
    
    // Apply level filter
    if (this.selectedLevel() !== 'all') {
      logs = logs.filter(log => log.level === this.selectedLevel());
    }
    
    // Apply time range filter
    if (this.selectedTimeRange() > 0) {
      const cutoffTime = new Date(Date.now() - this.selectedTimeRange() * 60 * 1000);
      logs = logs.filter(log => {
        if (!log.timestamp) return false;
        return log.timestamp >= cutoffTime;
      });
    }
    
    // Apply sorting
    logs.sort((a, b) => {
      let aVal: any, bVal: any;
      switch (this.sortColumn()) {
        case 'timestamp':
          aVal = a.timestamp?.getTime() || 0;
          bVal = b.timestamp?.getTime() || 0;
          break;
        case 'level':
          aVal = a.level || '';
          bVal = b.level || '';
          break;
        case 'category':
          aVal = a.category || '';
          bVal = b.category || '';
          break;
        case 'message':
          aVal = a.message || '';
          bVal = b.message || '';
          break;
      }
      
      if (aVal < bVal) return this.sortAscending() ? -1 : 1;
      if (aVal > bVal) return this.sortAscending() ? 1 : -1;
      return 0;
    });
    
    return logs;
  });
  
  progressPercent = computed(() => {
    if (this.totalLines() === 0) return 0;
    return Math.round((this.processedLines() / this.totalLines()) * 100);
  });
  
  hasActiveStructuredFilters = computed(() =>
    this.searchQuery().trim().length > 0 ||
    this.selectedCategory().length > 0 ||
    this.selectedLevel() !== 'all' ||
    this.selectedTimeRange() !== 15
  );
  
  // Calculate modal position accounting for viewport scale
  modalStyle = computed(() => {
    if (typeof window === 'undefined' || !this.visible()) {
      return {};
    }
    
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight(); // Dynamic base height
    const baseWidth = this.viewportScaleService.baseWidth; // Base width from service
    const scrollPos = this.scrollPosition();
    
    // Calculate the actual visible area accounting for scroll
    // Scroll position is in actual pixels, but we need to convert to base coordinates
    const visibleTop = scrollPos.top / scale;
    const visibleHeight = viewportHeight / scale;
    const topSafeOffset = 120;
    
    // Center the modal vertically in the visible viewport
    // Position it at the center of the current viewport, accounting for scroll
    const minCenterY = visibleTop + topSafeOffset + 120;
    const centerY = Math.max(minCenterY, visibleTop + (visibleHeight / 2));
    
    // Center horizontally (always center of the base width)
    const centerX = baseWidth / 2;
    
    // Calculate the transform to center the modal
    // The backdrop covers the full viewport container, modal content is centered within it
    return {
      position: 'absolute' as const,
      top: `${centerY}px`,
      left: `${centerX}px`,
      transform: 'translate(-50%, -50%)',
      width: '90%',
      maxWidth: '1600px',
      maxHeight: `${Math.min(90 * baseHeight / 100, Math.max(320, visibleHeight - topSafeOffset - 24))}px`,
    };
  });

  constructor() {
    effect(() => {
      if (this.resource && this.namespace) {
        this.resourceName.set(this.resource.name);
        // Fetch pods for the resource when opening logs
        this.loadPodsForResource();
        if (!this.visible()) {
          this.visible.set(true);
          // Register refresh callback when logs viewer opens
          this.registerAutoRefresh();
          // Set up scroll tracking for modal positioning
          this.setupScrollTracking();
        }
      }
    }, { injector: this.injector });
    
    // Track visibility changes to set up/tear down scroll tracking
    effect(() => {
      if (this.visible()) {
        this.setupScrollTracking();
        this.updateScrollPosition();
      } else {
        this.cleanupScrollTracking();
      }
    }, { injector: this.injector });
  }
  
  private updateScrollPosition(): void {
    if (typeof window === 'undefined') {
      return;
    }
    
    // Get the scrollable container (app-root :host element)
    const viewportContainer = document.querySelector('.viewport-container') as HTMLElement;
    if (!viewportContainer) {
      return;
    }
    
    // The scroll happens on the app-root element (which is the :host)
    const scrollContainer = viewportContainer.closest('app-root') || 
                           document.querySelector('app-root') ||
                           document.documentElement;
    
    const scrollTop = scrollContainer.scrollTop || window.scrollY || 0;
    const scrollLeft = scrollContainer.scrollLeft || window.scrollX || 0;
    
    this.scrollPosition.set({ top: scrollTop, left: scrollLeft });
  }
  
  private setupScrollTracking(): void {
    if (typeof window === 'undefined' || this.scrollListener) {
      return;
    }
    
    this.updateScrollPosition();
    
    this.scrollListener = () => {
      this.updateScrollPosition();
    };
    
    this.resizeListener = () => {
      this.updateScrollPosition();
    };
    
    // Listen to scroll on the app-root element and window
    const viewportContainer = document.querySelector('.viewport-container');
    const scrollContainer = viewportContainer?.closest('app-root') || window;
    
    scrollContainer.addEventListener('scroll', this.scrollListener, true);
    window.addEventListener('resize', this.resizeListener);
    window.addEventListener('scroll', this.scrollListener, true);
  }
  
  private cleanupScrollTracking(): void {
    if (this.scrollListener) {
      const viewportContainer = document.querySelector('.viewport-container');
      const scrollContainer = viewportContainer?.closest('app-root') || window;
      
      scrollContainer.removeEventListener('scroll', this.scrollListener, true);
      window.removeEventListener('scroll', this.scrollListener, true);
      this.scrollListener = undefined;
    }
    
    if (this.resizeListener) {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = undefined;
    }
  }

  ngOnInit(): void {
    if (this.resource) {
      this.resourceName.set(this.resource.name);
      if (this.namespace && this.resource) {
        this.visible.set(true);
        this.loadPodsForResource();
        // Register refresh callback when logs viewer opens
        this.registerAutoRefresh();
      }
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['resource'] && this.resource && this.namespace) {
      this.resourceName.set(this.resource.name);
      if (!this.visible()) {
        this.visible.set(true);
        // Register refresh callback when logs viewer opens
        this.registerAutoRefresh();
      }
      this.loadPodsForResource();
    }
    // If podName input changes, update selected pod
    if (changes['podName'] && this.podName && this.pods().length > 0) {
      const podExists = this.pods().find(p => p.name === this.podName);
      if (podExists) {
        this.selectedPod.set(this.podName);
        this.refreshLogs();
      }
    }
  }

  ngOnDestroy(): void {
    // Unregister refresh callback when component is destroyed
    this.unregisterAutoRefresh();
    // Clean up scroll tracking
    this.cleanupScrollTracking();
    this.clearActionMessageTimer();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.visible()) {
      this.close();
    }
  }

  open(namespace: string, resource: ResourceInfo, resourceType: string): void {
    this.namespace = namespace;
    this.resource = resource;
    this.resourceType = resourceType;
    this.resourceName.set(resource.name);
    this.visible.set(true);
    this.error.set('');
    this.rawLogs.set('');
    this.loadPodsForResource();
    // Register refresh callback when logs viewer opens
    this.registerAutoRefresh();
    // Set up scroll tracking for modal positioning
    this.setupScrollTracking();
  }

  async loadPodsForResource(): Promise<void> {
    if (!this.resource || !this.namespace || !this.resourceType) {
      return;
    }

    // Prevent concurrent calls
    if (this.loadingPods) {
      return;
    }

    this.loadingPods = true;
    try {
      // Fetch pods for the resource
      const podsList = await this.clustersService
        .getPodsForResource(
          this.namespace,
          this.resource.metadataName,
          this.resourceType
        )
        .toPromise();

      if (podsList && podsList.length > 0) {
        this.pods.set(podsList);
        // Set selected pod: use provided podName if it exists in the list, otherwise use first one
        if (this.podName && podsList.find(p => p.name === this.podName)) {
          this.selectedPod.set(this.podName);
        } else if (!this.selectedPod() || !podsList.find(p => p.name === this.selectedPod())) {
          this.selectedPod.set(podsList[0].name);
        }
      } else {
        this.pods.set([]);
        this.selectedPod.set('');
      }

      // Fetch logs for the selected pod
      await this.refreshLogs();
    } catch (error) {
      console.error('Error loading pods:', error);
      // If pods fetch fails, still try to fetch logs without pod name
      this.pods.set([]);
      this.selectedPod.set('');
      await this.refreshLogs();
    } finally {
      this.loadingPods = false;
    }
  }

  close(): void {
    this.visible.set(false);
    this.rawLogs.set('');
    this.parsedLogs.set([]);
    this.error.set('');
    this.expandedRows.set(new Set());
    this.fullMessageRows.set(new Set());
    this.actionMessage.set(null);
    this.clearActionMessageTimer();
    // Unregister refresh callback when logs viewer closes
    this.unregisterAutoRefresh();
    // Notify parent component to clear the resource
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    // Close modal when clicking on the backdrop (not on the modal content)
    if (event.target === event.currentTarget) {
      this.close();
    }
  }

  /**
   * Register this component's refresh callback with the state service
   * This allows auto-refresh to refresh logs when the modal is open
   */
  private registerAutoRefresh(): void {
    // Disabled auto-refresh for logs viewer - users can use the refresh button instead
    // This prevents flickering and unnecessary API calls for large log files
    // this.stateService.registerRefreshCallback('logs-viewer', async () => {
    //   // Only refresh if the modal is actually visible
    //   if (this.visible() && this.resource && this.namespace) {
    //     // Use loadPodsForResource to ensure pods are loaded before fetching logs
    //     await this.loadPodsForResource();
    //   }
    // });
  }

  /**
   * Unregister this component's refresh callback
   */
  private unregisterAutoRefresh(): void {
    this.stateService.unregisterRefreshCallback('logs-viewer');
  }

  switchTab(tab: 'raw' | 'structured'): void {
    this.currentTab.set(tab);
    if (tab === 'structured' && this.parsedLogs().length === 0 && this.rawLogs()) {
      this.parseStructuredLogs();
    }
  }

  async onPodChange(event: Event): Promise<void> {
    const podName = (event.target as HTMLSelectElement).value;
    this.selectedPod.set(podName);
    // Notify parent to update URL
    this.podChanged.emit(podName);
    // Show loading state and refresh logs
    await this.refreshLogs();
  }

  async onTailLinesChange(event: Event): Promise<void> {
    const value = parseInt((event.target as HTMLSelectElement).value, 10);
    this.tailLines.set(value);
    // Show loading state and refresh logs
    await this.refreshLogs();
  }

  onSearchChange(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    this.searchQuery.set(query);
  }

  clearSearch(): void {
    this.searchQuery.set('');
  }

  clearStructuredFilters(): void {
    this.searchQuery.set('');
    this.selectedCategory.set('');
    this.selectedLevel.set('all');
    this.selectedTimeRange.set(15);
    this.showActionMessage('Structured filters cleared.', 'info');
  }

  onCategoryChange(event: Event): void {
    const category = (event.target as HTMLSelectElement).value;
    this.selectedCategory.set(category);
  }

  onLevelChange(event: Event): void {
    const level = (event.target as HTMLSelectElement).value;
    this.selectedLevel.set(level);
  }

  onTimeRangeChange(event: Event): void {
    const minutes = parseInt((event.target as HTMLSelectElement).value, 10);
    this.selectedTimeRange.set(minutes);
  }

  sortLogs(column: 'timestamp' | 'level' | 'category' | 'message'): void {
    if (this.sortColumn() === column) {
      this.sortAscending.set(!this.sortAscending());
    } else {
      this.sortColumn.set(column);
      this.sortAscending.set(false);
    }
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

  toggleFullMessage(index: number): void {
    const expanded = new Set(this.fullMessageRows());
    if (expanded.has(index)) {
      expanded.delete(index);
    } else {
      expanded.add(index);
    }
    this.fullMessageRows.set(expanded);
  }

  async refreshLogs(): Promise<void> {
    if (!this.resource || !this.namespace) {
      this.error.set('Missing resource or namespace information');
      return;
    }

    // Prevent concurrent refresh calls
    if (this.loading()) {
      return;
    }

    this.loading.set(true);
    this.error.set('');
    // Don't clear logs immediately to prevent flickering - only clear when new data arrives or on error
    const previousLogs = this.rawLogs();

    try {
      const podName = this.selectedPod() || undefined;
      const response = await this.podsService
        .getPodLogs(
          this.namespace,
          this.resource.metadataName,
          this.resourceType,
          this.tailLines(),
          podName
        )
        .toPromise();
      if (response) {
        // Update logs atomically - this prevents flickering
        this.rawLogs.set(response.logs);
        this.fullMessageRows.set(new Set());
        // If structured tab is active, parse logs
        if (this.currentTab() === 'structured') {
          await this.parseStructuredLogs();
        }
        this.showActionMessage('Logs refreshed.', 'success');
      } else {
        this.error.set('No logs received from server');
        // Only clear on error
        if (!previousLogs) {
          this.rawLogs.set('');
        }
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load logs');
      // Only clear on error if we don't have previous logs
      if (!previousLogs) {
        this.rawLogs.set('');
      }
    } finally {
      this.loading.set(false);
    }
  }

  async parseStructuredLogs(): Promise<void> {
    const rawLogsText = this.rawLogs();
    if (!rawLogsText) return;

    this.isProcessing.set(true);
    this.parsedLogs.set([]);
    this.nonJsonCount.set(0);
    
    const lines = rawLogsText.split('\n').filter(line => line.trim());
    this.totalLines.set(lines.length);
    this.processedLines.set(0);
    
    const parsed: StructuredLogEntry[] = [];
    const categories = new Set<string>();
    let jsonCount = 0;
    let nonJsonCount = 0;
    
    // Process in chunks for better UX
    const chunkSize = 100;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunk = lines.slice(i, Math.min(i + chunkSize, lines.length));
      
      chunk.forEach((line, offset) => {
        const index = i + offset;
        try {
          const logEntry = JSON.parse(line);
          
          let logLevel = logEntry.LogLevel || logEntry.Level || logEntry.level || 'Information';
          logLevel = String(logLevel).toLowerCase();
          
          const timestamp = logEntry.Timestamp ? new Date(logEntry.Timestamp) : null;
          const category = logEntry.Category || 'Unknown';
          
          categories.add(category);
          
          parsed.push({
            index,
            timestamp,
            level: logLevel,
            category,
            message: logEntry.Message || '',
            exception: logEntry.Exception,
            applicationName: logEntry.ApplicationName,
            environment: logEntry.Environment,
            scope: logEntry.Scope,
            requestId: logEntry.RequestId || logEntry.RequestID,
            traceId: logEntry.TraceId || logEntry.TraceID,
            spanId: logEntry.SpanId || logEntry.SpanID,
            logKey: logEntry.log_key || logEntry.logKey || logEntry.LogKey,
            rawJson: line,
          });
          
          jsonCount++;
        } catch {
          nonJsonCount++;
        }
      });
      
      this.processedLines.set(Math.min(i + chunkSize, lines.length));
      
      // Yield to browser
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    
    this.parsedLogs.set(parsed);
    this.nonJsonCount.set(nonJsonCount);
    this.isProcessing.set(false);
  }

  copyLogs(): void {
    const textToCopy = this.currentTab() === 'raw'
      ? this.rawLogs()
      : this.filteredLogs().map(log => log.rawJson).join('\n');
    if (!textToCopy) {
      this.showActionMessage('Nothing to copy.', 'info');
      return;
    }
    navigator.clipboard.writeText(textToCopy)
      .then(() => this.showActionMessage('Logs copied to clipboard.', 'success'))
      .catch(() => this.showActionMessage('Copy failed. Please try again.', 'error'));
  }

  exportFilteredLogs(): void {
    const filteredLogs = this.filteredLogs();
    if (filteredLogs.length === 0) {
      this.showActionMessage('No logs to export.', 'info');
      return;
    }

    // Format as CSV-like structured text (matching backend format)
    const header = 'Timestamp\tLog Level\tCategory\tLog Key\tMessage\tException\tRequest ID\n';
    const separator = '='.repeat(150) + '\n';

    const dataStr = filteredLogs.map(log => {
      const timestamp = log.timestamp ? log.timestamp.toISOString() : 'N/A';
      const level = log.level.toUpperCase();
      const category = log.category || 'N/A';
      const logKey = log.logKey || 'N/A';
      const message = log.message || '';
      const exception = log.exception ? `\n    Exception: ${log.exception}` : '';
      const requestId = log.requestId ? `\n    Request ID: ${log.requestId}` : '';

      // Format as readable text (matching backend format)
      return `${timestamp}\t${level}\t${category}\t${logKey}\t${message}${exception}${requestId}`;
    }).join('\n' + separator);

    const fullContent = header + separator + dataStr;

    const blob = new Blob([fullContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

    // Include filter info in filename (matching backend format)
    const levelFilter = this.selectedLevel() !== 'all' ? `-${this.selectedLevel()}` : '';
    const timeFilter = this.selectedTimeRange() > 0 ? `-${this.selectedTimeRange()}min` : '';
    a.download = `structured-logs${levelFilter}${timeFilter}-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      this.showActionMessage(`Exported ${filteredLogs.length} log lines.`, 'success');
  }

  private showActionMessage(message: string, type: 'success' | 'info' | 'error'): void {
    this.actionMessage.set(message);
    this.actionMessageType.set(type);
    this.clearActionMessageTimer();
    this.actionMessageTimer = window.setTimeout(() => {
      this.actionMessage.set(null);
      this.actionMessageTimer = undefined;
    }, 2200);
  }

  private clearActionMessageTimer(): void {
    if (this.actionMessageTimer) {
      window.clearTimeout(this.actionMessageTimer);
      this.actionMessageTimer = undefined;
    }
  }

  formatTimestamp(timestamp: Date): string {
    if (!timestamp) return 'N/A';
    try {
      const year = timestamp.getFullYear();
      const month = String(timestamp.getMonth() + 1).padStart(2, '0');
      const day = String(timestamp.getDate()).padStart(2, '0');
      const hours = String(timestamp.getHours()).padStart(2, '0');
      const minutes = String(timestamp.getMinutes()).padStart(2, '0');
      const seconds = String(timestamp.getSeconds()).padStart(2, '0');
      const milliseconds = String(timestamp.getMilliseconds()).padStart(3, '0');
      return `${month}/${day}/${year}, ${hours}:${minutes}:${seconds}.${milliseconds}`;
    } catch {
      return 'N/A';
    }
  }

  getMessagePreview(message?: string): string {
    if (!message) return '';
    return message.length > this.messagePreviewLength
      ? `${message.slice(0, this.messagePreviewLength)}...`
      : message;
  }
}
