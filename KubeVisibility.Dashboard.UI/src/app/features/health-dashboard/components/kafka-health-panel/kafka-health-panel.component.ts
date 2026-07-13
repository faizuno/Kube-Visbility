import { Component, computed, inject, signal, effect, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { EchartsWrapperComponent } from '../../../../shared/components/echarts-wrapper/echarts-wrapper.component';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';
import { TopicErrorsModalComponent } from '../topic-errors-modal/topic-errors-modal.component';
import { HealthStateService } from '../../services/health-state.service';
import { HealthApiService } from '../../services/health-api.service';
import { KafkaService } from '../../../../core/services/api/kafka.service';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { ElasticsearchService, TopicErrorEntry } from '../../../../core/services/api/elasticsearch.service';
import type { EChartsOption } from 'echarts';
import { TopicHealthSummaryResponse, ConsumerLagSummaryResponse, TopicHealth, ConsumerGroupHealth, BrokerHealth, ControllerHealth } from '../../models/health.models';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { TopicInfo, ConsumerGroupTopicAssociationsResponse, TopicPartitionsResponse } from '../../../../core/models/kafka.models';

@Component({
  selector: 'app-kafka-health-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, EchartsWrapperComponent, LoadingSkeletonComponent, TopicErrorsModalComponent],
  template: `
    <div class="kafka-health-panel">
      <div class="panel-content">
        <div class="section-toolbar">
          <button type="button" class="btn-view-metrics" (click)="openTopicMetricsModal()">
            <i class="fas fa-chart-line"></i>
            <span>View Topics Health</span>
          </button>
        </div>

        <!-- Kafka Nodes (Controllers and Brokers) -->
        <div class="section">
          @if (isLoading()) {
            <div class="broker-grid broker-grid-skeleton">
              @for (card of [1, 2, 3, 4, 5, 6]; track card) {
                <div class="broker-card skeleton-card">
                  <div class="broker-header">
                    <span class="node-skeleton-bar node-skeleton-title"></span>
                    <span class="node-skeleton-dot"></span>
                  </div>
                  <div class="broker-details">
                    <div class="detail-row">
                      <span class="node-skeleton-bar node-skeleton-host"></span>
                    </div>
                    <div class="detail-row">
                      <span class="label node-skeleton-bar node-skeleton-label"></span>
                      <span class="value node-skeleton-bar node-skeleton-value"></span>
                    </div>
                    <div class="detail-row">
                      <span class="label node-skeleton-bar node-skeleton-label"></span>
                      <span class="value node-skeleton-bar node-skeleton-value"></span>
                    </div>
                    <div class="broker-resources">
                      <div class="resource-metric">
                        <div class="resource-label">
                          <span class="node-skeleton-bar node-skeleton-metric"></span>
                        </div>
                        <div class="resource-bar">
                          <div class="node-skeleton-fill"></div>
                        </div>
                      </div>
                      <div class="resource-metric">
                        <div class="resource-label">
                          <span class="node-skeleton-bar node-skeleton-metric"></span>
                        </div>
                        <div class="resource-bar">
                          <div class="node-skeleton-fill node-skeleton-fill-memory"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          } @else if (healthState.kafkaHealth(); as kafka) {
            @if (allNodes(); as nodes) {
              @if (nodes.length > 0) {
                <div class="broker-grid">
                  @for (node of nodes; track node.id) {
                    @if (node.type === 'controller') {
                      <div class="broker-card controller-card" [class.offline]="!node.isOnline" [class.active-controller]="node.isActive">
                        <div class="broker-header">
                          <span class="broker-id">
                            Controller {{ node.id }}
                            @if (node.isActive) {
                              <span class="active-badge">Active</span>
                            }
                          </span>
                          <span class="status-indicator" [class.online]="node.isOnline"></span>
                        </div>
                        <div class="broker-details">
                          <div class="detail-row">
                            <span>{{ node.host }}:{{ node.port }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="label">Status:</span>
                            <span class="value">{{ node.isActive ? 'Active' : 'Standby' }}</span>
                          </div>
    
                          <!-- Resource Utilization -->
                          @if (node.cpuUsage || node.memoryUsage) {
                            <div class="broker-resources">
                              @if (node.cpuUsage) {
                                <div class="resource-metric">
                                  <div class="resource-label">
                                    <i class="fas fa-microchip"></i>
                                    CPU: {{ node.cpuUsage || 'N/A' }}
                                    @if (node.cpuLimit) {
                                      <span> / {{ node.cpuLimit }}</span>
                                    }
                                    @if (node.cpuUsagePercent !== null && node.cpuUsagePercent !== undefined) {
                                      <span class="resource-percent">
                                        ({{ node.cpuUsagePercent.toFixed(1) }}%)
                                      </span>
                                    }
                                  </div>
                                  @if (node.cpuUsagePercent !== null && node.cpuUsagePercent !== undefined) {
                                    <div class="resource-bar">
                                      <div class="resource-fill"
                                        [style.width]="node.cpuUsagePercent + '%'"
                                        [class.critical]="node.cpuUsagePercent > 90"
                                        [class.warning]="node.cpuUsagePercent > 70 && node.cpuUsagePercent <= 90">
                                      </div>
                                    </div>
                                  }
                                </div>
                              }
                              @if (node.memoryUsage) {
                                <div class="resource-metric">
                                  <div class="resource-label">
                                    <i class="fas fa-memory"></i>
                                    Memory: {{ node.memoryUsage || 'N/A' }}
                                    @if (node.memoryLimit) {
                                      <span> / {{ node.memoryLimit }}</span>
                                    }
                                    @if (node.memoryUsagePercent !== null && node.memoryUsagePercent !== undefined) {
                                      <span class="resource-percent">
                                        ({{ node.memoryUsagePercent.toFixed(1) }}%)
                                      </span>
                                    }
                                  </div>
                                  @if (node.memoryUsagePercent !== null && node.memoryUsagePercent !== undefined) {
                                    <div class="resource-bar">
                                      <div class="resource-fill"
                                        [style.width.%]="node.memoryUsagePercent"
                                        [class.critical]="node.memoryUsagePercent > 90"
                                        [class.warning]="node.memoryUsagePercent > 70 && node.memoryUsagePercent <= 90">
                                      </div>
                                    </div>
                                  }
                                </div>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    } @else {
                      <div class="broker-card" [class.offline]="!node.isOnline">
                        <div class="broker-header">
                          <span class="broker-id">Broker {{ node.id }}</span>
                          <span class="status-indicator" [class.online]="node.isOnline"></span>
                        </div>
                        <div class="broker-details">
                          @if (!node.isOnline) {
                            <div class="offline-banner">
                              <i class="fas fa-exclamation-circle"></i>
                              <span>Offline</span>
                            </div>
                          }
                          <div class="detail-row">
                            <span>{{ node.host === 'Unknown' ? 'Not available' : node.host }}:{{ node.port || 'N/A' }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="label">Partitions:</span>
                            <span class="value">{{ node.partitionCount ?? 0 }}</span>
                          </div>
                          <div class="detail-row">
                            <span class="label">Leader:</span>
                            <span class="value">{{ node.leaderPartitionCount ?? 0 }}</span>
                          </div>
    
                          <!-- Resource Utilization -->
                          @if (node.cpuUsage || node.memoryUsage) {
                            <div class="broker-resources">
                              @if (node.cpuUsage) {
                                <div class="resource-metric">
                                  <div class="resource-label">
                                    <i class="fas fa-microchip"></i>
                                    CPU: {{ node.cpuUsage || 'N/A' }}
                                    @if (node.cpuLimit) {
                                      <span> / {{ node.cpuLimit }}</span>
                                    }
                                    @if (node.cpuUsagePercent !== null && node.cpuUsagePercent !== undefined) {
                                      <span class="resource-percent">
                                        ({{ node.cpuUsagePercent.toFixed(1) }}%)
                                      </span>
                                    }
                                  </div>
                                  @if (node.cpuUsagePercent !== null && node.cpuUsagePercent !== undefined) {
                                    <div class="resource-bar">
                                      <div class="resource-fill"
                                        [style.width]="node.cpuUsagePercent + '%'"
                                        [class.critical]="node.cpuUsagePercent > 90"
                                        [class.warning]="node.cpuUsagePercent > 70 && node.cpuUsagePercent <= 90">
                                      </div>
                                    </div>
                                  }
                                </div>
                              }
                              @if (node.memoryUsage) {
                                <div class="resource-metric">
                                  <div class="resource-label">
                                    <i class="fas fa-memory"></i>
                                    Memory: {{ node.memoryUsage || 'N/A' }}
                                    @if (node.memoryLimit) {
                                      <span> / {{ node.memoryLimit }}</span>
                                    }
                                    @if (node.memoryUsagePercent !== null && node.memoryUsagePercent !== undefined) {
                                      <span class="resource-percent">
                                        ({{ node.memoryUsagePercent.toFixed(1) }}%)
                                      </span>
                                    }
                                  </div>
                                  @if (node.memoryUsagePercent !== null && node.memoryUsagePercent !== undefined) {
                                    <div class="resource-bar">
                                      <div class="resource-fill"
                                        [style.width.%]="node.memoryUsagePercent"
                                        [class.critical]="node.memoryUsagePercent > 90"
                                        [class.warning]="node.memoryUsagePercent > 70 && node.memoryUsagePercent <= 90">
                                      </div>
                                    </div>
                                  }
                                </div>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    }
                  }
                </div>
              } @else {
                <div class="empty-state">No node data available</div>
              }
            }
          } @else {
            <div class="empty-state">No node data available</div>
          }
        </div>

      </div>

      @if (showTopicMetricsModal()) {
        <div class="metrics-modal-overlay" (click)="closeTopicMetricsModal()">
          <div
            class="metrics-modal-content"
            (click)="$event.stopPropagation()"
            [ngStyle]="topicMetricsModalStyle()"
          >
            <div class="metrics-modal-header">
              <h2>
                <i class="fas fa-chart-line"></i>
                Topic Health Summary
              </h2>
              <button class="metrics-modal-close" (click)="closeTopicMetricsModal()" aria-label="Close topic health metrics modal">&times;</button>
            </div>
            <div class="metrics-modal-body">
              @if (topicHealthSummary(); as summary) {
                <div class="topic-stats-search-row">
                  <div class="topic-stats">
                    <div class="stat-item">
                      <span class="stat-label">Total Topics:</span>
                      <span class="stat-value">{{ summary.totalTopics }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">Healthy:</span>
                      <span class="stat-value success">{{ summary.healthyTopics }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">With Lag:</span>
                      <span class="stat-value warning">{{ summary.topicsWithLag }}</span>
                    </div>
                    <div class="stat-item">
                      <span class="stat-label">Under-Replicated:</span>
                      <span class="stat-value danger">{{ summary.topicsWithUnderReplicatedPartitions }}</span>
                    </div>
                  </div>

                  <div class="topic-search-wrapper">
                    <div class="search-input-wrapper">
                      <i class="fas fa-search search-icon"></i>
                      <input
                        type="text"
                        class="topic-search-input"
                        placeholder="Search topics..."
                        [value]="topicSearchQuery()"
                        (input)="onTopicSearchInput($event)"
                      />
                      @if (topicSearchQuery()) {
                        <button class="search-clear" (click)="clearTopicSearch()" title="Clear search">
                          <i class="fas fa-times"></i>
                        </button>
                      }
                    </div>
                    @if (filteredTopics().length !== summary.topics.length) {
                      <div class="search-results-count">
                        Showing {{ filteredTopics().length }} of {{ summary.topics.length }} topics
                      </div>
                    }
                  </div>
                </div>

                <div class="topic-table-wrapper dashboard-common-table-wrap">
                  <table class="topic-table dashboard-common-table">
                    <thead>
                      <tr>
                        <th class="sortable" (click)="onSort('topic')">
                          <span>Topic</span>
                          @if (sortColumn() === 'topic') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="sortable" (click)="onSort('status')">
                          <span>Status</span>
                          @if (sortColumn() === 'status') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="sortable" (click)="onSort('partitions')">
                          <span>Partitions</span>
                          @if (sortColumn() === 'partitions') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="sortable" (click)="onSort('messages')">
                          <span>Messages</span>
                          @if (sortColumn() === 'messages') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="sortable" (click)="onSort('lag')">
                          <span>Consumer Lag</span>
                          @if (sortColumn() === 'lag') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="sortable" (click)="onSort('groups')">
                          <span>Groups</span>
                          @if (sortColumn() === 'groups') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                        <th class="sortable" (click)="onSort('errors')">
                          <span>Errors</span>
                          @if (sortColumn() === 'errors') {
                            <i class="fas" [class.fa-sort-up]="sortDirection() === 'asc'" [class.fa-sort-down]="sortDirection() === 'desc'"></i>
                          } @else {
                            <i class="fas fa-sort sort-inactive"></i>
                          }
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (topic of filteredTopics(); track topic.topicName) {
                        <tr>
                          <td class="topic-name">
                            <a
                              class="topic-link"
                              (click)="navigateToTopicMessages(topic.topicName, $event)"
                              [title]="'View messages for ' + topic.topicName"
                            >
                              {{ topic.topicName }}
                            </a>
                          </td>
                          <td>
                            <span class="health-badge" [class]="'health-' + topic.healthStatus.toLowerCase()">
                              {{ topic.healthStatus }}
                            </span>
                          </td>
                          <td>{{ topic.partitionCount }}</td>
                          <td>{{ topic.totalMessages | number }}</td>
                          <td>
                            @if (topic.hasActiveConsumers === false) {
                              <span class="not-active">Not active</span>
                            } @else {
                              <span class="lag-value">{{ topic.totalLag | number }}</span>
                            }
                          </td>
                          <td>{{ topic.consumerGroupCount }}</td>
                          <td>
                            @if (isLoadingTopicErrors()) {
                              <app-loading-skeleton [count]="1" height="20px" borderRadius="4px" />
                            } @else {
                              @if (topicErrors() === null) {
                                <span class="error-count-na">N/A</span>
                              } @else {
                                @if (getErrorCountForTopic(topic.topicName) === 0) {
                                  <span class="error-count-zero">0</span>
                                } @else {
                                  <a
                                    class="error-count-link"
                                    (click)="openTopicErrorsModal(topic.topicName, $event)"
                                    [title]="'View ' + getErrorCountForTopic(topic.topicName) + ' errors for ' + topic.topicName"
                                  >
                                    {{ getErrorCountForTopic(topic.topicName) }}
                                  </a>
                                }
                              }
                            }
                          </td>
                        </tr>
                      }
                      @if (filteredTopics().length === 0) {
                        <tr>
                          <td colspan="7" class="no-results">
                            No topics found matching "{{ topicSearchQuery() }}"
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else if (isLoadingTopics()) {
                <div class="topic-stats-search-row">
                  <div class="topic-stats">
                    @for (item of [1, 2, 3, 4]; track item) {
                      <div class="stat-item">
                        <span class="table-skeleton-bar table-skeleton-label"></span>
                        <span class="table-skeleton-bar table-skeleton-value"></span>
                      </div>
                    }
                  </div>
                </div>
                <div class="topic-table-wrapper dashboard-common-table-wrap">
                  <table class="topic-table dashboard-common-table">
                    <thead>
                      <tr>
                        <th><span>Topic</span></th>
                        <th><span>Status</span></th>
                        <th><span>Partitions</span></th>
                        <th><span>Messages</span></th>
                        <th><span>Consumer Lag</span></th>
                        <th><span>Groups</span></th>
                        <th><span>Errors</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (row of [1, 2, 3, 4, 5, 6, 7, 8]; track row) {
                        <tr>
                          <td><span class="table-skeleton-bar table-skeleton-topic"></span></td>
                          <td><span class="table-skeleton-bar table-skeleton-badge"></span></td>
                          <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                          <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                          <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                          <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                          <td><span class="table-skeleton-bar table-skeleton-cell"></span></td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              } @else {
                <div class="empty-state">No topic data available</div>
              }

              @if (consumerLagSummary(); as lagSummary) {
                @if (lagSummary.totalLag > 0 || lagSummary.groupsWithLag > 0) {
                  <div class="section section-lag-overview">
                    <h3>Consumer Lag Overview</h3>
                    <div class="lag-stats">
                      <div class="stat-item">
                        <span class="stat-label">Total Lag:</span>
                        <span class="stat-value">{{ lagSummary.totalLag | number }}</span>
                      </div>
                      <div class="stat-item">
                        <span class="stat-label">Groups with Lag:</span>
                        <span class="stat-value">{{ lagSummary.groupsWithLag }}</span>
                      </div>
                    </div>
                    <app-echarts-wrapper
                      [chartOption]="consumerLagChart()"
                      height="300px">
                    </app-echarts-wrapper>
                  </div>
                }
              }
            </div>
          </div>
        </div>
      }
    
      <!-- Topic Errors Modal -->
      @if (isModalOpen()) {
        <app-topic-errors-modal
          [topicName]="selectedTopicName()"
          [errors]="selectedTopicErrors()"
          (closed)="closeModal()"
          />
      }
    </div>
    `,
  styles: [`
    .kafka-health-panel {
      border-radius: 8px;
      padding: .5rem 1rem 1rem 1rem;
      box-shadow: var(--theme-shadow-sm);
    }

    .section {
      margin-bottom: 1rem;
    }

    .section-toolbar {
      display: flex;
      justify-content: flex-start;
      margin: 1rem 0rem 1rem 0rem;
    }

    .btn-view-metrics {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      border: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      border-radius: 8px;
      padding: 0.45rem 0.75rem;
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      cursor: pointer;
      transition: all 0.18s ease;
    }

    .btn-view-metrics:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }

    .btn-view-metrics i {
      color: var(--theme-text-teal);
    }

    .metrics-modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(100vh * 20);
      background: var(--theme-bg-overlay-backdrop);
      z-index: var(--z-modal-backdrop);
      pointer-events: auto;
      overflow-y: auto;
      padding: 1rem;
    }

    .metrics-modal-content {
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      box-shadow: var(--theme-shadow-lg);
      pointer-events: auto;
      min-height: 0;
      z-index: var(--z-modal-content);
    }

    .metrics-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 0.9rem 1.25rem;
      border-bottom: 1px solid var(--theme-border-teal-dark);
      background: var(--theme-header-gradient);
      color: var(--theme-bg-surface);
      box-shadow: var(--theme-shadow-md);
    }

    .metrics-modal-header h2 {
      margin: 0;
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-bg-surface);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      line-height: 1.2;
    }

    .metrics-modal-close {
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
      transition: background-color 0.2s;
    }

    .metrics-modal-close:hover {
      background: var(--theme-bg-overlay-light);
      color: var(--theme-bg-surface);
    }

    .metrics-modal-body {
      padding: 1rem 1.25rem 1.25rem;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }

    .section-lag-overview {
      margin-top: 1.25rem;
      margin-bottom: 0;
    }

    .section h3 {
      margin: 0 0 1rem 0;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .broker-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 1rem;
    }

    .skeleton-card {
      border-color: var(--theme-border-gray);
      background: var(--theme-bg-app);
    }

    .node-skeleton-bar {
      display: inline-block;
      height: 12px;
      border-radius: 999px;
      background: linear-gradient(
        90deg,
        var(--theme-skeleton-base) 25%,
        var(--theme-skeleton-highlight) 50%,
        var(--theme-skeleton-base) 75%
      );
      background-size: 200% 100%;
      animation: table-skeleton-shimmer 1.3s ease-in-out infinite;
    }

    .node-skeleton-title { width: 110px; height: 14px; }
    .node-skeleton-host { width: 175px; }
    .node-skeleton-label { width: 66px; }
    .node-skeleton-value { width: 52px; }
    .node-skeleton-metric { width: 150px; }

    .node-skeleton-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--theme-border-gray);
      animation: node-skeleton-pulse 1.3s ease-in-out infinite;
    }

    .node-skeleton-fill {
      width: 38%;
      height: 100%;
      border-radius: 3px;
      background: var(--theme-border-gray);
      animation: node-skeleton-pulse 1.3s ease-in-out infinite;
    }

    .node-skeleton-fill-memory { width: 52%; }

    @keyframes node-skeleton-pulse {
      0%, 100% { opacity: 0.6; }
      50% { opacity: 1; }
    }

    .broker-card {
      background: var(--theme-bg-surface);
      border: 2px solid var(--theme-button-success);
      border-radius: 6px;
      padding: 1rem;
    }

    .broker-card.offline {
      border-color: var(--theme-button-danger);
      background: var(--theme-bg-app);
      opacity: 0.9;
    }

    .offline-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-button-danger);
      border-radius: 4px;
      color: var(--theme-button-danger-hover);
      font-weight: var(--theme-font-table-header-weight);
      font-size: var(--theme-font-body);
      margin-bottom: 0.75rem;
    }

    .offline-banner i {
      font-size: var(--theme-font-body);
    }

    .broker-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--theme-border-gray);
    }

    .broker-id {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--theme-button-danger);
    }

    .status-indicator.online {
      background: var(--theme-button-success);
    }

    .broker-details {
      font-size: var(--theme-font-body);
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 0.5rem;
      color: var(--theme-text-gray);
    }

    .detail-row .label {
      font-weight: var(--theme-font-table-body-weight);
    }

    .detail-row .value {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .broker-resources {
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--theme-border-gray);
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .resource-metric {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .resource-label {
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-weight: var(--theme-font-table-body-weight);
    }

    .resource-label i {
      color: var(--theme-text-gray);
      width: 16px;
    }

    .resource-percent {
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-header-weight);
      margin-left: 0.25rem;
    }

    .resource-bar {
      width: 100%;
      height: 6px;
      background: var(--theme-border-gray);
      border-radius: 3px;
      overflow: hidden;
    }

    .resource-fill {
      height: 100%;
      background: var(--theme-button-success);
      transition: width 0.3s ease;
    }

    .resource-fill.warning {
      background: var(--theme-button-warning);
    }

    .resource-fill.critical {
      background: var(--theme-button-danger);
    }

    .controller-card {
      border-color: var(--theme-border-teal);
    }

    .controller-card.active-controller {
      border-color: var(--theme-button-success);
      border-width: 3px;
    }

    .active-badge {
      font-size: var(--theme-font-caption);
      background: var(--theme-button-success);
      color: var(--theme-bg-surface);
      padding: 0.125rem 0.5rem;
      border-radius: 12px;
      margin-left: 0.5rem;
      font-weight: var(--theme-font-table-header-weight);
    }

    .topic-stats-search-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
    }

    .topic-stats {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      flex-wrap: wrap;
    }

    .stat-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-label {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-body-weight);
    }

    .stat-value {
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .stat-value.success {
      color: var(--theme-button-success);
    }

    .stat-value.warning {
      color: var(--theme-button-warning);
    }

    .stat-value.danger {
      color: var(--theme-button-danger);
    }

    .topic-search-wrapper {
      flex-shrink: 0;
      min-width: 300px;
      max-width: 400px;
      flex: 1;
    }

    .search-input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
      width: 100%;
    }

    .search-icon {
      position: absolute;
      left: 0.75rem;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
      z-index: 1;
    }

    .topic-search-input {
      width: 100%;
      padding: 0.625rem 2.5rem 0.625rem 2.5rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      font-size: var(--theme-font-body);
      transition: border-color 0.2s;
      height: auto;
    }

    .topic-search-input:focus {
      outline: none;
      border-color: var(--theme-button-primary);
      box-shadow: 0 0 0 3px var(--theme-button-primary-shadow);
    }

    .search-clear {
      position: absolute;
      right: 0.375rem;
      background: none;
      border: none;
      color: var(--theme-text-gray);
      cursor: pointer;
      padding: 0.125rem;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: background-color 0.2s;
      font-size: var(--theme-font-caption);
    }

    .search-clear:hover {
      background-color: var(--theme-bg-app);
      color: var(--theme-table-header-color);
    }

    .search-results-count {
      margin-top: 0.5rem;
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
    }

    .topic-table-wrapper {
      overflow-x: auto;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    .topic-table {
      width: 100%;
      font-size: var(--theme-font-body);
    }

    .topic-table thead {
      position: sticky;
      top: 0;
      z-index: 10;
    }

    .topic-table th.sortable {
      cursor: pointer;
      user-select: none;
      position: relative;
      transition: background-color 0.2s;
    }

    .topic-table th.sortable:hover {
      background: var(--theme-table-header-bg-hover);
    }

    .topic-table th.sortable span {
      margin-right: 0.5rem;
    }

    .topic-table th.sortable i {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
      margin-left: 0.25rem;
    }

    .topic-table th.sortable i.sort-inactive {
      opacity: 0.4;
    }

    .topic-table th.sortable i.fa-sort-up,
    .topic-table th.sortable i.fa-sort-down {
      color: var(--theme-text-teal);
      opacity: 1;
    }

    .table-skeleton-bar {
      display: inline-block;
      height: 14px;
      border-radius: 999px;
      background: linear-gradient(
        90deg,
        var(--theme-skeleton-base) 25%,
        var(--theme-skeleton-highlight) 50%,
        var(--theme-skeleton-base) 75%
      );
      background-size: 200% 100%;
      animation: table-skeleton-shimmer 1.4s infinite;
    }

    .table-skeleton-label {
      width: 90px;
    }

    .table-skeleton-value {
      width: 42px;
      margin-left: 0.5rem;
    }

    .table-skeleton-topic {
      width: 160px;
    }

    .table-skeleton-badge {
      width: 72px;
      height: 22px;
      border-radius: 12px;
    }

    .table-skeleton-cell {
      width: 56px;
    }

    @keyframes table-skeleton-shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }

    .no-results {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
      font-style: italic;
    }

    .topic-table tbody tr:hover {
      background: var(--theme-bg-app);
    }

    .topic-name {
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-dark);
    }

    .topic-link {
      color: var(--theme-text-teal);
      text-decoration: none;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-block;
    }

    .topic-link:hover {
      color: var(--theme-text-teal-dark);
      text-decoration: underline;
    }

    .health-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      border: 1px solid transparent;
    }

    .health-badge.health-healthy {
      background: var(--theme-bg-surface);
      border-color: var(--theme-button-success);
      color: var(--theme-button-success-hover);
    }

    .health-badge.health-warning {
      background: var(--theme-bg-surface);
      border-color: var(--theme-button-warning);
      color: var(--theme-button-warning-hover);
    }

    .health-badge.health-critical {
      background: var(--theme-bg-surface);
      border-color: var(--theme-button-danger);
      color: var(--theme-button-danger-hover);
    }

    .health-badge.health-unknown {
      background: var(--theme-bg-surface);
      border-color: var(--theme-border-gray-light);
      color: var(--theme-text-gray);
    }

    .lag-value {
      color: var(--theme-text-dark);
      font-weight: var(--theme-font-table-body-weight);
    }

    .not-active {
      color: var(--theme-button-danger-hover);
      font-weight: var(--theme-font-table-body-weight);
      font-style: italic;
    }

    .lag-stats {
      display: flex;
      gap: 2rem;
      margin-bottom: 1rem;
      padding: 1rem;
      background: var(--theme-bg-app);
      border-radius: 6px;
    }

    .stat-item {
      display: flex;
      gap: 0.5rem;
    }

    .stat-item .stat-label {
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-body-weight);
    }

    .stat-item .stat-value {
      color: var(--theme-text-dark);
      font-weight: var(--theme-font-table-header-weight);
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
    }

    .error-count-zero {
      color: var(--theme-button-success);
      font-weight: var(--theme-font-table-body-weight);
    }

    .error-count-link {
      color: var(--theme-button-danger);
      text-decoration: underline;
      cursor: pointer;
      font-weight: var(--theme-font-table-body-weight);
      transition: all 0.2s;
    }

    .error-count-link:hover {
      color: var(--theme-button-danger-hover);
      text-decoration-thickness: 2px;
    }

    .error-count-na {
      color: var(--theme-text-gray);
      font-style: italic;
    }
  `]
})
export class KafkaHealthPanelComponent {
  isLoading = input<boolean>(false);

  healthState = inject(HealthStateService);
  healthApi = inject(HealthApiService);
  kafkaService = inject(KafkaService);
  router = inject(Router);
  clusterStateService = inject(ClusterStateService);
  authService = inject(AuthService);
  elasticsearchService = inject(ElasticsearchService);
  viewportScaleService = inject(ViewportScaleService);

  topicHealthSummary = signal<TopicHealthSummaryResponse | null>(null);
  consumerLagSummary = signal<ConsumerLagSummaryResponse | null>(null);
  isLoadingTopics = signal(false);
  showTopicMetricsModal = signal(false);
  topicSearchQuery = signal<string>('');
  sortColumn = signal<string | null>(null);
  sortDirection = signal<'asc' | 'desc'>('asc');
  
  // Topic errors state
  topicErrors = signal<TopicErrorEntry[] | null>(null);
  isLoadingTopicErrors = signal<boolean>(false);
  isModalOpen = signal<boolean>(false);
  selectedTopicErrors = signal<TopicErrorEntry[]>([]);
  selectedTopicName = signal<string>('');

  // Map errors by topic name (case-insensitive) for O(1) lookup
  topicErrorsMap = computed(() => {
    const errors = this.topicErrors();
    if (!errors || errors.length === 0) return new Map<string, TopicErrorEntry[]>();
    
    const map = new Map<string, TopicErrorEntry[]>();
    errors.forEach(error => {
      if (error.topicName) {
        const key = error.topicName.toLowerCase();
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key)!.push(error);
      }
    });
    return map;
  });

  topicMetricsModalStyle = computed(() => {
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const visibleHeight = viewportHeight / scale;
    const maxHeight = Math.min((94 * baseHeight) / 100, visibleHeight * 0.94);
    return {
      width: '90%',
      maxWidth: '1600px',
      maxHeight: `${maxHeight}px`,
      margin: 'auto',
      marginTop: '5vh',
    };
  });

  getErrorCountForTopic(topicName: string): number {
    if (!topicName) return 0;
    const errors = this.topicErrorsMap().get(topicName.toLowerCase());
    return errors ? errors.length : 0;
  }

  // Filtered and sorted topics based on search query and sort settings
  filteredTopics = computed(() => {
    const summary = this.topicHealthSummary();
    if (!summary) return [];
    
    const query = this.topicSearchQuery().toLowerCase().trim();
    let topics = query 
      ? summary.topics.filter(topic => 
          topic.topicName.toLowerCase().includes(query) ||
          topic.healthStatus.toLowerCase().includes(query)
        )
      : [...summary.topics];
    
    // Apply sorting
    const column = this.sortColumn();
    const direction = this.sortDirection();
    
    if (column) {
      topics.sort((a, b) => {
        let aValue: any;
        let bValue: any;
        
        switch (column) {
          case 'topic':
            aValue = a.topicName.toLowerCase();
            bValue = b.topicName.toLowerCase();
            break;
          case 'status':
            // Sort by health status priority: Healthy < Warning < Critical < Unknown
            const statusOrder: Record<string, number> = { 'healthy': 0, 'warning': 1, 'critical': 2, 'unknown': 3 };
            aValue = statusOrder[a.healthStatus.toLowerCase()] ?? 3;
            bValue = statusOrder[b.healthStatus.toLowerCase()] ?? 3;
            break;
          case 'partitions':
            aValue = a.partitionCount;
            bValue = b.partitionCount;
            break;
          case 'messages':
            aValue = a.totalMessages;
            bValue = b.totalMessages;
            break;
          case 'lag':
            // Handle "Not active" case - treat as -1 for sorting (should appear last)
            if (a.hasActiveConsumers === false) aValue = -1;
            else aValue = a.totalLag;
            if (b.hasActiveConsumers === false) bValue = -1;
            else bValue = b.totalLag;
            break;
          case 'groups':
            aValue = a.consumerGroupCount;
            bValue = b.consumerGroupCount;
            break;
          case 'errors':
            aValue = this.getErrorCountForTopic(a.topicName);
            bValue = this.getErrorCountForTopic(b.topicName);
            break;
          default:
            return 0;
        }
        
        if (aValue < bValue) return direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return topics;
  });

  // Combined nodes (controllers first, then brokers)
  // Ensures all desired brokers/controllers are shown, including offline ones
  allNodes = computed(() => {
    const kafka = this.healthState.kafkaHealth();
    if (!kafka) return [];

    const nodes: Array<{
      id: number;
      type: 'controller' | 'broker';
      host: string;
      port: number;
      isOnline: boolean;
      isActive?: boolean;
      partitionCount?: number;
      leaderPartitionCount?: number;
      cpuUsage?: string;
      cpuLimit?: string;
      cpuRequest?: string;
      cpuUsagePercent?: number;
      memoryUsage?: string;
      memoryLimit?: string;
      memoryRequest?: string;
      memoryUsagePercent?: number;
    }> = [];

    // Create a map of existing controllers for quick lookup
    const existingControllers = new Map<number, ControllerHealth>();
    if (kafka.controllers && kafka.controllers.length > 0) {
      kafka.controllers.forEach(controller => {
        existingControllers.set(controller.controllerId, controller);
      });
    }

    // Add all controllers from the API response (they already include all desired controllers, including offline ones)
    // The backend ensures all desired controllers are included, so we can iterate through the response
    if (kafka.controllers && kafka.controllers.length > 0) {
      kafka.controllers.forEach(controller => {
        nodes.push({
          id: controller.controllerId,
          type: 'controller',
          host: controller.host ?? 'Unknown',
          port: controller.port ?? 0,
          isOnline: controller.isOnline ?? false,
          isActive: controller.isActive ?? false,
          cpuUsage: controller.cpuUsage,
          cpuLimit: controller.cpuLimit,
          cpuRequest: controller.cpuRequest,
          cpuUsagePercent: controller.cpuUsagePercent,
          memoryUsage: controller.memoryUsage,
          memoryLimit: controller.memoryLimit,
          memoryRequest: controller.memoryRequest,
          memoryUsagePercent: controller.memoryUsagePercent
        });
      });
    } else {
      // Fallback: if no controllers in response but totalControllers > 0, create offline entries
      // This shouldn't happen if backend is working correctly, but handle it gracefully
      const totalControllers = kafka.totalControllers ?? 0;
      for (let controllerId = 0; controllerId < totalControllers; controllerId++) {
        nodes.push({
          id: controllerId,
          type: 'controller',
          host: 'Unknown',
          port: 0,
          isOnline: false,
          isActive: false
        });
      }
    }

    // Add all brokers from the API response (they already include all desired brokers, including offline ones)
    // The backend ensures all desired brokers are included, so we can iterate through the response
    if (kafka.brokers && kafka.brokers.length > 0) {
      kafka.brokers.forEach(broker => {
        nodes.push({
          id: broker.brokerId,
          type: 'broker',
          host: broker.host ?? 'Unknown',
          port: broker.port ?? 0,
          isOnline: broker.isOnline ?? false,
          partitionCount: broker.partitionCount,
          leaderPartitionCount: broker.leaderPartitionCount,
          cpuUsage: broker.cpuUsage,
          cpuLimit: broker.cpuLimit,
          cpuRequest: broker.cpuRequest,
          cpuUsagePercent: broker.cpuUsagePercent,
          memoryUsage: broker.memoryUsage,
          memoryLimit: broker.memoryLimit,
          memoryRequest: broker.memoryRequest,
          memoryUsagePercent: broker.memoryUsagePercent
        });
      });
    } else {
      // Fallback: if no brokers in response but totalBrokers > 0, create offline entries
      // This shouldn't happen if backend is working correctly, but handle it gracefully
      const totalBrokers = kafka.totalBrokers ?? 0;
      for (let brokerId = 0; brokerId < totalBrokers; brokerId++) {
        nodes.push({
          id: brokerId,
          type: 'broker',
          host: 'Unknown',
          port: 0,
          isOnline: false,
          partitionCount: 0,
          leaderPartitionCount: 0
        });
      }
    }

    // Sort: controllers first, then brokers, both by ID
    return nodes.sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'controller' ? -1 : 1;
      }
      return a.id - b.id;
    });
  });

  private lastKafkaHealthTimestamp: string | null = null;

  constructor() {
    // Watch for Kafka health refreshes and reload topic health data and errors
    effect(() => {
      const kafkaHealth = this.healthState.kafkaHealth();
      const isLoading = this.healthState.isLoadingKafkaHealth();
      
      // Only refresh topic health if:
      // 1. Kafka health exists
      // 2. Not currently loading Kafka health (refresh completed)
      // 3. Not currently loading topics (avoid duplicate calls)
      // 4. Timestamp changed (actual refresh, not initial load)
      if (this.showTopicMetricsModal() && kafkaHealth && !isLoading && !this.isLoadingTopics() && kafkaHealth.timestamp !== this.lastKafkaHealthTimestamp) {
        this.lastKafkaHealthTimestamp = kafkaHealth.timestamp;
        // Reload topic health and errors when Kafka cluster health is refreshed
        this.loadKafkaDetails();
        this.loadTopicErrors();
      }
    });
  }

  private loadKafkaDetails() {
    // Check if Kafka is enabled using user's namespace list (available immediately)
    // This allows parallel calls with cluster data loading instead of waiting
    const userNamespaces = this.authService.namespaces();
    const isKafkaEnabled = userNamespaces.includes(this.authService.consumersNamespace());
    
    if (!isKafkaEnabled) {
      console.log('[Kafka Health Panel] Kafka is disabled - skipping API calls');
      this.isLoadingTopics.set(false);
      return;
    }
    
    // Single optimized call: Get topics with health (including lag) - uses cache service
    // This can now run in parallel with cluster data loading
    this.isLoadingTopics.set(true);
    this.healthApi.getTopicHealthSummary().subscribe({
      next: (summary) => {
        this.topicHealthSummary.set(summary);
        this.isLoadingTopics.set(false);
        
        // Calculate consumer lag summary from topics health for the chart
        this.calculateConsumerLagSummaryFromTopics(summary.topics);
      },
      error: (err) => {
        console.error('Error loading topics health:', err);
        this.isLoadingTopics.set(false);
      }
    });
  }

  private loadTopicErrors() {
    // Check if Kafka is enabled using user's namespace list (available immediately)
    const userNamespaces = this.authService.namespaces();
    const isKafkaEnabled = userNamespaces.includes(this.authService.consumersNamespace());
    
    if (!isKafkaEnabled) {
      console.log('[Kafka Health Panel] Kafka is disabled - skipping topic errors API call');
      this.isLoadingTopicErrors.set(false);
      return;
    }
    
    // Let backend use configured default time range (no timeFrom/timeTo passed)
    this.isLoadingTopicErrors.set(true);
    this.elasticsearchService.getTopicErrors().subscribe({
      next: (response) => {
        this.topicErrors.set(response.errors);
        this.isLoadingTopicErrors.set(false);
      },
      error: (err) => {
        console.error('Error loading topic errors:', err);
        this.topicErrors.set(null);
        this.isLoadingTopicErrors.set(false);
      }
    });
  }

  openTopicErrorsModal(topicName: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    
    const errors = this.topicErrorsMap().get(topicName.toLowerCase()) || [];
    this.selectedTopicErrors.set(errors);
    this.selectedTopicName.set(topicName);
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
    this.selectedTopicErrors.set([]);
    this.selectedTopicName.set('');
  }

  openTopicMetricsModal(): void {
    this.lastKafkaHealthTimestamp = this.healthState.kafkaHealth()?.timestamp ?? null;
    this.showTopicMetricsModal.set(true);
    this.loadKafkaDetails();
    this.loadTopicErrors();
  }

  closeTopicMetricsModal(): void {
    this.showTopicMetricsModal.set(false);
  }

  /**
   * Calculate consumer lag summary from topics health data for the chart
   * This avoids a separate API call by deriving the data from topics
   */
  private calculateConsumerLagSummaryFromTopics(topics: TopicHealth[]): void {
    const consumerGroupHealthDict: Record<string, ConsumerGroupHealth> = {};
    let totalLag = 0;
    let groupsWithLag = 0;

    // Group topics by consumer groups (we need to reconstruct this from associations)
    // Since we don't have group-level data in topics, we'll create a simplified summary
    // For a full lag summary, we'd need the associations, but for the chart we can use topic-level data
    topics.forEach(topic => {
      if (topic.totalLag > 0) {
        totalLag += topic.totalLag;
        
        // Create a simplified consumer group entry for the chart
        // The chart shows top groups, so we'll use topic names as keys
        const key = `topic_${topic.topicName}`;
        consumerGroupHealthDict[key] = {
          groupId: topic.topicName, // Using topic name as identifier for chart
          topicName: topic.topicName,
          totalLag: topic.totalLag,
          activeConsumers: 0, // Not available from topics
          partitionLags: [], // Not available from topics
          state: 'Unknown'
        };
        
        if (topic.totalLag > 0) {
          groupsWithLag++;
        }
      }
    });

    this.consumerLagSummary.set({
      consumerGroups: consumerGroupHealthDict,
      totalLag,
      groupsWithLag,
      timestamp: new Date().toISOString()
    });
  }

  // Removed loadTopicHealthData, calculateTopicHealthWithAssociations, updateTopicHealthWithPartitions, and calculateTopicHealth
  // All data now comes from the single optimized getTopicHealthSummary() endpoint which uses the cache service

  consumerLagChart = computed((): EChartsOption => {
    const lagSummary = this.consumerLagSummary();
    if (!lagSummary) {
      return {};
    }

    const groups = Object.values(lagSummary.consumerGroups).slice(0, 10); // Top 10
    const warningColor = this.resolveThemeColor('--theme-button-warning', '#f59e0b');
    const data = groups.map(g => ({
      name: `${g.groupId} (${g.topicName})`,
      value: g.totalLag
    }));

    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'shadow'
        }
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        containLabel: true
      },
      xAxis: {
        type: 'value'
      },
      yAxis: {
        type: 'category',
        data: data.map(d => d.name)
      },
      series: [
        {
          type: 'bar',
          data: data.map(d => d.value),
          itemStyle: { color: warningColor }
        }
      ]
    };
  });

  /**
   * Navigate to Kafka deep-dive view with the selected topic and messages tab
   */
  navigateToTopicMessages(topicName: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    
    // Navigate to Kafka deep-dive view with topic and messages tab
    this.router.navigate(['/messages'], {
      queryParams: {
        view: 'deepdive',
        topic: topicName,
        tab: 'messages'
      }
    });
  }

  onTopicSearchInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.topicSearchQuery.set(input.value);
  }

  clearTopicSearch(): void {
    this.topicSearchQuery.set('');
  }

  onSort(column: string): void {
    const currentColumn = this.sortColumn();
    const currentDirection = this.sortDirection();
    
    if (currentColumn === column) {
      // Toggle direction if clicking the same column
      this.sortDirection.set(currentDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new column and default to ascending
      this.sortColumn.set(column);
      this.sortDirection.set('asc');
    }
  }

  private resolveThemeColor(cssVariableName: string, fallbackColor: string): string {
    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVariableName).trim();
    return value || fallbackColor;
  }
}

