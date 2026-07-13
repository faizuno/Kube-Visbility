import { Component, OnInit, AfterViewInit, OnDestroy, inject, signal, computed, effect, Injector, ElementRef, ViewChild, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { HealthBadgeComponent } from '../../../../shared/components/health-badge/health-badge.component';
import { ResourceInfo, HealthFilter } from '../../../../core/models/cluster-info.models';
import { LogsViewerComponent } from '../logs-viewer/logs-viewer.component';
import { ElasticsearchLogsViewerComponent } from '../elasticsearch-logs-viewer/elasticsearch-logs-viewer.component';
import { EditCronworkflowComponent } from '../edit-cronworkflow/edit-cronworkflow.component';
import { ResourcesService } from '../../../../core/services/api/resources.service';
import { ConsumersService } from '../../../../core/services/api/consumers.service';
import { CronWorkflowsService } from '../../../../core/services/api/cron-workflows.service';
import { CronFormatPipe } from '../../../../shared/pipes/cron-format.pipe';
import { AuthService } from '../../../../core/services/auth.service';
import { environment } from '../../../../../environments/environment';
import { BulkActionProgressComponent, BulkActionItem } from '../bulk-action-progress/bulk-action-progress.component';
import { SearchBarComponent } from '../../../../shared/components/search-bar/search-bar.component';
import { HealthFilterComponent } from '../../../../shared/components/health-filter/health-filter.component';

@Component({
  selector: 'app-scanning-view',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, LogsViewerComponent, ElasticsearchLogsViewerComponent, EditCronworkflowComponent, CronFormatPipe, BulkActionProgressComponent, SearchBarComponent, HealthFilterComponent],
  template: `
    <div class="scanning-view-container" #scanningContainer [ngStyle]="containerHeightStyle()">
    <div class="scanning-view">
      <div class="cluster-top-controls-row">
        <div class="cluster-top-controls-left">
          <span class="global-total-applications">
            <i class="fas fa-cubes"></i>
            Total Applications: {{ totalResourcesCount() }}
          </span>
          <app-health-filter
            [currentFilter]="healthFilter()"
            [filterCounts]="healthFilterCounts()"
            variant="header"
            (filterChange)="onInlineHealthFilterChange($event)"
          />
        </div>
        <div class="cluster-search-row">
          <app-search-bar
            appearance="header"
            [searchTerm]="activeSearchQuery()"
            [placeholderText]="'Search applications...'"
            (searchChange)="onInlineSearchChange($event)"
          />
        </div>
      </div>
      @if (hasActiveFilters()) {
        <div class="active-filters-summary">
          <span class="summary-text">
            Showing {{ filteredResources().length }} of {{ totalResourcesCount() }} resources
            @if (activeSearchQuery()) {
              for "{{ activeSearchQuery() }}"
            }
          </span>
          @if (activeHealthFilterLabels().length > 0) {
            <span class="summary-badges">
              @for (status of activeHealthFilterLabels(); track status) {
                <span class="summary-badge">{{ status }}</span>
              }
            </span>
          }
          <button type="button" class="summary-clear-btn" (click)="clearAllFilters()">Clear filters</button>
        </div>
      }
      @if (isLoading() && !hasAnyDataLoaded()) {
        <!-- Initial load - keep namespace/table structure stable and skeletonize table cells -->
        @for (namespace of namespaces(); track namespace) {
          <div class="scanning-namespace" [attr.data-namespace]="namespace">
            <div class="scanning-namespace-header">
              <div class="namespace-info">
                <i class="fas fa-folder-open"></i>
                <span class="namespace-name">{{ namespace }}</span>
              </div>
              <div class="namespace-status-center">
                <div class="namespace-status-pills skeleton-status-pills" title="Loading namespace status">
                  <span class="namespace-status-pill skeleton-status-pill">
                    <span class="skeleton skeleton-cell" style="width: 54px;"></span>
                  </span>
                  <span class="namespace-status-pill skeleton-status-pill">
                    <span class="skeleton skeleton-cell" style="width: 68px;"></span>
                  </span>
                </div>
              </div>
              <i class="fas fa-chevron-up toggle-icon"></i>
            </div>
            <div class="scanning-table-container">
              <div class="table-wrapper">
                <div class="table-header-wrapper">
                  <table class="scanning-table scanning-table-header">
                    <thead>
                      <tr>
                        @if (isAdmin()) {
                          <th class="col-checkbox">
                            <input type="checkbox" disabled />
                          </th>
                        }
                        <th class="col-name">Name</th>
                        <th class="col-type">Type</th>
                        <th class="col-version">Version</th>
                        <th class="col-status">Status</th>
                        @if (namespace !== jobsNamespace()) {
                          <th class="col-replicas">Replicas</th>
                        }
                        @if (namespace === jobsNamespace()) {
                          <th class="col-schedule">Schedule</th>
                        }
                        <th class="col-last-updated">Last Updated</th>
                        @if (namespace === jobsNamespace()) {
                          <th class="col-last-run">Last Run</th>
                        }
                        @if (isAdmin()) {
                          <th class="col-log-level">Log Level</th>
                        }
                        <th class="actions-column">Actions</th>
                      </tr>
                    </thead>
                  </table>
                </div>
                <div class="table-body-container">
                  <table class="scanning-table scanning-table-body">
                    <tbody>
                      @for (row of [1, 2, 3, 4, 5, 6]; track row) {
                        <tr class="resource-row">
                          @if (isAdmin()) {
                            <td class="col-checkbox"><input type="checkbox" disabled /></td>
                          }
                          <td class="col-name"><span class="skeleton skeleton-cell" style="width: 170px;"></span></td>
                          <td class="col-type"><span class="skeleton skeleton-pill" style="width: 88px;"></span></td>
                          <td class="col-version"><span class="skeleton skeleton-cell" style="width: 120px;"></span></td>
                          <td class="col-status"><span class="skeleton skeleton-pill" style="width: 92px;"></span></td>
                          @if (namespace !== jobsNamespace()) {
                            <td class="col-replicas"><span class="skeleton skeleton-cell" style="width: 55px;"></span></td>
                          }
                          @if (namespace === jobsNamespace()) {
                            <td class="col-schedule"><span class="skeleton skeleton-cell" style="width: 130px;"></span></td>
                          }
                          <td class="col-last-updated"><span class="skeleton skeleton-cell" style="width: 110px;"></span></td>
                          @if (namespace === jobsNamespace()) {
                            <td class="col-last-run"><span class="skeleton skeleton-cell" style="width: 95px;"></span></td>
                          }
                          @if (isAdmin()) {
                            <td class="col-log-level"><span class="skeleton skeleton-cell" style="width: 120px;"></span></td>
                          }
                          <td class="actions-cell">
                            <span class="skeleton skeleton-action-dot"></span>
                          </td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        }
      } @else {
        @if (filteredNamespaces().length === 0) {
          <div class="no-resources">
            <p>No namespaces found matching the current filters</p>
          </div>
        } @else {
          @for (namespace of filteredNamespaces(); track namespace) {
          @if (isNamespaceLoading(namespace) && !getNamespaceData(namespace)) {
            <div class="scanning-namespace">
              <div class="scanning-namespace-header">
                <div class="namespace-info">
                  <i class="fas fa-folder-open"></i>
                  <span class="namespace-name">{{ namespace }}</span>
                </div>
                <div class="namespace-status-center">
                  <div class="namespace-status-pills skeleton-status-pills" title="Loading namespace status">
                    <span class="namespace-status-pill skeleton-status-pill">
                      <span class="skeleton skeleton-cell" style="width: 54px;"></span>
                    </span>
                    <span class="namespace-status-pill skeleton-status-pill">
                      <span class="skeleton skeleton-cell" style="width: 68px;"></span>
                    </span>
                  </div>
                </div>
                <i class="fas fa-chevron-up toggle-icon"></i>
              </div>
              <div class="scanning-table-container">
                <div class="table-wrapper">
                  <div class="table-header-wrapper">
                    <table class="scanning-table scanning-table-header">
                      <thead>
                        <tr>
                          @if (isAdmin()) {
                            <th class="col-checkbox">
                              <input type="checkbox" disabled />
                            </th>
                          }
                          <th class="col-name">Name</th>
                          <th class="col-type">Type</th>
                          <th class="col-version">Version</th>
                          <th class="col-status">Status</th>
                          @if (namespace !== jobsNamespace()) {
                            <th class="col-replicas">Replicas</th>
                          }
                          @if (namespace === jobsNamespace()) {
                            <th class="col-schedule">Schedule</th>
                          }
                          <th class="col-last-updated">Last Updated</th>
                          @if (namespace === jobsNamespace()) {
                            <th class="col-last-run">Last Run</th>
                          }
                          @if (isAdmin()) {
                            <th class="col-log-level">Log Level</th>
                          }
                          <th class="actions-column">Actions</th>
                        </tr>
                      </thead>
                    </table>
                  </div>
                  <div class="table-body-container">
                    <table class="scanning-table scanning-table-body">
                      <tbody>
                        @for (row of [1, 2, 3, 4, 5, 6]; track row) {
                          <tr class="resource-row">
                            @if (isAdmin()) {
                              <td class="col-checkbox"><input type="checkbox" disabled /></td>
                            }
                            <td class="col-name"><span class="skeleton skeleton-cell" style="width: 170px;"></span></td>
                            <td class="col-type"><span class="skeleton skeleton-pill" style="width: 88px;"></span></td>
                            <td class="col-version"><span class="skeleton skeleton-cell" style="width: 120px;"></span></td>
                            <td class="col-status"><span class="skeleton skeleton-pill" style="width: 92px;"></span></td>
                            @if (namespace !== jobsNamespace()) {
                              <td class="col-replicas"><span class="skeleton skeleton-cell" style="width: 55px;"></span></td>
                            }
                            @if (namespace === jobsNamespace()) {
                              <td class="col-schedule"><span class="skeleton skeleton-cell" style="width: 130px;"></span></td>
                            }
                            <td class="col-last-updated"><span class="skeleton skeleton-cell" style="width: 110px;"></span></td>
                            @if (namespace === jobsNamespace()) {
                              <td class="col-last-run"><span class="skeleton skeleton-cell" style="width: 95px;"></span></td>
                            }
                            @if (isAdmin()) {
                              <td class="col-log-level"><span class="skeleton skeleton-cell" style="width: 120px;"></span></td>
                            }
                            <td class="actions-cell">
                              <span class="skeleton skeleton-action-dot"></span>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          } @else if (getNamespaceData(namespace); as nsData) {
          <div class="scanning-namespace" [attr.data-namespace]="namespace">
            <!-- Namespace Header (Accordion) -->
            <div
              class="scanning-namespace-header"
              role="button"
              tabindex="0"
              [attr.aria-label]="'Toggle namespace ' + namespace"
              (click)="toggleNamespace(namespace); $event.stopPropagation()"
            >
              <div class="namespace-info">
                <i class="fas fa-folder-open"></i>
                <span class="namespace-name">{{ namespace }}</span>
              </div>
              @if (nsData.success && nsData.resources) {
                @if (getNamespaceStatusCounts(namespace); as statusCounts) {
                  <div class="namespace-status-center">
                    <div class="namespace-status-pills" title="Visible resources by status">
                      <span class="namespace-status-pill status-total">Total {{ getSortedResources(namespace).length }}</span>
                      <span class="namespace-status-pill status-healthy">Healthy {{ statusCounts.healthy }}</span>
                      @if (statusCounts.degraded > 0) {
                        <span class="namespace-status-pill status-degraded">Degraded {{ statusCounts.degraded }}</span>
                      }
                      @if (statusCounts.failed > 0) {
                        <span class="namespace-status-pill status-failed">Failed {{ statusCounts.failed }}</span>
                      }
                      @if (statusCounts.stopped > 0) {
                        <span class="namespace-status-pill status-stopped">Stopped {{ statusCounts.stopped }}</span>
                      }
                      @if (statusCounts.paused > 0) {
                        <span class="namespace-status-pill status-paused">Paused {{ statusCounts.paused }}</span>
                      }
                      @if (statusCounts.pending > 0) {
                        <span class="namespace-status-pill status-pending">Pending {{ statusCounts.pending }}</span>
                      }
                      @if (statusCounts.running > 0) {
                        <span class="namespace-status-pill status-running">Running {{ statusCounts.running }}</span>
                      }
                      @if (statusCounts.neverRun > 0) {
                        <span class="namespace-status-pill status-never-run">Never Run {{ statusCounts.neverRun }}</span>
                      }
                    </div>
                  </div>
                }
              }
              @if (isAdmin() && getSelectedCount(namespace) > 0) {
                <div class="namespace-bulk-actions" (click)="$event.stopPropagation()">
                  @if (canRestartSelected(namespace)) {
                    <button
                      class="btn-bulk-action btn-bulk-restart"
                      (click)="performBulkRestart(namespace)"
                      title="Restart selected resources"
                    >
                      <i class="fas fa-redo"></i>
                      Restart ({{ getSelectedCount(namespace) }})
                    </button>
                  }
                  @if (canToggleConsumerSelected(namespace)) {
                    @if (getConsumerStartCount(namespace) > 0) {
                      <button
                        class="btn-bulk-action btn-bulk-start"
                        (click)="performBulkStartConsumer(namespace)"
                        title="Resume message processing for selected resources"
                      >
                        <i class="fas fa-play"></i>
                        Start ({{ getConsumerStartCount(namespace) }})
                      </button>
                    }
                    @if (getConsumerStopCount(namespace) > 0) {
                      <button
                        class="btn-bulk-action btn-bulk-stop"
                        (click)="performBulkStopConsumer(namespace)"
                        title="Pause message processing for selected resources"
                      >
                        <i class="fas fa-stop"></i>
                        Stop ({{ getConsumerStopCount(namespace) }})
                      </button>
                    }
                  }
                  @if (canToggleSuspendSelected(namespace)) {
                    @if (getSuspendPauseCount(namespace) > 0) {
                      <button
                        class="btn-bulk-action btn-bulk-pause"
                        (click)="performBulkPauseSuspend(namespace)"
                        title="Pause selected workflow schedules"
                      >
                        <i class="fas fa-pause"></i>
                        Pause ({{ getSuspendPauseCount(namespace) }})
                      </button>
                    }
                    @if (getSuspendResumeCount(namespace) > 0) {
                      <button
                        class="btn-bulk-action btn-bulk-resume"
                        (click)="performBulkResumeSuspend(namespace)"
                        title="Resume selected workflow schedules"
                      >
                        <i class="fas fa-play"></i>
                        Resume ({{ getSuspendResumeCount(namespace) }})
                      </button>
                    }
                    @if (getRunWorkflowCount(namespace) > 0) {
                      <button
                        class="btn-bulk-action btn-bulk-run"
                        (click)="performBulkRunWorkflow(namespace)"
                        title="Run selected workflows now"
                      >
                        <i class="fas fa-rocket"></i>
                        Run Now ({{ getRunWorkflowCount(namespace) }})
                      </button>
                    }
                  }
                </div>
              }
              <i
                class="fas toggle-icon"
                [class.fa-chevron-down]="!isNamespaceOpen(namespace)"
                [class.fa-chevron-up]="isNamespaceOpen(namespace)"
              ></i>
            </div>

            <!-- Namespace Content (Table) -->
            @if (isNamespaceOpen(namespace)) {
              <div class="scanning-table-container">
                <div class="table-help-row">
                  @if (isAdmin()) {
                    <div class="selection-helper">
                      Select rows to enable bulk actions for this namespace.
                    </div>
                  }
                  <div class="action-helper action-helper-right">
                    <span><i class="fas fa-search"></i> Logs</span>
                    @if (isAdmin() && namespace === consumersNamespace()) {
                      <span><i class="fas fa-stop"></i> Stop/Start</span>
                      <span><i class="fas fa-redo"></i> Restart</span>
                    } @else if (isAdmin() && namespace === jobsNamespace()) {
                      <span><i class="fas fa-pause"></i> Pause/Resume</span>
                    <span><i class="fas fa-rocket"></i> Run now</span>
                      <span><i class="fas fa-edit"></i> Edit</span>
                    } @else if (isAdmin()) {
                      <span><i class="fas fa-redo"></i> Restart</span>
                    }
                  </div>
                </div>
                @if (nsData.success && nsData.resources && nsData.resources.length > 0) {
                  <div class="table-wrapper">
                    <div class="table-header-wrapper">
                      <table class="scanning-table scanning-table-header">
                        <thead>
                          <tr>
                            @if (isAdmin()) {
                              <th class="col-checkbox" (click)="$event.stopPropagation()">
                                <input
                                  type="checkbox"
                                  [checked]="isAllSelected(namespace)"
                                  [indeterminate]="isIndeterminate(namespace)"
                                  (change)="toggleSelectAll(namespace)"
                                  (click)="$event.stopPropagation()"
                                  title="Select All"
                                  [attr.aria-label]="'Select all resources in namespace ' + namespace"
                                />
                              </th>
                            }
                            <th class="col-name" (click)="sortTable(namespace, 'name')">
                              Name <i class="fas fa-sort"></i>
                            </th>
                            <th class="col-type" (click)="sortTable(namespace, 'type')">
                              Type <i class="fas fa-sort"></i>
                            </th>
                            <th class="col-version" (click)="sortTable(namespace, 'version')">
                              Version <i class="fas fa-sort"></i>
                            </th>
                            <th class="col-status" (click)="sortTable(namespace, 'status')">
                              Status <i class="fas fa-sort"></i>
                            </th>
                            @if (namespace !== jobsNamespace()) {
                              <th class="col-replicas" (click)="sortTable(namespace, 'replicas')" title="Ready / Desired replicas">
                                Replicas <i class="fas fa-sort"></i>
                              </th>
                            }
                            @if (namespace === jobsNamespace()) {
                              <th class="col-schedule" (click)="sortTable(namespace, 'schedule')">
                                Schedule <i class="fas fa-sort"></i>
                              </th>
                            }
                            <th class="col-last-updated" (click)="sortTable(namespace, 'lastUpdated')" title="Timestamp shown in EST">
                              Last Updated <i class="fas fa-sort"></i>
                            </th>
                            @if (namespace === jobsNamespace()) {
                              <th class="col-last-run" (click)="sortTable(namespace, 'lastRun')">
                                Last Run <i class="fas fa-sort"></i>
                              </th>
                            }
                            @if (isAdmin()) {
                              <th class="col-log-level">
                                Log Level
                              </th>
                            }
                            <th
                              class="actions-column"
                              [class.actions-column-consumers]="namespace === consumersNamespace()"
                              [class.actions-column-jobs]="namespace === jobsNamespace()"
                            >
                              Actions
                            </th>
                          </tr>
                        </thead>
                      </table>
                    </div>
                    <div
                      class="table-body-container"
                      [class.table-body-container-expanded]="namespace === jobsNamespace() || namespace === consumersNamespace()"
                    >
                      <table class="scanning-table scanning-table-body">
                        <tbody>
                          @for (resource of getSortedResources(namespace); track resource.metadataName) {
                            <tr
                              class="resource-row"
                              [class.resource-selected]="isAdmin() && isResourceSelected(namespace, resource)"
                              (click)="openInDeepDive(namespace, resource)"
                            >
                              @if (isAdmin()) {
                                <td class="col-checkbox" (click)="$event.stopPropagation()">
                                  <input
                                    type="checkbox"
                                    [checked]="isResourceSelected(namespace, resource)"
                                    (change)="toggleResourceSelection(namespace, resource)"
                                    (click)="$event.stopPropagation()"
                                    [attr.aria-label]="'Select resource ' + resource.name + ' in namespace ' + namespace"
                                  />
                                </td>
                              }
                              <td class="col-name resource-name">
                                <a 
                                  [routerLink]="['/cluster']"
                                  [queryParams]="{ view: 'deepdive', namespace: namespace, resource: resource.metadataName }"
                                  class="resource-name-link"
                                  (click)="$event.stopPropagation()"
                                  [title]="'View resource details'"
                                >
                                  {{ resource.name }}
                                </a>
                              </td>
                              <td class="col-type">
                                <span class="badge badge-type">{{ resource.type }}</span>
                              </td>
                              <td class="col-version">
                                @if (resource.containers && resource.containers.length > 0) {
                                  <span class="version-tag">
                                    {{ resource.containers[0].version }}
                                  </span>
                                } @else {
                                  N/A
                                }
                              </td>
                              <td class="col-status">
                                <span class="health-status" 
                                      [class.status-stopped]="getDisplayStatus(resource) === 'Stopped'"
                                      [class.status-healthy]="getDisplayStatus(resource) === 'Healthy'"
                                      [class.status-degraded]="getDisplayStatus(resource) === 'Degraded'"
                                      [class.status-failed]="getDisplayStatus(resource) === 'Failed'"
                                      [class.status-paused]="getDisplayStatus(resource) === 'Paused'">
                                  {{ getHealthIcon(resource) }} {{ getDisplayStatus(resource) }}
                                </span>
                              </td>
                              @if (namespace !== jobsNamespace()) {
                                <td class="col-replicas" [title]="getReplicaStatusTitle(resource)">{{ getReplicaStatus(resource) }}</td>
                              }
                              @if (namespace === jobsNamespace()) {
                                <td class="col-schedule">
                                  @if (resource.type === 'CronWorkflow' && resource.schedule) {
                                    {{ resource.schedule | cronFormat }}
                                  } @else {
                                    N/A
                                  }
                                </td>
                              }
                              <td class="col-last-updated last-updated">
                                {{ formatDateEST(resource.lastUpdated) }}
                              </td>
                              @if (namespace === jobsNamespace()) {
                                <td class="col-last-run">
                                  @if (resource.lastScheduleTime) {
                                    {{ formatDateEST(resource.lastScheduleTime) }}
                                  } @else if (resource.type === 'CronWorkflow') {
                                    Never
                                  } @else {
                                    N/A
                                  }
                                </td>
                              }
                              @if (isAdmin()) {
                                <td class="col-log-level" (click)="$event.stopPropagation()">
                                  @if (resource.type === 'Deployment' || resource.type === 'DaemonSet' || resource.type === 'StatefulSet' || resource.type === 'CronWorkflow') {
                                    <div class="log-level-cell">
                                      <select
                                        class="log-level-select"
                                        [ngModel]="getSelectedLogLevel(namespace, resource)"
                                        [disabled]="isActionLoading(namespace, resource.metadataName, 'logLevel')"
                                        (ngModelChange)="onLogLevelSelectionChange(namespace, resource, $event)"
                                        title="Set Logging__LogLevel__Default for all containers"
                                        [attr.aria-label]="'Select log level for ' + resource.name"
                                      >
                                        @for (level of availableLogLevels; track level) {
                                          <option [value]="level">{{ level }}</option>
                                        }
                                      </select>
                                      <button
                                        class="btn-consumer-control btn-log-level-update"
                                        [disabled]="isActionLoading(namespace, resource.metadataName, 'logLevel')"
                                        (click)="updateLogLevel(namespace, resource)"
                                        [title]="resource.type === 'CronWorkflow' ? 'Update log level for future workflow runs' : 'Update log level and trigger rollout'"
                                        [attr.aria-label]="'Update log level for ' + resource.name"
                                      >
                                        @if (isActionLoading(namespace, resource.metadataName, 'logLevel')) {
                                          <i class="fas fa-sliders-h fa-spin"></i>
                                        } @else {
                                          <i class="fas fa-sliders-h"></i>
                                        }
                                      </button>
                                    </div>
                                  } @else {
                                    <span class="log-level-na">N/A</span>
                                  }
                                </td>
                              }
                              <td
                                class="actions-cell"
                                [class.actions-cell-consumers]="namespace === consumersNamespace()"
                                [class.actions-cell-jobs]="namespace === jobsNamespace()"
                                (click)="$event.stopPropagation()"
                              >
                                <div class="resource-actions">
                                  <!-- Aggregated Logs button -->
                                  <button
                                    class="btn-consumer-control btn-elastic-logs-scanning"
                                    (click)="viewElasticLogs(namespace, resource)"
                                    title="Open logs for this resource"
                                    [attr.aria-label]="'Open logs for ' + resource.name"
                                  >
                                    <i class="fas fa-search"></i>
                                  </button>
                                  @if (resource.type === 'Deployment' && namespace === consumersNamespace() && isAdmin()) {
                                    <button
                                      class="btn-consumer-control"
                                      [class.btn-stop]="resource.consumerEnabled !== false"
                                      [class.btn-start]="resource.consumerEnabled === false"
                                      [disabled]="isActionLoading(namespace, resource.metadataName, 'toggleConsumer')"
                                      (click)="toggleConsumer(namespace, resource)"
                                      [title]="resource.consumerEnabled !== false ? 'Pause message processing' : 'Resume message processing'"
                                    >
                                      @if (isActionLoading(namespace, resource.metadataName, 'toggleConsumer')) {
                                        <i class="fas fa-spinner fa-spin"></i>
                                      } @else {
                                        <i
                                          class="fas"
                                          [class.fa-stop]="resource.consumerEnabled !== false"
                                          [class.fa-play]="resource.consumerEnabled === false"
                                        ></i>
                                      }
                                    </button>
                                  }
                                  @if ((resource.type === 'Deployment' || resource.type === 'DaemonSet' || resource.type === 'StatefulSet') && isAdmin()) {
                                    <button
                                      class="btn-consumer-control btn-restart-scanning"
                                      [disabled]="isActionLoading(namespace, resource.metadataName, 'restart')"
                                      (click)="restartResource(namespace, resource)"
                                      title="Restart this resource"
                                      [attr.aria-label]="'Restart ' + resource.type + ' ' + resource.name"
                                    >
                                      @if (isActionLoading(namespace, resource.metadataName, 'restart')) {
                                        <i class="fas fa-redo fa-spin"></i>
                                      } @else {
                                        <i class="fas fa-redo"></i>
                                      }
                                    </button>
                                  }
                                  @if (resource.type === 'CronWorkflow' && isAdmin()) {
                                    <button
                                      class="btn-consumer-control btn-suspend-scanning"
                                      [class.btn-resume]="resource.suspend === true"
                                      [disabled]="isActionLoading(namespace, resource.metadataName, 'toggleSuspend')"
                                      (click)="toggleSuspend(namespace, resource)"
                                      [title]="resource.suspend ? 'Resume this workflow schedule' : 'Pause this workflow schedule'"
                                      [attr.aria-label]="(resource.suspend ? 'Resume' : 'Suspend') + ' cron workflow ' + resource.name"
                                    >
                                      @if (isActionLoading(namespace, resource.metadataName, 'toggleSuspend')) {
                                        <i class="fas fa-spinner fa-spin"></i>
                                      } @else {
                                        <i
                                          class="fas"
                                          [class.fa-pause]="resource.suspend !== true"
                                          [class.fa-play]="resource.suspend === true"
                                        ></i>
                                      }
                                    </button>
                                    <button
                                      class="btn-consumer-control btn-run-scanning"
                                      [disabled]="isActionLoading(namespace, resource.metadataName, 'submit')"
                                      (click)="submitWorkflow(namespace, resource)"
                                      title="Run this workflow now"
                                      [attr.aria-label]="'Run workflow now for ' + resource.name"
                                    >
                                      @if (isActionLoading(namespace, resource.metadataName, 'submit')) {
                                        <i class="fas fa-spinner fa-spin"></i>
                                      } @else {
                                        <i class="fas fa-rocket"></i>
                                      }
                                    </button>
                                    <button
                                      class="btn-consumer-control btn-edit-scanning"
                                      (click)="editCronWorkflow(namespace, resource)"
                                      title="Edit schedule settings"
                                      [attr.aria-label]="'Edit schedule and suspend settings for ' + resource.name"
                                    >
                                      <i class="fas fa-edit"></i>
                                    </button>
                                  }
                                </div>
                              </td>
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  </div>
                } @else if (!nsData.success) {
                  <div class="error-message">
                    <i class="fas fa-exclamation-triangle"></i>
                    {{ nsData.error || 'Failed to load namespace' }}
                  </div>
                }
              </div>
            }
          </div>
          }
        }
        }
      }
      @if (!isLoading() && filteredResources().length === 0) {
        <div class="no-resources">
          <i class="fas fa-filter"></i>
          <h3>No resources match your filters</h3>
          <p>Try clearing one or more filters to see resources again.</p>
          <button type="button" class="summary-clear-btn" (click)="clearAllFilters()">Reset filters</button>
        </div>
      }
    </div>
    </div>
    @if (currentLogsResource()) {
      <app-logs-viewer
        [namespace]="currentLogsNamespace()"
        [resource]="currentLogsResource()!"
        [resourceType]="currentLogsResourceType()"
        [podName]="currentLogsPodName()"
        (closed)="closeLogsViewer()"
        (podChanged)="onLogsPodChanged($event)"
      />
    }
    @if (currentElasticLogsResource()) {
      <app-elasticsearch-logs-viewer
        [namespace]="currentElasticLogsNamespace()"
        [resource]="currentElasticLogsResource()!"
        (closed)="closeElasticLogsViewer()"
      />
    }
    @if (currentEditResource()) {
      <app-edit-cronworkflow
        [namespace]="currentEditNamespace()"
        [resource]="currentEditResource()!"
        (closed)="closeEditModal()"
        (saved)="onCronWorkflowSaved($event)"
      />
    }
    @if (currentBulkAction(); as bulkAction) {
      <app-bulk-action-progress
        [actionType]="bulkAction.actionType"
        [items]="bulkAction.items"
        [actionLabel]="bulkAction.actionLabel"
        (close)="closeBulkActionModal()"
        (retry)="retryBulkActionItem($event)"
      />
    }
  `,
  styles: [
    `
      .scanning-view-container {
        width: var(--base-viewport-width);
        padding-right: 1.5rem;
        position: fixed;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
    .scanning-view {
        padding: 0;
      }
      .cluster-top-controls-row {
        margin-top: 0.75rem;
        margin-bottom: 0.85rem;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
      }
      .cluster-top-controls-left {
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
      }
      .global-total-applications {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        border-radius: 999px;
        padding: 0.34rem 0.75rem;
        border: 1px solid var(--theme-border-teal, #5fa6a3);
        background: #ecfeff;
        color: #0f766e;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
      }
      .cluster-search-row {
        display: flex;
        justify-content: flex-end;
        flex: 1;
      }
      .cluster-search-row app-search-bar {
        width: 50%;
        min-width: 340px;
        max-width: 680px;
      }
      .active-filters-summary {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        flex-wrap: wrap;
        padding: 0.65rem 0.85rem;
        background: var(--theme-bg-teal-lighter);
        border: 1px solid #c7d2fe;
        border-radius: 10px;
        margin-bottom: 1rem;
      }
      .summary-text {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }
      .summary-badges {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .summary-badge {
        display: inline-flex;
        align-items: center;
        padding: 0.12rem 0.45rem;
        border-radius: 999px;
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
      }
      .summary-clear-btn {
        margin-left: auto;
        border: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
        border-radius: 999px;
        padding: 0.28rem 0.7rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
      }
      .summary-clear-btn:hover {
        background: var(--theme-bg-app);
      }
      .selection-helper {
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
        margin-bottom: 0;
      }
      .table-help-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.6rem;
        flex-wrap: wrap;
        margin-bottom: 0.45rem;
      }
      .action-helper {
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        flex-wrap: wrap;
        margin-bottom: 0;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
      }
      .action-helper span {
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        background: var(--theme-bg-app);
        border-radius: 999px;
        padding: 0.14rem 0.46rem;
      }
      .action-helper-right {
        margin-left: auto;
        justify-content: flex-end;
      }

      .scanning-namespace {
        background-color: var(--theme-bg-app);
        border-radius: 12px;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        margin-bottom: 1.5rem;
        overflow: hidden;
      }

      .scanning-namespace-header {
        display: grid;
        grid-template-columns: minmax(220px, 1fr) auto minmax(0, 1fr) auto;
        align-items: center;
        column-gap: 0.8rem;
        padding: 1.25rem 1.5rem;
        cursor: pointer;
        background-color: var(--theme-bg-surface);
        border-bottom: 1px solid var(--border-color, var(--theme-border-gray-light));
        transition: all 0.3s ease;
        user-select: none;
      }

      .scanning-namespace-header:hover {
        background-color: var(--theme-bg-surface);
      }

      .namespace-info {
        display: flex;
        align-items: center;
        gap: 1rem;
        pointer-events: none;
        grid-column: 1;
        justify-content: flex-start;
        min-width: 0;
      }
      .namespace-status-center {
        grid-column: 2;
        justify-self: center;
        min-width: 0;
        pointer-events: none;
      }

      .namespace-bulk-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        grid-column: 3;
        justify-self: end;
        margin-right: 0;
      }

      .btn-bulk-action {
        padding: 0.5rem 1rem;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
        white-space: nowrap;
      }

      .btn-bulk-action i {
        font-size: var(--theme-font-body);
      }

      .btn-bulk-restart {
        background-color: var(--theme-button-primary);
        color: white;
      }

      .btn-bulk-restart:hover {
        background-color: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px var(--theme-button-primary-shadow);
      }

      .btn-bulk-stop {
        background-color: #ef4444;
        color: white;
      }

      .btn-bulk-stop:hover {
        background-color: #dc2626;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3);
      }

      .btn-bulk-start {
        background-color: #10b981;
        color: white;
      }

      .btn-bulk-start:hover {
        background-color: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
      }

      .btn-bulk-pause {
        background-color: #f59e0b;
        color: white;
      }

      .btn-bulk-pause:hover {
        background-color: #d97706;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(245, 158, 11, 0.3);
      }

      .btn-bulk-resume {
        background-color: #10b981;
        color: white;
      }

      .btn-bulk-resume:hover {
        background-color: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
      }

      .btn-bulk-run {
        background-color: #10b981; /* Green for run - consistent */
        color: white;
      }

      .btn-bulk-run:hover {
        background-color: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
      }

      .resource-row.resource-selected {
        background-color: var(--theme-bg-teal-lighter);
        border-left: 3px solid var(--theme-border-teal);
      }

      .resource-row.resource-selected:hover {
        background-color: var(--theme-bg-teal-lighter);
      }

      .namespace-info i.fa-folder-open {
        color: var(--warning-color, #f59e0b);
        font-size: var(--theme-font-page-title);
      }

      .namespace-name {
        font-size: var(--theme-font-page-title);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-primary, var(--theme-text-dark));
      }
      .namespace-status-pills {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        flex-wrap: wrap;
        justify-content: center;
      }
      .namespace-status-pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 0.22rem 0.48rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        line-height: 1;
      }
      .namespace-status-pill.status-healthy {
        background: #dcfce7;
        color: #166534;
      }
      .namespace-status-pill.status-degraded {
        background: #fef3c7;
        color: #92400e;
      }
      .namespace-status-pill.status-failed {
        background: #fee2e2;
        color: #991b1b;
      }
      .namespace-status-pill.status-stopped {
        background: #ffedd5;
        color: #9a3412;
      }
      .namespace-status-pill.status-paused {
        background: #ede9fe;
        color: #5b21b6;
      }
      .namespace-status-pill.status-pending {
        background: #fef9c3;
        color: #854d0e;
      }
      .namespace-status-pill.status-running {
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-text-teal-dark);
      }
      .namespace-status-pill.status-never-run {
        background: var(--theme-bg-teal-lighter);
        color: var(--theme-table-header-color);
      }
      .namespace-status-pill.status-total {
        background: var(--theme-border-gray);
        color: var(--theme-text-gray-dark);
      }
      .namespace-status-pills.skeleton-status-pills {
        pointer-events: none;
      }
      .namespace-status-pill.skeleton-status-pill {
        background: var(--theme-bg-app);
        color: transparent;
      }

      .toggle-icon {
        color: var(--text-secondary, var(--theme-text-gray));
        transition: transform 0.3s ease;
        pointer-events: none;
        grid-column: 4;
        justify-self: end;
      }

      .badge {
        padding: 0.5rem 1rem;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        pointer-events: none;
      }

      .badge-success {
        background-color: #d1fae5;
        color: #065f46;
      }

      .badge-type {
        background-color: var(--bg-color, var(--theme-bg-app));
        color: var(--text-primary, var(--theme-text-dark));
        padding: 0.14rem 0.45rem;
        font-size: var(--theme-font-caption);
        text-transform: uppercase;
        display: inline-block;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.15;
      }

      .scanning-table-container {
        padding: 1.5rem;
        background-color: var(--theme-bg-app);
      }

      .table-wrapper {
        display: block;
        border: 1px solid var(--theme-border-gray);
        border-radius: 8px;
        overflow: hidden;
        width: 100%;
        position: relative;
      }

      .table-header-wrapper {
        width: 100%;
        overflow: hidden;
        background-color: var(--theme-table-header-bg);
        position: relative;
        box-sizing: border-box;
      }

      .scanning-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        margin: 0;
      }

      .scanning-table-header {
        background-color: var(--theme-table-header-bg);
        width: 100%;
      }

      .scanning-table-header thead {
        background-color: var(--theme-table-header-bg);
      }

      .scanning-table-header th {
        text-align: left;
        padding: 0.58rem 0.65rem;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-secondary, var(--theme-text-gray));
        text-transform: uppercase;
        font-size: var(--theme-font-table-header);
        letter-spacing: 0.5px;
        cursor: pointer;
        user-select: none;
        transition: all 0.3s ease;
        background-color: var(--theme-table-header-bg);
      }

      .table-body-container {
        max-height: 300px;
        overflow-y: auto;
        overflow-x: hidden;
        width: 100%;
        position: relative;
        box-sizing: border-box;
      }
      .table-body-container.table-body-container-expanded {
        max-height: 420px;
      }

      .table-body-container::-webkit-scrollbar {
        width: 17px;
      }

      .table-body-container {
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }


      .scanning-table-body {
        background: var(--theme-bg-surface);
        margin: 0;
        table-layout: fixed;
        width: 100%;
      }

      .scanning-table-body tbody {
        display: table-row-group;
      }

      .scanning-table-body tbody tr {
        display: table-row;
      }

      .scanning-table-body tbody td {
        display: table-cell;
      }

      /* Optimize column widths */
      .scanning-table th.col-checkbox,
      .scanning-table td.col-checkbox {
        /* Checkbox column - fixed width */
        width: 38px;
        min-width: 38px;
        max-width: 38px;
        text-align: center;
        padding: 0.6rem 0.35rem;
      }

      .scanning-table th.col-checkbox input[type="checkbox"],
      .scanning-table td.col-checkbox input[type="checkbox"] {
        width: 14px;
        height: 14px;
        cursor: pointer;
        accent-color: var(--theme-button-primary);
      }

      .scanning-table th.col-name,
      .scanning-table td.col-name {
        /* Name column - flexible, takes more space */
        width: 22%;
        min-width: 180px;
        max-width: 280px;
      }

      .scanning-table th.col-type,
      .scanning-table td.col-type {
        /* Type column - fixed width for badge */
        width: 96px;
        min-width: 96px;
        max-width: 96px;
      }

      .scanning-table th.col-version,
      .scanning-table td.col-version {
        /* Version column - wider for version tags */
        width: 180px;
        min-width: 160px;
        max-width: 180px;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
      }

      .scanning-table th.col-status,
      .scanning-table td.col-status {
        /* Status column - wider for status text */
        width: 140px;
        min-width: 130px;
        max-width: 140px;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
      }

      .scanning-table th.col-replicas,
      .scanning-table td.col-replicas {
        /* Replicas column - narrow for numbers like "1/1" */
        width: 100px;
        min-width: 80px;
        max-width: 100px;
        text-align: center;
      }

      .scanning-table th.col-schedule,
      .scanning-table td.col-schedule {
        /* Schedule column - medium for cron format */
        width: 160px;
        min-width: 150px;
        max-width: 160px;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
      }

      .scanning-table th.col-last-updated,
      .scanning-table td.col-last-updated {
        /* Last Updated column - medium for dates */
        width: 160px;
        min-width: 150px;
        max-width: 160px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .scanning-table th.col-last-run,
      .scanning-table td.col-last-run {
        /* Last Run column - medium for dates */
        width: 160px;
        min-width: 150px;
        max-width: 160px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .scanning-table th.col-log-level,
      .scanning-table td.col-log-level {
        width: 168px;
        min-width: 168px;
        max-width: 168px;
      }

      .scanning-table th.actions-column,
      .scanning-table td.actions-cell {
        /* Compact default actions width (logs + restart) */
        width: 94px;
        min-width: 94px;
        max-width: 94px;
      }
      .scanning-table th.actions-column.actions-column-consumers,
      .scanning-table td.actions-cell.actions-cell-consumers {
        /* Consumers may show logs + stop/start + restart */
        width: 94px;
        min-width: 94px;
        max-width: 94px;
      }
      .scanning-table th.actions-column.actions-column-jobs,
      .scanning-table td.actions-cell.actions-cell-jobs {
        /* Jobs may show logs + pause/resume + run + edit */
        width: 160px;
        min-width: 160px;
        max-width: 160px;
      }

      .scanning-table-header th:hover {
        color: var(--primary-color, var(--theme-text-teal));
        background-color: var(--theme-table-header-bg-hover);
      }

      .scanning-table-header th i {
        margin-left: 0.5rem;
        font-size: var(--theme-font-caption);
        opacity: 0.5;
        transition: opacity 0.3s ease;
      }

      .scanning-table-header th:hover i {
        opacity: 1;
      }

      .scanning-table-body tbody tr {
        border-bottom: 1px solid var(--border-color, var(--theme-border-gray-light));
        transition: all 0.3s ease;
        cursor: pointer;
      }

      .scanning-table-body tbody tr:last-child {
        border-bottom: none;
      }

      .scanning-table-body tbody tr:hover {
        background-color: #e0e7ff;
      }

      .scanning-table-body td {
        padding: 0.42rem 0.65rem;
        font-size: var(--theme-font-table-body);
        vertical-align: top;
      }

      /* Text overflow handling for specific columns */
      .scanning-table-body td.col-name {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .scanning-table-body td.col-type {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.15;
      }

      .scanning-table-body td.col-version {
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
        line-height: 1.4;
      }

      .scanning-table-body td.col-status {
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
        line-height: 1.4;
      }

      .scanning-table-body td.col-schedule {
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
        line-height: 1.4;
      }

      .scanning-table td:first-child {
        padding-left: 1rem;
      }

      .scanning-table td:last-child {
        padding-right: 1rem;
      }

      .resource-name {
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--text-primary, var(--theme-text-dark));
        display: block;
        white-space: nowrap;
      }

      .resource-name-link {
        color: var(--theme-button-primary);
        cursor: pointer;
        text-decoration: none;
        transition: all 0.2s ease;
        display: inline-block;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
      }

      .resource-name-link:hover {
        color: var(--theme-button-primary-hover, #851697);
        text-decoration: underline;
      }

      .resource-name-link:active {
        transform: translateY(1px);
      }

      .resource-name-link:visited {
        color: var(--theme-button-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }

      .version-tag {
        background-color: var(--success-color, #10b981);
        color: white;
        padding: 0.15rem 0.45rem;
        border-radius: 4px;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        display: inline-block;
        max-width: 100%;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
        line-height: 1.4;
      }

      .health-status {
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        display: inline-block;
        max-width: 100%;
        word-wrap: break-word;
        overflow-wrap: break-word;
        white-space: normal;
        line-height: 1.4;
      }

      .health-status.status-stopped {
        color: #ef4444; /* Red for stopped - consistent with stop button */
      }

      .health-status.status-healthy {
        color: #10b981; /* Green for healthy */
      }

      .health-status.status-degraded {
        color: #f59e0b; /* Orange for degraded */
      }

      .health-status.status-failed {
        color: #ef4444; /* Red for failed */
      }

      .health-status.status-paused {
        color: #f59e0b; /* Orange for paused */
      }

      .last-updated {
        color: var(--text-secondary, var(--theme-text-gray));
        font-size: var(--theme-font-table-header);
      }

      .actions-column {
        width: 94px;
        text-align: right;
      }

      .actions-cell {
        text-align: right;
        vertical-align: middle;
      }
      .scanning-table-header th.actions-column {
        text-align: right;
        padding-right: 1rem;
      }
      .scanning-table-body td.actions-cell {
        text-align: right;
        padding-right: 1rem;
      }

      .resource-actions {
        display: flex;
        gap: 0.35rem;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: nowrap;
        width: 100%;
      }

      .btn-consumer-control {
        width: 30px;
        height: 30px;
        padding: 0;
        border: 1px solid #d1d5db;
        background-color: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        border-radius: 6px;
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

      .btn-consumer-control.btn-start {
        color: #059669;
      }

      .btn-consumer-control.btn-start:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #059669;
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

      .btn-restart-scanning {
        color: var(--theme-button-primary);
      }

      .btn-restart-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: var(--theme-button-primary-hover);
        color: var(--theme-button-primary-hover);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .log-level-select {
        height: 30px;
        border: 1px solid var(--theme-border-gray);
        border-radius: 6px;
        padding: 0 0.35rem;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
        background: var(--theme-bg-surface);
        min-width: 118px;
      }

      .log-level-select:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .btn-log-level-update {
        background: #0f766e;
        border-color: #0f766e;
        color: #ffffff;
      }

      .btn-log-level-update:hover:not(:disabled) {
        background: #0d5f59;
        border-color: #0d5f59;
      }

      .log-level-cell {
        display: inline-flex;
        align-items: center;
        gap: 0.3rem;
      }

      .log-level-na {
        color: var(--theme-text-gray);
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-caption);
      }

      .btn-suspend-scanning {
        color: #b45309;
      }

      .btn-suspend-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #b45309;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-suspend-scanning.btn-resume {
        color: #059669;
      }

      .btn-suspend-scanning.btn-resume:hover:not(:disabled) {
        border-color: #059669;
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-edit-scanning {
        color: var(--theme-button-primary);
      }

      .btn-edit-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: var(--theme-button-primary-hover);
        color: var(--theme-button-primary-hover);
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-run-scanning {
        color: #059669;
      }

      .btn-run-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #059669;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-elastic-logs-scanning {
        color: #059669;
      }

      .btn-elastic-logs-scanning:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        border-color: #059669;
        transform: translateY(-2px);
        box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
      }

      .btn-consumer-control:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        pointer-events: none;
      }
      
      .btn-consumer-control .fa-spinner {
        animation: spin 1s linear infinite;
      }
      
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .no-resources {
        padding: 2rem;
        text-align: center;
        color: var(--text-secondary, var(--theme-text-gray));
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.45rem;
      }
      .no-resources i {
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-gray);
        opacity: 0.8;
      }
      .no-resources h3 {
        margin: 0.1rem 0;
        color: var(--theme-table-header-color);
        font-size: var(--theme-font-body);
      }
      .no-resources p {
        margin: 0 0 0.35rem;
      }

      .error-message {
        background-color: #fee2e2;
        color: var(--error-color, #ef4444);
        padding: 1rem 1.5rem;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin: 1rem;
      }

      /* Skeleton Loaders */
      .skeleton {
        background: linear-gradient(90deg, var(--theme-skeleton-base) 25%, var(--theme-skeleton-highlight) 50%, var(--theme-skeleton-base) 75%);
        background-size: 200% 100%;
        animation: skeletonPulse 1.5s ease-in-out infinite;
        border-radius: 4px;
      }

      .skeleton-text {
        height: 16px;
      }

      .skeleton-text-lg {
        height: 20px;
        width: 200px;
      }

      .skeleton-badge {
        height: 28px;
        width: 80px;
      }

      .skeleton-cell {
        display: inline-block;
        height: 14px;
        border-radius: 999px;
      }

      .skeleton-pill {
        display: inline-block;
        height: 22px;
        border-radius: 999px;
      }

      .skeleton-action-dot {
        display: inline-block;
        width: 24px;
        height: 24px;
        border-radius: 999px;
      }

      @keyframes skeletonPulse {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
    `,
  ],
})
export class ScanningViewComponent implements OnInit, AfterViewInit, OnDestroy {
  private stateService = inject(ClusterStateService);
  private resourcesService = inject(ResourcesService);
  private consumersService = inject(ConsumersService);
  private cronWorkflowsService = inject(CronWorkflowsService);
  private authService = inject(AuthService);
  private viewportScaleService = inject(ViewportScaleService);
  private platformId = inject(PLATFORM_ID);
  private hostElement = inject(ElementRef);
  private router = inject(Router);
  
  private resizeObserver?: ResizeObserver;
  private mutationObserver?: MutationObserver;
  private readonly openNamespaceStorageKey = 'cluster-scanning-open-namespace';
  
  // Signal to track the Y offset of this component from top of viewport
  private componentOffsetTop = signal<number>(0);
  
  // Dynamic height style for the container - accounts for header and padding
  containerHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const offsetTop = this.componentOffsetTop();
    
    // Calculate available height: baseHeight - offset from top
    const availableHeight = Math.max(baseHeight - offsetTop, 300); // Minimum 300px
    
    return {
      height: `${availableHeight}px`
    };
  });

  filteredResources = this.stateService.filteredResources;
  clusterData = this.stateService.clusterData;
  loadingStates = this.stateService.loadingStates;
  healthFilter = this.stateService.healthFilter;
  totalResourcesCount = computed(() => this.stateService.stats().total);
  healthFilterCounts = computed(() => {
    const stats = this.stateService.stats();
    return {
      healthy: stats.healthy,
      degraded: stats.degraded,
      failed: stats.failed,
      paused: stats.paused,
      stopped: stats.stopped,
    };
  });
  activeSearchQuery = computed(() => this.stateService.searchQuery().trim());
  activeHealthFilterLabels = computed(() => {
    const labels: Record<string, string> = {
      healthy: 'Healthy',
      degraded: 'Degraded',
      failed: 'Failed',
      paused: 'Paused',
      stopped: 'Stopped',
    };
    return this.stateService.healthFilter().map((status) => labels[status] ?? status);
  });
  hasActiveFilters = computed(() => this.activeSearchQuery().length > 0 || this.stateService.healthFilter().length > 0);
  currentLogsNamespace = signal('');
  currentLogsResource = signal<ResourceInfo | null>(null);
  currentLogsResourceType = signal('');
  currentLogsPodName = signal<string | undefined>(undefined);
  currentElasticLogsNamespace = signal('');
  currentElasticLogsResource = signal<ResourceInfo | null>(null);
  currentEditNamespace = signal('');
  currentEditResource = signal<ResourceInfo | null>(null);
  
  private openNamespaces = signal<Set<string>>(new Set());
  private userHasManuallyToggled = signal(false);
  private sortState = signal<Record<string, { column: string; direction: 'asc' | 'desc' }>>({});
  private actionLoadingStates = signal<Set<string>>(new Set());
  readonly availableLogLevels = ['Trace', 'Debug', 'Information', 'Warning', 'Error', 'Critical', 'None'];
  private selectedLogLevels = signal<Record<string, string>>({});
  private injector = inject(Injector);
  private previousSearchQuery = signal<string>('');

  isAdmin = computed(() => this.authService.isUserAdmin());
  consumersNamespace = computed(() => this.authService.consumersNamespace());
  jobsNamespace = computed(() => this.authService.jobsNamespace());
  
  // Selection state management
  private selectedResources = signal<Set<string>>(new Set());
  
  // Bulk action progress modal
  currentBulkAction = signal<{
    actionType: 'restart' | 'toggleConsumer' | 'toggleSuspend' | 'submit';
    items: BulkActionItem[];
    actionLabel: string;
  } | null>(null);
  
  // Track namespaces affected by bulk actions
  private affectedNamespaces = signal<Set<string>>(new Set());

  namespaces = computed(() => this.authService.namespaces());

  // Filtered namespaces that contain resources matching current filters
  // Also includes namespaces that are still loading (to show skeleton loaders)
  filteredNamespaces = computed(() => {
    const allNamespaces = this.namespaces();
    const loadingStates = this.loadingStates();
    const filtered: string[] = [];
    
    for (const namespace of allNamespaces) {
      // Include namespace if it's still loading (don't filter out until data is loaded)
      if (loadingStates[namespace] === true) {
        filtered.push(namespace);
      } else {
        // Only filter out if data is loaded and no resources match
        const matchingResources = this.getSortedResources(namespace);
        if (matchingResources.length > 0) {
          filtered.push(namespace);
        }
      }
    }
    
    return filtered;
  });

  hasAnyDataLoaded = computed(() => {
    const data = this.clusterData();
    const namespaces = this.namespaces();
    // Check if we have successfully loaded data (not just error states)
    return namespaces.some((ns) => {
      const nsData = data.namespaces[ns];
      return nsData !== undefined && nsData.success === true && nsData.resources !== undefined;
    });
  });

  isLoading = computed(() => {
    const data = this.clusterData();
    const hasAnyNamespaceData = Object.keys(data.namespaces).length > 0;
    
    // Show initial skeleton loader only if no namespace data exists at all
    return !hasAnyNamespaceData;
  });

  isNamespaceLoading(namespace: string): boolean {
    const states = this.loadingStates();
    return states[namespace] === true;
  }

  isActionLoading(namespace: string, resourceName: string, action: string): boolean {
    const key = `${namespace}:${resourceName}:${action}`;
    return this.actionLoadingStates().has(key);
  }

  private setActionLoading(namespace: string, resourceName: string, action: string, loading: boolean): void {
    const key = `${namespace}:${resourceName}:${action}`;
    this.actionLoadingStates.update((states) => {
      const newStates = new Set(states);
      if (loading) {
        newStates.add(key);
      } else {
        newStates.delete(key);
      }
      return newStates;
    });
  }

  ngOnInit(): void {
    // Calculate the offset from top of viewport
    this.calculateComponentOffset();
    
    // Recalculate on window resize
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', () => this.calculateComponentOffset());
    }
    
    // Clean URL for scanning view - keep only namespace param if present
    this.cleanUrlForScanningView();
    
    // Data loading is handled by parent ClusterInfoComponent
    // Only restore URL state here
    this.restoreStateFromUrl();
    this.restoreOpenNamespaceFromStorage();
    
    // Effect for search query changes - opens all filtered namespaces when search is active
    effect(() => {
      const searchQuery = this.stateService.searchQuery().trim();
      const hasSearch = searchQuery.length > 0;
      const previousSearch = this.previousSearchQuery();
      const previousHasSearch = previousSearch.length > 0;
      
      // Only react when search state changes (empty to non-empty or vice versa)
      if (hasSearch !== previousHasSearch) {
        this.previousSearchQuery.set(searchQuery);
        
        if (hasSearch) {
          // Search just became active - open all filtered namespaces
          const filtered = this.filteredNamespaces();
          if (filtered.length > 0) {
            const namespacesToOpen = new Set(filtered);
            // Check if there's a namespace in the URL
            const urlParams = new URLSearchParams(window.location.search);
            const urlNamespace = urlParams.get('namespace');
            const currentView = this.stateService.currentView();
            if (currentView === 'scanning' && urlNamespace && filtered.includes(urlNamespace)) {
              namespacesToOpen.add(urlNamespace);
            }
            this.openNamespaces.set(namespacesToOpen);
          }
        } else {
          // Search just became inactive - restore normal behavior
          // This will be handled by the other effect
        }
      } else {
        // Search state didn't change, but update the stored query
        this.previousSearchQuery.set(searchQuery);
      }
    }, { injector: this.injector });

    // Auto-open namespace from URL or first namespace when filtered namespaces change
    // Only runs when search is NOT active
    effect(() => {
      const searchQuery = this.stateService.searchQuery().trim();
      const hasSearch = searchQuery.length > 0;
      
      // Skip if search is active (handled by the other effect)
      if (hasSearch) {
        return;
      }
      
      const filtered = this.filteredNamespaces();
      const currentlyOpen = this.openNamespaces();
      const userToggled = this.userHasManuallyToggled();
      
      // Don't auto-open if user has manually toggled namespaces
      if (userToggled) {
        return;
      }
      
      if (filtered.length > 0) {
        // Check if there's a namespace in the URL (for scanning mode)
        const urlParams = new URLSearchParams(window.location.search);
        const urlNamespace = urlParams.get('namespace');
        const currentView = this.stateService.currentView();
        
        // Only use URL namespace if we're in scanning mode
        const targetNamespace = (currentView === 'scanning' && urlNamespace && filtered.includes(urlNamespace))
          ? urlNamespace
          : null;
        
        const hasOpenInFiltered = Array.from(currentlyOpen).some(ns => filtered.includes(ns));
        
        // Priority 1: If URL has a namespace and it's in filtered list, always open it
        if (targetNamespace) {
          if (!currentlyOpen.has(targetNamespace)) {
            this.openNamespaces.set(new Set([targetNamespace]));
          }
        } else if (!hasOpenInFiltered) {
          // Priority 2: If no namespace in URL and no namespace is open, open first namespace
          this.openNamespaces.set(new Set([filtered[0]]));
        }
      }
    }, { injector: this.injector });
  }

  ngAfterViewInit(): void {
    // Sync table header and body widths
    this.syncTableWidths();
    
    // Set up observers to sync widths when content changes
    this.setupWidthSync();
  }

  ngOnDestroy(): void {
    // Remove resize listener
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', () => this.calculateComponentOffset());
    }
    
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
    }
  }
  
  /**
   * Calculate the offset of this component from the top of the viewport
   * This accounts for the header and any padding above this component
   */
  private calculateComponentOffset(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    
    // Use setTimeout to ensure DOM has rendered
    setTimeout(() => {
      const element = document.querySelector('.scanning-view-container');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        
        // Convert actual pixel offset to base coordinates
        const offsetInBaseCoords = rect.top / scale;
        
        this.componentOffsetTop.set(offsetInBaseCoords);
      }
    }, 0);
  }

  private syncTableWidths(): void {
    setTimeout(() => {
      const host = this.hostElement.nativeElement;
      const tableWrappers = host.querySelectorAll('.table-wrapper');
      
      tableWrappers.forEach((wrapper: HTMLElement) => {
        const headerWrapper = wrapper.querySelector('.table-header-wrapper') as HTMLElement;
        const bodyContainer = wrapper.querySelector('.table-body-container') as HTMLElement;
        const headerTable = headerWrapper?.querySelector('.scanning-table-header') as HTMLElement;
        const bodyTable = bodyContainer?.querySelector('.scanning-table-body') as HTMLElement;
        
        if (headerWrapper && bodyContainer && headerTable && bodyTable) {
          // Get the wrapper's full width
          const wrapperWidth = wrapper.clientWidth;
          
          // Get the body container's scrollbar width
          const scrollbarWidth = bodyContainer.offsetWidth - bodyContainer.clientWidth;
          
          // Calculate the header width to match body's content area
          const headerTargetWidth = wrapperWidth - scrollbarWidth;
          
          // Set header wrapper width to match body's content area
          headerWrapper.style.width = `${headerTargetWidth}px`;
          
          // Ensure both tables have the same width
          headerTable.style.width = `${headerTargetWidth}px`;
          bodyTable.style.width = `${bodyContainer.clientWidth}px`;
        }
      });
    }, 0);
  }

  private setupWidthSync(): void {
    const host = this.hostElement.nativeElement;
    
    // Use ResizeObserver to sync widths when container size changes
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.syncTableWidths();
      });
      
      const tableWrappers = host.querySelectorAll('.table-wrapper');
      tableWrappers.forEach((wrapper: HTMLElement) => {
        this.resizeObserver?.observe(wrapper);
      });
    }
    
    // Use MutationObserver to sync when content changes
    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        this.syncTableWidths();
      });
      
      this.mutationObserver.observe(host, {
        childList: true,
        subtree: true,
        attributes: false,
      });
    }
  }

  getNamespaceData(namespace: string) {
    const data = this.clusterData();
    return data.namespaces[namespace];
  }

  isNamespaceOpen(namespace: string): boolean {
    return this.openNamespaces().has(namespace);
  }

  private areSetsEqual(set1: Set<string>, set2: Set<string>): boolean {
    if (set1.size !== set2.size) {
      return false;
    }
    for (const item of set1) {
      if (!set2.has(item)) {
        return false;
      }
    }
    return true;
  }

  toggleNamespace(namespace: string): void {
    this.userHasManuallyToggled.set(true);
    const current = new Set(this.openNamespaces());
    const wasOpen = current.has(namespace);
    
    if (wasOpen) {
      current.delete(namespace);
      // Clear URL completely when closing (scanning view should have clean URL)
      this.clearUrlForScanningView();
    } else {
      // Close all others (accordion behavior)
      current.clear();
      current.add(namespace);
      // Update URL with only namespace parameter (clear everything else)
      this.setUrlForScanningView(namespace);
    }
    
    this.openNamespaces.set(current);
    this.persistOpenNamespace(current);

    if (!wasOpen) {
      // Bring the selected accordion to the top after state and layout settle.
      this.scrollNamespaceToTop(namespace);
    }
    
    // Sync table widths after toggling
    setTimeout(() => this.syncTableWidths(), 100);
  }

  private scrollNamespaceToTop(namespace: string, attempt: number = 0): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }

    setTimeout(() => {
      const host = this.hostElement.nativeElement as HTMLElement;
      const namespaceElements = Array.from(
        host.querySelectorAll('.scanning-namespace')
      ) as HTMLElement[];
      const targetNamespace = namespaceElements.find(
        (element) => element.dataset['namespace'] === namespace
      );
      const targetHeader = targetNamespace?.querySelector(
        '.scanning-namespace-header'
      ) as HTMLElement | null;

      if (!targetHeader) {
        if (attempt < 5) {
          this.scrollNamespaceToTop(namespace, attempt + 1);
        }
        return;
      }

      const container =
        this.getScrollableAncestor(targetHeader, host) ??
        (host.querySelector('.scanning-view-container') as HTMLElement | null);
      if (!container) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const headerRect = targetHeader.getBoundingClientRect();
      const desiredTop = Math.max(
        0,
        container.scrollTop + (headerRect.top - containerRect.top) - 8
      );

      if (Math.abs(container.scrollTop - desiredTop) > 2) {
        container.scrollTo({ top: desiredTop, behavior: 'smooth' });
      }

      // Verify once after expansion/layout settles; correct any drift.
      if (attempt < 2) {
        setTimeout(() => {
          this.scrollNamespaceToTop(namespace, attempt + 1);
        }, 180);
      }
    }, attempt === 0 ? 40 : 80);
  }

  private getScrollableAncestor(element: HTMLElement, fallbackRoot: HTMLElement): HTMLElement | null {
    let current: HTMLElement | null = element.parentElement;
    while (current && current !== fallbackRoot) {
      const styles = window.getComputedStyle(current);
      const overflowY = styles.overflowY;
      const isScrollable = (overflowY === 'auto' || overflowY === 'scroll') && current.scrollHeight > current.clientHeight;
      if (isScrollable) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  getSortedResources(namespace: string): ResourceInfo[] {
    const nsData = this.getNamespaceData(namespace);
    if (!nsData?.success || !nsData.resources) return [];
    
    // Apply health filter first
    const healthFilter = this.stateService.healthFilter();
    let resources = [...nsData.resources];
    
    if (healthFilter.length > 0) {
        resources = resources.filter((resource) => {
        const statusKey = this.mapDisplayStatusToFilter(this.getDisplayStatus(resource));
        return statusKey ? healthFilter.includes(statusKey) : false;
        });
    }
    
    // Apply search filter
    const searchQuery = this.stateService.searchQuery().toLowerCase();
    if (searchQuery) {
      resources = resources.filter((resource) => {
        const searchableText = [
          resource.name,
          resource.metadataName,
          resource.type,
          ...(resource.containers?.map((c) => c.image) || []),
          ...Object.values(resource.containers?.[0]?.environmentVariables || {}),
        ]
          .join(' ')
          .toLowerCase();
        return searchableText.includes(searchQuery);
      });
    }
    
    // Apply sorting
    const sort = this.sortState()[namespace];
    
    if (!sort) {
      return resources.sort((a, b) => a.name.localeCompare(b.name));
    }
    
    return resources.sort((a, b) => {
      let aVal: any;
      let bVal: any;
      
      switch (sort.column) {
        case 'name':
          aVal = a.name;
          bVal = b.name;
          break;
        case 'type':
          aVal = a.type;
          bVal = b.type;
          break;
        case 'version':
          aVal = a.containers?.[0]?.version || '';
          bVal = b.containers?.[0]?.version || '';
          break;
        case 'status':
          aVal = this.getDisplayStatus(a);
          bVal = this.getDisplayStatus(b);
          break;
        case 'replicas':
          aVal = a.readyReplicas || 0;
          bVal = b.readyReplicas || 0;
          break;
        case 'schedule':
          aVal = a.schedule || '';
          bVal = b.schedule || '';
          break;
        case 'lastUpdated':
          aVal = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
          bVal = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
          break;
        case 'lastRun':
          aVal = a.lastScheduleTime ? new Date(a.lastScheduleTime).getTime() : 0;
          bVal = b.lastScheduleTime ? new Date(b.lastScheduleTime).getTime() : 0;
          break;
        default:
          return 0;
      }
      
      if (typeof aVal === 'string') {
        return sort.direction === 'asc' 
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      
      return sort.direction === 'asc' ? aVal - bVal : bVal - aVal;
    });
  }

  sortTable(namespace: string, column: string): void {
    const current = { ...this.sortState() };
    const existing = current[namespace];
    
    if (existing?.column === column) {
      current[namespace] = {
        column,
        direction: existing.direction === 'asc' ? 'desc' : 'asc',
      };
    } else {
      current[namespace] = { column, direction: 'asc' };
    }
    
    this.sortState.set(current);
  }

  getHealthIcon(resource: ResourceInfo): string {
    const status = this.getDisplayStatus(resource);
    const iconMap: Record<string, string> = {
      Healthy: '✅',
      Degraded: '⚠️',
      Failed: '❌',
      Succeeded: '✅',
      Running: '🔄',
      Pending: '⏳',
      'Never Run': '⚪',
      Paused: '⏸️',
      Stopped: '🛑',
    };
    return iconMap[status] || '❓';
  }

  getDisplayStatus(resource: ResourceInfo): string {
    if (resource.type === 'CronWorkflow' && resource.suspend === true) {
      return 'Paused';
    }
    if (
      (resource.type === 'Deployment' ||
        resource.type === 'DaemonSet' ||
        resource.type === 'StatefulSet') &&
      resource.consumerEnabled === false
    ) {
      return 'Stopped';
    }
    return resource.healthStatus;
  }

  getNamespaceStatusCounts(namespace: string): { healthy: number; degraded: number; failed: number; stopped: number; paused: number; pending: number; running: number; neverRun: number } {
    const counts = {
      healthy: 0,
      degraded: 0,
      failed: 0,
      stopped: 0,
      paused: 0,
      pending: 0,
      running: 0,
      neverRun: 0,
    };
    const resources = this.getSortedResources(namespace);
    resources.forEach((resource) => {
      const status = this.getDisplayStatus(resource);
      if (status === 'Healthy' || status === 'Succeeded') {
        counts.healthy += 1;
      } else if (status === 'Degraded') {
        counts.degraded += 1;
      } else if (status === 'Failed') {
        counts.failed += 1;
      } else if (status === 'Stopped') {
        counts.stopped += 1;
      } else if (status === 'Paused') {
        counts.paused += 1;
      } else if (status === 'Pending') {
        counts.pending += 1;
      } else if (status === 'Running') {
        counts.running += 1;
      } else if (status === 'Never Run') {
        counts.neverRun += 1;
      }
    });
    return counts;
  }

  getReplicaStatus(resource: ResourceInfo): string {
    if (
      ['N/A', 'Succeeded', 'Failed', 'Running', 'Pending', 'Never Run'].includes(
        resource.healthStatus
      )
    ) {
      return 'N/A';
    }
    return `${resource.readyReplicas || 0}/${resource.desiredReplicas || 0}`;
  }

  getReplicaStatusTitle(resource: ResourceInfo): string {
    if (this.getReplicaStatus(resource) === 'N/A') {
      return 'Replica information is not available for this resource type.';
    }
    const ready = resource.readyReplicas || 0;
    const desired = resource.desiredReplicas || 0;
    return `${ready} of ${desired} replicas are ready`;
  }

  formatDateEST(dateString?: string): string {
    if (!dateString) {
      return 'N/A';
    }
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return 'N/A';
      }
      const estTime = date.toLocaleString('en-US', {
        timeZone: 'America/New_York',
        dateStyle: 'short',
        timeStyle: 'short',
      });
      return `${estTime} EST`;
    } catch {
      return 'N/A';
    }
  }

  clearAllFilters(): void {
    this.stateService.setSearchQuery('');
    this.stateService.setHealthFilter([]);
  }

  onInlineSearchChange(query: string): void {
    this.stateService.setSearchQuery(query);
  }

  onInlineHealthFilterChange(filter: HealthFilter[]): void {
    this.stateService.setHealthFilter(filter);
    this.updateUrl({ health: filter.length ? filter.join(',') : '' });
  }

  openInDeepDive(namespace: string, resource: ResourceInfo): void {
    this.stateService.setCurrentView('deepdive');
    this.stateService.setSelectedResource(namespace, resource);
    this.updateUrl({
      view: 'deepdive',
      namespace: namespace,
      resource: resource.metadataName,
    });
  }

  private updateUrl(params: {
    view?: string;
    namespace?: string | null;
    resource?: string;
    health?: string;
    logsNamespace?: string | null;
    logsResource?: string | null;
    logsPod?: string | null;
  }): void {
    const url = new URLSearchParams(window.location.search);
    
    if (params.view && params.view !== 'scanning') {
      url.set('view', params.view);
    } else if (params.view === 'scanning') {
      url.delete('view');
    }
    if (params.namespace !== undefined) {
    if (params.namespace) {
      url.set('namespace', params.namespace);
      } else {
        url.delete('namespace');
      }
    }
    if (params.resource) {
      url.set('resource', params.resource);
    }
    if (params.health !== undefined) {
      if (params.health.length > 0) {
        url.set('health', params.health);
      } else {
        url.delete('health');
      }
    }
    if (params.logsNamespace !== undefined) {
      if (params.logsNamespace) {
        url.set('logsNamespace', params.logsNamespace);
      } else {
        url.delete('logsNamespace');
      }
    }
    if (params.logsResource !== undefined) {
      if (params.logsResource) {
        url.set('logsResource', params.logsResource);
      } else {
        url.delete('logsResource');
      }
    }
    if (params.logsPod !== undefined) {
      if (params.logsPod) {
        url.set('logsPod', params.logsPod);
      } else {
        url.delete('logsPod');
      }
    }
    
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    const newUrl = url.toString() ? `${currentPath}?${url.toString()}` : currentPath;
    window.history.pushState({}, '', newUrl);
  }

  /**
   * Set URL for scanning view with only namespace parameter
   */
  private setUrlForScanningView(namespace: string): void {
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    const newUrl = `${currentPath}?namespace=${encodeURIComponent(namespace)}`;
    window.history.pushState({}, '', newUrl);
  }

  /**
   * Clear all URL parameters for scanning view
   */
  private clearUrlForScanningView(): void {
    // Use window.location.pathname to get the full path including base href
    const currentPath = window.location.pathname;
    window.history.pushState({}, '', currentPath);
  }

  private persistOpenNamespace(openNamespaces: Set<string>): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const firstOpen = Array.from(openNamespaces)[0];
    if (firstOpen) {
      window.localStorage.setItem(this.openNamespaceStorageKey, firstOpen);
    } else {
      window.localStorage.removeItem(this.openNamespaceStorageKey);
    }
  }

  private restoreOpenNamespaceFromStorage(): void {
    if (!isPlatformBrowser(this.platformId)) {
      return;
    }
    const storedNamespace = window.localStorage.getItem(this.openNamespaceStorageKey);
    if (!storedNamespace) {
      return;
    }
    const available = this.namespaces();
    if (!available.includes(storedNamespace)) {
      return;
    }
    this.userHasManuallyToggled.set(true);
    this.openNamespaces.set(new Set([storedNamespace]));
    this.setUrlForScanningView(storedNamespace);
  }

  /**
   * Clean URL for scanning view - keep only namespace param if present
   */
  private cleanUrlForScanningView(): void {
    const urlParams = new URLSearchParams(window.location.search);
    const namespace = urlParams.get('namespace');
    
    // If there's a namespace param, keep only that; otherwise clear everything
    if (namespace) {
      this.setUrlForScanningView(namespace);
    } else {
      this.clearUrlForScanningView();
    }
  }

  private restoreStateFromUrl(): void {
    const params = new URLSearchParams(window.location.search);
    const view = params.get('view');
    const namespace = params.get('namespace');
    const resource = params.get('resource');
    const health = params.get('health');
    const logsNamespace = params.get('logsNamespace');
    const logsResource = params.get('logsResource');
    const logsPod = params.get('logsPod');

    if (view && view !== 'scanning') {
      this.stateService.setCurrentView(view as any);
    }

    if (health) {
      const filters = health
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean) as HealthFilter[];
      this.stateService.setHealthFilter(filters);
    }

    if (view === 'deepdive' && namespace && resource) {
      // Wait for data to load, then select resource
      setTimeout(() => {
        const nsData = this.getNamespaceData(namespace);
        if (nsData?.success && nsData.resources) {
          const foundResource = nsData.resources.find((r) => r.metadataName === resource);
          if (foundResource) {
            this.stateService.setSelectedResource(namespace, foundResource);
          }
        }
      }, 500);
    }
    
    // Restore logs modal from URL if parameters are present
    if (logsNamespace && logsResource) {
      setTimeout(() => {
        const nsData = this.getNamespaceData(logsNamespace);
        if (nsData?.success && nsData.resources) {
          const foundResource = nsData.resources.find((r) => r.metadataName === logsResource);
          if (foundResource) {
            this.currentLogsNamespace.set(logsNamespace);
            this.currentLogsResource.set(foundResource);
            this.currentLogsResourceType.set(foundResource.type);
            if (logsPod) {
              this.currentLogsPodName.set(logsPod);
            }
          }
        }
      }, 500);
    }
  }

  viewLogs(namespace: string, resource: ResourceInfo): void {
    this.currentLogsNamespace.set(namespace);
    this.currentLogsResource.set(resource);
    this.currentLogsResourceType.set(resource.type);
    
    // Update URL to include logs modal state
    this.updateUrl({
      logsNamespace: namespace,
      logsResource: resource.metadataName,
    });
  }

  onLogsPodChanged(podName: string): void {
    this.currentLogsPodName.set(podName);
    // Update URL with new pod name
    this.updateUrl({
      logsPod: podName,
    });
  }

  closeLogsViewer(): void {
    this.currentLogsResource.set(null);
    this.currentLogsNamespace.set('');
    this.currentLogsResourceType.set('');
    this.currentLogsPodName.set(undefined);
    
    // Remove logs parameters from URL
    this.updateUrl({
      logsNamespace: null,
      logsResource: null,
      logsPod: null,
    });
  }

  viewElasticLogs(namespace: string, resource: ResourceInfo): void {
    this.currentElasticLogsNamespace.set(namespace);
    this.currentElasticLogsResource.set(resource);
  }

  closeElasticLogsViewer(): void {
    this.currentElasticLogsResource.set(null);
    this.currentElasticLogsNamespace.set('');
  }

  async restartResource(namespace: string, resource: ResourceInfo): Promise<void> {
    if (confirm(this.getRestartWarningMessage(resource))) {
      this.setActionLoading(namespace, resource.metadataName, 'restart', true);
      try {
        await this.resourcesService
          .restartResource({
            namespaceName: namespace,
            resourceName: resource.metadataName,
            resourceType: resource.type,
          })
          .toPromise();
        this.stateService.loadNamespaceData(namespace);
      } catch (error) {
        console.error('Error restarting resource:', error);
        alert('Failed to restart resource');
      } finally {
        this.setActionLoading(namespace, resource.metadataName, 'restart', false);
      }
    }
  }

  getSelectedLogLevel(namespace: string, resource: ResourceInfo): string {
    const key = `${namespace}:${resource.metadataName}`;
    const existing = this.selectedLogLevels()[key];
    if (existing) {
      return this.normalizeLogLevel(existing);
    }

    return this.normalizeLogLevel(this.getCurrentLogLevelFromResource(resource));
  }

  onLogLevelSelectionChange(namespace: string, resource: ResourceInfo, logLevel: string): void {
    const key = `${namespace}:${resource.metadataName}`;
    this.selectedLogLevels.update((current) => ({ ...current, [key]: this.normalizeLogLevel(logLevel) }));
  }

  async updateLogLevel(namespace: string, resource: ResourceInfo): Promise<void> {
    const logLevel = this.getSelectedLogLevel(namespace, resource);
    if (!logLevel) {
      alert('Please select a log level.');
      return;
    }

    const isCronWorkflow = resource.type === 'CronWorkflow';
    const confirmMessage = isCronWorkflow
      ? `WARNING: This change applies to FUTURE CronWorkflow runs only.\n\n` +
        `Resource: ${resource.name}\n` +
        `Setting: Logging__LogLevel__Default = ${logLevel}\n\n` +
        `Suggestion: If you need immediate effect, update now and trigger a new run manually.\n\n` +
        `Do you want to continue?`
      : `WARNING: This action will trigger a ROLLOUT RESTART.\n\n` +
        `Resource: ${resource.name}\n` +
        `Setting: Logging__LogLevel__Default = ${logLevel}\n` +
        `Impact: Pods for this workload will be recreated, which may cause brief disruption.\n\n` +
        `Do you want to continue?`;

    if (!confirm(confirmMessage)) {
      return;
    }

    this.setActionLoading(namespace, resource.metadataName, 'logLevel', true);
    try {
      const response = isCronWorkflow
        ? await this.cronWorkflowsService
            .updateLogLevel({
              namespaceName: namespace,
              resourceName: resource.metadataName,
              logLevel,
            })
            .toPromise()
        : await this.resourcesService
            .updateLogLevel({
              namespaceName: namespace,
              resourceName: resource.metadataName,
              resourceType: resource.type,
              logLevel,
            })
            .toPromise();

      if (response?.success) {
        await this.stateService.loadNamespaceData(namespace, true);
        this.clearSelectedLogLevel(namespace, resource.metadataName);
      } else {
        alert(response?.message || 'Failed to update log level');
      }
    } catch (error: any) {
      console.error('Error updating log level:', error);
      alert('Failed to update log level: ' + (error?.message || 'Unknown error'));
    } finally {
      this.setActionLoading(namespace, resource.metadataName, 'logLevel', false);
    }
  }

  async toggleConsumer(namespace: string, resource: ResourceInfo): Promise<void> {
    const currentState = resource.consumerEnabled !== false;
    const newState = !currentState;
    const action = newState ? 'enable' : 'disable';
    
    if (confirm(`Are you sure you want to ${action} consumer for ${resource.name}?`)) {
      this.setActionLoading(namespace, resource.metadataName, 'toggleConsumer', true);
      try {
        const response = await this.consumersService
          .toggleConsumer({
            namespaceName: namespace,
            deploymentName: resource.metadataName,
            enabled: newState,
          })
          .toPromise();
        
        if (response?.success) {
          // Update the resource in state with the updated resource returned from API
          if (response.updatedResource) {
            this.stateService.updateResourceInState(namespace, response.updatedResource);
          } else {
            // Fallback: reload namespace data if updated resource not provided
            await this.stateService.loadNamespaceData(namespace);
          }
        } else {
          alert(response?.message || 'Failed to toggle consumer');
        }
      } catch (error) {
        console.error('Error toggling consumer:', error);
        alert('Failed to toggle consumer');
      } finally {
        this.setActionLoading(namespace, resource.metadataName, 'toggleConsumer', false);
      }
    }
  }

  private getCurrentLogLevelFromResource(resource: ResourceInfo): string | null {
    if (!resource?.containers?.length) {
      return null;
    }

    for (const container of resource.containers) {
      const envVars = container.environmentVariables ?? {};
      const value = envVars['Logging__LogLevel__Default'];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
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

  private clearSelectedLogLevel(namespace: string, resourceName: string): void {
    const key = `${namespace}:${resourceName}`;
    this.selectedLogLevels.update((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  private getRestartWarningMessage(resource: ResourceInfo): string {
    return `WARNING: This action will trigger a ROLLOUT RESTART.\n\n` +
      `Resource: ${resource.name}\n` +
      `Type: ${resource.type}\n` +
      `Impact: Pods for this workload will be recreated, which may cause brief disruption.\n\n` +
      `Do you want to continue?`;
  }

  private getBulkRestartWarningMessage(namespace: string, count: number): string {
    return `WARNING: This action will trigger ROLLOUT RESTARTS for multiple workloads.\n\n` +
      `Namespace: ${namespace}\n` +
      `Workloads selected: ${count}\n` +
      `Impact: Pods for each selected workload will be recreated, which may cause brief disruption.\n\n` +
      `Do you want to continue?`;
  }

  async toggleSuspend(namespace: string, resource: ResourceInfo): Promise<void> {
    const currentState = resource.suspend === true;
    const newState = !currentState;
    const action = newState ? 'suspend' : 'resume';
    
    if (confirm(`Are you sure you want to ${action} CronWorkflow ${resource.name}?`)) {
      this.setActionLoading(namespace, resource.metadataName, 'toggleSuspend', true);
      try {
        const response = await this.cronWorkflowsService
          .toggleSuspend({
            namespaceName: namespace,
            resourceName: resource.metadataName,
            suspend: newState,
          })
          .toPromise();
        
        if (response?.success) {
          // Update the resource in state with the updated resource returned from API
          if (response.updatedResource) {
            this.stateService.updateResourceInState(namespace, response.updatedResource);
          } else {
            // Fallback: reload namespace data if updated resource not provided
            await this.stateService.loadNamespaceData(namespace);
          }
        } else {
          alert(response?.message || 'Failed to toggle suspend');
        }
      } catch (error) {
        console.error('Error toggling suspend:', error);
        alert('Failed to toggle suspend');
      } finally {
        this.setActionLoading(namespace, resource.metadataName, 'toggleSuspend', false);
      }
    }
  }

  async submitWorkflow(namespace: string, resource: ResourceInfo): Promise<void> {
    if (confirm(`Are you sure you want to run workflow ${resource.name} now?`)) {
      this.setActionLoading(namespace, resource.metadataName, 'submit', true);
      try {
        const response = await this.cronWorkflowsService
          .submitCronWorkflow({
            namespaceName: namespace,
            resourceName: resource.metadataName,
          })
          .toPromise();
        
        if (response?.success) {
          alert(
            response.message + 
            (response.workflowName ? `\nWorkflow: ${response.workflowName}` : '')
          );
          // Reload namespace data to show the new workflow execution
          await this.stateService.loadNamespaceData(namespace);
        } else {
          alert(response?.message || 'Failed to submit workflow');
        }
      } catch (error: any) {
        console.error('Error submitting workflow:', error);
        alert('Failed to submit workflow: ' + (error?.message || 'Unknown error'));
      } finally {
        this.setActionLoading(namespace, resource.metadataName, 'submit', false);
      }
    }
  }

  editCronWorkflow(namespace: string, resource: ResourceInfo): void {
    this.currentEditNamespace.set(namespace);
    this.currentEditResource.set(resource);
  }

  closeEditModal(): void {
    this.currentEditResource.set(null);
    this.currentEditNamespace.set('');
  }

  onCronWorkflowSaved(updatedResource: ResourceInfo): void {
    // Resource is already updated in state service, just close the modal
    this.closeEditModal();
  }
  private mapDisplayStatusToFilter(status: string): HealthFilter | null {
    const map: Record<string, HealthFilter> = {
      Healthy: 'healthy',
      Degraded: 'degraded',
      Failed: 'failed',
      Paused: 'paused',
      Stopped: 'stopped',
    };
    return map[status] ?? null;
  }

  // Selection state management methods
  private getResourceKey(namespace: string, resource: ResourceInfo): string {
    return `${namespace}:${resource.metadataName}`;
  }

  toggleResourceSelection(namespace: string, resource: ResourceInfo): void {
    const key = this.getResourceKey(namespace, resource);
    this.selectedResources.update(selected => {
      const newSet = new Set(selected);
      if (newSet.has(key)) {
        newSet.delete(key);
      } else {
        newSet.add(key);
      }
      return newSet;
    });
  }

  toggleSelectAll(namespace: string): void {
    const resources = this.getSortedResources(namespace);
    const allSelected = this.isAllSelected(namespace);
    
    this.selectedResources.update(selected => {
      const newSet = new Set(selected);
      if (allSelected) {
        // Deselect all in this namespace
        resources.forEach(resource => {
          newSet.delete(this.getResourceKey(namespace, resource));
        });
      } else {
        // Select all in this namespace
        resources.forEach(resource => {
          newSet.add(this.getResourceKey(namespace, resource));
        });
      }
      return newSet;
    });
  }

  isResourceSelected(namespace: string, resource: ResourceInfo): boolean {
    const key = this.getResourceKey(namespace, resource);
    return this.selectedResources().has(key);
  }

  isAllSelected(namespace: string): boolean {
    const resources = this.getSortedResources(namespace);
    if (resources.length === 0) return false;
    return resources.every(resource => 
      this.selectedResources().has(this.getResourceKey(namespace, resource))
    );
  }

  isIndeterminate(namespace: string): boolean {
    const resources = this.getSortedResources(namespace);
    if (resources.length === 0) return false;
    const selectedCount = resources.filter(resource => 
      this.selectedResources().has(this.getResourceKey(namespace, resource))
    ).length;
    return selectedCount > 0 && selectedCount < resources.length;
  }

  getSelectedCount(namespace: string): number {
    const resources = this.getSortedResources(namespace);
    return resources.filter(resource => 
      this.selectedResources().has(this.getResourceKey(namespace, resource))
    ).length;
  }

  clearSelection(namespace: string): void {
    const resources = this.getSortedResources(namespace);
    this.selectedResources.update(selected => {
      const newSet = new Set(selected);
      resources.forEach(resource => {
        newSet.delete(this.getResourceKey(namespace, resource));
      });
      return newSet;
    });
  }

  // Action availability logic
  canRestartSelected(namespace: string): boolean {
    const resources = this.getSortedResources(namespace);
    return resources.some(resource => 
      this.isResourceSelected(namespace, resource) &&
      (resource.type === 'Deployment' || resource.type === 'DaemonSet' || resource.type === 'StatefulSet')
    );
  }

  canToggleConsumerSelected(namespace: string): boolean {
    if (namespace !== this.consumersNamespace()) return false;
    const resources = this.getSortedResources(namespace);
    return resources.some(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'Deployment'
    );
  }

  canToggleSuspendSelected(namespace: string): boolean {
    const resources = this.getSortedResources(namespace);
    return resources.some(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow'
    );
  }

  // Get counts for consumer start/stop actions
  getConsumerStartCount(namespace: string): number {
    if (namespace !== this.consumersNamespace()) return 0;
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'Deployment' &&
      resource.consumerEnabled === false // Stopped services
    );
    return selected.length;
  }

  getConsumerStopCount(namespace: string): number {
    if (namespace !== this.consumersNamespace()) return 0;
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'Deployment' &&
      resource.consumerEnabled !== false // Started services
    );
    return selected.length;
  }

  // Get counts for suspend/resume actions
  getSuspendPauseCount(namespace: string): number {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow' &&
      resource.suspend !== true // Not suspended (can be paused)
    );
    return selected.length;
  }

  getSuspendResumeCount(namespace: string): number {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow' &&
      resource.suspend === true // Suspended (can be resumed)
    );
    return selected.length;
  }

  getRunWorkflowCount(namespace: string): number {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow'
    );
    return selected.length;
  }

  // Bulk action execution methods
  async performBulkRestart(namespace: string): Promise<void> {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      (resource.type === 'Deployment' || resource.type === 'DaemonSet' || resource.type === 'StatefulSet')
    );

    if (selected.length === 0) return;

    if (!confirm(this.getBulkRestartWarningMessage(namespace, selected.length))) {
      return;
    }

    const items: BulkActionItem[] = selected.map(resource => ({
      namespace,
      resource,
      status: 'pending' as const,
    }));

    this.currentBulkAction.set({
      actionType: 'restart',
      items,
      actionLabel: `Restart ${selected.length} Resource(s)`,
    });

    // Track affected namespace
    this.affectedNamespaces.update(ns => {
      const newSet = new Set(ns);
      newSet.add(namespace);
      return newSet;
    });

    // Execute actions sequentially
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'processing';
      this.updateBulkActionItems(items);

      try {
        await this.resourcesService
          .restartResource({
            namespaceName: namespace,
            resourceName: item.resource.metadataName,
            resourceType: item.resource.type,
          })
          .toPromise();
        item.status = 'success';
      } catch (error: any) {
        item.status = 'error';
        item.errorMessage = error?.message || 'Failed to restart resource';
      }

      this.updateBulkActionItems(items);
    }

    // Don't refresh here - let closeBulkActionModal handle it after a delay
    // This prevents race conditions where API hasn't propagated changes yet
    this.clearSelection(namespace);
  }

  async performBulkStartConsumer(namespace: string): Promise<void> {
    if (namespace !== this.consumersNamespace()) return;

    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'Deployment' &&
      resource.consumerEnabled === false // Only stopped services
    );

    if (selected.length === 0) return;

    if (!confirm(`Are you sure you want to start ${selected.length} consumer(s)?`)) {
      return;
    }

    const items: BulkActionItem[] = selected.map(resource => ({
      namespace,
      resource,
      status: 'pending' as const,
    }));

    this.currentBulkAction.set({
      actionType: 'toggleConsumer',
      items,
      actionLabel: `Start ${selected.length} Consumer(s)`,
    });

    // Track affected namespace
    this.affectedNamespaces.update(ns => {
      const newSet = new Set(ns);
      newSet.add(namespace);
      return newSet;
    });

    // Execute actions sequentially - all are start actions (enabled = true)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'processing';
      this.updateBulkActionItems(items);

      try {
        const response = await this.consumersService
          .toggleConsumer({
            namespaceName: namespace,
            deploymentName: item.resource.metadataName,
            enabled: true, // Start the consumer
          })
          .toPromise();

        if (response?.success) {
          item.status = 'success';
          if (response.updatedResource) {
            this.stateService.updateResourceInState(namespace, response.updatedResource);
          }
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to toggle consumer';
        }
      } catch (error: any) {
        item.status = 'error';
        item.errorMessage = error?.message || 'Failed to toggle consumer';
      }

      this.updateBulkActionItems(items);
    }

    // Don't refresh here - let closeBulkActionModal handle it after a delay
    // This prevents race conditions where API hasn't propagated changes yet
    this.clearSelection(namespace);
  }

  async performBulkStopConsumer(namespace: string): Promise<void> {
    if (namespace !== this.consumersNamespace()) return;

    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'Deployment' &&
      resource.consumerEnabled !== false // Only started services
    );

    if (selected.length === 0) return;

    if (!confirm(`Are you sure you want to stop ${selected.length} consumer(s)?`)) {
      return;
    }

    const items: BulkActionItem[] = selected.map(resource => ({
      namespace,
      resource,
      status: 'pending' as const,
    }));

    this.currentBulkAction.set({
      actionType: 'toggleConsumer',
      items,
      actionLabel: `Stop ${selected.length} Consumer(s)`,
    });

    // Track affected namespace
    this.affectedNamespaces.update(ns => {
      const newSet = new Set(ns);
      newSet.add(namespace);
      return newSet;
    });

    // Execute actions sequentially - all are stop actions (enabled = false)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'processing';
      this.updateBulkActionItems(items);

      try {
        const response = await this.consumersService
          .toggleConsumer({
            namespaceName: namespace,
            deploymentName: item.resource.metadataName,
            enabled: false, // Stop the consumer
          })
          .toPromise();

        if (response?.success) {
          item.status = 'success';
          if (response.updatedResource) {
            this.stateService.updateResourceInState(namespace, response.updatedResource);
          }
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to toggle consumer';
        }
      } catch (error: any) {
        item.status = 'error';
        item.errorMessage = error?.message || 'Failed to toggle consumer';
      }

      this.updateBulkActionItems(items);
    }

    // Don't refresh here - let closeBulkActionModal handle it after a delay
    // This prevents race conditions where API hasn't propagated changes yet
    this.clearSelection(namespace);
  }

  async performBulkPauseSuspend(namespace: string): Promise<void> {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow' &&
      resource.suspend !== true // Only non-suspended workflows
    );

    if (selected.length === 0) return;

    if (!confirm(`Are you sure you want to pause ${selected.length} CronWorkflow(s)?`)) {
      return;
    }

    const items: BulkActionItem[] = selected.map(resource => ({
      namespace,
      resource,
      status: 'pending' as const,
    }));

    this.currentBulkAction.set({
      actionType: 'toggleSuspend',
      items,
      actionLabel: `Pause ${selected.length} CronWorkflow(s)`,
    });

    // Track affected namespace
    this.affectedNamespaces.update(ns => {
      const newSet = new Set(ns);
      newSet.add(namespace);
      return newSet;
    });

    // Execute actions sequentially - all are pause actions (suspend = true)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'processing';
      this.updateBulkActionItems(items);

      try {
        const response = await this.cronWorkflowsService
          .toggleSuspend({
            namespaceName: namespace,
            resourceName: item.resource.metadataName,
            suspend: true, // Pause the workflow
          })
          .toPromise();

        if (response?.success) {
          item.status = 'success';
          if (response.updatedResource) {
            this.stateService.updateResourceInState(namespace, response.updatedResource);
          }
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to toggle suspend';
        }
      } catch (error: any) {
        item.status = 'error';
        item.errorMessage = error?.message || 'Failed to toggle suspend';
      }

      this.updateBulkActionItems(items);
    }

    // Don't refresh here - let closeBulkActionModal handle it after a delay
    // This prevents race conditions where API hasn't propagated changes yet
    this.clearSelection(namespace);
  }

  async performBulkResumeSuspend(namespace: string): Promise<void> {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow' &&
      resource.suspend === true // Only suspended workflows
    );

    if (selected.length === 0) return;

    if (!confirm(`Are you sure you want to resume ${selected.length} CronWorkflow(s)?`)) {
      return;
    }

    const items: BulkActionItem[] = selected.map(resource => ({
      namespace,
      resource,
      status: 'pending' as const,
    }));

    this.currentBulkAction.set({
      actionType: 'toggleSuspend',
      items,
      actionLabel: `Resume ${selected.length} CronWorkflow(s)`,
    });

    // Track affected namespace
    this.affectedNamespaces.update(ns => {
      const newSet = new Set(ns);
      newSet.add(namespace);
      return newSet;
    });

    // Execute actions sequentially - all are resume actions (suspend = false)
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'processing';
      this.updateBulkActionItems(items);

      try {
        const response = await this.cronWorkflowsService
          .toggleSuspend({
            namespaceName: namespace,
            resourceName: item.resource.metadataName,
            suspend: false, // Resume the workflow
          })
          .toPromise();

        if (response?.success) {
          item.status = 'success';
          if (response.updatedResource) {
            this.stateService.updateResourceInState(namespace, response.updatedResource);
          }
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to toggle suspend';
        }
      } catch (error: any) {
        item.status = 'error';
        item.errorMessage = error?.message || 'Failed to toggle suspend';
      }

      this.updateBulkActionItems(items);
    }

    // Don't refresh here - let closeBulkActionModal handle it after a delay
    // This prevents race conditions where API hasn't propagated changes yet
    this.clearSelection(namespace);
  }

  async performBulkRunWorkflow(namespace: string): Promise<void> {
    const resources = this.getSortedResources(namespace);
    const selected = resources.filter(resource => 
      this.isResourceSelected(namespace, resource) &&
      resource.type === 'CronWorkflow'
    );

    if (selected.length === 0) return;

    if (!confirm(`Are you sure you want to run ${selected.length} CronWorkflow(s) now?`)) {
      return;
    }

    const items: BulkActionItem[] = selected.map(resource => ({
      namespace,
      resource,
      status: 'pending' as const,
    }));

    this.currentBulkAction.set({
      actionType: 'submit',
      items,
      actionLabel: `Run ${selected.length} CronWorkflow(s) Now`,
    });

    // Track affected namespace
    this.affectedNamespaces.update(ns => {
      const newSet = new Set(ns);
      newSet.add(namespace);
      return newSet;
    });

    // Execute actions sequentially
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      item.status = 'processing';
      this.updateBulkActionItems(items);

      try {
        const response = await this.cronWorkflowsService
          .submitCronWorkflow({
            namespaceName: namespace,
            resourceName: item.resource.metadataName,
          })
          .toPromise();

        if (response?.success) {
          item.status = 'success';
          item.successMessage = response.workflowName 
            ? `Workflow created: ${response.workflowName}` 
            : 'Workflow submitted successfully';
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to submit workflow';
        }
      } catch (error: any) {
        item.status = 'error';
        item.errorMessage = error?.message || 'Failed to submit workflow';
      }

      this.updateBulkActionItems(items);
    }

    // Don't refresh here - let closeBulkActionModal handle it after a delay
    // This prevents race conditions where API hasn't propagated changes yet
    this.clearSelection(namespace);
  }

  private updateBulkActionItems(items: BulkActionItem[]): void {
    const current = this.currentBulkAction();
    if (current) {
      this.currentBulkAction.set({
        ...current,
        items: [...items],
      });
    }
  }

  async closeBulkActionModal(): Promise<void> {
    const bulkAction = this.currentBulkAction();
    
    // Get all unique namespaces from the bulk action items
    const namespacesToRefresh = new Set<string>();
    if (bulkAction) {
      bulkAction.items.forEach(item => {
        namespacesToRefresh.add(item.namespace);
      });
    }
    
    // Also include any tracked affected namespaces
    this.affectedNamespaces().forEach(ns => {
      namespacesToRefresh.add(ns);
    });
    
    // Clear the bulk action state first
    this.currentBulkAction.set(null);
    this.affectedNamespaces.set(new Set());
    
    // Clear selection immediately
    namespacesToRefresh.forEach(namespace => {
      this.clearSelection(namespace);
    });
    
    // Wait a bit for Kubernetes to propagate changes before refreshing
    // This ensures we get the latest state from the API
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Refresh data for all affected namespaces after delay
    const refreshPromises = Array.from(namespacesToRefresh).map(namespace => 
      this.stateService.loadNamespaceData(namespace)
    );
    
    await Promise.all(refreshPromises);
  }

  async retryBulkActionItem(item: BulkActionItem): Promise<void> {
    const current = this.currentBulkAction();
    if (!current) return;

    item.status = 'processing';
    this.updateBulkActionItems(current.items);

    try {
      if (current.actionType === 'restart') {
        await this.resourcesService
          .restartResource({
            namespaceName: item.namespace,
            resourceName: item.resource.metadataName,
            resourceType: item.resource.type,
          })
          .toPromise();
        item.status = 'success';
      } else if (current.actionType === 'toggleConsumer') {
        const shouldStop = item.resource.consumerEnabled !== false;
        const response = await this.consumersService
          .toggleConsumer({
            namespaceName: item.namespace,
            deploymentName: item.resource.metadataName,
            enabled: !shouldStop,
          })
          .toPromise();
        if (response?.success) {
          item.status = 'success';
          if (response.updatedResource) {
            this.stateService.updateResourceInState(item.namespace, response.updatedResource);
          }
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to toggle consumer';
        }
      } else if (current.actionType === 'toggleSuspend') {
        const shouldPause = item.resource.suspend !== true;
        const response = await this.cronWorkflowsService
          .toggleSuspend({
            namespaceName: item.namespace,
            resourceName: item.resource.metadataName,
            suspend: shouldPause,
          })
          .toPromise();
        if (response?.success) {
          item.status = 'success';
          if (response.updatedResource) {
            this.stateService.updateResourceInState(item.namespace, response.updatedResource);
          }
        } else {
          item.status = 'error';
          item.errorMessage = response?.message || 'Failed to toggle suspend';
        }
      }

      // Reload namespace data after retry
      await this.stateService.loadNamespaceData(item.namespace);
    } catch (error: any) {
      item.status = 'error';
      item.errorMessage = error?.message || 'Action failed';
    }

    this.updateBulkActionItems(current.items);
  }
}
