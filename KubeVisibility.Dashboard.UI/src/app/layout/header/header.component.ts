import {
  Component,
  EventEmitter,
  Input,
  Output,
  inject,
  signal,
  computed,
  effect,
  OnInit,
  OnDestroy,
  ViewChild,
  HostListener,
} from '@angular/core';

import { Router, RouterModule, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { ClusterStateService } from '../../core/services/cluster-state.service';
import { AuthService } from '../../core/services/auth.service';
import { HealthStateService } from '../../features/health-dashboard/services/health-state.service';
import { AutoRefreshComponent } from '../../shared/components/auto-refresh/auto-refresh.component';
import { NavOption } from '../../shared/components/nav-toggle-slider/nav-toggle-slider.component';
import { GlobalElasticsearchSearchComponent } from '../../shared/components/global-elasticsearch-search/global-elasticsearch-search.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { ViewMode, HealthFilter } from '../../core/models/cluster-info.models';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [
    RouterModule,
    AutoRefreshComponent,
    GlobalElasticsearchSearchComponent,
    ToastComponent
],
  template: `
    <div class="header-section">
      @if (enableAlertNotifications && alertNotificationToasts().length > 0) {
        <div class="toast-stack">
          @for (toast of alertNotificationToasts(); track toast.id) {
            <app-toast
              [message]="toast.message"
              type="warning"
              (click)="openAlertsNotificationsView()"
              title="Open alerts section"
            ></app-toast>
          }
        </div>
      }
      @if (refreshToastMessage()) {
        <div
          class="refresh-toast-floating"
          [class.refresh-toast-floating-info]="refreshToastType() === 'info'"
          [class.refresh-toast-floating-success]="refreshToastType() === 'success'"
          [class.refresh-toast-floating-error]="refreshToastType() === 'error'"
        >
          <i class="fas" [class.fa-check-circle]="refreshToastType() === 'success'" [class.fa-info-circle]="refreshToastType() === 'info'" [class.fa-exclamation-circle]="refreshToastType() === 'error'"></i>
          <span>{{ refreshToastMessage() }}</span>
        </div>
      }
      <div class="header-content">
        <div class="header-left">
          <div class="header-title-row">
            <div class="header-title-main">
              <div class="header-title-block">
                <h1>
                  <a routerLink="/" [queryParams]="{ section: 'overview' }" class="title-link" title="Go to Health Dashboard">
                    <span class="header-logo-chip">
                      <img class="header-logo" src="logo.svg" alt="Kube Visibility" />
                    </span>
                    <span class="title-env-separator">Kube Visibility —</span>
                  @if (isEnvironmentNameLoading()) {
                    <span class="environment-name-skeleton skeleton"></span>
                  } @else {
                    <span>{{ environmentName() }}</span>
                  }
                  </a>
                </h1>
              </div>
                <div class="header-quick-actions-box quick-actions-enter">
                  <div class="header-quick-actions-list">
                    <a class="header-quick-action-btn" [class.active]="isAlertsQuickLinkActive()" [routerLink]="['/']" [queryParams]="{ section: 'alerts' }">
                      <i class="fas fa-bell"></i>
                      Alerts
                    </a>
                    <a class="header-quick-action-btn" [class.active]="isErrorsQuickLinkActive()" [routerLink]="['/errors']">
                      <i class="fas fa-triangle-exclamation"></i>
                      Errors
                    </a>
                    @if (isAdmin()) {
                      <a class="header-quick-action-btn" [class.active]="isAuditsQuickLinkActive()" [routerLink]="['/audit']">
                        <i class="fas fa-clipboard-list"></i>
                        Audits
                      </a>
                    }
                    <button type="button" class="header-quick-action-btn" [class.active]="isLogsQuickLinkActive()" (click)="openGlobalSearch()">
                      <i class="fas fa-search"></i>
                      Logs
                    </button>
                    <a class="header-quick-action-btn" [class.active]="isAppsQuickLinkActive()" [routerLink]="['/cluster']" [queryParams]="{ view: 'scanning' }">
                      <i class="fas fa-server"></i>
                      Apps
                    </a>
                    @if (isMessagingEnabled()) {
                      <a class="header-quick-action-btn" [class.active]="isMessagesQuickLinkActive()" [routerLink]="['/messages']" [queryParams]="{ view: 'scanning' }">
                        <i class="fas fa-stream"></i>
                        Messages
                      </a>
                    }
                  </div>
                </div>
                <div class="header-controls-group">
                  <div class="header-user-section">
                    @if (isAuthenticated()) {
                      <div class="user-name">
                        <i class="fas fa-user"></i>
                        <span>{{ userName() || userEmail() || 'User' }}</span>
                      </div>
                      @if (isAdmin()) {
                        <div class="admin-badge" title="Admin" aria-label="Admin">
                          <i class="fas fa-shield-alt"></i>
                        </div>
                      }
                    } @else {
                      <div class="user-name">
                        <i class="fas fa-user-slash"></i>
                        <span>Not Authenticated</span>
                      </div>
                    }
                    @if (enableAlertNotifications) {
                    <div class="alerts-container">
                      <button
                        class="btn-alerts btn-refresh-icon-only"
                        (click)="toggleAlertDropdown()"
                        [title]="alertNotificationMessage() || 'Alert notifications panel'"
                        aria-label="Open alert notifications"
                      >
                        <i class="fas fa-bell"></i>
                        @if (alertNotificationCount() > 0) {
                          <span class="alert-badge">{{ alertNotificationCount() }}</span>
                        }
                      </button>
                      @if (showAlertDropdown()) {
                        <div class="alert-dropdown">
                          <div class="alert-dropdown-header">
                            <span>New alerts</span>
                            <div class="alert-dropdown-actions">
                              <button type="button" class="alert-clear" (click)="clearAlertNotifications()">Clear</button>
                              <button
                                type="button"
                                class="alert-close"
                                (click)="closeAlertDropdown()"
                                aria-label="Close alerts panel"
                                title="Close"
                              >
                                <i class="fas fa-times"></i>
                              </button>
                            </div>
                          </div>
                          @if (alertNotificationItems().length === 0) {
                            <div class="alert-empty">No new alerts. You are all caught up.</div>
                          } @else {
                            @for (item of alertNotificationItems(); track item.alertName + (item.startsAt ?? '') + (item.namespaceName ?? '')) {
                              <div class="alert-item" (click)="openAlertsNotificationsView()" title="Open alerts section">
                                <div class="alert-item-title">{{ item.alertName }}</div>
                                <div class="alert-item-meta">
                                  <span>{{ item.severity }}</span>
                                  @if (item.namespaceName) { <span>{{ item.namespaceName }}</span> }
                                  @if (item.podName) { <span>{{ item.podName }}</span> }
                                </div>
                              </div>
                            }
                          }
                        </div>
                      }
                    </div>
                    }
                    @if (isMobileHeader()) {
                      <button
                        class="btn-quick-menu btn-refresh-icon-only"
                        (click)="toggleMobileQuickActions()"
                        [title]="showMobileQuickActions() ? 'Close quick actions' : 'Open quick actions'"
                        aria-label="Toggle mobile quick actions"
                      >
                        <i class="fas" [class.fa-times]="showMobileQuickActions()" [class.fa-ellipsis-v]="!showMobileQuickActions()"></i>
                      </button>
                    }
                  </div>
                  <app-auto-refresh
                    appearance="header"
                    [enabled]="autoRefreshEnabled"
                    [interval]="autoRefreshInterval"
                    [showLabel]="!isAuditRoute()"
                    (enabledChange)="autoRefreshEnabledChange.emit($event)"
                    (intervalChange)="autoRefreshIntervalChange.emit($event)"
                  />
                  <button
                    class="btn-refresh btn-refresh-icon-only"
                    (click)="refresh()"
                    [disabled]="isRefreshingState()"
                    title="Refresh"
                    aria-label="Refresh current page data"
                  >
                    <i class="fas fa-sync-alt" [class.spinning]="isRefreshingState() || isLoading()"></i>
                  </button>
                </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    @if (showMobileQuickActions()) {
      <div class="mobile-quick-actions-panel">
        <div class="mobile-quick-actions-header">
          <span>Quick Actions</span>
          <button type="button" (click)="closeMobileQuickActions()">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <button type="button" class="mobile-action-btn" (click)="openAlertsNotificationsView()">
          <i class="fas fa-bell"></i>
          Alerts
          @if (alertNotificationCount() > 0) {
            <span class="mobile-action-badge">{{ alertNotificationCount() }}</span>
          }
        </button>
        <button type="button" class="mobile-action-btn" (click)="openErrorsFromMenu()">
          <i class="fas fa-triangle-exclamation"></i>
          Errors
        </button>
        @if (isAdmin()) {
          <button type="button" class="mobile-action-btn" (click)="openAuditFromMenu()">
            <i class="fas fa-clipboard-list"></i>
            Audits
          </button>
        }
        <button type="button" class="mobile-action-btn" (click)="openGlobalSearchFromMenu()">
          <i class="fas fa-search"></i>
          Search Logs
        </button>
        <button type="button" class="mobile-action-btn" (click)="openClusterFromMenu()">
          <i class="fas fa-server"></i>
          Apps
        </button>
        @if (isMessagingEnabled()) {
          <button type="button" class="mobile-action-btn" (click)="openMessagesFromMenu()">
            <i class="fas fa-stream"></i>
            Messages
          </button>
        }
      </div>
    }

    <!-- Global Elasticsearch Search Modal -->
    <app-global-elasticsearch-search #globalSearchModal [routeQueryMode]="true" />
  `,
  styles: [
    `
      .header-section {
        margin-top: .5rem;
        padding: 1rem 2rem;
        background: var(--theme-header-gradient);
        color: white;
        border-radius: 12px;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
        position: sticky;
        top: 0.5rem;
        overflow: visible;
        z-index: var(--z-header, 9000);
      }
      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: stretch;
        gap: 2rem;
        min-width: 0;
      }
      .header-title-block {
        grid-column: 1;
        justify-self: start;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
      }
      .header-separator {
        width: 2px;
        height: 32px;
        background-color: rgba(255, 255, 255, 0.3);
        margin: 0 1rem;
        flex-shrink: 0;
      }
      .header-user-section {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding-left: 0;
      }
      .header-controls-group {
        display: inline-flex;
        align-items: center;
        gap: 0.8rem;
        grid-column: 3;
        justify-self: end;
        margin-left: 0;
        padding: 0.45rem 0.6rem;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.12);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
        min-width: 0;
        position: relative;
        z-index: 1;
      }
      app-auto-refresh {
        --auto-refresh-font-size: var(--theme-font-body);
      }
      .user-name {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        color: rgba(255, 255, 255, 0.95);
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }
      .user-name i {
        font-size: var(--theme-font-table-header);
        opacity: 0.9;
      }
      .admin-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 0;
        width: 28px;
        height: 28px;
        padding: 0;
        background-color: rgba(245, 158, 11, 0.2);
        border: 1px solid rgba(245, 158, 11, 0.5);
        border-radius: 999px;
        color: #fbbf24;
      }
      .admin-badge i {
        font-size: var(--theme-font-table-header);
      }
      .header-left {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-width: 0;
      }
      .header-title-row {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .header-title-main {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        gap: 1rem;
        padding-bottom: 0;
        min-width: 0;
      }
      .header-title-center {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
      }
      .header-title-main h1 {
        font-size: var(--theme-font-page-title);
        margin: 0;
        display: flex;
        align-items: center;
        gap: 1rem;
        flex-shrink: 0;
      }
      .title-link {
        display: flex;
        align-items: center;
        gap: .2rem;
        color: inherit;
        text-decoration: none;
        transition: opacity 0.2s ease;
        cursor: pointer;
        white-space: nowrap;
      }
      .title-link:hover {
        opacity: 0.9;
      }
      .title-link i {
        font-size: var(--theme-font-page-title);
      }
      .header-logo {
        width: 30px;
        height: auto;
        display: block;
        filter: contrast(1.18) saturate(1.08);
      }
      .header-logo-chip {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.2rem 0.45rem;
      }
      .environment-name-skeleton {
        display: inline-block;
        min-width: 120px;
        height: 1.2em;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.3) 25%, rgba(255, 255, 255, 0.5) 50%, rgba(255, 255, 255, 0.3) 75%);
        background-size: 200% 100%;
        animation: skeletonPulse 1.5s ease-in-out infinite;
        border-radius: 4px;
      }

      .route-context {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.22rem 0.65rem;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.16);
        border: 1px solid rgba(255, 255, 255, 0.3);
        font-size: var(--theme-font-caption);
        margin-top: -0.3rem;
      }
      .route-context-label {
        font-weight: var(--theme-font-table-header-weight);
      }

      .route-context-hint {
        opacity: 0.92;
      }
      .route-context-info {
        border: none;
        background: transparent;
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        padding: 0;
      }
      .route-context-info:hover {
        color: #ffffff;
      }

      .btn-quick-menu {
        display: none;
        background-color: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        color: var(--theme-button-primary);
        border-radius: 999px;
        cursor: pointer;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        height: 32px;
        width: 32px;
      }

      .btn-quick-menu:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        color: var(--theme-button-primary-hover);
        transform: translateY(-1px);
      }

      .mobile-quick-actions-panel {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        position: fixed;
        right: 0.75rem;
        top: 4.25rem;
        width: min(320px, calc(100vw - 1.5rem));
        background: var(--theme-bg-surface);
        color: var(--theme-text-dark);
        border-radius: 12px;
        border: 1px solid var(--theme-border-gray-light);
        box-shadow: 0 18px 40px rgba(15, 23, 42, 0.3);
        padding: 0.75rem;
        z-index: var(--z-modal-content, 1000001);
        max-height: calc(100vh - 5rem);
        overflow-y: auto;
      }
      .mobile-quick-actions-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-weight: var(--theme-font-table-header-weight);
        font-size: var(--theme-font-body);
        color: var(--theme-text-dark);
      }
      .mobile-quick-actions-header button {
        border: none;
        background: transparent;
        color: var(--theme-text-gray);
        cursor: pointer;
      }
      .mobile-action-btn {
        border: 1px solid var(--theme-border-gray-light);
        background: var(--theme-bg-app);
        border-radius: 999px;
        color: var(--theme-text-dark);
        text-decoration: none;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 0.48rem;
        width: 100%;
        padding: 0.7rem 0.7rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        line-height: 1.1;
        backdrop-filter: blur(2px);
        transition: all 0.2s ease;
        cursor: pointer;
      }
      .mobile-action-btn i {
        font-size: var(--theme-font-body);
      }
      .mobile-action-btn:hover {
        background: var(--theme-bg-teal-lighter);
        border-color: var(--theme-border-gray);
        transform: translateY(-1px);
      }
      .mobile-action-badge {
        margin-left: auto;
        background: #ef4444;
        color: #fff;
        border-radius: 999px;
        font-size: var(--theme-font-caption);
        padding: 0.1rem 0.4rem;
      }
      @keyframes skeletonPulse {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }
      .header-second-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        flex-wrap: wrap;
      }
      .header-quick-actions-box {
        display: flex;
        align-items: center;
        justify-content: center;
        grid-column: 2;
        justify-self: center;
        width: fit-content;
        max-width: 100%;
        padding: 0;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
        min-width: 0;
        position: relative;
        z-index: 3;
      }
      .quick-actions-enter {
        animation: quick-actions-enter 260ms ease-out;
      }
      @keyframes quick-actions-enter {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .header-quick-actions-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.58rem;
        justify-content: center;
        min-width: 0;
        position: relative;
        z-index: 3;
      }
      .header-quick-action-btn {
        border: 1px solid var(--theme-border-gray-light);
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
        text-decoration: none;
        border-radius: 999px;
        padding: 0.7rem 0.7rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-header-weight);
        display: inline-flex;
        align-items: center;
        gap: 0.48rem;
        cursor: pointer;
        transition: all 0.2s ease;
        line-height: 1.1;
        backdrop-filter: blur(2px);
      }
      .header-quick-action-btn i {
        font-size: var(--theme-font-body);
      }
      .header-quick-action-btn:hover {
        background: var(--theme-bg-teal-lighter);
        border-color: var(--theme-border-gray);
        transform: translateY(-1px);
      }
      .header-quick-action-btn.active {
        background: #cfd8ce;
        border-color: #fbbf24;
        color: #000000;
        font-weight: var(--theme-font-table-header-weight);
      }
      .header-quick-action-btn.active i {
        color: #000000;
      }
      .header-quick-action-btn.active:hover {
        transform: none;
        background: #cfd8ce;
      }
      @media (max-width: 1320px) {
        .header-quick-actions-list {
          gap: 0.45rem;
        }
        .header-quick-action-btn {
          font-size: var(--theme-font-caption);
          padding: 0.7rem 0.7rem;
        }
      }
      .header-stats {
        padding: 0.6rem 1.2rem;
        background-color: rgba(255, 255, 255, 0.15);
        border-radius: 8px;
        font-size: var(--theme-font-section-title);
        font-weight: var(--theme-font-table-body-weight);
        display: flex;
        align-items: center;
        line-height: 1.4;
        min-height: 60px;
        height: fit-content;
      }

      .stats-text-skeleton {
        display: flex;
        align-items: center;
      }

      .skeleton-line {
        width: 200px;
        height: 20px;
        background: linear-gradient(90deg, rgba(255, 255, 255, 0.2) 25%, rgba(255, 255, 255, 0.3) 50%, rgba(255, 255, 255, 0.2) 75%);
        background-size: 200% 100%;
        animation: skeleton-loading 1.5s infinite;
        border-radius: 4px;
      }

      @keyframes skeleton-loading {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      .header-controls-container {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
        flex: 1;
        min-width: 0;
      }

      .dashboard-buttons {
        margin-left: auto;
        justify-content: flex-end;
      }
      .header-search-box {
        display: flex;
        align-items: center;
        background: rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        padding: 0.6rem 1.2rem;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        min-height: 60px;
        height: fit-content;
        flex: 1;
        min-width: 0;
        width: 100%;
      }
      .header-search-box app-search-bar {
        width: 100%;
        display: block;
      }
      .header-buttons-box {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
        background: rgba(255, 255, 255, 0.18);
        border-radius: 8px;
        padding: 0.6rem 1.2rem;
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        min-height: 60px;
        height: fit-content;
      }
      .header-refresh-controls {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        flex-wrap: wrap;
      }
      .header-health {
        display: flex;
      }
      .header-search-box button,
      .header-search-box select,
      .header-search-box input,
      .header-buttons-box button,
      .header-buttons-box select,
      .header-buttons-box input {
        font-size: var(--theme-font-body);
      }
      .btn-refresh {
        background-color: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        color: var(--theme-text-dark);
        border-radius: 999px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        font-weight: var(--theme-font-table-header-weight);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        line-height: 1.4;
        box-sizing: border-box;
        height: 32px;
        width: 32px;
        padding: 0;
      }
      .btn-alerts {
        background-color: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        color: var(--theme-button-primary);
        border-radius: 999px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        font-weight: var(--theme-font-table-header-weight);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        line-height: 1.4;
        box-sizing: border-box;
        height: 32px;
        width: 32px;
        padding: 0;
        position: relative;
      }
      .btn-alerts:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        color: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
      }
      .alert-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        background: #ef4444;
        color: #fff;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        line-height: 1;
        padding: 2px 5px;
        border-radius: 999px;
        border: 2px solid #1e293b;
      }
      .alerts-container {
        position: relative;
        display: flex;
        align-items: center;
      }
      .alert-dropdown {
        position: absolute;
        top: calc(100% + 10px);
        right: 0;
        width: 300px;
        background: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        border-radius: 8px;
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.15);
        z-index: var(--z-header-popover, 9010);
        padding: 0.5rem;
        max-height: 320px;
        overflow-y: auto;
      }
      .alert-dropdown-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
        padding-bottom: 0.35rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        margin-bottom: 0.5rem;
      }
      .alert-dropdown-actions {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
      }
      .alert-clear {
        border: none;
        background: none;
        color: var(--theme-text-teal);
        cursor: pointer;
        font-size: var(--theme-font-caption);
      }
      .alert-close {
        border: none;
        background: transparent;
        color: var(--theme-text-gray);
        cursor: pointer;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
      }
      .alert-close:hover {
        background: var(--theme-bg-app);
        color: var(--theme-text-dark);
      }
      .alert-empty {
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
        padding: 0.25rem 0.1rem 0.5rem;
      }
      .alert-item {
        padding: 0.5rem 0.4rem;
        border-bottom: 1px solid var(--theme-bg-gray-light);
        background: var(--theme-bg-surface);
        border-radius: 6px;
        margin-bottom: 0.35rem;
        cursor: pointer;
      }
      .alert-item:last-child {
        border-bottom: none;
        margin-bottom: 0;
      }
      .alert-item:hover {
        background: var(--theme-bg-app);
      }
      .alert-item-title {
        font-size: var(--theme-font-caption);
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-text-dark);
      }
      .alert-item-meta {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        font-size: var(--theme-font-caption);
        color: var(--theme-text-gray);
      }
      .toast-stack {
        position: fixed;
        top: 78px;
        right: 20px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        z-index: var(--z-toast, 9020);
      }
      .refresh-toast-floating {
        position: absolute;
        top: 8px;
        right: 16px;
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.5rem 0.75rem 0.5rem 1.3rem;
        border-radius: 10px;
        background: rgba(15, 23, 42, 0.92);
        color: #ffffff;
        border: 1px solid rgba(148, 163, 184, 0.35);
        box-shadow: 0 12px 26px rgba(2, 6, 23, 0.35);
        font-size: var(--theme-font-table-header);
        font-weight: var(--theme-font-table-header-weight);
        z-index: var(--z-toast, 9020);
      }
      .refresh-toast-floating-info {
        background: rgba(30, 64, 175, 0.96);
        border-color: rgba(147, 197, 253, 0.55);
        color: #e0ecff;
      }
      .refresh-toast-floating-success {
        background: rgba(6, 78, 59, 0.95);
        border-color: rgba(110, 231, 183, 0.45);
        color: #dcfce7;
      }
      .refresh-toast-floating-error {
        background: rgba(127, 29, 29, 0.95);
        border-color: rgba(248, 113, 113, 0.45);
        color: #fee2e2;
      }
      .btn-refresh:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        transform: translateY(-1px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
      }
      .btn-refresh:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn-refresh-icon-only {
        padding: 0;
        min-width: 32px;
        width: 32px;
      }
      .btn-refresh-icon-only i {
        font-size: var(--theme-font-body);
      }
      .btn-refresh i.spinning {
        animation: spin 1s linear infinite;
      }
      .btn-search-logs {
        background-color: var(--theme-bg-surface);
        border: 1px solid var(--theme-border-gray-light);
        color: var(--theme-button-primary);
        border-radius: 999px;
        cursor: pointer;
        font-size: var(--theme-font-body);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
        font-weight: var(--theme-font-table-header-weight);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
        line-height: 1.4;
        box-sizing: border-box;
        height: 32px;
        width: 32px;
        padding: 0;
        margin: 0;
      }
      .btn-search-logs:hover:not(:disabled) {
        background-color: var(--theme-bg-app);
        color: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
      }
      .btn-search-logs:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
      .btn-search-logs i {
        font-size: var(--theme-font-body);
        color: currentColor;
      }
      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }
      @media (max-width: 1024px) {
        .header-content {
          gap: 0.65rem;
        }
        .header-section {
          padding: 0.75rem 1rem;
        }
        .header-title-main {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas: "title controls";
          align-items: center;
          gap: 0.5rem;
        }
        .header-title-block {
          grid-area: title;
          width: 100%;
          justify-self: start;
        }
        .header-title-main h1 {
          font-size: var(--theme-font-page-title);
          margin-bottom: 0;
        }
        .title-link {
          gap: 0.2rem;
        }
        .header-logo {
          width: 30px;
        }
        .header-logo-chip {
          padding: 0.16rem 0.36rem;
          border-radius: 8px;
        }
        .title-link i {
          font-size: var(--theme-font-section-title);
        }
        .header-title-center {
          width: 100%;
          justify-content: flex-start;
        }
        .header-quick-actions-box {
          display: none;
        }
        .header-controls-group {
          grid-area: controls;
          justify-self: end;
          align-self: center;
          margin-left: auto;
          padding: 0.35rem 0.5rem;
          gap: 0.55rem;
        }
        .header-separator {
          display: none;
        }
        .header-user-section {
          flex-wrap: nowrap;
          gap: 0.5rem;
        }
        .header-user-section .user-name,
        .header-user-section .admin-badge,
        .header-user-section .btn-alerts {
          display: none;
        }
        .btn-quick-menu {
          display: inline-flex;
        }
        app-auto-refresh {
          --auto-refresh-font-size: var(--theme-font-caption);
        }
        .header-second-row {
          flex-direction: column;
          align-items: stretch;
        }
        .header-controls-container {
          flex-direction: column;
          align-items: stretch;
        }
        .header-search-box {
          width: 100%;
        }
        .header-buttons-box {
          width: 100%;
        }
        .header-health {
          width: 100%;
          justify-content: flex-start;
        }
        .header-refresh-controls {
          width: 100%;
          justify-content: flex-start;
        }
        .toast-stack {
          top: 70px;
          right: 12px;
        }
        .refresh-toast-floating {
          top: 6px;
          right: 10px;
          font-size: var(--theme-font-caption);
          padding: 0.42rem 0.62rem 0.42rem 1rem;
        }
      }
      @media (max-width: 1320px) {
        .header-section {
          padding: 0.85rem 1.25rem;
        }
        .header-content {
          gap: 1rem;
        }
        .header-controls-group {
          padding: 0.38rem 0.52rem;
          gap: 0.6rem;
        }
        .header-title-main h1 {
          font-size: var(--theme-font-page-title);
        }
        .route-context-hint {
          display: none;
        }
        .header-user-section {
          gap: 0.65rem;
        }
        .user-name span {
          max-width: 160px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        app-auto-refresh {
          --auto-refresh-font-size: var(--theme-font-caption);
        }
      }
      @media (max-width: 640px) {
        .header-section {
          padding: 0.55rem 0.75rem;
        }
        .route-context {
          font-size: var(--theme-font-caption);
          padding: 0.2rem 0.45rem;
        }

        .route-context-hint {
          display: none;
        }

        .header-title-main {
          grid-template-columns: minmax(0, 1fr) auto;
          grid-template-areas:
            "title controls";
          gap: 0.4rem;
        }
        .header-title-main h1 {
          font-size: var(--theme-font-page-title);
        }
        .header-logo {
          width: 30px;
        }
        .header-logo-chip {
          padding: 0.14rem 0.3rem;
          border-radius: 7px;
        }
        .header-title-block {
          grid-area: title;
        }
        .header-controls-group {
          grid-area: controls;
          padding: 0;
          gap: 0.45rem;
          background: transparent;
          box-shadow: none;
          border-radius: 0;
        }
        .header-quick-actions-box {
          display: none;
        }

        .header-user-section .user-name,
        .header-user-section .admin-badge,
        .header-user-section .btn-alerts,
        .header-separator {
          display: none;
        }

        .btn-quick-menu {
          display: inline-flex;
        }

        .header-user-section {
          width: auto;
          justify-content: flex-start;
          gap: 0.5rem;
        }
        app-auto-refresh {
          --auto-refresh-font-size: var(--theme-font-caption);
        }

        .toast-stack {
          top: 62px;
          right: 8px;
        }
        .refresh-toast-floating {
          top: 4px;
          right: 8px;
          max-width: calc(100% - 1rem);
        }
        .user-name span {
          max-width: 170px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          display: inline-block;
          vertical-align: bottom;
        }
      }
    `,
  ],
})
export class HeaderComponent implements OnInit, OnDestroy {
  private static readonly MIN_REFRESH_SPINNER_MS = 700;
  readonly enableAlertNotifications = false;

  private stateService = inject(ClusterStateService);
  private authService = inject(AuthService);
  private router = inject(Router);
  protected healthStateService = inject(HealthStateService);
  alertNotificationCount = this.healthStateService.alertNotificationCount;
  alertNotificationMessage = this.healthStateService.alertNotificationMessage;
  alertNotificationItems = this.healthStateService.alertNotificationItems;
  alertNotificationToasts = this.healthStateService.alertNotificationToasts;
  showAlertDropdown = signal(false);
  showMobileQuickActions = signal(false);
  isMobileHeader = signal(false);
  refreshToastMessage = signal<string | null>(null);
  refreshToastType = signal<'success' | 'error' | 'warning' | 'info'>('info');
  private refreshToastTimer?: number;
  private pendingExternalRefreshToast = false;
  private externalRefreshFallbackTimer?: number;
  private refreshDisplayTimer?: number;
  private refreshDisplayStartedAt = 0;
  
  @ViewChild('globalSearchModal') globalSearchModal!: GlobalElasticsearchSearchComponent;
  
  // Signal to track current route for reactivity
  private currentRoute = signal<string>('');
  
  // User info computed signals
  userName = computed(() => this.authService.userInfo().userName);
  userEmail = computed(() => this.authService.userInfo().userEmail);
  isAdmin = computed(() => this.authService.userInfo().isAdmin);
  isAuthenticated = computed(() => this.authService.isAuthenticated());
  
  // Get environment name from userinfo
  environmentName = computed(() => {
    const env = this.authService.userInfo().environment;
    return (env && env.trim() !== '') ? env : 'Development'; // Fallback to 'Development' if empty or null
  });

  // Check if environment name is still loading
  // Only show loader if userinfo hasn't loaded yet (not authenticated = still loading)
  isEnvironmentNameLoading = computed(() => {
    return !this.isAuthenticated();
  });

  // Check if current route is kafka
  // Check if current route is kafka/messaging
  isKafkaRoute = computed(() => {
    const path = this.getPathOnly(this.currentRoute());
    return (
      path === '/messages' ||
      path.startsWith('/messages/') ||
      path === '/dashboard/messages' ||
      path.startsWith('/dashboard/messages/')
    );
  });

  // Check if messaging/Kafka is enabled (consumers namespace exists)
  isMessagingEnabled = computed(() => {
    return this.stateService.hasConsumersNamespace();
  });

  // Check if current route is dashboard
  isDashboardRoute = computed(() => {
    const path = this.getPathOnly(this.currentRoute());
    return path === '' || path === '/' || path === '/dashboard';
  });

  isAuditRoute = computed(() => {
    const path = this.getPathOnly(this.currentRoute());
    return path === '/dashboard/audit' || path === '/audit';
  });

  isErrorRoute = computed(() => {
    const path = this.getPathOnly(this.currentRoute());
    return path === '/dashboard/errors' || path === '/errors';
  });

  routeContextLabel(): string {
    if (this.isDashboardHeader()) {
      return '';
    }
    if (this.isAuditRoute()) {
      return 'Admin / Audit';
    }
    if (this.isErrorRoute()) {
      return 'Dashboard / Errors';
    }
    const isDeepDive = this.currentView === 'deepdive';
    if (this.isKafkaRoute()) {
      return isDeepDive ? 'Messaging / Details' : 'Messaging / List';
    }
    return isDeepDive ? 'Cluster Info / Details' : 'Cluster Info / List';
  }

  routeContextHint(): string {
    if (this.isDashboardHeader()) {
      return '';
    }
    if (this.isAuditRoute()) {
      return 'Review privileged actions over time';
    }
    if (this.isErrorRoute()) {
      return 'Review grouped errors and trends';
    }
    return this.currentView === 'deepdive'
      ? 'Focus on one item with full context'
      : 'Browse, compare, and take quick actions';
  }

  routeContextGuide(): string {
    if (this.isDashboardHeader()) {
      return '';
    }
    if (this.isAuditRoute()) {
      return 'Use this view to investigate who performed admin changes and when.';
    }
    if (this.isErrorRoute()) {
      return 'Use this view to analyze recurring errors and open related logs.';
    }
    return this.currentView === 'deepdive'
      ? 'Use this mode when you need root-cause details.'
      : 'Use this mode for fast operational checks.';
  }

  // Get current nav option for toggle slider
  currentNavOption = computed<NavOption>(() => {
    if (this.navSelectionOverride !== undefined) {
      return this.navSelectionOverride;
    }
    if (this.isDashboardHeader()) {
      return null; // No active option when on dashboard
    }
    if (this.isAuditRoute()) {
      return null;
    }
    // If messaging is disabled and user is on kafka route, redirect to cluster
    if (this.isKafkaRoute() && !this.isMessagingEnabled()) {
      return 'cluster';
    }
    return this.isKafkaRoute() ? 'messages' : 'cluster';
  });

  ngOnInit(): void {
    this.updateViewportState();
    // Initialize with current route
    this.currentRoute.set(this.getCurrentUrlWithQuery());
    
    // Subscribe to route changes
    this.router.events
      .pipe(filter(event => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.currentRoute.set(this.getCurrentUrlWithQuery());
        
        // Redirect from Kafka routes if messaging is disabled
        if (this.isKafkaRoute() && !this.isMessagingEnabled()) {
          this.router.navigate(['/cluster'], { replaceUrl: true });
        }
      });

    if (this.enableAlertNotifications) {
      this.healthStateService.startAlertPolling();
    } else {
      this.healthStateService.clearAlertNotifications();
    }
  }

  ngOnDestroy(): void {
    // Cleanup handled by async pipe or manual unsubscribe if needed
    if (this.enableAlertNotifications) {
      this.healthStateService.stopAlertPolling();
    }
    if (this.refreshToastTimer) {
      window.clearTimeout(this.refreshToastTimer);
      this.refreshToastTimer = undefined;
    }
    if (this.externalRefreshFallbackTimer) {
      window.clearTimeout(this.externalRefreshFallbackTimer);
      this.externalRefreshFallbackTimer = undefined;
    }
    if (this.refreshDisplayTimer) {
      window.clearTimeout(this.refreshDisplayTimer);
      this.refreshDisplayTimer = undefined;
    }
  }

  /**
   * Get health class based on score
   */
  stats = this.stateService.stats;
  lastUpdated = this.stateService.lastUpdated;
  loadingStates = this.stateService.loadingStates;
  isRefreshing = signal(false);
  
  isLoading = computed(() => {
    const states = this.loadingStates();
    return Object.values(states).some(loading => loading === true);
  });

  rawRefreshingState = computed(() => {
    const external = this.externalIsRefreshingSignal();
    return external !== null ? external : this.isRefreshing();
  });
  displayedRefreshingState = signal(false);

  @Input() currentView: ViewMode = 'scanning';
  @Input() healthFilter: HealthFilter[] = [];
  @Input() healthFilterCounts: Partial<Record<HealthFilter, number>> | null = null;
  @Input() autoRefreshEnabled = false;
  @Input() autoRefreshInterval = 30;
  @Input() customStatsText: string | null = null;
  @Input() showRouteContext = true;
  @Input() showHealthFilter = true;
  @Input() showSearch = true;
  @Input() showStats = true;
  @Input() showViewToggle = true;
  @Input() headerMode: 'auto' | 'dashboard' | 'standard' = 'auto';
  @Input() showDashboardQuickActions = false;
  @Input() navSelectionOverride: NavOption | undefined = undefined;
  @Input() searchQuery = '';
  private _externalIsRefreshing: boolean | null = null;
  private externalIsRefreshingSignal = signal<boolean | null>(null);
  private readonly refreshDisplayEffect = effect(
    () => {
      const refreshing = this.rawRefreshingState();
      if (refreshing) {
        if (this.refreshDisplayTimer) {
          window.clearTimeout(this.refreshDisplayTimer);
          this.refreshDisplayTimer = undefined;
        }
        if (!this.displayedRefreshingState()) {
          this.refreshDisplayStartedAt = Date.now();
          this.displayedRefreshingState.set(true);
        }
        return;
      }

      if (!this.displayedRefreshingState()) {
        return;
      }

      const elapsedMs = Date.now() - this.refreshDisplayStartedAt;
      const remainingMs = HeaderComponent.MIN_REFRESH_SPINNER_MS - elapsedMs;
      if (remainingMs <= 0) {
        this.displayedRefreshingState.set(false);
        return;
      }

      if (this.refreshDisplayTimer) {
        window.clearTimeout(this.refreshDisplayTimer);
      }
      this.refreshDisplayTimer = window.setTimeout(() => {
        this.displayedRefreshingState.set(false);
        this.refreshDisplayTimer = undefined;
      }, remainingMs);
    },
    { allowSignalWrites: true }
  );
  @Input()
  set externalIsRefreshing(value: boolean | null) {
    const previous = this._externalIsRefreshing;
    this._externalIsRefreshing = value;
    this.externalIsRefreshingSignal.set(value);

    // For externally managed refresh flows, emit completion toast when refresh ends.
    if (this.pendingExternalRefreshToast && previous === true && value === false) {
      if (this.externalRefreshFallbackTimer) {
        window.clearTimeout(this.externalRefreshFallbackTimer);
        this.externalRefreshFallbackTimer = undefined;
      }
      this.pendingExternalRefreshToast = false;
      this.showRefreshToast('Data refreshed successfully.', 'success');
      this.isRefreshing.set(false);
    }
  }
  get externalIsRefreshing(): boolean | null {
    return this._externalIsRefreshing;
  }

  isRefreshingState = computed(() => this.displayedRefreshingState());

  @Output() searchChange = new EventEmitter<string>();
  @Output() viewChange = new EventEmitter<ViewMode>();
  @Output() healthFilterChange = new EventEmitter<HealthFilter[]>();
  @Output() autoRefreshEnabledChange = new EventEmitter<boolean>();
  @Output() autoRefreshIntervalChange = new EventEmitter<number>();
  @Output() refreshClick = new EventEmitter<void>();

  isDashboardHeader(): boolean {
    if (this.headerMode === 'dashboard') {
      return true;
    }
    if (this.headerMode === 'standard') {
      return false;
    }
    return this.isDashboardRoute();
  }

  navigateToKafka(): void {
    this.router.navigate(['/messages']);
  }

  onNavChange(nav: NavOption): void {
    if (nav === 'messages' && this.isMessagingEnabled()) {
      this.router.navigate(['/messages']);
    } else {
      this.router.navigate(['/cluster']);
    }
  }

  async refresh(): Promise<void> {
    this.showRefreshToast('Refreshing...', 'info');
    this.refreshClick.emit();
    // If no custom refresh handler subscribed, use default
    if (this.refreshClick.observers.length === 0) {
      this.isRefreshing.set(true);
      try {
        await this.stateService.performContextAwareRefresh();
        this.showRefreshToast('Data refreshed successfully.', 'success');
      } catch {
        this.showRefreshToast('Refresh failed. Please try again.', 'error');
      } finally {
        this.isRefreshing.set(false);
      }
    } else {
      // If external handler, let it manage the state
      // But set local state if not externally controlled
      if (this.externalIsRefreshing === null) {
        this.isRefreshing.set(true);
        // Fallback: external refresh flow not state-driven, so resolve with a delayed success toast.
        if (this.externalRefreshFallbackTimer) {
          window.clearTimeout(this.externalRefreshFallbackTimer);
        }
        this.externalRefreshFallbackTimer = window.setTimeout(() => {
          this.showRefreshToast('Data refreshed successfully.', 'success');
          this.isRefreshing.set(false);
          this.externalRefreshFallbackTimer = undefined;
        }, 1500);
      } else {
        this.pendingExternalRefreshToast = true;
        // If a caller passes a constant false value, still provide completion feedback.
        if (this.externalIsRefreshing === false) {
          if (this.externalRefreshFallbackTimer) {
            window.clearTimeout(this.externalRefreshFallbackTimer);
          }
          this.externalRefreshFallbackTimer = window.setTimeout(() => {
            if (this.pendingExternalRefreshToast) {
              this.pendingExternalRefreshToast = false;
              this.showRefreshToast('Data refreshed successfully.', 'success');
            }
            this.externalRefreshFallbackTimer = undefined;
          }, 1500);
        }
      }
    }
  }

  private showRefreshToast(message: string, type: 'success' | 'error' | 'warning' | 'info'): void {
    this.refreshToastMessage.set(message);
    this.refreshToastType.set(type);
    if (this.refreshToastTimer) {
      window.clearTimeout(this.refreshToastTimer);
    }
    this.refreshToastTimer = window.setTimeout(() => {
      this.refreshToastMessage.set(null);
      this.refreshToastTimer = undefined;
    }, 2500);
  }

  clearAlertNotifications(): void {
    this.healthStateService.clearAlertNotifications();
    this.showAlertDropdown.set(false);
    this.showMobileQuickActions.set(false);
  }

  toggleAlertDropdown(): void {
    this.showAlertDropdown.set(!this.showAlertDropdown());
  }

  closeAlertDropdown(): void {
    this.showAlertDropdown.set(false);
  }

  toggleMobileQuickActions(): void {
    this.showMobileQuickActions.set(!this.showMobileQuickActions());
  }

  closeMobileQuickActions(): void {
    this.showMobileQuickActions.set(false);
  }

  handleSearchChange(value: string): void {
    this.searchChange.emit(value);
  }

  openGlobalSearch(): void {
    if (this.globalSearchModal) {
      this.globalSearchModal.open();
    }
  }

  openGlobalSearchFromMenu(): void {
    this.showMobileQuickActions.set(false);
    this.openGlobalSearch();
  }

  openAuditFromMenu(): void {
    this.showMobileQuickActions.set(false);
    this.router.navigate(['/audit']);
  }

  openErrorsFromMenu(): void {
    this.showMobileQuickActions.set(false);
    this.router.navigate(['/errors']);
  }

  openClusterFromMenu(): void {
    this.showMobileQuickActions.set(false);
    this.router.navigate(['/cluster'], { queryParams: { view: 'scanning' } });
  }

  openMessagesFromMenu(): void {
    this.showMobileQuickActions.set(false);
    this.router.navigate(['/messages'], { queryParams: { view: 'scanning' } });
  }

  openAlertsNotificationsView(): void {
    this.showAlertDropdown.set(false);
    this.showMobileQuickActions.set(false);
    this.healthStateService.clearAlertNotifications();
    this.router.navigate(['/'], { queryParams: { section: 'alerts' } });
  }

  isAlertsQuickLinkActive(): boolean {
    const path = this.getPathOnly(this.currentRoute());
    const section = this.getQueryParam(this.currentRoute(), 'section');
    return (path === '/' || path === '/dashboard' || path === '') && section === 'alerts';
  }

  isErrorsQuickLinkActive(): boolean {
    return this.isErrorRoute();
  }

  isAuditsQuickLinkActive(): boolean {
    return this.isAuditRoute();
  }

  isAppsQuickLinkActive(): boolean {
    const path = this.getPathOnly(this.currentRoute());
    return path === '/cluster' || path === '/dashboard/cluster' || path === '/cluster-info/cluster';
  }

  isMessagesQuickLinkActive(): boolean {
    return this.isKafkaRoute();
  }

  isLogsQuickLinkActive(): boolean {
    return this.getQueryParam(this.currentRoute(), 'globalLogs') === '1' || this.globalSearchModal?.visible() === true;
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updateViewportState();
  }

  private updateViewportState(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const mobile = window.innerWidth <= 1024;
    this.isMobileHeader.set(mobile);
    if (!mobile) {
      this.showMobileQuickActions.set(false);
    }
  }

  private getCurrentUrlWithQuery(): string {
    if (typeof window !== 'undefined') {
      return `${window.location.pathname}${window.location.search}`;
    }
    return this.router.url;
  }

  private getPathOnly(url: string): string {
    return (url || '').split('?')[0].replace(/\/+$/, '') || '/';
  }

  private getQueryParam(url: string, key: string): string | null {
    const query = (url || '').split('?')[1] ?? '';
    if (!query) {
      return null;
    }
    return new URLSearchParams(query).get(key);
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent): void {
    // Ctrl+K or Cmd+K to open global search
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.openGlobalSearch();
    }
    // Escape to close search modal
    if (event.key === 'Escape' && this.globalSearchModal?.visible()) {
      this.globalSearchModal.close();
    }
    if (event.key === 'Escape' && this.showMobileQuickActions()) {
      this.showMobileQuickActions.set(false);
    }
    if (event.key === 'Escape' && this.showAlertDropdown()) {
      this.showAlertDropdown.set(false);
    }
  }

  @HostListener('document:click', ['$event'])
  handleDocumentClick(event: Event): void {
    if (!this.showAlertDropdown()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (!target?.closest('.alerts-container')) {
      this.showAlertDropdown.set(false);
    }
  }
}
