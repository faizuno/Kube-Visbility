import { Component, Input, Output, EventEmitter, inject, OnInit, OnChanges, OnDestroy, SimpleChanges, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';

import { ResourceInfo, PodInfo, EventInfo } from '../../../../core/models/cluster-info.models';
import { CronFormatPipe } from '../../../../shared/pipes/cron-format.pipe';
import { PodsService } from '../../../../core/services/api/pods.service';
import { ResourcesService } from '../../../../core/services/api/resources.service';
import { ConsumersService } from '../../../../core/services/api/consumers.service';
import { CronWorkflowsService } from '../../../../core/services/api/cron-workflows.service';
import { ClustersService } from '../../../../core/services/api/clusters.service';
import { AuthService } from '../../../../core/services/auth.service';

interface ContainerInfo {
  name: string;
  image: string;
  version: string;
  environmentVariables: Record<string, string>;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  imagePullPolicy: string;
}

@Component({
  selector: 'app-resource-detail',
  standalone: true,
  imports: [FormsModule, CronFormatPipe],
  template: `
    @if (resource) {
      <div class="detail-body">
        <!-- Detail Header with Title, Status, and Action Buttons -->
        <div class="detail-header">
          <div class="detail-header-top">
            <div class="detail-title">
              <h2>{{ resource.name }}</h2>
              <span class="status-badge"
                [class.status-healthy]="getDisplayStatus() === 'Healthy'"
                [class.status-degraded]="getDisplayStatus() === 'Degraded'"
                [class.status-failed]="getDisplayStatus() === 'Failed'"
                [class.status-paused]="getDisplayStatus() === 'Paused'"
                [class.status-stopped]="getDisplayStatus() === 'Stopped'"
                [class.status-unknown]="getDisplayStatus() === 'N/A' || !getDisplayStatus()"
                [title]="getStatusTooltip()">
                <span class="status-icon">{{ getHealthIcon() }}</span>
                <span class="status-text">{{ getDisplayStatus() }}</span>
                <span class="replica-info-inline" [title]="getReplicaStatusTooltip()">{{ resource.readyReplicas || 0 }}/{{ resource.desiredReplicas || 0 }} Ready</span>
              </span>
            </div>
            <!-- Action Buttons -->
            <div class="detail-header-actions">
              <!-- Aggregated Logs Button -->
              <button class="btn-consumer-control btn-elastic-logs"
                (click)="viewElasticLogs()"
                title="Open aggregated logs for this resource">
                <i class="fas fa-search"></i>
              </button>
              <!-- Restart Button (for Deployments, DaemonSets, StatefulSets) -->
              @if (canRestart() && isAdmin()) {
                <button
                  class="btn-consumer-control btn-restart-scanning"
                  [disabled]="isActionLoading('restart')"
                  (click)="restartResource()"
                  [title]="'Restart this ' + resource.type.toLowerCase()">
                  <i class="fas fa-redo" [class.fa-spin]="isActionLoading('restart')"></i>
                </button>
              }
              @if (canUpdateLogLevel() && isAdmin()) {
                <div class="log-level-control-inline">
                  <select
                    class="log-level-select"
                    [ngModel]="selectedLogLevel()"
                    [disabled]="isActionLoading('logLevel')"
                    (ngModelChange)="onLogLevelChange($event)"
                    [title]="resource.type === 'CronWorkflow' ? 'Set Logging__LogLevel__Default for future workflow runs' : 'Set Logging__LogLevel__Default for all containers'"
                  >
                    @for (level of availableLogLevels; track level) {
                      <option [value]="level">{{ level }}</option>
                    }
                  </select>
                  <button
                    class="btn-consumer-control btn-log-level-update"
                    [disabled]="isActionLoading('logLevel')"
                    (click)="updateLogLevel()"
                    [title]="resource.type === 'CronWorkflow' ? 'Update log level for future workflow runs' : 'Update log level and trigger rollout'"
                  >
                    <i class="fas fa-sliders-h" [class.fa-spin]="isActionLoading('logLevel')"></i>
                  </button>
                </div>
              }
              <!-- Consumer Control Button (for Deployments in consumers namespace) -->
              @if (showConsumerControl() && isAdmin()) {
                <button
                  class="btn-consumer-control"
                  [class.btn-stop]="resource.consumerEnabled"
                  [class.btn-start]="!resource.consumerEnabled"
                  [disabled]="isActionLoading('consumer')"
                  (click)="toggleConsumer()"
                  [title]="resource.consumerEnabled ? 'Pause message processing for this consumer' : 'Resume message processing for this consumer'">
                  <i class="fas"
                    [class.fa-stop]="resource.consumerEnabled"
                    [class.fa-play]="!resource.consumerEnabled"
                    [class.fa-spinner]="isActionLoading('consumer')"
                  [class.fa-spin]="isActionLoading('consumer')"></i>
                </button>
              }
              <!-- CronWorkflow Controls -->
              @if (resource.type === 'CronWorkflow' && isAdmin()) {
                <div class="cronworkflow-controls">
                  <button class="btn-consumer-control"
                    [class.btn-pause]="!resource.suspend"
                    [class.btn-resume]="resource.suspend"
                    [disabled]="isActionLoading('toggleSuspend')"
                    (click)="toggleSuspend()"
                    [title]="resource.suspend ? 'Resume this scheduled workflow' : 'Pause this scheduled workflow'">
                    <i class="fas"
                      [class.fa-pause]="!resource.suspend"
                      [class.fa-play]="resource.suspend"
                      [class.fa-spinner]="isActionLoading('toggleSuspend')"
                    [class.fa-spin]="isActionLoading('toggleSuspend')"></i>
                  </button>
                  <button class="btn-consumer-control btn-submit"
                    [disabled]="isActionLoading('submit')"
                    (click)="submitCronWorkflow()"
                    title="Run this workflow now">
                    <i class="fas fa-rocket"
                      [class.fa-spinner]="isActionLoading('submit')"
                    [class.fa-spin]="isActionLoading('submit')"></i>
                  </button>
                  <button class="btn-consumer-control btn-edit-scanning"
                    (click)="editCronWorkflow()"
                    title="Edit workflow schedule and settings">
                    <i class="fas fa-pencil-alt"></i>
                  </button>
                </div>
              }
            </div>
          </div>
          <div class="detail-next-step">
            <i class="fas fa-lightbulb"></i>
            <span>{{ getNextStepHint() }}</span>
          </div>
        </div>
        <!-- Basic Information Section -->
        <div class="detail-section">
          <button type="button" class="section-toggle-btn" (click)="toggleOverviewSection()">
            <span><i class="fas fa-info-circle"></i> Resource Overview</span>
            <i class="fas" [class.fa-chevron-down]="!overviewExpanded()" [class.fa-chevron-up]="overviewExpanded()"></i>
          </button>
          @if (overviewExpanded()) {
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">Resource Name:</span>
                <span class="detail-value">{{ resource.name }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Internal ID:</span>
                <span class="detail-value">{{ resource.metadataName }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Type:</span>
                <span class="detail-value">{{ resource.type }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Namespace:</span>
                <span class="detail-value">{{ namespace }}</span>
              </div>
              @if (resource.creationTime) {
                <div class="detail-item">
                  <span class="detail-label">Created:</span>
                  <span class="detail-value">{{ formatDateWithAge(resource.creationTime) }}</span>
                </div>
              }
              @if (resource.lastUpdated) {
                <div class="detail-item">
                  <span class="detail-label">Last Updated:</span>
                  <span class="detail-value">{{ formatDateEST(resource.lastUpdated) }}</span>
                </div>
              }
            </div>
          }
        </div>
        <!-- Schedule Information Section (for CronWorkflows with single schedule) -->
        @if (resource.type === 'CronWorkflow' && resource.schedule) {
          <div class="detail-section schedule-section">
            <h3><i class="fas fa-clock"></i> Schedule Information</h3>
            <div class="detail-grid">
              <div class="detail-item">
                <span class="detail-label">Schedule:</span>
                <span class="detail-value schedule-cron">{{ resource.schedule | cronFormat }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Cron Expression:</span>
                <span class="detail-value" style="font-family: monospace; font-size: 0.9em;">{{ resource.schedule }}</span>
              </div>
              @if (resource.lastScheduleTime) {
                <div class="detail-item">
                  <span class="detail-label">Last Run:</span>
                  <span class="detail-value">{{ resource.lastScheduleTime }}</span>
                </div>
              }
            </div>
          </div>
        }
        <!-- CronWorkflow Configuration Section -->
        @if (resource.type === 'CronWorkflow') {
          <div class="detail-section">
            <h3><i class="fas fa-cogs"></i> CronWorkflow Configuration</h3>
            <div class="detail-grid">
              <!-- Multiple Schedules -->
              @if (resource.schedules && resource.schedules.length > 0) {
                <div class="detail-item">
                  <span class="detail-label">Schedules ({{ resource.schedules.length }}):</span>
                  <span class="detail-value">
                    @for (schedule of resource.schedules; track schedule) {
                      <div style="font-family: monospace; font-size: 0.9em; margin: 2px 0;">
                        {{ schedule }} <span style="color: var(--text-secondary);">({{ schedule | cronFormat }})</span>
                      </div>
                    }
                  </span>
                </div>
              }
              <!-- Starting Deadline Seconds -->
              <div class="detail-item">
                <span class="detail-label">Starting Deadline:</span>
                <span class="detail-value">
                  {{ resource.startingDeadlineSeconds !== null && resource.startingDeadlineSeconds !== undefined
                  ? resource.startingDeadlineSeconds + ' seconds'
                  : 'Not set' }}
                </span>
              </div>
              <!-- Concurrency Policy -->
              <div class="detail-item">
                <span class="detail-label">Concurrency Policy:</span>
                <span class="detail-value">{{ resource.concurrencyPolicy || 'Not set' }}</span>
              </div>
              <!-- History Limits -->
              <div class="detail-item">
                <span class="detail-label">Successful History Limit:</span>
                <span class="detail-value">
                  {{ resource.successfulJobsHistoryLimit !== null && resource.successfulJobsHistoryLimit !== undefined
                  ? resource.successfulJobsHistoryLimit
                  : 'Not set' }}
                </span>
              </div>
              <div class="detail-item">
                <span class="detail-label">Failed History Limit:</span>
                <span class="detail-value">
                  {{ resource.failedJobsHistoryLimit !== null && resource.failedJobsHistoryLimit !== undefined
                  ? resource.failedJobsHistoryLimit
                  : 'Not set' }}
                </span>
              </div>
              <!-- Suspend Status -->
              <div class="detail-item">
                <span class="detail-label">Status:</span>
                <span class="detail-value">
                  @if (resource.suspend) {
                    <span style="color: var(--warning-color); font-weight: var(--theme-font-table-header-weight);">
                      <i class="fas fa-pause-circle"></i> Suspended
                    </span>
                  }
                  @if (!resource.suspend) {
                    <span style="color: var(--success-color); font-weight: var(--theme-font-table-header-weight);">
                      <i class="fas fa-play-circle"></i> Active
                    </span>
                  }
                </span>
              </div>
            </div>
          </div>
        }
        <!-- Containers Section -->
        @if (resource.containers && resource.containers.length > 0) {
          <div class="detail-section">
            <button type="button" class="section-toggle-btn" (click)="toggleContainersSection()">
              <span><i class="fas fa-box"></i> Containers ({{ resource.containers.length }})</span>
              <i class="fas" [class.fa-chevron-down]="!containersExpanded()" [class.fa-chevron-up]="containersExpanded()"></i>
            </button>
            @if (containersExpanded()) {
              @for (container of resource.containers; track container; let idx = $index) {
                <div class="container-detail">
                  <div class="container-header-detail">
                    <span class="container-name-detail">{{ container.name || 'N/A' }}</span>
                  </div>
                  <div class="container-info">
                    <div class="info-row">
                      <i class="fas fa-image"></i>
                      <span class="info-label">Image:</span>
                      <span class="info-value">{{ container.image || 'N/A' }}</span>
                    </div>
                    <div class="info-row">
                      <i class="fas fa-tag"></i>
                      <span class="info-label">Version:</span>
                      <span class="version-badge-detail">{{ container.version || 'N/A' }}</span>
                    </div>
                    @if (container.cpuRequest || container.cpuLimit || container.memoryRequest || container.memoryLimit) {
                      <div class="info-row resource-limits">
                        <i class="fas fa-microchip"></i>
                        <span class="info-label">Resources:</span>
                        <div class="resource-details">
                          @if (container.cpuRequest || container.cpuLimit) {
                            <span class="resource-item">
                              CPU: {{ container.cpuRequest || '-' }} / {{ container.cpuLimit || '-' }}
                            </span>
                          }
                          @if (container.memoryRequest || container.memoryLimit) {
                            <span class="resource-item">
                              Memory: {{ container.memoryRequest || '-' }} / {{ container.memoryLimit || '-' }}
                            </span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                  <!-- Environment Variables -->
                  @if (getContainerEnvVarCount(container) > 0) {
                    <div class="env-section-detail">
                      <button class="env-toggle-btn" (click)="toggleEnvVars(idx)">
                        <i class="fas fa-list"></i>
                        Environment Variables ({{ getContainerEnvVarCount(container) }})
                        <i class="fas" [class.fa-chevron-down]="!isEnvVarsOpen(idx)" [class.fa-chevron-up]="isEnvVarsOpen(idx)"></i>
                      </button>
                      @if (isEnvVarsOpen(idx)) {
                        <div class="env-content">
                          @for (envVar of getContainerEnvVars(container); track envVar.key) {
                            <div class="env-item-detail">
                              <span class="env-key-detail">{{ envVar.key }}</span>
                              <span class="env-value-detail">{{ envVar.value }}</span>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                  @if (getContainerEnvVarCount(container) === 0) {
                    <p class="no-env">
                      No environment variables
                    </p>
                  }
                </div>
              }
            }
          </div>
        }
        <!-- Running Pods Section (with lazy loading) -->
        <div class="detail-section pods-section">
          <h3><i class="fas fa-server"></i> Running Pods @if (pods().length > 0) {
          <span>({{ pods().length }})</span>
        }</h3>
        @if (loadingPods()) {
          <div class="pods-loading">
            <i class="fas fa-spinner fa-spin"></i> Loading pods...
          </div>
        }
        @if (!loadingPods() && podsError()) {
          <div class="pods-error">
            <i class="fas fa-exclamation-triangle"></i> Failed to load pods: {{ podsError() }}
          </div>
        }
        @if (!loadingPods() && !podsError() && pods().length === 0) {
          <div class="no-pods">
            No active pods found. Use the logs action if this service recently restarted.
          </div>
        }
        @if (!loadingPods() && !podsError() && pods().length > 0) {
          <div>
            @for (pod of pods(); track pod) {
              <div class="pod-item" [class.pod-failed]="pod.status === 'Failed' || (!pod.isReady && pod.reason && pod.status !== 'Succeeded')" [class.pod-succeeded]="pod.status === 'Succeeded'">
                <div class="pod-info">
                  <div class="pod-name">{{ getPodIcon(pod) }} {{ pod.name }}</div>
                  <div class="pod-meta">
                    <span class="pod-status" [class.pod-status-running]="pod.status === 'Running'"
                      [class.pod-status-pending]="pod.status === 'Pending'"
                      [class.pod-status-failed]="pod.status === 'Failed'"
                      [class.pod-status-succeeded]="pod.status === 'Succeeded'">
                      <i class="fas fa-circle"></i> {{ pod.status }}
                    </span>
                    @if (pod.startTime) {
                      <span class="pod-uptime">
                        <i class="fas fa-clock"></i> {{ calculateUptime(pod.startTime) }}
                      </span>
                    }
                    <span class="pod-restarts">
                      <i class="fas fa-redo"></i> {{ getRestartCount(pod.restartCount) }} restarts
                    </span>
                    @if (pod.nodeName) {
                      <span class="pod-node">
                        <i class="fas fa-server"></i> {{ pod.nodeName }}
                      </span>
                    }
                  </div>
                  <!-- Resource Utilization -->
                  @if (pod.cpuUsage || pod.memoryUsage) {
                    <div class="pod-resources">
                      @if (pod.cpuUsage) {
                        <div class="resource-metric">
                          <div class="resource-label">
                            <i class="fas fa-microchip"></i>
                            CPU: {{ pod.cpuUsage || 'N/A' }}
                            @if (pod.cpuLimit) {
                              <span> / {{ pod.cpuLimit }}</span>
                            }
                            @if (pod.cpuUsagePercent !== null && pod.cpuUsagePercent !== undefined) {
                              <span class="resource-percent">
                                ({{ pod.cpuUsagePercent.toFixed(1) }}%)
                              </span>
                            }
                          </div>
                          @if (pod.cpuUsagePercent !== null && pod.cpuUsagePercent !== undefined) {
                            <div class="resource-bar">
                              <div class="resource-fill"
                                [style.width.%]="pod.cpuUsagePercent"
                                [class.critical]="pod.cpuUsagePercent > 90"
                                [class.warning]="pod.cpuUsagePercent > 70 && pod.cpuUsagePercent <= 90">
                              </div>
                            </div>
                          }
                        </div>
                      }
                      @if (pod.memoryUsage) {
                        <div class="resource-metric">
                          <div class="resource-label">
                            <i class="fas fa-memory"></i>
                            Memory: {{ pod.memoryUsage || 'N/A' }}
                            @if (pod.memoryLimit) {
                              <span> / {{ pod.memoryLimit }}</span>
                            }
                            @if (pod.memoryUsagePercent !== null && pod.memoryUsagePercent !== undefined) {
                              <span class="resource-percent">
                                ({{ pod.memoryUsagePercent.toFixed(1) }}%)
                              </span>
                            }
                          </div>
                          @if (pod.memoryUsagePercent !== null && pod.memoryUsagePercent !== undefined) {
                            <div class="resource-bar">
                              <div class="resource-fill"
                                [style.width.%]="pod.memoryUsagePercent"
                                [class.critical]="pod.memoryUsagePercent > 90"
                                [class.warning]="pod.memoryUsagePercent > 70 && pod.memoryUsagePercent <= 90">
                              </div>
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                  <!-- Completed status for succeeded jobs (green, no warning icon) -->
                  @if (pod.status === 'Succeeded' && pod.reason) {
                    <div class="pod-completed">
                      <span class="completed-reason">{{ pod.reason }}</span>
                      @if (pod.message) {
                        <span class="completed-message">
                          {{ pod.message.length > 100 ? (pod.message.substring(0, 100) + '...') : pod.message }}
                        </span>
                      }
                    </div>
                  }
                  <!-- Error status for failed jobs (red with warning icon) -->
                  @if (pod.status === 'Failed' && pod.reason) {
                    <div class="pod-error">
                      <i class="fas fa-exclamation-triangle"></i>
                      <span class="error-reason">{{ pod.reason }}</span>
                      @if (pod.message) {
                        <span class="error-message">
                          {{ pod.message.length > 100 ? (pod.message.substring(0, 100) + '...') : pod.message }}
                        </span>
                      }
                    </div>
                  }
                  <!-- Other error states (not succeeded or failed) -->
                  @if (pod.status !== 'Succeeded' && pod.status !== 'Failed' && !pod.isReady && pod.reason) {
                    <div class="pod-error">
                      <i class="fas fa-exclamation-triangle"></i>
                      <span class="error-reason">{{ pod.reason }}</span>
                      @if (pod.message) {
                        <span class="error-message">
                          {{ pod.message.length > 100 ? (pod.message.substring(0, 100) + '...') : pod.message }}
                        </span>
                      }
                    </div>
                  }
                </div>
                <div class="pod-actions">
                  <button class="btn-pod-action btn-pod-logs"
                    (click)="viewLogsForPod(pod.name)"
                    title="Open logs for this pod">
                    <i class="fas fa-file-alt"></i>
                  </button>
                  @if (isAdmin()) {
                    <button class="btn-pod-action btn-pod-restart"
                      [disabled]="isPodActionLoading(pod.name, 'restart')"
                      (click)="restartPod(pod.name)"
                      title="Restart this pod">
                      <i class="fas fa-redo" [class.fa-spin]="isPodActionLoading(pod.name, 'restart')"></i>
                    </button>
                  }
                </div>
              </div>
            }
          </div>
        }
      </div>
      <!-- Recent Events Section (with lazy loading and collapsible) -->
      <div class="detail-section events-section">
        <div class="events-header-toggle" (click)="toggleEventsSection()">
          <h3>
            <i class="fas fa-bell"></i> Recent Events
            @if (events().length > 0) {
              <span>({{ events().length }})</span>
            }
            <i class="fas events-chevron"
              [class.fa-chevron-down]="!eventsExpanded()"
            [class.fa-chevron-up]="eventsExpanded()"></i>
          </h3>
        </div>
        @if (eventsExpanded()) {
          <div class="events-container">
            @if (loadingEvents()) {
              <div class="events-loading">
                <i class="fas fa-spinner fa-spin"></i> Loading events...
              </div>
            }
            @if (!loadingEvents() && eventsError()) {
              <div class="events-error">
                <i class="fas fa-exclamation-triangle"></i> Failed to load events: {{ eventsError() }}
              </div>
            }
            @if (!loadingEvents() && !eventsError() && events().length === 0) {
              <div class="no-events">
                No recent events found for this resource
              </div>
            }
            @if (!loadingEvents() && !eventsError() && events().length > 0) {
              <div class="events-list">
                @for (event of events(); track event) {
                  <div class="event-item"
                    [class.event-warning]="event.type === 'Warning'"
                    [class.event-error]="event.type === 'Error'">
                    <span class="event-icon">{{ getEventIcon(event.type) }}</span>
                    <span class="event-type">{{ event.type }}</span>
                    <span class="event-reason">{{ event.reason }}</span>
                    <span class="event-message">{{ event.message }}</span>
                    <span class="event-time">{{ formatEventTime(event.timestamp) }}</span>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>
    </div>
    }
    `,
  styles: [
    `
      .detail-body {
        padding: 1rem;
        padding-bottom: 0;
        font-size: var(--theme-font-body);
        line-height: 1.38;
      }

      .detail-header {
        margin-bottom: 1rem;
      }
      .detail-next-step {
        display: inline-flex;
        align-items: center;
        gap: 0.42rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
        background: var(--theme-bg-teal-lighter);
        border: 1px solid #c7d2fe;
        border-radius: 999px;
        padding: 0.28rem 0.62rem;
      }
      .detail-next-step i {
        color: var(--theme-text-teal-dark);
      }

      .detail-header-top {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 0.7rem;
      }

      .detail-title {
        display: flex;
        align-items: center;
        gap: 0.95rem;
      }

      .detail-title h2 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-primary, #1e293b);
      }

      .status-badge {
        display: flex;
        align-items: center;
        gap: 0.42rem;
        padding: 0.34rem 0.62rem;
        border-radius: 6px;
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        background-color: var(--bg-color, #f8f9fa);
        border: 1px solid var(--border-color, var(--theme-border-gray-light));
      }

      .status-badge.status-healthy {
        background-color: #d1fae5;
        border-color: var(--success-color, #10b981);
        color: #065f46;
      }

      .status-badge.status-degraded {
        background-color: #fef3c7;
        border-color: var(--warning-color, #f59e0b);
        color: #92400e;
      }

      .status-badge.status-failed {
        background-color: #fee2e2;
        border-color: var(--error-color, #ef4444);
        color: #991b1b;
      }

      .status-badge.status-paused {
        background-color: #fef3c7;
        border-color: var(--warning-color, #f59e0b);
        color: #92400e;
      }

      .status-badge.status-stopped {
        background-color: #fee2e2;
        border-color: var(--error-color, #ef4444);
        color: #991b1b;
      }

      .status-badge.status-unknown {
        background-color: var(--theme-bg-app);
        border-color: var(--text-secondary, #64748b);
        color: var(--text-secondary, #64748b);
      }

      .status-icon {
        font-size: var(--theme-font-body);
      }

      .status-text {
        text-transform: capitalize;
        font-size: var(--theme-font-body);
      }

      .replica-info-inline {
        font-size: var(--theme-font-body);
        color: var(--text-secondary, #64748b);
        margin-left: 0.25rem;
        font-weight: var(--theme-font-table-body-weight);
      }

      .detail-header-actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .cronworkflow-controls {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .btn-consumer-control {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        background-color: var(--theme-bg-surface);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        font-size: var(--theme-font-body);
        line-height: 1;
      }

      .btn-consumer-control i {
        font-size: var(--theme-font-body);
        line-height: 1;
      }

      .btn-consumer-control:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-consumer-control.btn-restart-scanning {
        color: var(--theme-button-primary);
      }

      .btn-consumer-control.btn-restart-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: var(--theme-button-primary-hover);
        color: var(--theme-button-primary-hover);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-stop {
        color: #b91c1c;
      }

      .btn-consumer-control.btn-stop:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #b91c1c;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-start {
        color: #059669;
      }

      .btn-consumer-control.btn-start:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #059669;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-pause {
        color: #b45309;
      }

      .btn-consumer-control.btn-pause:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #b45309;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-resume {
        color: #059669;
      }

      .btn-consumer-control.btn-resume:hover:not(:disabled) {
        border-color: #059669;
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-submit {
        color: #059669;
      }

      .btn-consumer-control.btn-submit:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #059669;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-edit-scanning {
        color: var(--theme-button-primary);
      }

      .btn-consumer-control.btn-edit-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: var(--theme-button-primary-hover);
        color: var(--theme-button-primary-hover);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control.btn-elastic-logs {
        color: #059669;
        border-color: #10b981;
        width: 36px;
        padding: 7px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .btn-consumer-control.btn-elastic-logs:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #059669;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .log-level-control-inline {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }

      .log-level-select {
        height: 34px;
        border: 1px solid var(--theme-border-gray);
        border-radius: 7px;
        padding: 0 0.55rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
        background: var(--theme-bg-surface);
        min-width: 120px;
      }

      .log-level-select:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .btn-consumer-control.btn-log-level-update {
        background: #0f766e;
        color: #ffffff;
      }

      .btn-consumer-control.btn-log-level-update:hover:not(:disabled) {
        background: #0d5f59;
      }


      .detail-section {
        margin-bottom: 1.2rem;
        padding: 1rem;
        background-color: var(--bg-color, #f8f9fa);
        border-radius: 8px;
      }

      .detail-section h3 {
        font-size: var(--theme-font-section-title);
        margin-bottom: 0.7rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: var(--text-primary, #1e293b);
      }
      .section-toggle-btn {
        width: 100%;
        border: none;
        background: transparent;
        padding: 0;
        margin: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: var(--text-primary, #1e293b);
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
      }
      .section-toggle-btn span {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .section-toggle-btn i.fa-chevron-down,
      .section-toggle-btn i.fa-chevron-up {
        font-size: var(--theme-font-body);
        color: var(--text-secondary, #64748b);
      }
      /* Add breathing room between collapsible heading and content */
      .section-toggle-btn + .detail-grid {
        margin-top: 0.7rem;
      }
      .section-toggle-btn + .container-detail {
        margin-top: 0.7rem;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 0.7rem 0.95rem;
        background-color: var(--theme-bg-surface);
      }

      .detail-item {
        display: flex;
        flex-direction: column;
        gap: 0.24rem;
      }

      .detail-label {
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-caption);
        color: var(--text-secondary, #64748b);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .detail-value {
        color: var(--text-primary, #1e293b);
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
      }

      .schedule-section {
        background-color: var(--bg-color, #f8f9fa);
        border-left: 4px solid var(--primary-color, var(--theme-button-primary));
      }

      .schedule-cron {
        font-family: 'Courier New', monospace;
        background-color: var(--card-bg, white);
        padding: 0.2rem 0.4rem;
        border-radius: 4px;
        font-size: var(--theme-font-table-header);
      }

      .container-detail {
        background-color: var(--bg-color, #f8f9fa);
        border-radius: 8px;
        padding: 1rem;
        margin-bottom: 0.8rem;
      }

      .container-header-detail {
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-section-title);
        margin-bottom: 0.7rem;
        color: var(--primary-color, var(--theme-button-primary));
      }

      .container-info {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
        margin-bottom: 0.75rem;
        background-color: var(--theme-bg-surface);
      }

      .info-row {
        display: flex;
        align-items: center;
        gap: 0.7rem;
      }

      .info-row i {
        color: var(--text-secondary, #64748b);
        width: 20px;
      }

      .info-label {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-secondary, #64748b);
        min-width: 80px;
        font-size: var(--theme-font-body);
      }

      .info-value {
        color: var(--text-primary, #1e293b);
        word-break: break-all;
        font-size: var(--theme-font-body);
      }

      .version-badge-detail {
        background-color: var(--success-color, #10b981);
        color: white;
        padding: 0.25rem 0.75rem;
        border-radius: 4px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
      }

      .resource-limits {
        margin-top: 0.5rem;
      }

      .resource-details {
        display: flex;
        flex-direction: column;
        gap: 0.3rem;
        margin-top: 0.3rem;
      }

      .resource-item {
        font-size: var(--theme-font-body);
        color: var(--text-secondary, #64748b);
        padding: 0.26rem 0.56rem;
        background-color: var(--bg-color, #f8f9fa);
        border-radius: 4px;
      }

      .env-section-detail {
        margin-top: 0.9rem;
      }

      .env-toggle-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        background-color: var(--theme-bg-surface);
        border: 1px solid var(--border-color, var(--theme-border-gray-light));
        padding: 0.62rem 0.88rem;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        color: var(--text-secondary, #64748b);
        transition: all 0.3s ease;
      }

      .env-toggle-btn:hover {
        background-color: var(--bg-color, #f8f9fa);
        border-color: var(--primary-color, var(--theme-button-primary));
      }

      .env-content {
        margin-top: 0.5rem;
        padding: 0.75rem;
        background-color: var(--theme-bg-surface);
        border: 1px solid var(--border-color, var(--theme-border-gray-light));
        border-radius: 6px;
        max-height: 400px;
        overflow-y: auto;
      }

      .env-item-detail {
        display: flex;
        padding: 0.42rem 0;
        border-bottom: 1px solid var(--border-color, var(--theme-border-gray-light));
      }

      .env-item-detail:last-child {
        border-bottom: none;
      }

      .env-key-detail {
        flex: 0 0 40%;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-primary, #1e293b);
        word-break: break-word;
        font-size: var(--theme-font-body);
      }

      .env-value-detail {
        flex: 1;
        color: var(--text-secondary, #64748b);
        word-break: break-all;
        font-size: var(--theme-font-body);
      }

      .no-env {
        color: var(--text-secondary, #64748b);
        font-style: italic;
        text-align: center;
        padding: 1rem;
      }

      .pods-section {
        margin-top: 1.2rem;
      }

      .pods-loading, .events-loading {
        text-align: center;
        padding: 2rem;
        color: var(--text-secondary, #64748b);
        font-size: var(--theme-font-body);
      }

      .pods-loading i, .events-loading i {
        margin-right: 0.5rem;
        color: var(--primary-color, var(--theme-button-primary));
      }

      .no-pods, .no-events {
        text-align: center;
        padding: 2rem;
        color: var(--text-secondary, #64748b);
        font-style: italic;
      }

      .pods-error, .events-error {
        text-align: center;
        padding: 2rem;
        color: var(--error-color, #ef4444);
        background-color: #fef2f2;
        border-radius: 8px;
        border-left: 4px solid var(--error-color, #ef4444);
      }

      .pods-error i, .events-error i {
        margin-right: 0.5rem;
      }

      .pod-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.85rem 1rem;
        background-color: var(--theme-bg-surface);
        border-radius: 8px;
        margin-bottom: 0.62rem;
        border-left: 3px solid var(--primary-color, var(--theme-button-primary));
        transition: all 0.3s ease;
      }

      .pod-item:hover {
        background-color: var(--theme-bg-app);
        transform: translateX(4px);
      }

      .pod-item.pod-failed {
        border-left-color: var(--error-color, #ef4444);
      }

      .pod-item.pod-succeeded {
        border-left-color: var(--success-color, #10b981);
      }

      .pod-info {
        flex: 1;
      }

      .pod-name {
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        color: var(--text-primary, #1e293b);
        margin-bottom: 0.45rem;
      }

      .pod-meta {
        display: flex;
        gap: 1rem;
        flex-wrap: wrap;
      }

      .pod-meta span {
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.3rem;
      }

      .pod-status i {
        font-size: var(--theme-font-caption);
      }

      .pod-status-running {
        color: var(--success-color, #10b981);
      }

      .pod-status-pending {
        color: var(--warning-color, #f59e0b);
      }

      .pod-status-failed {
        color: var(--error-color, #ef4444);
      }

      .pod-status-succeeded {
        color: var(--success-color, #10b981);
      }

      .pod-uptime, .pod-restarts, .pod-node {
        color: var(--text-secondary, #64748b);
      }

      .pod-resources {
        margin-top: 0.6rem;
        padding-top: 0.6rem;
        border-top: 1px solid var(--theme-border-gray-light);
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
      }

      .resource-metric {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .resource-label {
        font-size: var(--theme-font-body);
        color: var(--text-primary, #1e293b);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: var(--theme-font-table-body-weight);
      }

      .resource-label i {
        color: var(--text-secondary, #64748b);
        width: 16px;
      }

      .resource-percent {
        color: var(--text-secondary, #64748b);
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
        background: #10b981;
        transition: width 0.3s ease;
      }

      .resource-fill.warning {
        background: #f59e0b;
      }

      .resource-fill.critical {
        background: #ef4444;
      }

      .pod-error {
        margin-top: 0.5rem;
        padding: 0.52rem;
        background-color: #fef2f2;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .error-reason {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--error-color, #ef4444);
      }

      .error-message {
        color: var(--text-secondary, #64748b);
        font-size: var(--theme-font-body);
      }

      .pod-completed {
        margin-top: 0.5rem;
        padding: 0.52rem;
        background-color: #f0fdf4;
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .completed-reason {
        font-weight: var(--theme-font-table-header-weight);
        color: var(--success-color, #10b981);
      }

      .completed-message {
        color: var(--text-secondary, #64748b);
        font-size: var(--theme-font-body);
      }

      .pod-actions {
        display: flex;
        gap: 0.5rem;
        align-items: center;
      }

      .btn-pod-action {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid #d1d5db;
        background-color: var(--theme-bg-surface);
        border-radius: 6px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        font-size: var(--theme-font-body);
        line-height: 1;
      }

      .btn-pod-action i {
        font-size: var(--theme-font-body);
        line-height: 1;
      }

      .btn-pod-logs {
        color: var(--theme-button-primary);
      }

      .btn-pod-logs:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: var(--theme-button-primary-hover);
        color: var(--theme-button-primary-hover);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-pod-restart {
        color: #7e0000;
      }

      .btn-pod-restart:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #7e0000;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-pod-action:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        pointer-events: none;
      }

      .events-section {
        margin-top: 1.2rem;
      }

      .events-header-toggle {
        cursor: pointer;
      }

      .events-header-toggle h3 {
        margin-bottom: 0;
      }

      .events-chevron {
        margin-left: auto;
        transition: transform 0.3s ease;
      }

      .events-container {
        margin-top: 0.7rem;
      }

      .events-list {
        display: flex;
        flex-direction: column;
        gap: 0.45rem;
      }

      .event-item {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.8rem;
        background-color: var(--theme-bg-surface);
        border-radius: 6px;
        border-left: 3px solid var(--primary-color, var(--theme-button-primary));
        transition: all 0.3s ease;
      }

      .event-item.event-warning {
        border-left-color: var(--warning-color, #f59e0b);
      }

      .event-item.event-error {
        border-left-color: var(--error-color, #ef4444);
      }

      .event-icon {
        font-size: var(--theme-font-body);
      }

      .event-type {
        font-weight: var(--theme-font-table-header-weight);
        min-width: 80px;
        font-size: var(--theme-font-body);
      }

      .event-reason {
        font-weight: var(--theme-font-table-body-weight);
        min-width: 150px;
        color: var(--text-primary, #1e293b);
        font-size: var(--theme-font-body);
      }

      .event-message {
        flex: 1;
        color: var(--text-secondary, #64748b);
        word-break: break-word;
        font-size: var(--theme-font-body);
      }

      .event-time {
        font-size: var(--theme-font-table-header);
        color: var(--text-secondary, #64748b);
        white-space: nowrap;
      }

      .detail-actions {
        display: flex;
        gap: 1rem;
        margin-top: 2rem;
        padding-top: 2rem;
        border-top: 2px solid var(--border-color, var(--theme-border-gray-light));
      }

      .btn-detail-action {
        flex: 1;
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        transition: all 0.3s ease;
      }

    `,
  ],
})
export class ResourceDetailComponent implements OnInit, OnChanges, OnDestroy {
  @Input() resource!: ResourceInfo;
  @Input() namespace!: string;
  @Output() editCronWorkflowRequested = new EventEmitter<{ namespace: string; resource: ResourceInfo }>();
  @Output() viewLogsRequested = new EventEmitter<{ namespace: string; resource: ResourceInfo; resourceType: string; podName?: string }>();
  @Output() viewElasticLogsRequested = new EventEmitter<{ namespace: string; resource: ResourceInfo }>();

  private podsService = inject(PodsService);
  private resourcesService = inject(ResourcesService);
  private consumersService = inject(ConsumersService);
  private cronWorkflowsService = inject(CronWorkflowsService);
  private clustersService = inject(ClustersService);
  private stateService = inject(ClusterStateService);
  private authService = inject(AuthService);

  // State for pods
  pods = signal<PodInfo[]>([]);
  loadingPods = signal(false);
  podsError = signal<string | null>(null);
  private hasEverLoadedPods = false; // Track if pods have ever been loaded
  private lastLoadedResourceKey: string | null = null; // Track which resource we last loaded pods for

  // State for events
  events = signal<EventInfo[]>([]);
  loadingEvents = signal(false);
  eventsError = signal<string | null>(null);
  eventsExpanded = signal(false);

  // State for environment variables
  openEnvVars = signal<Set<number>>(new Set());
  overviewExpanded = signal(false);
  containersExpanded = signal(false);

  // State for action loading
  actionLoading = signal<Set<string>>(new Set());
  readonly availableLogLevels = ['Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical', 'None'];
  selectedLogLevel = signal<string>('Information');
  
  // State for pod action loading (key: podName-action, e.g., "pod-123-restart")
  podActionLoading = signal<Set<string>>(new Set());

  // Admin status
  isAdmin = computed(() => this.authService.isUserAdmin());

  ngOnInit(): void {
    // Load pods immediately
    this.loadPods();
    this.syncSelectedLogLevelFromResource();
    this.resetEnvVarsToCollapsed();
    this.resetCollapsibleSections();
    
    // Register refresh callback for pods
    this.registerPodsRefresh();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Reload pods when resource changes (but not on first change - ngOnInit handles that)
    if (changes['resource'] && !changes['resource'].firstChange) {
      const newResource = changes['resource'].currentValue;
      const resourceKey = `${this.namespace}-${newResource?.metadataName}`;
      
      // Only reset the flag if this is actually a different resource
      if (this.lastLoadedResourceKey !== resourceKey) {
        this.hasEverLoadedPods = false;
        this.lastLoadedResourceKey = resourceKey;
      }
      
      this.loadPods();
      this.syncSelectedLogLevelFromResource();
      this.resetEnvVarsToCollapsed();
      this.resetCollapsibleSections();
      // Clear events when resource changes
      this.events.set([]);
      this.eventsExpanded.set(false);
      
      // Re-register refresh callback with new resource
      this.registerPodsRefresh();
    }
  }

  private registerPodsRefresh(): void {
    if (!this.resource || !this.namespace) {
      return;
    }
    
    // Register refresh callback for pods
    const callbackId = `resource-detail-pods-${this.namespace}-${this.resource.metadataName}`;
    this.stateService.registerRefreshCallback(callbackId, async () => {
      // Refresh pods for this resource
      this.loadPods();
    });
  }

  ngOnDestroy(): void {
    // Unregister refresh callback on destroy
    if (this.resource && this.namespace) {
      const callbackId = `resource-detail-pods-${this.namespace}-${this.resource.metadataName}`;
      this.stateService.unregisterRefreshCallback(callbackId);
    }
  }

  private isLoadingPods = false;

  loadPods(): void {
    // Prevent duplicate concurrent calls
    if (this.isLoadingPods) {
      return;
    }
    
    const resourceKey = `${this.namespace}-${this.resource.metadataName}`;
    
    // Only show loading state if this is the initial load for this specific resource
    const isInitialLoad = !this.hasEverLoadedPods || this.lastLoadedResourceKey !== resourceKey;
    if (isInitialLoad) {
      this.loadingPods.set(true);
    }
    this.podsError.set(null);
    this.isLoadingPods = true;
    
    this.clustersService
      .getPodsForResource(this.namespace, this.resource.metadataName, this.resource.type)
      .subscribe({
        next: (pods: PodInfo[]) => {
          // Update pods data without clearing (prevents flickering)
          this.pods.set(pods);
          this.hasEverLoadedPods = true;
          this.lastLoadedResourceKey = resourceKey;
          this.isLoadingPods = false;
          if (isInitialLoad) {
            this.loadingPods.set(false);
          }
        },
        error: (error: any) => {
          this.podsError.set(error.message || 'Failed to load pods');
          this.isLoadingPods = false;
          if (isInitialLoad) {
            this.loadingPods.set(false);
          }
        },
      });
  }

  toggleEventsSection(): void {
    const isExpanded = this.eventsExpanded();
    this.eventsExpanded.set(!isExpanded);
    
    if (!isExpanded && this.events().length === 0) {
      this.loadEvents();
    }
  }

  loadEvents(): void {
    this.loadingEvents.set(true);
    this.eventsError.set(null);
    
    this.clustersService
      .getEventsForResource(this.namespace, this.resource.metadataName, this.resource.type)
      .subscribe({
        next: (events: EventInfo[]) => {
          this.events.set(events);
          this.loadingEvents.set(false);
        },
        error: (error: any) => {
          this.eventsError.set(error.message || 'Failed to load events');
          this.loadingEvents.set(false);
        },
      });
  }

  toggleEnvVars(index: number): void {
    const current = new Set(this.openEnvVars());
    if (current.has(index)) {
      current.delete(index);
    } else {
      current.add(index);
    }
    this.openEnvVars.set(current);
  }

  private resetEnvVarsToCollapsed(): void {
    // Keep environment variables collapsed by default until user expands.
    this.openEnvVars.set(new Set());
  }

  toggleOverviewSection(): void {
    this.overviewExpanded.set(!this.overviewExpanded());
  }

  toggleContainersSection(): void {
    this.containersExpanded.set(!this.containersExpanded());
  }

  private resetCollapsibleSections(): void {
    this.overviewExpanded.set(false);
    this.containersExpanded.set(false);
  }

  private getRawContainerEnvVars(container: ContainerInfo): unknown {
    const candidate = container as unknown as Record<string, unknown>;
    return (
      candidate['environmentVariables'] ??
      candidate['envVars'] ??
      candidate['env'] ??
      candidate['environment'] ??
      null
    );
  }

  getContainerEnvVars(container: ContainerInfo): Array<{ key: string; value: string }> {
    return this.getSortedEnvVars(this.getRawContainerEnvVars(container));
  }

  getContainerEnvVarCount(container: ContainerInfo): number {
    return this.getContainerEnvVars(container).length;
  }

  isEnvVarsOpen(index: number): boolean {
    return this.openEnvVars().has(index);
  }

  getEnvVarCount(envVars: unknown): number {
    return this.getSortedEnvVars(envVars).length;
  }

  getSortedEnvVars(envVars: unknown): Array<{ key: string; value: string }> {
    const entries = this.normalizeEnvVars(envVars);
    return entries.sort((a, b) => a.key.localeCompare(b.key));
  }

  private normalizeEnvVars(envVars: unknown): Array<{ key: string; value: string }> {
    if (!envVars) {
      return [];
    }

    if (Array.isArray(envVars)) {
      const normalized = envVars
        .map((entry) => {
          if (typeof entry === 'string') {
            const separatorIndex = entry.indexOf('=');
            if (separatorIndex > 0) {
              const key = entry.substring(0, separatorIndex).trim();
              const value = entry.substring(separatorIndex + 1).trim();
              return key ? { key, value } : null;
            }
            return null;
          }

          if (entry && typeof entry === 'object') {
            const record = entry as Record<string, unknown>;
            const rawKey = record['key'] ?? record['name'] ?? record['envVar'];
            if (typeof rawKey !== 'string' || rawKey.trim().length === 0) {
              return null;
            }

            if (typeof record['value'] === 'string') {
              return { key: rawKey.trim(), value: record['value'] };
            }

            if (record['valueFrom']) {
              return { key: rawKey.trim(), value: '[from secret/config]' };
            }

            return { key: rawKey.trim(), value: this.stringifyEnvValue(record['value']) };
          }

          return null;
        })
        .filter((item): item is { key: string; value: string } => !!item);

      return this.uniqueEnvEntries(normalized);
    }

    if (typeof envVars === 'object') {
      const asRecord = envVars as Record<string, unknown>;
      const entries = Object.entries(asRecord).map(([key, value]) => ({
        key,
        value: this.stringifyEnvValue(value),
      }));
      return this.uniqueEnvEntries(entries);
    }

    return [];
  }

  private stringifyEnvValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    if (typeof value === 'string') {
      return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private uniqueEnvEntries(entries: Array<{ key: string; value: string }>): Array<{ key: string; value: string }> {
    const deduped = new Map<string, string>();
    for (const entry of entries) {
      if (!deduped.has(entry.key)) {
        deduped.set(entry.key, entry.value);
      }
    }
    return Array.from(deduped.entries()).map(([key, value]) => ({ key, value }));
  }

  formatDateEST(dateString: string): string {
    const date = new Date(dateString);
    const estTime = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    return `${estTime} EST`;
  }

  formatDateWithAge(dateString: string): string {
    const date = new Date(dateString);
    const estTime = date.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const age = this.calculateUptime(dateString);
    return `${estTime} EST (${age} ago)`;
  }

  calculateUptime(startTime: string): string {
    if (!startTime) return 'Unknown';
    
    const now = new Date();
    const start = new Date(startTime);
    const diffMs = now.getTime() - start.getTime();
    
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) {
      return `${days}d ${hours}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  formatEventTime(timestamp: string): string {
    const eventDate = new Date(timestamp);
    const estTime = eventDate.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const timeAgo = this.calculateUptime(timestamp);
    return `${estTime} EST (${timeAgo} ago)`;
  }

  getEventIcon(type: string): string {
    if (type === 'Warning') return '⚠️';
    if (type === 'Error') return '❌';
    return '✓';
  }

  getRestartCount(restartCount?: string): number {
    if (!restartCount) return 0;
    const parsed = parseInt(restartCount, 10);
    return isNaN(parsed) ? 0 : parsed;
  }

  viewLogsForPod(podName: string): void {
    this.viewLogsRequested.emit({
      namespace: this.namespace,
      resource: this.resource,
      resourceType: this.resource.type,
      podName: podName,
    });
  }

  restartPod(podName: string): void {
    if (!confirm(`Are you sure you want to restart pod ${podName}?`)) {
      return;
    }
    
    this.setPodActionLoading(podName, 'restart', true);
    this.podsService
      .restartPod({
        namespaceName: this.namespace,
        podName: podName,
      })
      .subscribe({
        next: (response) => {
          this.setPodActionLoading(podName, 'restart', false);
          if (response.success) {
            // Reload pods to reflect the restart
            this.loadPods();
          } else {
            alert(response.message || 'Failed to restart pod');
          }
        },
        error: (error: any) => {
          this.setPodActionLoading(podName, 'restart', false);
          console.error('Error restarting pod:', error);
          alert('Failed to restart pod: ' + (error.message || 'Unknown error'));
        },
      });
  }

  isPodActionLoading(podName: string, action: string): boolean {
    return this.podActionLoading().has(`${podName}-${action}`);
  }

  setPodActionLoading(podName: string, action: string, loading: boolean): void {
    const current = new Set(this.podActionLoading());
    const key = `${podName}-${action}`;
    if (loading) {
      current.add(key);
    } else {
      current.delete(key);
    }
    this.podActionLoading.set(current);
  }

  viewElasticLogs(): void {
    this.viewElasticLogsRequested.emit({
      namespace: this.namespace,
      resource: this.resource,
    });
  }

  canRestart(): boolean {
    return ['Deployment', 'DaemonSet', 'StatefulSet'].includes(this.resource.type);
  }

  canUpdateLogLevel(): boolean {
    return this.canRestart() || this.resource.type === 'CronWorkflow';
  }

  onLogLevelChange(level: string): void {
    this.selectedLogLevel.set(this.normalizeLogLevel(level));
  }

  showConsumerControl(): boolean {
    return this.resource.type === 'Deployment' && this.namespace === this.authService.consumersNamespace();
  }

  isActionLoading(action: string): boolean {
    return this.actionLoading().has(action);
  }

  restartResource(): void {
    const confirmMessage = `WARNING: This action will trigger a ROLLOUT RESTART.\n\n` +
      `Resource: ${this.resource.name}\n` +
      `Type: ${this.resource.type}\n` +
      `Impact: Pods for this workload will be recreated, which may cause brief disruption.\n\n` +
      `Do you want to continue?`;

    if (!confirm(confirmMessage)) {
      return;
    }
    
    this.setActionLoading('restart', true);
    this.resourcesService
      .restartResource({
        namespaceName: this.namespace,
        resourceName: this.resource.metadataName,
        resourceType: this.resource.type,
      })
      .subscribe({
        next: () => {
          this.setActionLoading('restart', false);
          // Reload namespace data to get updated resource state
          this.stateService.loadNamespaceData(this.namespace, true).then(() => {
            // Update selected resource if it's the same one
            const updatedData = this.stateService.clusterData();
            const nsData = updatedData.namespaces[this.namespace];
            if (nsData?.success && nsData.resources) {
              const updatedResource = nsData.resources.find(
                (r) => r.metadataName === this.resource.metadataName
              );
              if (updatedResource) {
                this.stateService.setSelectedResource(this.namespace, updatedResource);
              }
            }
          });
        },
        error: (error: any) => {
          this.setActionLoading('restart', false);
          console.error('Error restarting resource:', error);
          alert('Failed to restart resource: ' + (error.message || 'Unknown error'));
        },
      });
  }

  updateLogLevel(): void {
    if (!this.canUpdateLogLevel()) {
      return;
    }

    const logLevel = this.normalizeLogLevel(this.selectedLogLevel());
    if (!logLevel) {
      alert('Please select a log level.');
      return;
    }

    const isCronWorkflow = this.resource.type === 'CronWorkflow';
    const confirmMessage = isCronWorkflow
      ? `WARNING: This change applies to FUTURE CronWorkflow runs only.\n\n` +
        `Resource: ${this.resource.name}\n` +
        `Setting: Logging__LogLevel__Default = ${logLevel}\n\n` +
        `Suggestion: If you need immediate effect, update now and trigger a new run manually.\n\n` +
        `Do you want to continue?`
      : `WARNING: This action will trigger a ROLLOUT RESTART.\n\n` +
        `Resource: ${this.resource.name}\n` +
        `Setting: Logging__LogLevel__Default = ${logLevel}\n` +
        `Impact: Pods for this workload will be recreated, which may cause brief disruption.\n\n` +
        `Do you want to continue?`;

    if (!confirm(confirmMessage)) {
      return;
    }

    this.setActionLoading('logLevel', true);
    const request$ = isCronWorkflow
      ? this.cronWorkflowsService.updateLogLevel({
          namespaceName: this.namespace,
          resourceName: this.resource.metadataName,
          logLevel,
        })
      : this.resourcesService.updateLogLevel({
          namespaceName: this.namespace,
          resourceName: this.resource.metadataName,
          resourceType: this.resource.type,
          logLevel,
        });

    request$.subscribe({
        next: (response) => {
          this.setActionLoading('logLevel', false);
          if (response?.success) {
            this.stateService.loadNamespaceData(this.namespace, true).then(() => {
              const updatedData = this.stateService.clusterData();
              const nsData = updatedData.namespaces[this.namespace];
              if (nsData?.success && nsData.resources) {
                const updatedResource = nsData.resources.find(
                  (r) => r.metadataName === this.resource.metadataName
                );
                if (updatedResource) {
                  this.stateService.setSelectedResource(this.namespace, updatedResource);
                }
              }
            });
          } else {
            alert(response?.message || 'Failed to update log level');
          }
        },
        error: (error: any) => {
          this.setActionLoading('logLevel', false);
          console.error('Error updating log level:', error);
          alert('Failed to update log level: ' + (error.message || 'Unknown error'));
        },
      });
  }

  private syncSelectedLogLevelFromResource(): void {
    this.selectedLogLevel.set(this.normalizeLogLevel(this.getCurrentLogLevelFromResource()));
  }

  private getCurrentLogLevelFromResource(): string | null {
    if (!this.resource?.containers?.length) {
      return null;
    }

    for (const container of this.resource.containers) {
      const envVars = this.getContainerEnvVars(container);
      const match = envVars.find((item) => item.key === 'Logging__LogLevel__Default');
      if (match?.value) {
        return match.value.trim();
      }
    }

    return null;
  }

  private normalizeLogLevel(level: string | null | undefined): string {
    if (!level) {
      return 'Information';
    }

    const normalizedInput = level.trim().toLowerCase();
    if (!normalizedInput) {
      return 'Information';
    }

    const matched = this.availableLogLevels.find(
      (allowed) => allowed.toLowerCase() === normalizedInput
    );

    return matched ?? 'Information';
  }

  toggleConsumer(): void {
    const currentState = this.resource.consumerEnabled !== false;
    const newState = !currentState;
    const action = newState ? 'enable' : 'disable';
    
    if (!confirm(`Are you sure you want to ${action} consumer for ${this.resource.name}?`)) {
      return;
    }
    
    this.setActionLoading('consumer', true);
    this.consumersService
      .toggleConsumer({
        namespaceName: this.namespace,
        deploymentName: this.resource.metadataName,
        enabled: newState,
      })
      .subscribe({
        next: (response) => {
          this.setActionLoading('consumer', false);
          if (response?.success) {
            // Update the resource in state with the updated resource returned from API
            if (response.updatedResource) {
              this.stateService.updateResourceInState(this.namespace, response.updatedResource);
              // Update selected resource if it's the same one
              this.stateService.setSelectedResource(this.namespace, response.updatedResource);
            } else {
              // Fallback: reload namespace data if updated resource not provided
              this.stateService.loadNamespaceData(this.namespace, true).then(() => {
                const updatedData = this.stateService.clusterData();
                const nsData = updatedData.namespaces[this.namespace];
                if (nsData?.success && nsData.resources) {
                  const updatedResource = nsData.resources.find(
                    (r) => r.metadataName === this.resource.metadataName
                  );
                  if (updatedResource) {
                    this.stateService.setSelectedResource(this.namespace, updatedResource);
                  }
                }
              });
            }
          } else {
            alert(response?.message || 'Failed to toggle consumer');
          }
        },
        error: (error: any) => {
          this.setActionLoading('consumer', false);
          console.error('Error toggling consumer:', error);
          alert('Failed to toggle consumer: ' + (error.message || 'Unknown error'));
        },
      });
  }

  toggleSuspend(): void {
    const currentState = this.resource.suspend === true;
    const newSuspendState = !currentState;
    const action = newSuspendState ? 'suspend' : 'resume';
    
    if (!confirm(`Are you sure you want to ${action} CronWorkflow ${this.resource.name}?`)) {
      return;
    }
    
    this.setActionLoading('toggleSuspend', true);
    this.cronWorkflowsService
      .toggleSuspend({
        namespaceName: this.namespace,
        resourceName: this.resource.metadataName,
        suspend: newSuspendState,
      })
      .subscribe({
        next: (response) => {
          this.setActionLoading('toggleSuspend', false);
          if (response?.success) {
            // Update the resource in state with the updated resource returned from API
            if (response.updatedResource) {
              this.stateService.updateResourceInState(this.namespace, response.updatedResource);
              // Update selected resource if it's the same one
              this.stateService.setSelectedResource(this.namespace, response.updatedResource);
            } else {
              // Fallback: reload namespace data if updated resource not provided
              this.stateService.loadNamespaceData(this.namespace, true).then(() => {
                const updatedData = this.stateService.clusterData();
                const nsData = updatedData.namespaces[this.namespace];
                if (nsData?.success && nsData.resources) {
                  const updatedResource = nsData.resources.find(
                    (r) => r.metadataName === this.resource.metadataName
                  );
                  if (updatedResource) {
                    this.stateService.setSelectedResource(this.namespace, updatedResource);
                  }
                }
              });
            }
          } else {
            alert(response?.message || 'Failed to toggle suspend');
          }
        },
        error: (error: any) => {
          this.setActionLoading('toggleSuspend', false);
          console.error('Error toggling suspend:', error);
          alert('Failed to toggle suspend: ' + (error.message || 'Unknown error'));
        },
      });
  }

  submitCronWorkflow(): void {
    if (!this.resource || this.resource.type !== 'CronWorkflow') {
      return;
    }
    
    if (!confirm(`Are you sure you want to run workflow ${this.resource.name} now?`)) {
      return;
    }
    
    this.setActionLoading('submit', true);
    this.cronWorkflowsService
      .submitCronWorkflow({
        namespaceName: this.namespace,
        resourceName: this.resource.metadataName,
      })
      .subscribe({
        next: (response) => {
          this.setActionLoading('submit', false);
          if (response?.success) {
            alert(
              response.message + 
              (response.workflowName ? `\nWorkflow: ${response.workflowName}` : '')
            );
            // Refresh pods to show the new workflow execution
            this.loadPods();
          } else {
            alert(response?.message || 'Failed to submit workflow');
          }
        },
        error: (error: any) => {
          this.setActionLoading('submit', false);
          console.error('Error submitting workflow:', error);
          alert('Failed to submit workflow: ' + (error.message || 'Unknown error'));
        },
      });
  }

  editCronWorkflow(): void {
    this.editCronWorkflowRequested.emit({ namespace: this.namespace, resource: this.resource });
  }

  setActionLoading(action: string, loading: boolean): void {
    const current = new Set(this.actionLoading());
    if (loading) {
      current.add(action);
    } else {
      current.delete(action);
    }
    this.actionLoading.set(current);
  }

  getDisplayStatus(): string {
    if (this.resource.type === 'CronWorkflow' && this.resource.suspend === true) {
      return 'Paused';
    }
    return this.resource.healthStatus || 'N/A';
  }

  getHealthIcon(): string {
    const status = this.getDisplayStatus();
    if (status === 'Healthy') return '✅';
    if (status === 'Degraded') return '⚠️';
    if (status === 'Failed') return '❌';
    if (status === 'Paused') return '⏸️';
    if (status === 'Stopped') return '🛑';
    return '❓';
  }

  getPodIcon(pod: PodInfo): string {
    // For succeeded jobs, show checkmark
    if (pod.status === 'Succeeded') {
      return '✅';
    }
    // For failed jobs, show X
    if (pod.status === 'Failed') {
      return '❌';
    }
    // For other statuses, use isReady to determine icon
    return pod.isReady ? '✅' : '❌';
  }

  getNextStepHint(): string {
    const status = this.getDisplayStatus();
    if (status === 'Failed' || status === 'Degraded') {
      return 'Next: open logs first, then restart only if needed.';
    }
    if (status === 'Paused' || status === 'Stopped') {
      return 'Next: confirm this state is intentional before resuming.';
    }
    return 'Next: review recent logs and events for early warning signs.';
  }

  getStatusTooltip(): string {
    const status = this.getDisplayStatus();
    if (status === 'Healthy') return 'Healthy: the service is running as expected.';
    if (status === 'Degraded') return 'Degraded: the service is running but needs attention.';
    if (status === 'Failed') return 'Failed: the service is not operating correctly.';
    if (status === 'Paused') return 'Paused: this workflow is intentionally suspended.';
    if (status === 'Stopped') return 'Stopped: processing is currently disabled.';
    return 'Status is currently unavailable.';
  }

  getReplicaStatusTooltip(): string {
    const ready = this.resource?.readyReplicas || 0;
    const desired = this.resource?.desiredReplicas || 0;
    return `${ready} of ${desired} replicas are ready (ready/desired).`;
  }

}
