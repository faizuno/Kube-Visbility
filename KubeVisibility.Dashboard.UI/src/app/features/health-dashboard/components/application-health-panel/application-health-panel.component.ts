import { Component, computed, inject, signal, OnInit, OnDestroy, input } from '@angular/core';

import { Router, ActivatedRoute, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { EchartsWrapperComponent } from '../../../../shared/components/echarts-wrapper/echarts-wrapper.component';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';
import { HealthStateService } from '../../services/health-state.service';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import type { EChartsOption } from 'echarts';
import type { ServiceDetail, ConsumerDetail, JobDetail } from '../../models/health.models';

type CategoryType = 'services' | 'consumers' | 'jobs';
type StatusFilter = string | null;

@Component({
  selector: 'app-application-health-panel',
  standalone: true,
  imports: [RouterLink, EchartsWrapperComponent, LoadingSkeletonComponent],
  template: `
    <div class="application-health-panel">
      <!-- Three Pie Charts Row -->
      <div class="charts-grid">
        <!-- Services Chart -->
        <div class="chart-card" (click)="navigateToServices()">
          <div class="chart-header">
            <div class="chart-title">
              <i class="fas fa-server"></i>
              <span>Services</span>
            </div>
            <div class="chart-count">{{ isLoading() ? '-' : servicesCount() }}</div>
          </div>
          <div class="chart-content" (click)="$event.stopPropagation()">
              @if (isLoading()) {
                <app-loading-skeleton [count]="1" height="200px" borderRadius="6px" />
              } @else {
                <app-echarts-wrapper
                  [chartOption]="servicesStatusChart()"
                  [loadingState]="healthState.isLoadingServicesHealth()"
                  height="200px"
                  (chartClick)="onChartClick('services', $event)">
                </app-echarts-wrapper>
              }
          </div>
          <div class="chart-summary">
            <div class="summary-item success">
              <span class="dot"></span>
              <span class="label">Running:</span>
              <span class="value">{{ isLoading() ? '-' : servicesRunning() }}</span>
            </div>
            <div class="summary-item stopped">
              <span class="dot"></span>
              <span class="label">Stopped:</span>
              <span class="value">{{ isLoading() ? '-' : servicesStopped() }}</span>
            </div>
            <div class="summary-item warning">
              <span class="dot"></span>
              <span class="label">Degraded:</span>
              <span class="value">{{ isLoading() ? '-' : servicesDegraded() }}</span>
            </div>
            <div class="summary-item danger">
              <span class="dot"></span>
              <span class="label">Failed:</span>
              <span class="value">{{ isLoading() ? '-' : servicesFailed() }}</span>
            </div>
          </div>
        </div>

        <!-- Consumers Chart -->
        @if (hasConsumersNamespace()) {
          <div class="chart-card" (click)="navigateToConsumers()">
            <div class="chart-header">
              <div class="chart-title">
                <i class="fas fa-exchange-alt"></i>
                <span>Consumers</span>
              </div>
              <div class="chart-count">{{ isLoading() ? '-' : consumersCount() }}</div>
            </div>
            <div class="chart-content" (click)="$event.stopPropagation()">
              @if (isLoading()) {
                <app-loading-skeleton [count]="1" height="200px" borderRadius="6px" />
              } @else {
                <app-echarts-wrapper
                  [chartOption]="consumersStatusChart()"
                  [loadingState]="healthState.isLoadingConsumersHealth()"
                  height="200px"
                  (chartClick)="onChartClick('consumers', $event)">
                </app-echarts-wrapper>
              }
            </div>
            <div class="chart-summary">
              <div class="summary-item success">
                <span class="dot"></span>
                <span class="label">Running:</span>
                <span class="value">{{ isLoading() ? '-' : consumersRunning() }}</span>
              </div>
              <div class="summary-item stopped">
                <span class="dot"></span>
                <span class="label">Stopped:</span>
                <span class="value">{{ isLoading() ? '-' : consumersStopped() }}</span>
              </div>
              <div class="summary-item warning">
                <span class="dot"></span>
                <span class="label">Degraded:</span>
                <span class="value">{{ isLoading() ? '-' : consumersDegraded() }}</span>
              </div>
              <div class="summary-item danger">
                <span class="dot"></span>
                <span class="label">Failed:</span>
                <span class="value">{{ isLoading() ? '-' : consumersFailed() }}</span>
              </div>
            </div>
          </div>
        }

        <!-- Jobs Chart -->
        @if (hasJobsNamespace()) {
          <div class="chart-card" (click)="navigateToJobs()">
            <div class="chart-header">
              <div class="chart-title">
                <i class="fas fa-clock"></i>
                <span>Jobs</span>
              </div>
              <div class="chart-count">{{ isLoading() ? '-' : jobsCount() }}</div>
            </div>
            <div class="chart-content" (click)="$event.stopPropagation()">
              @if (isLoading()) {
                <app-loading-skeleton [count]="1" height="200px" borderRadius="6px" />
              } @else {
                <app-echarts-wrapper
                  [chartOption]="jobsStatusChart()"
                  [loadingState]="healthState.isLoadingJobsHealth()"
                  height="200px"
                  (chartClick)="onChartClick('jobs', $event)">
                </app-echarts-wrapper>
              }
            </div>
            <div class="chart-summary">
              <div class="summary-item scheduled">
                <span class="dot"></span>
                <span class="label">Scheduled:</span>
                <span class="value">{{ isLoading() ? '-' : jobsScheduled() }}</span>
              </div>
              <div class="summary-item stopped">
                <span class="dot"></span>
                <span class="label">Paused:</span>
                <span class="value">{{ isLoading() ? '-' : jobsPaused() }}</span>
              </div>
              <div class="summary-item warning">
                <span class="dot"></span>
                <span class="label">Degraded:</span>
                <span class="value">{{ isLoading() ? '-' : jobsDegraded() }}</span>
              </div>
              <div class="summary-item danger">
                <span class="dot"></span>
                <span class="label">Failed:</span>
                <span class="value">{{ isLoading() ? '-' : jobsFailed() }}</span>
              </div>
            </div>
          </div>
        }
      </div>

      <!-- Modal -->
      @if (showModal()) {
        <div class="modal-overlay" (click)="closeModal()" [style.height]="modalHeight()">
          <div class="modal-container" (click)="$event.stopPropagation()" [style.max-height]="modalMaxHeight()">
            <div class="modal-header">
              <h2>
                <i class="fas" [class]="getModalIcon()"></i>
                {{ getModalTitle() }}
              </h2>
              <button class="close-button" (click)="closeModal()">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div class="modal-body">
              <!-- Services Table -->
              @if (modalCategory() === 'services') {
                <div class="table-wrapper dashboard-common-table-wrap">
                  <table class="dashboard-common-table">
                    <thead>
                      <tr>
                        <th>Service Name</th>
                        <th>Namespace</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Replicas</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (service of filteredServices(); track service.metadataName) {
                        <tr class="clickable-row" (click)="navigateToResource(service.namespace, service.metadataName)" [title]="'View ' + service.name + ' details'">
                          <td class="resource-name">
                            <a
                              [routerLink]="['/cluster']"
                              [queryParams]="{ view: 'deepdive', namespace: service.namespace, resource: service.name }"
                              class="resource-name-link"
                              (click)="$event.stopPropagation()"
                              [title]="'View resource in Cluster Info'"
                            >{{ service.name }}</a>
                          </td>
                          <td>
                            <span class="namespace-badge">{{ service.namespace }}</span>
                          </td>
                          <td>{{ service.type }}</td>
                          <td>
                            <span class="status-badge" [class]="'status-' + service.status.toLowerCase()">
                              {{ service.status }}
                            </span>
                          </td>
                          <td>{{ service.readyReplicas }}/{{ service.desiredReplicas }}</td>
                        </tr>
                      }
                      @if (filteredServices().length === 0) {
                        <tr>
                          <td colspan="5" class="empty-state">No services found with this status</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              <!-- Consumers Table -->
              @if (modalCategory() === 'consumers') {
                <div class="table-wrapper dashboard-common-table-wrap">
                  <table class="dashboard-common-table">
                    <thead>
                      <tr>
                        <th>Consumer Name</th>
                        <th>Status</th>
                        <th>Enabled</th>
                        <th>Replicas</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (consumer of filteredConsumers(); track consumer.metadataName) {
                        <tr class="clickable-row" (click)="navigateToResource(consumer.namespace, consumer.metadataName)" [title]="'View ' + consumer.name + ' details'">
                          <td class="resource-name">
                            <a
                              [routerLink]="['/cluster']"
                              [queryParams]="{ view: 'deepdive', namespace: consumer.namespace, resource: consumer.name }"
                              class="resource-name-link"
                              (click)="$event.stopPropagation()"
                              [title]="'View resource in Cluster Info'"
                            >{{ consumer.name }}</a>
                          </td>
                          <td>
                            <span class="status-badge" [class]="'status-' + consumer.status.toLowerCase()">
                              {{ consumer.status }}
                            </span>
                          </td>
                          <td>
                            <span class="enabled-badge" [class.disabled]="!consumer.consumerEnabled">
                              <i class="fas" [class.fa-check-circle]="consumer.consumerEnabled" [class.fa-times-circle]="!consumer.consumerEnabled"></i>
                              {{ consumer.consumerEnabled ? 'Enabled' : 'Disabled' }}
                            </span>
                          </td>
                          <td>{{ consumer.readyReplicas }}/{{ consumer.desiredReplicas }}</td>
                        </tr>
                      }
                      @if (filteredConsumers().length === 0) {
                        <tr>
                          <td colspan="4" class="empty-state">No consumers found with this status</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }

              <!-- Jobs Table -->
              @if (modalCategory() === 'jobs') {
                <div class="table-wrapper dashboard-common-table-wrap">
                  <table class="dashboard-common-table">
                    <thead>
                      <tr>
                        <th>Job Name</th>
                        <th>Status</th>
                        <th>Schedule</th>
                        <th>Last Run</th>
                        <th>Recent Runs</th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (job of filteredJobs(); track job.metadataName) {
                        <tr class="clickable-row" (click)="navigateToResource(job.namespace, job.metadataName)" [title]="'View ' + job.name + ' details'">
                          <td class="resource-name">
                            <a
                              [routerLink]="['/cluster']"
                              [queryParams]="{ view: 'deepdive', namespace: job.namespace, resource: job.name }"
                              class="resource-name-link"
                              (click)="$event.stopPropagation()"
                              [title]="'View resource in Cluster Info'"
                            >{{ job.name }}</a>
                          </td>
                          <td>
                            <span class="status-badge" [class]="'status-' + job.status.toLowerCase()">
                              {{ job.status }}
                            </span>
                          </td>
                          <td>
                            <code class="schedule-code">{{ job.schedule }}</code>
                          </td>
                          <td>{{ formatDate(job.lastScheduleTime) }}</td>
                          <td>
                            <div class="recent-runs">
                              @for (run of job.recentRuns.slice(0, 5); track run.name) {
                                <span 
                                  class="run-badge" 
                                  [class]="'run-' + run.phase.toLowerCase()"
                                  [title]="run.phase + ' - ' + formatDate(run.startTime)">
                                </span>
                              }
                              @if (job.recentRuns.length === 0) {
                                <span class="no-runs">No runs yet</span>
                              }
                            </div>
                          </td>
                        </tr>
                      }
                      @if (filteredJobs().length === 0) {
                        <tr>
                          <td colspan="5" class="empty-state">No jobs found with this status</td>
                        </tr>
                      }
                    </tbody>
                  </table>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .application-health-panel {
      border-radius: 8px;
      padding: 1.5rem;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }

    .chart-card {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      padding: 1.25rem;
      border: 2px solid #e5e7eb;
      transition: all 0.3s;
      cursor: pointer;
    }

    .chart-card:hover {
      border-color: var(--theme-button-primary);
      box-shadow: 0 4px 12px rgba(147, 41, 154, 0.15);
      transform: translateY(-2px);
    }

    .chart-card:active {
      transform: translateY(0);
    }

    .chart-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .chart-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .chart-title i {
      color: var(--theme-text-teal);
    }

    .chart-count {
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-teal);
    }

    .chart-content {
      margin-bottom: 1rem;
    }

    .chart-summary {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.5rem;
    }

    .summary-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: var(--theme-font-body);
      padding: 0.375rem;
      border-radius: 4px;
    }

    .summary-item .dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .summary-item.success .dot {
      background: #10b981;
    }

    .summary-item.stopped .dot {
      background: var(--theme-border-gray);
    }

    .summary-item.warning .dot {
      background: #f59e0b;
    }

    .summary-item.danger .dot {
      background: #ef4444;
    }

    .summary-item.scheduled .dot {
      background: var(--theme-button-primary);
    }

    .summary-item .label {
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-body-weight);
    }

    .summary-item .value {
      margin-left: auto;
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    /* Modal Styles */
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10020;
      padding: 1rem;
      animation: fadeIn 0.2s;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .modal-container {
      background: var(--theme-bg-app);
      border-radius: 12px;
      max-width: 1200px;
      width: 100%;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      animation: slideUp 0.3s;
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 1.5rem 2.25rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: var(--theme-header-gradient);
      color: white;
      flex-shrink: 0;
      border-radius: 12px 12px 0 0;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }

    .modal-header h2 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: white;
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .modal-header i {
      color: white;
    }

    .close-button {
      background: none;
      border: none;
      font-size: var(--theme-font-page-title);
      color: rgba(255, 255, 255, 0.95);
      cursor: pointer;
      padding: 0;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      transition: all 0.2s;
    }

    .close-button:hover {
      background-color: rgba(255, 255, 255, 0.2);
      color: white;
    }

    .modal-body {
      padding: 1.5rem;
      overflow-y: auto;
      flex: 1;
      background: var(--theme-bg-app);
    }

    /* Table Styles */
    .table-wrapper {
      overflow-x: auto;
      border-radius: 6px;
    }

    table {
      min-width: 100%;
    }

    thead {
      position: sticky;
      top: 0;
      z-index: 10;
    }

    th {
      white-space: nowrap;
    }

    .clickable-row {
      cursor: pointer;
      transition: all 0.2s;
    }

    .clickable-row:hover {
      background: var(--theme-bg-teal-lighter) !important;
      transform: translateX(2px);
    }

    .clickable-row:active {
      background: var(--theme-bg-teal-light) !important;
    }

    .resource-name {
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-dark);
    }

    .resource-name-link {
      color: var(--theme-button-primary);
      text-decoration: none;
      font-weight: var(--theme-font-table-body-weight);
    }
    .resource-name-link:hover {
      text-decoration: underline;
    }

    .namespace-badge {
      display: inline-block;
      padding: 0.25rem 0.5rem;
      background: #e0e7ff;
      color: #3730a3;
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
    }

    .status-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 12px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      text-transform: uppercase;
    }

    .status-running {
      background: #dcfce7;
      color: #166534;
    }

    .status-stopped {
      background: var(--theme-bg-app);
      color: var(--theme-table-header-color);
    }

    .status-failed {
      background: #fee2e2;
      color: #991b1b;
    }

    .status-degraded {
      background: #fef3c7;
      color: #92400e;
    }

    .status-scheduled {
      background: var(--theme-bg-teal-lighter);
      color: var(--theme-text-teal-dark);
    }

    .status-paused {
      background: var(--theme-bg-app);
      color: var(--theme-table-header-color);
    }

    .enabled-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      background: #dcfce7;
      color: #166534;
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
    }

    .enabled-badge.disabled {
      background: #fee2e2;
      color: #991b1b;
    }

    .schedule-code {
      font-family: 'Monaco', 'Menlo', monospace;
      background: var(--theme-bg-app);
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      color: var(--theme-table-header-color);
    }

    .recent-runs {
      display: flex;
      gap: 0.375rem;
      align-items: center;
      flex-wrap: wrap;
    }

    .run-badge {
      display: inline-block;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--theme-border-gray);
      cursor: help;
      transition: transform 0.2s;
      flex-shrink: 0;
    }

    .run-badge:hover {
      transform: scale(1.3);
    }

    .run-succeeded {
      background: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }

    .run-failed, .run-error {
      background: #ef4444;
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
    }

    .run-running {
      background: var(--theme-button-primary);
      box-shadow: 0 0 0 2px rgba(147, 41, 154, 0.2);
      animation: pulse 2s infinite;
    }

    .run-pending {
      background: #f59e0b;
      box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.2);
    }

    .no-runs {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
      font-style: italic;
    }

    @keyframes pulse {
      0%, 100% {
        opacity: 1;
      }
      50% {
        opacity: 0.6;
      }
    }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
    }

    @media (max-width: 1024px) {
      .charts-grid {
        grid-template-columns: 1fr;
      }

      .modal-container {
        max-height: 90vh;
      }
    }
  `]
})
export class ApplicationHealthPanelComponent implements OnInit, OnDestroy {
  isLoading = input<boolean>(false);

  healthState = inject(HealthStateService);
  clusterStateService = inject(ClusterStateService);
  router = inject(Router);
  route = inject(ActivatedRoute);
  viewportScaleService = inject(ViewportScaleService);
  Object = Object;
  
  // Check if namespaces are available
  hasConsumersNamespace = computed(() => this.clusterStateService.hasConsumersNamespace());
  hasJobsNamespace = computed(() => this.clusterStateService.hasJobsNamespace());
  
  private queryParamsSubscription?: Subscription;

  // Viewport-based height calculations using ViewportScaleService
  modalHeight = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    return `${baseHeight}px`;
  });
  
  modalMaxHeight = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    return `${baseHeight * 0.85}px`; // 85% of viewport height
  });

  // Modal state
  showModal = signal(false);
  modalCategory = signal<CategoryType>('services');
  statusFilter = signal<StatusFilter>(null);

  ngOnInit(): void {
    // Subscribe to query params to open/close modal based on URL
    this.queryParamsSubscription = this.route.queryParams.subscribe(params => {
      const modalView = params['modal'];
      const status = params['status'];
      
      if (modalView === 'services' || modalView === 'consumers' || modalView === 'jobs') {
        this.modalCategory.set(modalView as CategoryType);
        this.statusFilter.set(status || null);
        this.showModal.set(true);
      } else {
        this.showModal.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.queryParamsSubscription?.unsubscribe();
  }

  // Services computed properties
  servicesCount = computed(() => this.healthState.servicesHealth()?.summary.totalServices ?? 0);
  servicesRunning = computed(() => this.healthState.servicesHealth()?.summary.runningServices ?? 0);
  servicesStopped = computed(() => this.healthState.servicesHealth()?.summary.stoppedServices ?? 0);
  servicesDegraded = computed(() => this.healthState.servicesHealth()?.summary.degradedServices ?? 0);
  servicesFailed = computed(() => this.healthState.servicesHealth()?.summary.failedServices ?? 0);

  // Consumers computed properties
  consumersCount = computed(() => this.healthState.consumersHealth()?.summary.totalConsumers ?? 0);
  consumersRunning = computed(() => this.healthState.consumersHealth()?.summary.runningConsumers ?? 0);
  consumersStopped = computed(() => this.healthState.consumersHealth()?.summary.stoppedConsumers ?? 0);
  consumersDegraded = computed(() => this.healthState.consumersHealth()?.summary.degradedConsumers ?? 0);
  consumersFailed = computed(() => this.healthState.consumersHealth()?.summary.failedConsumers ?? 0);

  // Jobs computed properties
  jobsCount = computed(() => this.healthState.jobsHealth()?.summary.totalJobs ?? 0);
  jobsScheduled = computed(() => this.healthState.jobsHealth()?.summary.scheduledJobs ?? 0);
  jobsPaused = computed(() => this.healthState.jobsHealth()?.summary.pausedJobs ?? 0);
  jobsDegraded = computed(() => this.healthState.jobsHealth()?.summary.degradedJobs ?? 0);
  jobsFailed = computed(() => this.healthState.jobsHealth()?.summary.failedJobs ?? 0);

  // Filtered data for modal
  filteredServices = computed(() => {
    const data = this.healthState.servicesHealth()?.services ?? [];
    const filter = this.statusFilter();
    if (!filter) return data;
    return data.filter(s => s.status.toLowerCase() === filter.toLowerCase());
  });

  filteredConsumers = computed(() => {
    const data = this.healthState.consumersHealth()?.consumers ?? [];
    const filter = this.statusFilter();
    if (!filter) return data;
    return data.filter(c => c.status.toLowerCase() === filter.toLowerCase());
  });

  filteredJobs = computed(() => {
    const data = this.healthState.jobsHealth()?.jobs ?? [];
    const filter = this.statusFilter();
    if (!filter) return data;
    return data.filter(j => j.status.toLowerCase() === filter.toLowerCase());
  });

  // Services Status Chart
  servicesStatusChart = computed((): EChartsOption => {
    const data = this.healthState.servicesHealth();
    if (!data) return this.getEmptyPieChart();

    return this.createPieChart([
      { value: data.summary.runningServices, name: 'Running', itemStyle: { color: '#10b981' } },
      { value: data.summary.stoppedServices, name: 'Stopped', itemStyle: { color: '#94a3b8' } },
      { value: data.summary.degradedServices, name: 'Degraded', itemStyle: { color: '#f59e0b' } },
      { value: data.summary.failedServices, name: 'Failed', itemStyle: { color: '#ef4444' } }
    ]);
  });

  // Consumers Status Chart
  consumersStatusChart = computed((): EChartsOption => {
    const data = this.healthState.consumersHealth();
    if (!data) return this.getEmptyPieChart();

    return this.createPieChart([
      { value: data.summary.runningConsumers, name: 'Running', itemStyle: { color: '#10b981' } },
      { value: data.summary.stoppedConsumers, name: 'Stopped', itemStyle: { color: '#94a3b8' } },
      { value: data.summary.degradedConsumers, name: 'Degraded', itemStyle: { color: '#f59e0b' } },
      { value: data.summary.failedConsumers, name: 'Failed', itemStyle: { color: '#ef4444' } }
    ]);
  });

  // Jobs Status Chart
  jobsStatusChart = computed((): EChartsOption => {
    const data = this.healthState.jobsHealth();
    if (!data) return this.getEmptyPieChart();

    return this.createPieChart([
      {
        value: data.summary.scheduledJobs,
        name: 'Scheduled',
        itemStyle: { color: this.resolveThemeColor('--theme-button-primary', '#007bff') },
      },
      { value: data.summary.pausedJobs, name: 'Paused', itemStyle: { color: '#94a3b8' } },
      { value: data.summary.degradedJobs, name: 'Degraded', itemStyle: { color: '#f59e0b' } },
      { value: data.summary.failedJobs, name: 'Failed', itemStyle: { color: '#ef4444' } }
    ]);
  });

  private createPieChart(data: any[]): EChartsOption {
    const filteredData = data.filter(item => item.value > 0);
    
    return {
      tooltip: {
        trigger: 'item',
        formatter: '{b}: {c} ({d}%)'
      },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        label: {
          show: false,
          position: 'center'
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 20,
            fontWeight: 'bold',
            formatter: '{b}\n{c}'
          }
        },
        labelLine: {
          show: false
        },
        data: filteredData
      }]
    };
  }

  private getEmptyPieChart(): EChartsOption {
    return {
      tooltip: { trigger: 'item' },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        data: [{ value: 1, name: 'No Data', itemStyle: { color: '#e5e7eb' } }],
        label: { show: false },
        emphasis: { label: { show: false } }
      }]
    };
  }

  onChartClick(category: CategoryType, event: any): void {
    if (event && event.name) {
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { 
          modal: category,
          status: event.name
        },
        queryParamsHandling: 'merge'
      });
    }
  }

  closeModal(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { 
        modal: null,
        status: null
      },
      queryParamsHandling: 'merge'
    });
  }

  getModalTitle(): string {
    const category = this.modalCategory();
    const status = this.statusFilter();
    const categoryName = category.charAt(0).toUpperCase() + category.slice(1);
    
    // If no status filter, just show the category name
    if (!status) {
      return `All ${categoryName}`;
    }
    
    return `${status} ${categoryName}`;
  }

  getModalIcon(): string {
    const category = this.modalCategory();
    switch (category) {
      case 'services': return 'fa-server';
      case 'consumers': return 'fa-exchange-alt';
      case 'jobs': return 'fa-clock';
      default: return 'fa-list';
    }
  }

  formatDate(date?: string): string {
    if (!date) return 'N/A';
    try {
      return new Date(date).toLocaleString();
    } catch {
      return 'N/A';
    }
  }

  navigateToResource(namespace: string, resourceName: string): void {
    // Navigate to cluster info with query params to select the specific resource
    this.router.navigate(['/cluster'], {
      queryParams: {
        namespace: namespace,
        resource: resourceName,
        view: 'deepdive'
      }
    });
  }

  navigateToServices(): void {
    // Open services modal instead of navigating away
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { modal: 'services' },
      queryParamsHandling: 'merge'
    });
  }

  navigateToConsumers(): void {
    // Open consumers modal instead of navigating away
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { modal: 'consumers' },
      queryParamsHandling: 'merge'
    });
  }

  navigateToJobs(): void {
    // Open jobs modal instead of navigating away
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { modal: 'jobs' },
      queryParamsHandling: 'merge'
    });
  }

  private resolveThemeColor(cssVariable: string, fallback: string): string {
    if (typeof window === 'undefined') {
      return fallback;
    }

    const value = getComputedStyle(document.documentElement).getPropertyValue(cssVariable).trim();
    return value || fallback;
  }
}
