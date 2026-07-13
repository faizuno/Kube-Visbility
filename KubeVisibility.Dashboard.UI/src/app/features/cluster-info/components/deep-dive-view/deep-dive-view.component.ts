import { Component, inject, signal, computed, effect, OnInit, OnDestroy, Injector, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ClusterStateService } from '../../../../core/services/cluster-state.service';
import { NavigationService } from '../../../../core/services/navigation.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { ResourceDetailComponent } from '../resource-detail/resource-detail.component';
import { EditCronworkflowComponent } from '../edit-cronworkflow/edit-cronworkflow.component';
import { LogsViewerComponent } from '../logs-viewer/logs-viewer.component';
import { ElasticsearchLogsViewerComponent } from '../elasticsearch-logs-viewer/elasticsearch-logs-viewer.component';
import { SearchBarComponent } from '../../../../shared/components/search-bar/search-bar.component';
import { ResourceInfo } from '../../../../core/models/cluster-info.models';
import { environment } from '../../../../../environments/environment';

interface NamespaceGroup {
  namespace: string;
  resources: Array<{ namespace: string; resource: ResourceInfo }>;
}

@Component({
  selector: 'app-deep-dive-view',
  standalone: true,
  imports: [CommonModule, RouterLink, ResourceDetailComponent, EditCronworkflowComponent, LogsViewerComponent, ElasticsearchLogsViewerComponent, SearchBarComponent],
  template: `
    <div class="deepdive-layout" [ngStyle]="layoutHeightStyle()">
      <div class="deepdive-sidebar">
        <div class="sidebar-header">
          <span class="sidebar-header-title">Resources</span>
          <div class="sidebar-search-row">
            <app-search-bar
              appearance="sidebar"
              [searchTerm]="activeSearchQuery()"
              [placeholderText]="'Search resources...'"
              (searchChange)="onSidebarSearchChange($event)"
            />
          </div>
        </div>
        <div class="sidebar-namespaces-container">
          @for (ns of namespaces(); track ns) {
            @if (shouldShowNamespace(ns)) {
              <div class="sidebar-namespace">
                <div
                  class="sidebar-namespace-header"
                  (click)="toggleNamespace(ns)"
                >
                  <i class="fas fa-folder"></i>
                  <span class="sidebar-namespace-name">{{ ns }}</span>
                  @if (getNamespaceStatusCounts(ns); as statusCounts) {
                    <div class="namespace-status-pills" title="Visible resources by status">
                      <span
                        class="namespace-status-pill status-total"
                        [title]="'Total: ' + getNamespaceVisibleCount(ns) + ' resources'"
                        [attr.aria-label]="'Total: ' + getNamespaceVisibleCount(ns) + ' resources'"
                      >{{ getNamespaceVisibleCount(ns) }}</span>
                      <span
                        class="namespace-status-pill status-healthy"
                        [title]="'Healthy: ' + statusCounts.healthy + ' resources'"
                        [attr.aria-label]="'Healthy: ' + statusCounts.healthy + ' resources'"
                      >{{ statusCounts.healthy }}</span>
                      @if (statusCounts.degraded > 0) {
                        <span
                          class="namespace-status-pill status-degraded"
                          [title]="'Degraded: ' + statusCounts.degraded + ' resources'"
                          [attr.aria-label]="'Degraded: ' + statusCounts.degraded + ' resources'"
                        >{{ statusCounts.degraded }}</span>
                      }
                      @if (statusCounts.failed > 0) {
                        <span
                          class="namespace-status-pill status-failed"
                          [title]="'Failed: ' + statusCounts.failed + ' resources'"
                          [attr.aria-label]="'Failed: ' + statusCounts.failed + ' resources'"
                        >{{ statusCounts.failed }}</span>
                      }
                      @if (statusCounts.stopped > 0) {
                        <span
                          class="namespace-status-pill status-stopped"
                          [title]="'Stopped: ' + statusCounts.stopped + ' resources'"
                          [attr.aria-label]="'Stopped: ' + statusCounts.stopped + ' resources'"
                        >{{ statusCounts.stopped }}</span>
                      }
                      @if (statusCounts.paused > 0) {
                        <span
                          class="namespace-status-pill status-paused"
                          [title]="'Paused: ' + statusCounts.paused + ' resources'"
                          [attr.aria-label]="'Paused: ' + statusCounts.paused + ' resources'"
                        >{{ statusCounts.paused }}</span>
                      }
                      @if (statusCounts.pending > 0) {
                        <span
                          class="namespace-status-pill status-pending"
                          [title]="'Pending: ' + statusCounts.pending + ' resources'"
                          [attr.aria-label]="'Pending: ' + statusCounts.pending + ' resources'"
                        >{{ statusCounts.pending }}</span>
                      }
                      @if (statusCounts.running > 0) {
                        <span
                          class="namespace-status-pill status-running"
                          [title]="'Running: ' + statusCounts.running + ' resources'"
                          [attr.aria-label]="'Running: ' + statusCounts.running + ' resources'"
                        >{{ statusCounts.running }}</span>
                      }
                      @if (statusCounts.neverRun > 0) {
                        <span
                          class="namespace-status-pill status-never-run"
                          [title]="'Never Run: ' + statusCounts.neverRun + ' resources'"
                          [attr.aria-label]="'Never Run: ' + statusCounts.neverRun + ' resources'"
                        >{{ statusCounts.neverRun }}</span>
                      }
                    </div>
                  }
                  <i
                    class="fas sidebar-toggle-icon"
                    [class.fa-chevron-down]="!isNamespaceOpen(ns)"
                    [class.fa-chevron-up]="isNamespaceOpen(ns)"
                  ></i>
                </div>
                @if (isNamespaceOpen(ns)) {
                  <div class="sidebar-resources">
                    @if (getNamespaceData(ns); as nsData) {
                      <!-- Namespace has data -->
                      @if (nsData.success && nsData.resources && nsData.resources.length > 0) {
                        @for (resource of getFilteredAndSortedResources(ns, nsData.resources); track resource.metadataName) {
                          <a
                            [routerLink]="['/cluster']"
                            [queryParams]="{ view: 'deepdive', namespace: ns, resource: resource.metadataName }"
                            class="sidebar-resource-item"
                            [class.selected]="isSelected(ns, resource.metadataName)"
                            (click)="selectResource(ns, resource)"
                            [title]="'View resource details'"
                          >
                            <span class="resource-name-small">
                              <span class="resource-health-dot" [class]="getResourceHealthClass(resource)"></span>
                              <span>{{ resource.name }}</span>
                              @if (getSidebarOperationalState(ns, resource); as state) {
                                <i
                                  class="fas resource-operational-icon"
                                  [class.fa-pause]="state === 'paused'"
                                  [class.fa-play]="state === 'resumed' || state === 'started'"
                                  [class.fa-stop]="state === 'stopped'"
                                  [title]="getSidebarOperationalStateLabel(state)"
                                  [attr.aria-label]="getSidebarOperationalStateLabel(state)"
                                ></i>
                              }
                            </span>
                          </a>
                        }
                      } @else if (nsData.success === false) {
                        <!-- Error state - namespace failed to load -->
                        <div class="error-message" style="padding: 0.5rem; color: #ef4444; font-size: var(--theme-font-body);">
                          {{ nsData.error || 'Failed to load' }}
                        </div>
                      } @else if (!hasNamespaceEverLoaded(ns)) {
                        <!-- Keep sidebar row structure and skeletonize item content -->
                        @for (width of sidebarSkeletonWidths; track width) {
                          <div class="sidebar-resource-item sidebar-resource-item-skeleton">
                            <span class="resource-name-small">
                              <span class="skeleton skeleton-dot"></span>
                              <span class="skeleton skeleton-line" [style.width.%]="width"></span>
                            </span>
                          </div>
                        }
                      }
                    } @else if (!hasNamespaceEverLoaded(ns) && !hasNamespaceData(ns)) {
                      <!-- Keep sidebar row structure and skeletonize item content -->
                      @for (width of sidebarSkeletonWidths; track width) {
                        <div class="sidebar-resource-item sidebar-resource-item-skeleton">
                          <span class="resource-name-small">
                            <span class="skeleton skeleton-dot"></span>
                            <span class="skeleton skeleton-line" [style.width.%]="width"></span>
                          </span>
                        </div>
                      }
                    }
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
      <div class="deepdive-content">
        @if (selectedResource(); as selected) {
          <div class="detail-breadcrumb">
            <a [routerLink]="['/cluster']" [queryParams]="{ view: 'scanning' }">Cluster</a>
            <span>/</span>
            <a [routerLink]="['/cluster']" [queryParams]="{ view: 'scanning', namespace: selected.namespace }">{{ selected.namespace }}</a>
            <span>/</span>
            <span class="breadcrumb-current">{{ selected.resource.name }}</span>
          </div>
          @if (isNamespaceLoading(selected.namespace)) {
            <!-- Show loading skeleton while namespace is loading -->
            <div class="resource-detail-loading">
              <div class="detail-header-skeleton">
                <div class="skeleton-text skeleton" style="width: 200px; height: 32px; margin-bottom: 1rem;"></div>
                <div class="skeleton-badge skeleton" style="width: 100px; height: 24px;"></div>
              </div>
              <div class="detail-section-skeleton">
                <div class="skeleton-text skeleton" style="width: 150px; height: 20px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 100%; height: 16px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 80%; height: 16px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 90%; height: 16px;"></div>
              </div>
              <div class="detail-section-skeleton">
                <div class="skeleton-text skeleton" style="width: 150px; height: 20px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 100%; height: 16px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 75%; height: 16px;"></div>
              </div>
              <div class="detail-section-skeleton">
                <div class="skeleton-text skeleton" style="width: 150px; height: 20px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-table-row">
                  <div class="skeleton-text skeleton" style="width: 120px;"></div>
                  <div class="skeleton-text skeleton" style="width: 100px;"></div>
                  <div class="skeleton-text skeleton" style="width: 80px;"></div>
                </div>
              </div>
            </div>
          } @else {
            <!-- Show resource detail once namespace has loaded (or if already loaded) -->
            <app-resource-detail
              [resource]="selected.resource"
              [namespace]="selected.namespace"
                (editCronWorkflowRequested)="editCronWorkflow($event.namespace, $event.resource)"
                (viewLogsRequested)="viewLogs($event.namespace, $event.resource, $event.resourceType, $event.podName)"
                (viewElasticLogsRequested)="viewElasticLogs($event.namespace, $event.resource)"
              />
          }
        } @else if (pendingResourceSelection(); as pending) {
          <!-- Loading skeleton for pending resource selection from URL (only on initial load) -->
          @if (!hasEverLoadedResource()) {
            <div class="resource-detail-loading">
              <div class="detail-header-skeleton">
                <div class="skeleton-text skeleton" style="width: 200px; height: 32px; margin-bottom: 1rem;"></div>
                <div class="skeleton-badge skeleton" style="width: 100px; height: 24px;"></div>
              </div>
              <div class="detail-section-skeleton">
                <div class="skeleton-text skeleton" style="width: 150px; height: 20px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 100%; height: 16px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 80%; height: 16px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 90%; height: 16px;"></div>
              </div>
              <div class="detail-section-skeleton">
                <div class="skeleton-text skeleton" style="width: 150px; height: 20px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 100%; height: 16px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-text skeleton" style="width: 75%; height: 16px;"></div>
              </div>
              <div class="detail-section-skeleton">
                <div class="skeleton-text skeleton" style="width: 150px; height: 20px; margin-bottom: 0.5rem;"></div>
                <div class="skeleton-table-row">
                  <div class="skeleton-text skeleton" style="width: 120px;"></div>
                  <div class="skeleton-text skeleton" style="width: 100px;"></div>
                  <div class="skeleton-text skeleton" style="width: 80px;"></div>
                </div>
              </div>
            </div>
          }
        } @else {
          <div class="no-selection">
            <i class="fas fa-hand-point-left"></i>
            <h3>Select a resource</h3>
            <p>Select a resource from the sidebar to view details.</p>
            <div class="no-selection-actions">
              <button class="btn-empty-cta" (click)="selectFirstVisibleResource()">
                <i class="fas fa-cubes"></i>
                Select first resource
              </button>
              <button class="btn-empty-secondary" (click)="goToClusterScanning()">
                <i class="fas fa-list"></i>
                Go to List
              </button>
            </div>
          </div>
        }
      </div>
      @if (currentEditResource()) {
        <app-edit-cronworkflow
          [namespace]="currentEditNamespace()"
          [resource]="currentEditResource()!"
          (closed)="closeEditModal()"
          (saved)="onCronWorkflowSaved($event)"
        />
      }
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
    </div>
  `,
  styles: [
    `
      .deepdive-layout {
        display: flex;
        min-height: 0;
        overflow: hidden;
      }
      .deepdive-sidebar {
        width: 30%;
        border-right: 1px solid var(--theme-border-gray-light);
        background: var(--theme-bg-surface);
        padding: 0 1rem 1rem;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
      }
      
      .deepdive-sidebar::-webkit-scrollbar {
        width: 17px;
      }
      
      .deepdive-sidebar::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .deepdive-sidebar::-webkit-scrollbar-thumb {
        background-color: var(--theme-border-gray);
        border-radius: 10px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      
      .deepdive-sidebar::-webkit-scrollbar-thumb:hover {
        background-color: var(--theme-border-gray);
      }
      
      .deepdive-sidebar {
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
      
      .sidebar-namespaces-container {
        flex: 1;
        min-height: 0;
      }
      
      .deepdive-content {
        flex: 1;
        padding: 0;
        background: var(--theme-bg-surface);
        overflow-y: auto;
        overflow-x: hidden;
        box-sizing: border-box;
      }
      
      .deepdive-content::-webkit-scrollbar {
        width: 17px;
      }
      
      .deepdive-content::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .deepdive-content::-webkit-scrollbar-thumb {
        background-color: var(--theme-border-gray);
        border-radius: 10px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      
      .deepdive-content::-webkit-scrollbar-thumb:hover {
        background-color: var(--theme-border-gray);
      }
      
      .deepdive-content {
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
      .sidebar-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-height: 48px;
        margin-bottom: 0.5rem;
        padding: 0.62rem 0;
        border-bottom: 1px solid var(--theme-border-gray-light);
      }
      .sidebar-header-title {
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        color: var(--theme-text-dark);
        white-space: nowrap;
      }
      .sidebar-search-row {
        margin-left: auto;
        width: 66%;
        min-width: 220px;
      }
      .sidebar-search-row app-search-bar {
        width: 100%;
      }
      .guide-legend {
        display: inline-block;
        margin-left: 0.35rem;
        color: var(--theme-table-header-color);
      }
      .sidebar-namespace {
        margin-bottom: 0.5rem;
      }
      .sidebar-namespace-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.36rem 0.5rem;
        cursor: pointer;
        border-radius: 6px;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-gray);
        transition: all 0.3s ease;
      }
      .sidebar-namespace-header:hover {
        background-color: var(--theme-bg-app);
      }
      .sidebar-namespace-header i.fa-folder {
        color: #f59e0b;
      }
      .sidebar-namespace-name {
        flex: 0 0 auto;
        font-size: var(--theme-font-body);
      }
      .namespace-count {
        flex: 0 0 auto !important;
        min-width: 1.4rem;
        height: 1.15rem;
        border-radius: 999px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        padding: 0 0.34rem;
      }
      .namespace-count {
        background: var(--theme-bg-app);
        color: var(--theme-table-header-color);
      }
      .namespace-status-pills {
        display: inline-flex;
        align-items: center;
        gap: 0.28rem;
        flex-wrap: wrap;
        flex: 1 1 auto;
        justify-content: flex-end;
        margin-left: auto;
      }
      .namespace-status-pill {
        display: inline-flex;
        align-items: center;
        justify-content: flex-end;
        border-radius: 999px;
        padding: 0.12rem 0.4rem;
        min-width: 1.35rem;
        text-align: right;
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
      .sidebar-toggle-icon {
        font-size: var(--theme-font-caption);
        transition: transform 0.3s ease;
      }
      .sidebar-resources {
        padding-left: 0.7rem;
        margin-top: 0.3rem;
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-color: var(--theme-border-gray) transparent;
      }
      
      .sidebar-resources::-webkit-scrollbar {
        width: 17px;
      }
      
      .sidebar-resources::-webkit-scrollbar-track {
        background: transparent;
      }
      
      .sidebar-resources::-webkit-scrollbar-thumb {
        background-color: var(--theme-border-gray);
        border-radius: 10px;
        border: 3px solid transparent;
        background-clip: content-box;
      }
      
      .sidebar-resources::-webkit-scrollbar-thumb:hover {
        background-color: var(--theme-border-gray);
      }
      .sidebar-resource-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.36rem 0.5rem;
        margin: 0.16rem 0;
        cursor: pointer;
        border-radius: 6px;
        transition: all 0.3s ease;
        border-left: 3px solid transparent;
        text-decoration: none;
        color: inherit;
      }
      .sidebar-resource-item:hover {
        background-color: var(--theme-bg-app);
        border-left-color: var(--theme-button-primary);
      }
      .sidebar-resource-item.selected {
        background-color: #e0e7ff;
        border-left-color: var(--theme-button-primary);
      }
      .resource-name-small {
        font-weight: var(--theme-font-table-body-weight);
        font-size: var(--theme-font-body);
        line-height: 1.32;
        color: var(--theme-text-dark);
        flex: 1;
        display: inline-flex;
        align-items: center;
        gap: 0.36rem;
      }
      .resource-operational-icon {
        margin-left: 0.2rem;
        font-size: var(--theme-font-caption);
        opacity: 0.95;
      }
      .resource-health-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        flex: 0 0 auto;
      }
      .resource-health-dot.health-healthy {
        background: #10b981;
      }
      .resource-health-dot.health-warning {
        background: #f59e0b;
      }
      .resource-health-dot.health-critical {
        background: #ef4444;
      }
      .resource-health-dot.health-muted {
        background: var(--theme-border-gray);
      }
      .sidebar-resource-item-skeleton {
        cursor: default;
        border-left-color: transparent !important;
        background: transparent !important;
      }
      .sidebar-resource-item-skeleton:hover {
        background: transparent !important;
        border-left-color: transparent !important;
      }
      .skeleton-dot {
        display: inline-block;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        margin-right: 0.5rem;
        vertical-align: middle;
      }
      .skeleton-line {
        display: inline-block;
        height: 14px;
        border-radius: 999px;
        vertical-align: middle;
      }
      @keyframes skeleton-loading {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
      .no-selection {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        color: var(--theme-text-gray);
        gap: 0.5rem;
      }
      .detail-breadcrumb {
        display: flex;
        align-items: center;
        gap: 0.42rem;
        min-height: 60px;
        padding: 0.72rem 1.1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
        line-height: 1.2;
        color: var(--theme-text-gray);
        position: sticky;
        top: 0;
        background: var(--theme-bg-surface);
        z-index: 5;
      }
      .detail-breadcrumb a {
        color: var(--theme-text-teal);
        text-decoration: none;
        font-weight: var(--theme-font-table-header-weight);
      }
      .detail-breadcrumb a:hover {
        text-decoration: underline;
      }
      .breadcrumb-current {
        color: var(--theme-text-dark);
        font-weight: var(--theme-font-table-header-weight);
      }
      .no-selection > i {
        font-size: var(--theme-font-page-title);
        opacity: 0.5;
      }
      .no-selection-actions {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: center;
      }
      .btn-empty-cta,
      .btn-empty-secondary {
        border-radius: 8px;
        border: 1px solid transparent;
        padding: 0.6rem 0.9rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
      }
      .btn-empty-cta {
        background: var(--theme-button-primary);
        color: #fff;
      }
      .btn-empty-secondary {
        background: var(--theme-bg-surface);
        color: var(--theme-table-header-color);
        border-color: var(--theme-border-gray);
      }
      .detail-panel h2 {
        margin: 0 0 1rem 0;
      }
      .resource-detail-loading {
        padding: 2rem;
      }
      .detail-header-skeleton {
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
      }
      .detail-section-skeleton {
        padding: 1rem;
        background: var(--theme-bg-app);
        border-radius: 6px;
      }
      .skeleton-table-row {
        display: flex;
        gap: 1rem;
        margin-top: 0.5rem;
      }
      .skeleton {
        background: linear-gradient(90deg, var(--theme-skeleton-base) 25%, var(--theme-skeleton-highlight) 50%, var(--theme-skeleton-base) 75%);
        background-size: 200% 100%;
        animation: skeleton-loading 1.5s ease-in-out infinite;
        border-radius: 4px;
      }
    `,
  ],
})
export class DeepDiveViewComponent implements OnInit, OnDestroy {
  private stateService = inject(ClusterStateService);
  private navigationService = inject(NavigationService);
  private authService = inject(AuthService);
  private viewportScaleService = inject(ViewportScaleService);
  private injector = inject(Injector);
  private platformId = inject(PLATFORM_ID);
  private router = inject(Router);
  
  private urlChangeSubscription?: Subscription;
  
  // Signal to track the Y offset of this component from top of viewport
  private componentOffsetTop = signal<number>(0);
  
  // Calculate viewport height in base coordinates
  calculatedHeight = computed(() => {
    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const viewportWidth = this.viewportScaleService.viewportWidth();
    const baseHeight = this.viewportScaleService.baseHeight(); // Dynamic base height
    const baseWidth = this.viewportScaleService.baseWidth; // Base width from service
    
    // Calculate visible dimensions in base coordinates
    const visibleHeight = viewportHeight / scale;
    const visibleWidth = viewportWidth / scale;
    
    console.log('=== Deep Dive View Height Calculation ===');
    console.log('Scale Factor:', scale);
    console.log('Viewport Height (actual pixels):', viewportHeight);
    console.log('Viewport Width (actual pixels):', viewportWidth);
    console.log('Visible Height (base coordinates):', visibleHeight);
    console.log('Visible Width (base coordinates):', visibleWidth);
    console.log('Base Height (dynamic):', baseHeight);
    console.log('Base Width (fixed):', baseWidth);
    console.log('Note: visibleHeight should equal baseHeight (no scrolling needed)');
    console.log('=========================================');
    
    return {
      scale,
      viewportHeight,
      viewportWidth,
      visibleHeight,
      visibleWidth,
      baseHeight,
      baseWidth
    };
  });

  // Dynamic height style for the layout - accounts for header and padding
  layoutHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const offsetTop = this.componentOffsetTop();
    
    // Calculate available height: baseHeight - offset from top
    // The offset includes: header height + cluster-info-container padding + view-container padding
    const availableHeight = Math.max(baseHeight - offsetTop, 300); // Minimum 300px
    
    console.log('Layout Height Calculation:');
    console.log('  Base Height:', baseHeight);
    console.log('  Offset from Top:', offsetTop);
    console.log('  Available Height:', availableHeight);
    
    return {
      height: `${availableHeight}px`
    };
  });
  
  // Namespaces from API
  namespaces = computed(() => this.authService.namespaces());

  // Expose environment for template access
  readonly environment = environment;
  readonly sidebarSkeletonWidths = [58, 66, 74, 62];
  activeSearchQuery = computed(() => this.stateService.searchQuery().trim());

  filteredResources = this.stateService.filteredResources;
  selectedResource = this.stateService.selectedResource;
  clusterData = this.stateService.clusterData;
  loadingStates = this.stateService.loadingStates;
  currentEditNamespace = signal('');
  currentEditResource = signal<ResourceInfo | null>(null);
  currentLogsNamespace = signal('');
  currentLogsResource = signal<ResourceInfo | null>(null);
  currentLogsResourceType = signal('');
  currentLogsPodName = signal<string | undefined>(undefined);
  currentElasticLogsNamespace = signal('');
  currentElasticLogsResource = signal<ResourceInfo | null>(null);
  
  // Track which namespace is open (accordion: only one at a time)
  openNamespace = signal<string | null>(null);
  
  // Track if user has manually toggled a namespace (to avoid auto-opening when they close it)
  private userHasManuallyToggledNamespace = signal(false);
  
  // Track URL params for resource selection
  private urlParams = signal<{ namespace?: string; resource?: string } | null>(null);
  
  // Track if we've attempted to restore from URL (keyed by URL params to handle back/forward)
  private urlRestoreAttempted = signal<string>('');
  
  // Track pending resource selection from URL (for showing skeleton while data loads)
  pendingResourceSelection = signal<{ namespace: string; metadataName: string } | null>(null);
  
  // Track if we've ever loaded data (to distinguish initial load from refresh)
  private hasEverLoadedData = signal(false);
  hasEverLoadedResource = signal(false);
  
  // Track which namespaces have ever loaded (to distinguish initial load from refresh)
  private namespacesEverLoaded = signal<Set<string>>(new Set());
  
  // Check if a namespace has ever loaded data
  hasNamespaceEverLoaded(namespace: string): boolean {
    return this.namespacesEverLoaded().has(namespace);
  }
  
  // Helper to check if a namespace is loading (reactive)
  isNamespaceLoading(namespace: string): boolean {
    // Read the signal to ensure reactivity
    const loading = this.loadingStates();
    return loading[namespace] === true;
  }

  // Helper to check if namespace has data (reactive)
  hasNamespaceData(namespace: string): boolean {
    // Read the signal to ensure reactivity
    const data = this.clusterData();
    const nsData = data.namespaces[namespace];
    return nsData !== undefined && nsData !== null;
  }

  // Helper to get namespace data (reactive)
  getNamespaceData(namespace: string) {
    // Read the signal to ensure reactivity
    const data = this.clusterData();
    const nsData = data.namespaces[namespace];
    // Debug logging
    if (nsData) {
      console.log(`[DeepDive] Namespace ${namespace} data:`, {
        success: nsData.success,
        resourcesCount: nsData.resources?.length || 0,
        hasResources: !!nsData.resources && nsData.resources.length > 0
      });
    }
    // Return undefined if namespace doesn't exist or hasn't loaded yet
    return nsData;
  }

  // Helper to get sorted resources for a namespace
  getSortedResources(resources: ResourceInfo[]): ResourceInfo[] {
    return [...resources].sort((a, b) => a.name.localeCompare(b.name));
  }

  // Helper to check if a namespace should be shown (has filtered resources or no filters active)
  shouldShowNamespace(namespace: string): boolean {
    const nsData = this.getNamespaceData(namespace);
    
    // If namespace data doesn't exist or hasn't loaded yet, show it (for loading state)
    if (!nsData) {
      return true;
    }
    
    // If namespace failed to load, show it (to display error)
    if (nsData.success === false) {
      return true;
    }
    
    // Check if any filters are active
    const searchQuery = this.stateService.searchQuery();
    const healthFilter = this.stateService.healthFilter();
    const hasActiveFilters = searchQuery.length > 0 || healthFilter.length > 0;
    
    if (!hasActiveFilters) {
      // No filters active, show all namespaces that have resources
      return !!(nsData.success && nsData.resources && nsData.resources.length > 0);
    }
    
    // Filters are active - check if this namespace has any matching resources
    if (!nsData.success || !nsData.resources || nsData.resources.length === 0) {
      return false;
    }
    
    const filteredResources = this.getFilteredAndSortedResources(namespace, nsData.resources);
    return filteredResources.length > 0;
  }

  // Helper to get filtered and sorted resources for a namespace (respects search and health filters)
  getFilteredAndSortedResources(namespace: string, resources: ResourceInfo[]): ResourceInfo[] {
    // Check if any filters are active
    const searchQuery = this.stateService.searchQuery();
    const healthFilter = this.stateService.healthFilter();
    const hasActiveFilters = searchQuery.length > 0 || healthFilter.length > 0;
    
    if (hasActiveFilters) {
      // Get all filtered resources for this namespace
      const filtered = this.filteredResources();
      const namespaceFiltered = filtered
        .filter((item) => item.namespace === namespace)
        .map((item) => item.resource);
      
      // Sort alphabetically
      return [...namespaceFiltered].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // No filters active, show all resources
      return [...resources].sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  // Helper to check if the resource object itself has complete data
  hasCompleteResourceData(resource: ResourceInfo): boolean {
    // Check if resource has essential properties
    return !!(resource && resource.type && resource.name && resource.metadataName);
  }

  // Helper to check if resource data is loaded (for showing loading state)
  // This method reads signals, so it's reactive in Angular templates
  isResourceDataLoaded(namespace: string, metadataName: string): boolean {
    // Read signals to ensure reactivity
    const data = this.clusterData();
    const loading = this.loadingStates();
    const nsData = data.namespaces[namespace];
    
    // If namespace is still loading, data is not ready
    if (loading[namespace] === true) {
      return false;
    }
    
    // Check if namespace data exists and has resources
    if (!nsData) {
      return false;
    }
    
    if (!nsData.success) {
      return false;
    }
    
    if (!nsData.resources || !Array.isArray(nsData.resources) || nsData.resources.length === 0) {
      return false;
    }
    
    // Check if the specific resource exists in the namespace data
    const resource = nsData.resources.find((r) => r.metadataName === metadataName);
    if (!resource) {
      return false;
    }
    
    // Verify resource has essential properties (not just a placeholder)
    if (!resource.type || !resource.name) {
      return false;
    }
    
    return true;
  }

  constructor() {
    // Read URL params on init
    this.readUrlParams();
    
    // Log calculated height whenever viewport changes
    effect(() => {
      const heightInfo = this.calculatedHeight();
      console.log('=== Deep Dive View Height Calculation ===');
      console.log('Scale Factor:', heightInfo.scale);
      console.log('Viewport Height (actual pixels):', heightInfo.viewportHeight);
      console.log('Viewport Width (actual pixels):', heightInfo.viewportWidth);
      console.log('Visible Height (base coordinates):', heightInfo.visibleHeight);
      console.log('Visible Width (base coordinates):', heightInfo.visibleWidth);
      console.log('Base Height:', heightInfo.baseHeight);
      console.log('Base Width:', heightInfo.baseWidth);
      console.log('=========================================');
      // This effect will run whenever viewport dimensions change
    }, { injector: this.injector });
    
    // Auto-open namespace when a resource is selected (e.g., from URL params)
    effect(() => {
      const selected = this.selectedResource();
      if (selected) {
        this.openNamespace.set(selected.namespace);
        // Register refresh callback for deep-dive view
        this.registerDeepDiveRefresh();
      } else {
        // Unregister callback when no resource is selected
        this.stateService.unregisterRefreshCallback('deep-dive-view');
      }
    }, { injector: this.injector });

    // Auto-open first namespace with filtered resources when filters change or data loads
    effect(() => {
      const searchQuery = this.stateService.searchQuery();
      const healthFilter = this.stateService.healthFilter();
      const currentOpen = this.openNamespace();
      const data = this.clusterData();
      
      // Only auto-open if:
      // 1. No namespace is currently open, OR
      // 2. Currently open namespace no longer has visible resources (filters changed)
      const currentOpenStillVisible = currentOpen ? this.shouldShowNamespace(currentOpen) : false;
      
      if (!currentOpen || !currentOpenStillVisible) {
        const firstVisibleNamespace = this.getFirstVisibleNamespace();
        if (firstVisibleNamespace && (!currentOpen || currentOpen !== firstVisibleNamespace)) {
          this.openNamespace.set(firstVisibleNamespace);
        }
      }
    }, { injector: this.injector });
    
    // Watch for data availability and restore from URL (handles progressive loading)
    effect(() => {
      const data = this.clusterData();
      const params = this.urlParams();
      const currentSelected = this.selectedResource();
      const loading = this.loadingStates();
      
      // Handle URL restoration - resource is required, namespace is optional
      // Create a key from URL params to track if we've restored for this specific URL
      const urlKey = params ? `${params.namespace || ''}:${params.resource || ''}` : '';
      const hasRestoredForThisUrl = this.urlRestoreAttempted() === urlKey;
      
      if (params?.resource && !hasRestoredForThisUrl) {
        let foundResource: ResourceInfo | null = null;
        let foundNamespace: string | null = null;
        
        // If namespace is provided, try that namespace first
        if (params.namespace) {
          const nsData = data.namespaces[params.namespace];
          // Only search if namespace has loaded (has data and not currently loading)
          if (nsData?.success && nsData.resources && loading[params.namespace] !== true) {
            // Try metadataName first
            foundResource = nsData.resources.find((r) => r.metadataName === params.resource) || null;
            
            // If not found, try name (consumer group ID might match name)
            if (!foundResource) {
              foundResource = nsData.resources.find((r) => r.name === params.resource) || null;
            }
            
            if (foundResource) {
              foundNamespace = params.namespace;
            }
          }
          // If namespace is specified but not loaded yet, wait for it to load
          // (don't search other namespaces yet)
        }
        
        // If not found in specified namespace (or no namespace provided), search all namespaces
        if (!foundResource) {
          for (const [namespace, nsData] of Object.entries(data.namespaces)) {
            if (nsData?.success && nsData.resources && loading[namespace] !== true) {
              // Try metadataName first
              let resource = nsData.resources.find((r) => r.metadataName === params.resource) || null;
              
              // If not found, try name (consumer group ID might match name)
              if (!resource) {
                resource = nsData.resources.find((r) => r.name === params.resource) || null;
              }
              
              if (resource) {
                foundResource = resource;
                foundNamespace = namespace;
                break;
              }
            }
          }
        }
        
        // If resource found, select it and update URL with correct namespace and metadataName
        if (foundResource && foundNamespace) {
          // Check if URL needs correction
          const needsUrlUpdate = 
            !params.namespace ||  // No namespace in URL
            params.namespace !== foundNamespace ||  // Wrong namespace
            params.resource !== foundResource.metadataName;  // Wrong resource (name vs metadataName)
          
          if (needsUrlUpdate) {
            // Update URL with correct namespace and metadataName
            console.log(`Correcting URL: namespace="${foundNamespace}", resource="${foundResource.metadataName}"`);
            this.updateUrl({
              view: 'deepdive',
              namespace: foundNamespace,
              resource: foundResource.metadataName
            });
          }
          
          // Select the resource
          if (!currentSelected || 
              currentSelected.namespace !== foundNamespace || 
              currentSelected.resource.metadataName !== foundResource.metadataName) {
            console.log(`Auto-selecting resource from URL: ${foundResource.metadataName} in ${foundNamespace}`);
            this.openNamespace.set(foundNamespace);
            this.stateService.setSelectedResource(foundNamespace, foundResource);
            // Mark that we've restored for this URL
            this.urlRestoreAttempted.set(urlKey);
            // Clear pending selection since we've now selected the actual resource
            this.pendingResourceSelection.set(null);
            // Reset hasEverLoadedResource when selecting a new resource from URL
            this.hasEverLoadedResource.set(false);
          }

          // If URL has logsPod (e.g. from Messaging consumer tab link), open logs panel for this resource + pod
          const logsPod = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('logsPod') : null;
          if (logsPod) {
            this.currentLogsNamespace.set(foundNamespace);
            this.currentLogsResource.set(foundResource);
            this.currentLogsResourceType.set(foundResource.type);
            this.currentLogsPodName.set(logsPod);
            this.updateUrl({
              view: 'deepdive',
              namespace: foundNamespace,
              resource: foundResource.metadataName,
              logsNamespace: foundNamespace,
              logsResource: foundResource.metadataName,
              logsPod
            });
          }
        } else {
          // Resource not found - check if we should wait for more data to load
          const allNamespaces = this.namespaces();
          const hasLoadingNamespaces = allNamespaces.some(ns => loading[ns] === true);
          
          // Check if there are namespaces that haven't been loaded yet
          // A namespace is considered "unloaded" if:
          // 1. It doesn't exist in data.namespaces at all, OR
          // 2. It exists but has no success property (hasn't been fetched yet)
          const hasUnloadedNamespaces = allNamespaces.some(ns => {
            const nsData = data.namespaces[ns];
            // If namespace doesn't exist in data or is not currently loading, it might be unloaded
            return !nsData || (nsData.success === undefined && loading[ns] !== true);
          });
          
          // Only mark as attempted if:
          // 1. All namespaces have finished loading (no loading states), AND
          // 2. All namespaces have been checked (either have data or have failed)
          const allNamespacesChecked = allNamespaces.every(ns => {
            const nsData = data.namespaces[ns];
            // Namespace is "checked" if it has data (success or failure) or is currently loading
            return nsData !== undefined || loading[ns] === true;
          });
          
          if (!hasLoadingNamespaces && allNamespacesChecked && !hasUnloadedNamespaces) {
            // All data has been loaded and resource still not found
            console.warn(`Resource "${params.resource}" not found in any namespace after all data loaded`);
            this.urlRestoreAttempted.set(urlKey);
            // Clear pending selection since we've confirmed it doesn't exist
            this.pendingResourceSelection.set(null);
          } else {
            // Still waiting for data to load - keep pending selection and don't mark as attempted
            console.log(`Resource "${params.resource}" not found yet, waiting for data to load... (loading: ${hasLoadingNamespaces}, unloaded: ${hasUnloadedNamespaces})`);
            if (!this.pendingResourceSelection()) {
              // Set pending selection if not already set
              this.pendingResourceSelection.set({
                namespace: params.namespace || '',
                metadataName: params.resource,
              });
            }
          }
        }
      }
      
      // Also update selected resource if it exists but data has changed (refresh case)
      if (currentSelected && params?.namespace === currentSelected.namespace && params?.resource === currentSelected.resource.metadataName) {
        const nsData = data.namespaces[currentSelected.namespace];
        if (nsData?.success && nsData.resources && loading[currentSelected.namespace] !== true) {
          const updatedResource = nsData.resources.find((r) => r.metadataName === currentSelected.resource.metadataName);
          if (updatedResource && updatedResource !== currentSelected.resource) {
            // Update the selected resource with fresh data
            this.stateService.setSelectedResource(currentSelected.namespace, updatedResource);
            // Only mark as loaded if the resource data is actually complete
            if (this.isResourceDataLoaded(currentSelected.namespace, updatedResource.metadataName) && 
                this.hasCompleteResourceData(updatedResource)) {
              this.hasEverLoadedResource.set(true);
            }
          } else if (updatedResource && this.isResourceDataLoaded(currentSelected.namespace, updatedResource.metadataName) && 
                     this.hasCompleteResourceData(updatedResource)) {
            // Resource data is now complete, mark as loaded
            this.hasEverLoadedResource.set(true);
          }
        }
      }

      // Track namespaces that have successfully loaded
      this.namespaces().forEach((ns) => {
        const nsData = data.namespaces[ns];
        if (nsData?.success && nsData.resources && !loading[ns]) {
          const current = new Set(this.namespacesEverLoaded());
          if (!current.has(ns)) {
            current.add(ns);
            this.namespacesEverLoaded.set(current);
          }
        }
      });
      
      // Update hasEverLoadedResource when selected resource data becomes available
      // This is now mainly used for tracking, not for template logic
      if (currentSelected && !this.hasEverLoadedResource()) {
        const nsData = data.namespaces[currentSelected.namespace];
        if (nsData?.success && nsData.resources && loading[currentSelected.namespace] !== true) {
          const resource = nsData.resources.find((r) => r.metadataName === currentSelected.resource.metadataName);
          if (resource && 
              this.isResourceDataLoaded(currentSelected.namespace, resource.metadataName) && 
              this.hasCompleteResourceData(resource)) {
            this.hasEverLoadedResource.set(true);
          }
        }
      }
      
      // Restore logs modal from URL if parameters are present and data is available
      const urlParams = new URLSearchParams(window.location.search);
      const logsNamespace = urlParams.get('logsNamespace');
      const logsResource = urlParams.get('logsResource');
      const logsPod = urlParams.get('logsPod');
      
      if (logsNamespace && logsResource && !this.currentLogsResource()) {
        const nsData = data.namespaces[logsNamespace];
        if (nsData?.success && nsData.resources && loading[logsNamespace] !== true) {
          const foundResource = nsData.resources.find((r) => r.metadataName === logsResource);
          if (foundResource) {
            this.currentLogsNamespace.set(logsNamespace);
            this.currentLogsResource.set(foundResource);
            this.currentLogsResourceType.set(foundResource.type);
            this.currentLogsPodName.set(logsPod || undefined);
          }
        }
      }
    }, { injector: this.injector });
  }

  ngOnInit(): void {
    // Calculate the offset from top of viewport
    this.calculateComponentOffset();
    
    // Recalculate on window resize
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', () => this.calculateComponentOffset());
    }
    
    // Subscribe to global URL changes from NavigationService
    this.urlChangeSubscription = this.navigationService.urlChanges$.subscribe(() => {
      // URL changed - re-read params and reset restoration flag
      this.readUrlParams();
    });
    
    // If a resource is already selected (e.g., from URL params), open its namespace
    const selected = this.selectedResource();
    if (selected) {
      this.openNamespace.set(selected.namespace);
    } else {
      // Check URL params first
      const params = this.urlParams();
      if (params?.resource) {
        // URL has a resource parameter
        if (params.namespace) {
          // Namespace is provided - open it and set pending selection
          this.openNamespace.set(params.namespace);
          this.pendingResourceSelection.set({
            namespace: params.namespace,
            metadataName: params.resource,
          });
          // Try to restore resource from URL (if data is already available)
          this.tryRestoreFromUrl();
        } else {
          // No namespace - resource will be found by effect handler across all namespaces
          // Set pending selection with a placeholder namespace (will be corrected by effect)
          this.pendingResourceSelection.set({
            namespace: '', // Will be set when resource is found
            metadataName: params.resource,
          });
        }
      } else if (params?.namespace) {
        // Just namespace without resource - open it
        this.openNamespace.set(params.namespace);
      } else {
        // No URL params - open the first namespace that should be shown
        const firstVisibleNamespace = this.getFirstVisibleNamespace();
        if (firstVisibleNamespace) {
          this.openNamespace.set(firstVisibleNamespace);
        } else if (this.namespaces().length > 0) {
          // Fallback to first namespace if none are visible yet (e.g., still loading)
          this.openNamespace.set(this.namespaces()[0]);
        }
      }
    }
  }

  // Helper to get the first namespace that should be shown
  private getFirstVisibleNamespace(): string | null {
    for (const ns of this.namespaces()) {
      if (this.shouldShowNamespace(ns)) {
        return ns;
      }
    }
    return null;
  }


  private readUrlParams(): void {
    const params = new URLSearchParams(window.location.search);
    const namespace = params.get('namespace');
    const resource = params.get('resource');
    const logsNamespace = params.get('logsNamespace');
    const logsResource = params.get('logsResource');
    const logsPod = params.get('logsPod');
    
    // Create URL key for tracking restoration
    const newUrlKey = resource ? `${namespace || ''}:${resource}` : '';
    const currentUrlKey = this.urlRestoreAttempted();
    
    // If URL params changed, reset the restoration flag
    if (newUrlKey !== currentUrlKey && currentUrlKey !== '') {
      this.urlRestoreAttempted.set('');
    }
    
    // Store params - resource can exist without namespace (for cross-namespace search)
    if (resource) {
      this.urlParams.set({ 
        namespace: namespace || undefined, 
        resource: resource 
      });
    } else if (namespace) {
      // Just namespace without resource (for opening the namespace)
      this.urlParams.set({ namespace, resource: undefined });
    }
    
    // Restore logs modal from URL if parameters are present
    if (logsNamespace && logsResource) {
      const data = this.clusterData();
      const nsData = data.namespaces[logsNamespace];
      if (nsData?.success && nsData.resources) {
        const foundResource = nsData.resources.find((r) => r.metadataName === logsResource);
        if (foundResource) {
          this.currentLogsNamespace.set(logsNamespace);
          this.currentLogsResource.set(foundResource);
          this.currentLogsResourceType.set(foundResource.type);
          this.currentLogsPodName.set(logsPod || undefined);
        }
      }
    }
  }

  private tryRestoreFromUrl(): void {
    const params = this.urlParams();
    if (!params?.namespace || !params?.resource) {
      return;
    }
    
    const data = this.clusterData();
    const nsData = data.namespaces[params.namespace];
    
    if (nsData?.success && nsData.resources) {
      const foundResource = nsData.resources.find((r) => r.metadataName === params.resource);
      if (foundResource) {
        console.log(`Restoring resource from URL: ${params.resource} in ${params.namespace}`);
        // Use internal method to avoid URL update loop
        this.openNamespace.set(params.namespace);
        this.stateService.setSelectedResource(params.namespace, foundResource);
        // Mark that we've restored for this URL
        const urlKey = `${params.namespace}:${params.resource}`;
        this.urlRestoreAttempted.set(urlKey);
      }
    }
  }

  // Group resources by namespace, sorted by namespace order, resources sorted alphabetically
  namespaceGroups = computed(() => {
    const resources = this.filteredResources();
    const namespaceMap = new Map<string, Array<{ namespace: string; resource: ResourceInfo }>>();
    
    // Group resources by namespace
    resources.forEach((item) => {
      if (!namespaceMap.has(item.namespace)) {
        namespaceMap.set(item.namespace, []);
      }
      namespaceMap.get(item.namespace)!.push(item);
    });
    
    // Sort resources within each namespace alphabetically
    namespaceMap.forEach((resources) => {
      resources.sort((a, b) => a.resource.name.localeCompare(b.resource.name));
    });
    
    // Create groups in configuration order
    const groups: NamespaceGroup[] = [];
    this.namespaces().forEach((ns) => {
      if (namespaceMap.has(ns)) {
        groups.push({
          namespace: ns,
          resources: namespaceMap.get(ns)!,
        });
      }
    });
    
    // Add any namespaces not in configuration (shouldn't happen, but be safe)
    namespaceMap.forEach((resources, ns) => {
      if (!this.namespaces().includes(ns)) {
        groups.push({
          namespace: ns,
          resources,
        });
      }
    });
    
    return groups;
  });

  selectResource(namespace: string, resource: ResourceInfo): void {
    // Auto-open the namespace containing this resource (accordion behavior)
    this.openNamespace.set(namespace);
    
    // Select the resource
    this.stateService.setSelectedResource(namespace, resource);
    
    // Mark that we've loaded resource data (no skeleton on refresh)
    this.hasEverLoadedResource.set(true);
    
    // Update URL to reflect selection (matching backend behavior)
    this.updateUrl({
      view: 'deepdive',
      namespace: namespace,
      resource: resource.metadataName,
    });
    
    // Scroll to top of the page when a resource is selected
    setTimeout(() => {
      const deepdiveContent = document.querySelector('.deepdive-content');
      if (deepdiveContent) {
        deepdiveContent.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }, 100);
  }

  selectFirstVisibleResource(): void {
    for (const namespace of this.namespaces()) {
      if (!this.shouldShowNamespace(namespace)) {
        continue;
      }
      const nsData = this.getNamespaceData(namespace);
      if (!nsData?.success || !nsData.resources?.length) {
        continue;
      }

      const resources = this.getFilteredAndSortedResources(namespace, nsData.resources);
      if (resources.length > 0) {
        this.selectResource(namespace, resources[0]);
        return;
      }
    }
  }

  goToClusterScanning(): void {
    this.stateService.setCurrentView('scanning');
    this.router.navigate(['/cluster']);
  }

  onSidebarSearchChange(query: string): void {
    this.stateService.setSearchQuery(query);
  }

  private updateUrl(params: {
    view?: string;
    namespace?: string;
    resource?: string;
    health?: string;
    logsNamespace?: string | null;
    logsResource?: string | null;
    logsPod?: string | null;
  }): void {
    const queryParams: Record<string, string> = {};
    const current = new URLSearchParams(window.location.search);

    current.forEach((value, key) => {
      queryParams[key] = value;
    });

    if (params.view && params.view !== 'scanning') {
      queryParams['view'] = params.view;
    }
    if (params.namespace) {
      queryParams['namespace'] = params.namespace;
    }
    if (params.resource) {
      queryParams['resource'] = params.resource;
    }
    if (params.health !== undefined) {
      if (params.health.length > 0) {
        queryParams['health'] = params.health;
      } else {
        delete queryParams['health'];
      }
    }
    if (params.logsNamespace !== undefined) {
      if (params.logsNamespace) {
        queryParams['logsNamespace'] = params.logsNamespace;
      } else {
        delete queryParams['logsNamespace'];
      }
    }
    if (params.logsResource !== undefined) {
      if (params.logsResource) {
        queryParams['logsResource'] = params.logsResource;
      } else {
        delete queryParams['logsResource'];
      }
    }
    if (params.logsPod !== undefined) {
      if (params.logsPod) {
        queryParams['logsPod'] = params.logsPod;
      } else {
        delete queryParams['logsPod'];
      }
    }

    this.router.navigate(['/cluster'], { queryParams });
  }

  isSelected(namespace: string, metadataName: string): boolean {
    const selected = this.selectedResource();
    return selected?.namespace === namespace && selected?.resource.metadataName === metadataName;
  }

  toggleNamespace(namespace: string): void {
    const currentOpen = this.openNamespace();
    
    // Mark that user has manually toggled
    this.userHasManuallyToggledNamespace.set(true);
    
    if (currentOpen === namespace) {
      // If clicking the open namespace, close it (allowing all to be closed)
      this.openNamespace.set(null);
    } else {
      // Open the clicked namespace (accordion: closes others automatically)
      this.openNamespace.set(namespace);
    }
  }

  isNamespaceOpen(namespace: string): boolean {
    return this.openNamespace() === namespace;
  }

  getResourceId(namespace: string, metadataName: string): string {
    return `${namespace}-${metadataName}`.replace(/\./g, '-').replace(/\s/g, '-');
  }

  getResourceDisplayIcon(resource: ResourceInfo): string {
    const healthIconMap: Record<string, string> = {
      'Healthy': '✅',
      'Degraded': '⚠️',
      'Failed': '❌',
      'Succeeded': '✅',
      'Running': '🔄',
      'Pending': '⏳',
      'Never Run': '⚪',
    };
    
    let displayStatus = resource.healthStatus;
    
    // Special handling for CronWorkflow with suspend
    if (resource.type === 'CronWorkflow' && resource.suspend === true) {
      return '⏸️';
    }
    
    // Special handling for Deployment/DaemonSet with consumer disabled
    if (
      (resource.type === 'Deployment' || resource.type === 'DaemonSet' || resource.type === 'StatefulSet') &&
      resource.consumerEnabled === false
    ) {
      return '🛑';
    }
    
    return healthIconMap[displayStatus] || '❓';
  }

  getResourceHealthClass(resource: ResourceInfo): string {
    const icon = this.getResourceDisplayIcon(resource);
    if (icon === '✅') return 'health-healthy';
    if (icon === '⚠️' || icon === '⏳') return 'health-warning';
    if (icon === '❌') return 'health-critical';
    return 'health-muted';
  }

  getSidebarOperationalState(namespace: string, resource: ResourceInfo): 'paused' | 'resumed' | 'started' | 'stopped' | null {
    if (resource.type === 'CronWorkflow') {
      return resource.suspend === true ? 'paused' : 'resumed';
    }

    const isConsumerResource =
      namespace === this.authService.consumersNamespace() &&
      (resource.type === 'Deployment' || resource.type === 'DaemonSet' || resource.type === 'StatefulSet');
    if (!isConsumerResource) {
      return null;
    }

    return resource.consumerEnabled === false ? 'stopped' : 'started';
  }

  getSidebarOperationalStateLabel(state: 'paused' | 'resumed' | 'started' | 'stopped'): string {
    switch (state) {
      case 'paused':
        return 'Paused';
      case 'resumed':
        return 'Resumed';
      case 'started':
        return 'Started';
      case 'stopped':
        return 'Stopped';
      default:
        return '';
    }
  }

  getNamespaceVisibleCount(namespace: string): number {
    const nsData = this.getNamespaceData(namespace);
    if (!nsData?.success || !nsData.resources) {
      return 0;
    }
    return this.getFilteredAndSortedResources(namespace, nsData.resources).length;
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
    const nsData = this.getNamespaceData(namespace);
    if (!nsData?.success || !nsData.resources) {
      return counts;
    }
    const visible = this.getFilteredAndSortedResources(namespace, nsData.resources);
    visible.forEach((resource) => {
      const icon = this.getResourceDisplayIcon(resource);
      if (icon === '✅') {
        counts.healthy += 1;
      } else if (icon === '⚠️') {
        counts.degraded += 1;
      } else if (icon === '❌') {
        counts.failed += 1;
      } else if (icon === '🛑') {
        counts.stopped += 1;
      } else if (icon === '⏸️') {
        counts.paused += 1;
      } else if (icon === '⏳') {
        counts.pending += 1;
      } else if (icon === '🔄') {
        counts.running += 1;
      } else if (icon === '⚪') {
        counts.neverRun += 1;
      }
    });
    return counts;
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

  viewLogs(namespace: string, resource: ResourceInfo, resourceType: string, podName?: string): void {
    this.currentLogsNamespace.set(namespace);
    this.currentLogsResource.set(resource);
    this.currentLogsResourceType.set(resourceType);
    this.currentLogsPodName.set(podName);
    
    // Update URL to include logs modal state
    this.updateUrl({
      logsNamespace: namespace,
      logsResource: resource.metadataName,
      logsPod: podName,
    });
  }

  onLogsPodChanged(podName: string): void {
    this.currentLogsPodName.set(podName);
    // Update URL with new pod name
    const selected = this.currentLogsResource();
    if (selected) {
      this.updateUrl({
        logsPod: podName,
      });
    }
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

  private registerDeepDiveRefresh(): void {
    const selected = this.selectedResource();
    if (!selected) {
      return;
    }

    // Register refresh callback that refreshes both resource data and pods
    this.stateService.registerRefreshCallback('deep-dive-view', async () => {
      // Refresh only the selected resource (not the entire namespace)
      await this.stateService.refreshSingleResource(
        selected.namespace,
        selected.resource.metadataName,
        selected.resource.type
      );
      
      // Update the selected resource with the refreshed data
      const updatedData = this.stateService.clusterData();
      const nsData = updatedData.namespaces[selected.namespace];
      if (nsData?.success && nsData.resources) {
        const updatedResource = nsData.resources.find(
          (r) => r.metadataName === selected.resource.metadataName
        );
        if (updatedResource) {
          this.stateService.setSelectedResource(selected.namespace, updatedResource);
        }
      }
      
      // Also trigger pod refresh by calling the resource-detail pods refresh callback
      const podsCallbackId = `resource-detail-pods-${selected.namespace}-${selected.resource.metadataName}`;
      const podsCallback = this.stateService.getRefreshCallback(podsCallbackId);
      if (podsCallback) {
        await podsCallback();
      }
    });
  }

  ngOnDestroy(): void {
    // Unregister refresh callback on destroy
    this.stateService.unregisterRefreshCallback('deep-dive-view');
    
    // Unsubscribe from URL changes
    if (this.urlChangeSubscription) {
      this.urlChangeSubscription.unsubscribe();
    }
    
    // Remove resize listener
    if (isPlatformBrowser(this.platformId)) {
      window.removeEventListener('resize', () => this.calculateComponentOffset());
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
      const element = document.querySelector('.deepdive-layout');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        
        // Convert actual pixel offset to base coordinates
        const offsetInBaseCoords = rect.top / scale;
        
        console.log('Component Offset Calculation:');
        console.log('  Actual offset (pixels):', rect.top);
        console.log('  Scale factor:', scale);
        console.log('  Offset in base coords:', offsetInBaseCoords);
        
        this.componentOffsetTop.set(offsetInBaseCoords);
      }
    }, 0);
  }
}


