import { CommonModule } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HealthStateService } from '../../services/health-state.service';
import { HealthApiService } from '../../services/health-api.service';
import { AuthService } from '../../../../core/services/auth.service';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';
import { AlertGroupDefinition, AlertRouteBinding, ApplyPrometheusRuleRequest, PrometheusRuleDefinition, PrometheusSuppression } from '../../models/health.models';

@Component({
  selector: 'app-prometheus-firing-alerts-table',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="firing-alerts-panel">
      <div class="header-row">
        <h3>Alert Occurrences (Last {{ rangeLabel() }})</h3>
        <div class="header-actions">
          <button class="refresh-btn" (click)="refresh()">
            <i class="fas fa-sync-alt"></i>
            Refresh
          </button>
        </div>
      </div>

      <div class="filters">
        <select [(ngModel)]="rangeHoursFilter" (change)="onRangeChange()">
          <option [ngValue]="24">Last 24 hours</option>
          <option [ngValue]="48">Last 48 hours</option>
          <option [ngValue]="168">Last 7 days</option>
          <option [ngValue]="336">Last 14 days</option>
          <option [ngValue]="720">Last 30 days</option>
        </select>

        <select [(ngModel)]="severityFilter" (change)="applyFilters()">
          <option value="">All Severities</option>
          @for (value of severityOptions(); track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select>

        <select [(ngModel)]="namespaceFilter" (change)="applyFilters()">
          <option value="">All Namespaces</option>
          @for (value of namespaceOptions(); track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select>

        <select [(ngModel)]="alertNameFilter" (change)="applyFilters()">
          <option value="">All Alert Names</option>
          @for (value of alertNameOptions(); track value) {
            <option [value]="value">{{ value }}</option>
          }
        </select>
      </div>

      @if (!healthState.isLoadingPrometheusFiringAlerts() && sortedAlerts().length === 0) {
        <div class="empty">No alert occurrences found in the selected range.</div>
      } @else {
        <div class="table-wrap dashboard-common-table-wrap">
          <table class="dashboard-common-table">
            <thead>
              <tr>
                <th>Alert</th>
                <th>Alert Group</th>
                <th class="sortable" (click)="toggleSort('severity')">Severity {{ sortIndicator('severity') }}</th>
                <th>Namespace</th>
                <th>Pod</th>
                <th class="sortable" (click)="toggleSort('firstOccurrenceAt')">First Seen {{ sortIndicator('firstOccurrenceAt') }}</th>
                <th class="sortable" (click)="toggleSort('lastOccurrenceAt')">Last Occurred {{ sortIndicator('lastOccurrenceAt') }}</th>
                <th>Summary</th>
                @if (isAdmin()) {
                  <th>Actions</th>
                }
              </tr>
            </thead>
            <tbody>
              @if (healthState.isLoadingPrometheusFiringAlerts()) {
                @for (row of skeletonRows; track row) {
                  <tr class="skeleton-row">
                    <td><span class="table-skeleton sk-text"></span></td>
                    <td><span class="table-skeleton sk-text"></span></td>
                    <td><span class="table-skeleton sk-pill"></span></td>
                    <td><span class="table-skeleton sk-text"></span></td>
                    <td><span class="table-skeleton sk-text"></span></td>
                    <td><span class="table-skeleton sk-text"></span></td>
                    <td><span class="table-skeleton sk-text"></span></td>
                    <td><span class="table-skeleton sk-summary"></span></td>
                    @if (isAdmin()) {
                      <td class="actions"><span class="table-skeleton sk-action"></span></td>
                    }
                  </tr>
                }
              } @else {
                @for (alert of sortedAlerts(); track alert.alertName + (alert.startsAt ?? '') + (alert.namespaceName ?? '')) {
                  <tr>
                    <td>{{ alert.alertName }}</td>
                    <td>{{ getAlertGroup(alert) }}</td>
                    <td><span class="sev" [class]="'sev-' + alert.severity.toLowerCase()">{{ alert.severity }}</span></td>
                    <td>{{ alert.namespaceName || 'n/a' }}</td>
                    <td>{{ alert.podName || 'n/a' }}</td>
                    <td>{{ formatDateTime(alert.firstOccurrenceAt) }}</td>
                    <td>{{ formatDuration(getLastOccurredSeconds(alert.lastOccurrenceAt)) }}</td>
                    <td [title]="alert.description || ''">{{ alert.summary || alert.description || 'n/a' }}</td>
                    @if (isAdmin()) {
                      <td class="actions">
                        @if (suppressionFor(alert); as suppression) {
                          <button class="action-btn" (click)="openEditSuppressionModal(suppression)">Edit Suppress</button>
                          <button class="action-btn danger" (click)="openUnsuppressModal(suppression)">Unsuppress</button>
                        } @else {
                          <button class="action-btn" (click)="openSuppressModal(alert)">Suppress</button>
                        }
                        <button class="action-btn" (click)="openAlertDefinitionModal(alert)">Edit Definition</button>
                      </td>
                    }
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>
      }

      @if (showSuppressionModal) {
        <div class="suppression-modal-backdrop" (click)="onSuppressionBackdropClick($event)">
          <div class="suppression-modal" (click)="$event.stopPropagation()" [ngStyle]="suppressionModalStyle()">
            <div class="modal-header">
              <div class="modal-header-left">
                <h2>
                  <i class="fas" [class.fa-bell-slash]="suppressionModalMode !== 'unsuppress'" [class.fa-bell]="suppressionModalMode === 'unsuppress'"></i>
                  {{ suppressionModalTitle }}
                </h2>
              </div>
              <button class="modal-close" (click)="closeSuppressionModal()">&times;</button>
            </div>
            <div class="suppression-modal-body">
              <div class="audit-info-banner">
                <i class="fas fa-info-circle"></i>
                <div>
                  <div class="audit-info-title">{{ suppressionTargetSummary() }}</div>
                  <div class="audit-info-subtitle">{{ suppressionAuditHint() }}</div>
                </div>
              </div>
              @if (suppressionModalMode !== 'unsuppress') {
                <div class="form-row">
                  <label for="suppressionReason">Reason <span class="required">*</span></label>
                  <textarea
                    id="suppressionReason"
                    [(ngModel)]="suppressionReason"
                    placeholder="Provide a clear reason that will be stored in audit logs"
                    rows="3"
                    [disabled]="suppressionModalSaving"
                  ></textarea>
                </div>
                <div class="form-row">
                  <label for="suppressionDuration">Duration (hours) <span class="required">*</span></label>
                  <input
                    id="suppressionDuration"
                    type="number"
                    min="1"
                    step="1"
                    [(ngModel)]="suppressionDurationHours"
                    [disabled]="suppressionModalSaving"
                  />
                </div>
              } @else {
                <div class="form-row">
                  <label for="unsuppressReason">Reason <span class="required">*</span></label>
                  <textarea
                    id="unsuppressReason"
                    [(ngModel)]="suppressionReason"
                    placeholder="Provide a reason to include in audit logs"
                    rows="3"
                    [disabled]="suppressionModalSaving"
                  ></textarea>
                </div>
              }

              @if (suppressionModalError) {
                <div class="modal-error">{{ suppressionModalError }}</div>
              }
            </div>
            <div class="suppression-modal-actions">
              <button class="action-btn" (click)="closeSuppressionModal()" [disabled]="suppressionModalSaving">Cancel</button>
              <button class="action-btn primary" (click)="submitSuppressionModal()" [disabled]="isSuppressionPrimaryActionDisabled()">
                @if (suppressionModalSaving) {
                  <i class="fas fa-spinner fa-spin"></i>
                }
                {{ suppressionModalActionButtonLabel() }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (showDefinitionModal) {
        <div class="definition-modal-backdrop" (click)="onDefinitionBackdropClick($event)">
          <div class="definition-modal" (click)="$event.stopPropagation()" [ngStyle]="definitionModalStyle()">
            <div class="modal-header">
              <div class="modal-header-left">
                <h2>
                  <i class="fas fa-edit"></i>
                  Edit alert definition
                </h2>
              </div>
              <button class="modal-close" (click)="closeDefinitionModal()">&times;</button>
            </div>
            <div class="suppression-modal-body">
              <div class="form-row">
                <label for="definitionAlertName">Alert name <span class="required">*</span></label>
                <input id="definitionAlertName" type="text" [(ngModel)]="definitionAlertName" />
              </div>
              <div class="form-row">
                <label for="definitionExpr">Expression <span class="required">*</span></label>
                <textarea id="definitionExpr" [(ngModel)]="definitionExpr" rows="4" placeholder="PromQL expression"></textarea>
              </div>
              <div class="form-row">
                <label for="definitionFor">For duration</label>
                <input id="definitionFor" type="text" [(ngModel)]="definitionFor" placeholder="5m" />
              </div>
              <div class="form-row">
                <label for="definitionSeverity">Severity</label>
                <input id="definitionSeverity" type="text" [(ngModel)]="definitionSeverity" placeholder="warning" />
              </div>
              <div class="form-row">
                <label for="definitionSummary">Summary</label>
                <textarea id="definitionSummary" [(ngModel)]="definitionSummary" rows="2"></textarea>
              </div>
              <div class="form-row">
                <label for="definitionDescription">Description</label>
                <textarea id="definitionDescription" [(ngModel)]="definitionDescription" rows="3"></textarea>
              </div>
              <div class="form-row">
                <label for="definitionGroupName">Rule group name</label>
                <input id="definitionGroupName" type="text" [(ngModel)]="definitionGroupName" />
              </div>
              <div class="form-row">
                <label for="definitionAlertGroup">Alert group (routes emails)</label>
                @if (alertGroups.length > 0) {
                  <select id="definitionAlertGroup" [(ngModel)]="definitionAlertGroup">
                    <option value="">Select group</option>
                    @for (group of alertGroups; track group.name) {
                      <option [value]="group.name">{{ group.name }}</option>
                    }
                  </select>
                } @else {
                  <input id="definitionAlertGroup" type="text" [(ngModel)]="definitionAlertGroup" placeholder="alert_group label" />
                }
              </div>
              <div class="form-row">
                <label>Labels</label>
                <div class="key-value-list">
                  @for (entry of definitionLabelEntries; track entry.id) {
                    <div class="key-value-row">
                      <input type="text" [(ngModel)]="entry.key" placeholder="label key" />
                      <input type="text" [(ngModel)]="entry.value" placeholder="label value" />
                      <button type="button" class="action-btn danger" (click)="removeLabelEntry(entry.id)">Remove</button>
                    </div>
                  }
                  <button type="button" class="action-btn" (click)="addLabelEntry()">Add label</button>
                </div>
              </div>
              <div class="form-row">
                <label>Annotations</label>
                <div class="key-value-list">
                  @for (entry of definitionAnnotationEntries; track entry.id) {
                    <div class="key-value-row">
                      <input type="text" [(ngModel)]="entry.key" placeholder="annotation key" />
                      <input type="text" [(ngModel)]="entry.value" placeholder="annotation value" />
                      <button type="button" class="action-btn danger" (click)="removeAnnotationEntry(entry.id)">Remove</button>
                    </div>
                  }
                  <button type="button" class="action-btn" (click)="addAnnotationEntry()">Add annotation</button>
                </div>
              </div>
              @if (definitionModalError) {
                <div class="modal-error">{{ definitionModalError }}</div>
              }
            </div>
            <div class="suppression-modal-actions">
              <button class="action-btn" (click)="closeDefinitionModal()" [disabled]="definitionModalSaving">Cancel</button>
              <button class="action-btn primary" (click)="submitDefinitionModal()" [disabled]="isDefinitionSubmitDisabled()">
                {{ definitionModalActionLabel }}
              </button>
            </div>
          </div>
        </div>
      }

      @if (showGroupManager) {
        <div class="definition-modal-backdrop" (click)="closeGroupManager($event)">
          <div class="definition-modal" (click)="$event.stopPropagation()" [ngStyle]="definitionModalStyle()">
            <div class="modal-header">
              <div class="modal-header-left">
                <h2>
                  <i class="fas fa-users"></i>
                  Alert groups & recipients
                </h2>
              </div>
              <button class="modal-close" (click)="closeGroupManager()">&times;</button>
            </div>
            <div class="suppression-modal-body">
              @if (groupManagerError) {
                <div class="modal-error">{{ groupManagerError }}</div>
              }
              <div class="form-row">
                <label for="groupNameInput">Group name</label>
                <input id="groupNameInput" type="text" [(ngModel)]="groupNameInput" placeholder="node-alerts-email" [disabled]="groupManagerSaving" />
              </div>
              <div class="form-row">
                <label for="groupEmailsInput">Emails (comma separated)</label>
                <textarea id="groupEmailsInput" [(ngModel)]="groupEmailsInput" rows="3" [disabled]="groupManagerSaving"></textarea>
              </div>
              <div class="form-row">
                <label for="groupRouteKeysSelect">Route keys</label>
                <div class="route-key-dropdown">
                  <button
                    id="groupRouteKeysSelect"
                    type="button"
                    class="route-key-dropdown-trigger"
                    (click)="toggleRouteKeyDropdown()"
                    [disabled]="groupManagerSaving"
                  >
                    {{ routeKeyDropdownLabel() }}
                  </button>
                  @if (isRouteKeyDropdownOpen) {
                    <div class="route-key-dropdown-menu">
                      @if (routeKeyOptions.length === 0) {
                        <div class="route-key-empty">No route keys available.</div>
                      } @else {
                        @for (routeKey of routeKeyOptions; track routeKey) {
                          <label class="route-key-option">
                            <input
                              type="checkbox"
                              [checked]="isRouteKeySelected(routeKey)"
                              (change)="setRouteKeySelected(routeKey, $any($event.target).checked)"
                              [disabled]="groupManagerSaving"
                            />
                            <span>{{ routeKey }}</span>
                          </label>
                        }
                      }
                      <div class="route-key-actions">
                        <button type="button" class="action-btn" (click)="closeRouteKeyDropdown()">Done</button>
                      </div>
                    </div>
                  }
                </div>
              </div>
              <div class="suppression-modal-actions">
                <button class="action-btn" (click)="clearGroupForm()" [disabled]="groupManagerSaving">Clear</button>
                <button class="action-btn primary" (click)="saveGroup()" [disabled]="groupManagerSaving">
                  Save Group
                </button>
              </div>
              @if (groupManagerSaving) {
                <div class="group-manager-loading">
                  <i class="fas fa-spinner fa-spin"></i>
                  Saving changes...
                </div>
              }

              <div class="group-table-wrap">
                <table class="group-table">
                  <thead>
                    <tr>
                      <th>Group</th>
                      <th>Route Key</th>
                      <th>Recipients</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    @if (alertGroups.length === 0) {
                      <tr>
                        <td colspan="4" class="empty">No groups configured.</td>
                      </tr>
                    } @else {
                      @for (group of alertGroups; track group.name) {
                        <tr>
                          <td>{{ group.name }}</td>
                          <td>{{ displayRouteKeys(group) }}</td>
                          <td>{{ group.emails.join(', ') }}</td>
                          <td class="group-actions">
                            <button class="action-btn" (click)="editGroup(group)" [disabled]="groupManagerSaving">Edit</button>
                            <button class="action-btn danger" (click)="deleteGroup(group.name)" [disabled]="groupManagerSaving">Delete</button>
                          </td>
                        </tr>
                      }
                    }
                  </tbody>
                </table>
              </div>

              <div class="route-bindings-panel">
                <h4>Effective Routing (Read-Only)</h4>
                @if (routeBindingsLoading) {
                  <div class="empty">Loading route bindings...</div>
                } @else if (alertRouteBindings.length === 0) {
                  <div class="empty">No route bindings detected.</div>
                } @else {
                  <div class="route-bindings-grid">
                    <div class="route-bindings-column">
                      <h5>Base (Helm)</h5>
                      @if (baseRouteBindings().length === 0) {
                        <div class="empty">No base bindings.</div>
                      } @else {
                        @for (binding of baseRouteBindings(); track binding.routeKey + binding.receiver + binding.source) {
                          <div class="route-binding-row">
                            <span class="route-key">{{ bindingRouteLabel(binding) }}</span>
                            <span class="route-arrow">→</span>
                            <span class="route-receiver">{{ binding.receiver }}</span>
                          </div>
                        }
                      }
                    </div>
                    <div class="route-bindings-column">
                      <h5>Dashboard Overrides</h5>
                      @if (overrideRouteBindings().length === 0) {
                        <div class="empty">No override bindings.</div>
                      } @else {
                        @for (binding of overrideRouteBindings(); track binding.routeKey + binding.receiver + binding.source) {
                          <div class="route-binding-row">
                            <span class="route-key">{{ bindingRouteLabel(binding) }}</span>
                            <span class="route-arrow">→</span>
                            <span class="route-receiver">{{ binding.receiver }}</span>
                          </div>
                        }
                      }
                    </div>
                  </div>
                }
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .firing-alerts-panel {
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 12px;
      padding: 0.85rem 1rem 1rem;
      box-shadow: var(--theme-shadow-sm);
      margin-bottom: 0.6rem;
      color: var(--theme-text-dark);
      font-family: inherit;
    }
    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .header-row h3 {
      margin: 0;
      font-size: var(--theme-font-section-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }
    .header-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .refresh-btn {
      border: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-app);
      border-radius: 6px;
      padding: 0.4rem 0.75rem;
      cursor: pointer;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      font-family: inherit;
    }
    .filters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 0.4rem;
      margin-bottom: 0.5rem;
    }
    .filters select {
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      padding: 0.35rem 0.45rem;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-table-header);
      font-family: inherit;
    }
    .table-wrap {
      overflow-x: auto;
      overflow-y: auto;
      max-height: 500px;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    th.sortable:hover {
      color: var(--theme-table-header-color);
    }
    .skeleton-row {
      pointer-events: none;
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
      animation: alerts-skeleton-shimmer 1.4s ease-in-out infinite;
    }
    .sk-text {
      width: 92px;
      height: 12px;
    }
    .sk-pill {
      width: 70px;
      height: 20px;
      border-radius: 6px;
    }
    .sk-summary {
      width: 96%;
      height: 12px;
    }
    .sk-action {
      width: 120px;
      height: 30px;
      border-radius: 6px;
    }
    @keyframes alerts-skeleton-shimmer {
      0% {
        background-position: 200% 0;
      }
      100% {
        background-position: -200% 0;
      }
    }
    .sev {
      border-radius: 999px;
      padding: 0.1rem 0.45rem;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      text-transform: capitalize;
    }
    .sev-critical { background: var(--theme-bg-surface); border: 1px solid var(--theme-button-danger); color: var(--theme-button-danger-hover); }
    .sev-warning { background: var(--theme-bg-surface); border: 1px solid var(--theme-button-warning); color: var(--theme-button-warning-hover); }
    .sev-none, .sev-info, .sev-unknown { background: var(--theme-bg-teal-lighter); color: var(--theme-table-header-color); }
    .actions {
      white-space: nowrap;
      display: flex;
      gap: 0.35rem;
    }
    .action-btn {
      border: 1px solid var(--theme-border-gray);
      background: var(--theme-bg-app);
      border-radius: 6px;
      padding: 0.16rem 0.4rem;
      font-size: var(--theme-font-caption);
      cursor: pointer;
      color: var(--theme-table-header-color);
      font-family: inherit;
      font-weight: var(--theme-font-table-header-weight);
    }
    .action-btn.danger {
      border-color: var(--theme-button-danger);
      background: var(--theme-bg-app);
      color: var(--theme-button-danger-hover);
    }
    .action-btn.primary {
      border-color: var(--theme-button-primary);
      background: var(--theme-button-primary);
      color: var(--theme-bg-surface);
    }
    .action-btn:disabled {
      opacity: 0.65;
      cursor: not-allowed;
    }
    .action-btn i {
      margin-right: 0.3rem;
    }
    .empty {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-body);
      padding: 0.4rem 0;
    }
    .suppression-modal-backdrop {
      position: fixed;
      inset: 0;
      height: calc(100vh*20);
      background: var(--theme-bg-overlay-backdrop);
      z-index: var(--z-modal-popover);
      pointer-events: auto;
    }
    .definition-modal-backdrop {
      position: fixed;
      inset: 0;
      height: calc(100vh*20);
      background: var(--theme-bg-overlay-backdrop);
      z-index: var(--z-modal-popover);
      pointer-events: auto;
    }
    .suppression-modal {
      width: min(520px, 90vw);
      background: var(--theme-bg-surface);
      border-radius: 10px;
      box-shadow: var(--theme-shadow-lg);
      border: 1px solid var(--theme-border-gray-light);
      display: flex;
      flex-direction: column;
      max-height: 90vh;
    }
    .definition-modal {
      width: min(720px, 95vw);
      background: var(--theme-bg-surface);
      border-radius: 10px;
      box-shadow: var(--theme-shadow-lg);
      border: 1px solid var(--theme-border-gray-light);
      display: flex;
      flex-direction: column;
      max-height: 90vh;
    }
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 1rem 1.5rem;
      border-bottom: 1px solid var(--theme-border-teal-dark);
      background: var(--theme-header-gradient);
      color: var(--theme-bg-surface);
      box-shadow: var(--theme-shadow-md);
    }
    .modal-header-left {
      flex: 1;
    }
    .modal-header-left h2 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-bg-surface);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .suppression-modal-body {
      padding: 0.9rem 1rem 0.2rem;
      overflow-y: auto;
    }
    .audit-info-banner {
      display: flex;
      align-items: flex-start;
      gap: 0.55rem;
      background: var(--theme-bg-teal-lighter);
      border: 1px solid var(--theme-border-teal);
      border-radius: 8px;
      padding: 0.55rem 0.65rem;
      margin-bottom: 0.85rem;
    }
    .audit-info-banner i {
      color: var(--theme-text-teal-dark);
      margin-top: 0.1rem;
    }
    .audit-info-title {
      color: var(--theme-text-teal-dark);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      line-height: 1.25;
    }
    .audit-info-subtitle {
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      margin-top: 0.15rem;
      line-height: 1.3;
    }
    .suppression-modal-body .form-row {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-bottom: 0.85rem;
    }
    .suppression-modal-body label {
      font-size: var(--theme-font-caption);
      color: var(--theme-table-header-color);
      font-weight: var(--theme-font-table-header-weight);
    }
    .suppression-modal-body textarea,
    .suppression-modal-body input,
    .suppression-modal-body select {
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      padding: 0.5rem 0.6rem;
      font-size: var(--theme-font-body);
      font-family: inherit;
    }
    .suppression-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem 1rem;
      border-top: 1px solid var(--theme-border-gray-light);
    }
    .modal-close {
      background: none;
      border: none;
      font-size: var(--theme-font-page-title);
      line-height: 1;
      color: var(--theme-text-gray);
      cursor: pointer;
    }
    .modal-error {
      color: var(--theme-button-danger-hover);
      background: var(--theme-bg-app);
      border: 1px solid var(--theme-button-danger);
      padding: 0.5rem 0.6rem;
      border-radius: 6px;
      font-size: var(--theme-font-caption);
      margin-bottom: 0.8rem;
    }
    .required {
      color: var(--theme-button-danger-hover);
    }
    .key-value-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .key-value-row {
      display: grid;
      grid-template-columns: 1fr 1fr auto;
      gap: 0.5rem;
      align-items: center;
    }
    .group-actions {
      display: flex;
      gap: 0.35rem;
    }
    .group-table-wrap {
      margin-top: 0.75rem;
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      overflow: hidden;
      background: var(--theme-bg-surface);
    }
    .group-table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--theme-font-caption);
    }
    .group-table th,
    .group-table td {
      text-align: left;
      padding: 0.5rem 0.6rem;
      border-bottom: 1px solid var(--theme-border-gray-light);
      vertical-align: top;
    }
    .group-table th {
      background: var(--theme-bg-app);
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-header-weight);
    }
    .group-table td.group-actions {
      white-space: nowrap;
    }
    .group-manager-loading {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      padding: 0.25rem 0.1rem 0.6rem;
    }
    .route-key-dropdown {
      position: relative;
    }
    .route-key-dropdown-trigger {
      width: 100%;
      text-align: left;
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      padding: 0.5rem 0.6rem;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-body);
      cursor: pointer;
    }
    .route-key-dropdown-menu {
      position: absolute;
      z-index: 8;
      width: 100%;
      max-height: 220px;
      overflow-y: auto;
      margin-top: 0.3rem;
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      box-shadow: var(--theme-shadow-lg);
      padding: 0.4rem;
    }
    .route-key-option {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.2rem;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-table-header);
      cursor: pointer;
    }
    .route-key-actions {
      margin-top: 0.4rem;
      display: flex;
      justify-content: flex-end;
      border-top: 1px solid var(--theme-border-gray-light);
      padding-top: 0.35rem;
    }
    .route-key-empty {
      color: var(--theme-text-gray);
      font-size: var(--theme-font-caption);
      padding: 0.25rem 0.2rem;
    }
    .route-bindings-panel {
      margin-top: 0.9rem;
      border-top: 1px solid var(--theme-border-gray-light);
      padding-top: 0.75rem;
    }
    .route-bindings-panel h4 {
      margin: 0 0 0.5rem 0;
      font-size: var(--theme-font-body);
      color: var(--theme-table-header-color);
    }
    .route-bindings-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 0.75rem;
    }
    .route-bindings-column {
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 6px;
      padding: 0.45rem 0.55rem;
      background: var(--theme-bg-app);
    }
    .route-bindings-column h5 {
      margin: 0 0 0.45rem 0;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .route-binding-row {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.15rem 0;
      font-size: var(--theme-font-caption);
      color: var(--theme-table-header-color);
    }
    .route-key {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    }
    .route-arrow {
      color: var(--theme-text-gray);
    }
    .route-receiver {
      color: var(--theme-text-dark);
      font-weight: var(--theme-font-table-body-weight);
    }
  `]
})
export class PrometheusFiringAlertsTableComponent implements OnInit, OnDestroy {
  readonly healthState = inject(HealthStateService);
  readonly healthApi = inject(HealthApiService);
  readonly auth = inject(AuthService);
  readonly viewportScaleService = inject(ViewportScaleService);
  readonly isAdmin = this.auth.isUserAdmin;

  readonly alerts = computed(() => this.healthState.prometheusFiringAlerts());
  readonly skeletonRows = [1, 2, 3, 4, 5, 6, 7, 8];
  readonly sortedAlerts = computed(() => {
    const key = this.sortKey();
    const direction = this.sortDirection() === 'asc' ? 1 : -1;
    const values = [...this.alerts()];
    values.sort((a, b) => this.compareAlerts(a, b, key) * direction);
    return values;
  });
  readonly rangeLabel = computed(() => this.toRangeLabel(this.rangeHoursFilter));

  rangeHoursFilter = 168;
  severityFilter = '';
  namespaceFilter = '';
  alertNameFilter = '';
  suppressions: PrometheusSuppression[] = [];
  sortKey = signal<'severity' | 'firstOccurrenceAt' | 'lastOccurrenceAt'>('lastOccurrenceAt');
  sortDirection = signal<'asc' | 'desc'>('desc');
  showSuppressionModal = false;
  suppressionModalMode: 'suppress' | 'edit' | 'unsuppress' = 'suppress';
  suppressionModalTitle = '';
  suppressionModalActionLabel = '';
  suppressionReason = '';
  suppressionDurationHours = 24;
  originalSuppressionDurationHours: number | null = null;
  suppressionModalError = '';
  suppressionModalSaving = false;
  suppressionAlertTarget: {
    alertName: string;
    namespaceName?: string;
    severity?: string;
    podName?: string;
    firstSeenAtUtc?: string;
    lastSeenAtUtc?: string;
  } | null = null;
  suppressionTarget: PrometheusSuppression | null = null;

  showDefinitionModal = false;
  definitionModalSaving = false;
  definitionModalError = '';
  definitionModalActionLabel = 'Save';
  definitionOriginalAlertName = '';
  definitionBaselineRequest: ApplyPrometheusRuleRequest | null = null;
  definitionAlertName = '';
  definitionExpr = '';
  definitionFor = '5m';
  definitionSeverity = 'warning';
  definitionSummary = '';
  definitionDescription = '';
  definitionGroupName = 'kube-dashboard-custom-alerts';
  definitionAlertGroup = '';
  definitionLabelEntries: { id: number; key: string; value: string }[] = [];
  definitionAnnotationEntries: { id: number; key: string; value: string }[] = [];
  definitionRuleOrigin = 'unknown';
  definitionEntryId = 0;

  alertGroups: AlertGroupDefinition[] = [];
  alertRouteBindings: AlertRouteBinding[] = [];
  routeBindingsLoading = false;
  showGroupManager = false;
  groupManagerSaving = false;
  groupManagerError = '';
  groupNameInput = '';
  groupEmailsInput = '';
  selectedGroupRouteKeys: string[] = [];
  routeKeyOptions: string[] = [];
  isRouteKeyDropdownOpen = false;
  suppressionScrollPosition = signal({ top: 0, left: 0 });
  suppressionScrollListener?: () => void;

  suppressionModalStyle(): Record<string, string> {
    if (typeof window === 'undefined' || !this.showSuppressionModal) {
      return {};
    }

    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const baseWidth = this.viewportScaleService.baseWidth;
    const scrollPos = this.suppressionScrollPosition();

    const visibleTop = scrollPos.top / scale;
    const visibleHeight = viewportHeight / scale;
    const centerY = visibleTop + (visibleHeight / 2);
    const centerX = baseWidth / 2;

    return {
      position: 'absolute' as const,
      top: `${centerY}px`,
      left: `${centerX}px`,
      transform: 'translate(-50%, -50%)',
      width: '90%',
      maxWidth: '520px',
      maxHeight: `${Math.min(90 * baseHeight / 100, visibleHeight * 0.8)}px`,
    };
  }

  definitionModalStyle(): Record<string, string> {
    if (typeof window === 'undefined' || (!this.showDefinitionModal && !this.showGroupManager)) {
      return {};
    }

    const scale = this.viewportScaleService.scaleFactor();
    const viewportHeight = this.viewportScaleService.viewportHeight();
    const baseHeight = this.viewportScaleService.baseHeight();
    const baseWidth = this.viewportScaleService.baseWidth;
    const scrollPos = this.suppressionScrollPosition();

    const visibleTop = scrollPos.top / scale;
    const visibleHeight = viewportHeight / scale;
    const centerY = visibleTop + (visibleHeight / 2);
    const centerX = baseWidth / 2;

    return {
      position: 'absolute' as const,
      top: `${centerY}px`,
      left: `${centerX}px`,
      transform: 'translate(-50%, -50%)',
      width: '90%',
      maxWidth: '720px',
      maxHeight: `${Math.min(90 * baseHeight / 100, visibleHeight * 0.85)}px`,
    };
  }

  readonly severityOptions = computed(() =>
    this.uniqueSorted(this.alerts().map(a => a.severity).filter(Boolean))
  );

  readonly namespaceOptions = computed(() =>
    this.uniqueSorted(this.alerts().map(a => a.namespaceName || '').filter(Boolean))
  );

  readonly alertNameOptions = computed(() =>
    this.uniqueSorted(this.alerts().map(a => a.alertName).filter(Boolean))
  );

  ngOnInit(): void {
    this.rangeHoursFilter = this.healthState.prometheusAlertRangeHours();
    if (!this.alerts().length) {
      this.applyFilters();
    }
    if (this.isAdmin()) {
      this.loadAdminData();
    }
  }

  ngOnDestroy(): void {
    this.cleanupSuppressionScrollTracking();
  }

  refresh(): void {
    this.applyFilters();
  }

  onRangeChange(): void {
    this.healthState.setPrometheusAlertRangeHours(this.rangeHoursFilter);
    this.healthState.loadHealthAlertsSection(true).subscribe();
    if (this.isAdmin()) {
      this.loadSuppressions();
    }
  }

  applyFilters(): void {
    this.healthState.loadPrometheusFiringAlerts({
      severity: this.severityFilter || undefined,
      namespaceName: this.namespaceFilter || undefined,
      alertName: this.alertNameFilter || undefined,
      rangeHours: this.rangeHoursFilter,
      limit: 100,
      offset: 0
    }).subscribe();
    if (this.isAdmin()) {
      this.loadSuppressions();
    }
  }

  openSuppressModal(alert: {
    alertName: string;
    namespaceName?: string;
    severity?: string;
    podName?: string;
    firstOccurrenceAt?: string;
    lastOccurrenceAt?: string;
  }): void {
    this.suppressionModalMode = 'suppress';
    this.suppressionModalTitle = 'Suppress alert';
    this.suppressionModalActionLabel = 'Suppress';
    this.suppressionReason = '';
    this.suppressionDurationHours = 24;
    this.originalSuppressionDurationHours = null;
    this.suppressionAlertTarget = {
      alertName: alert.alertName,
      namespaceName: alert.namespaceName,
      severity: alert.severity,
      podName: alert.podName,
      firstSeenAtUtc: alert.firstOccurrenceAt,
      lastSeenAtUtc: alert.lastOccurrenceAt
    };
    this.suppressionTarget = null;
    this.suppressionModalError = '';
    this.showDefinitionModal = false;
    this.showSuppressionModal = true;
    this.setupSuppressionScrollTracking();
  }

  openEditSuppressionModal(suppression: PrometheusSuppression): void {
    this.suppressionModalMode = 'edit';
    this.suppressionModalTitle = 'Edit suppression';
    this.suppressionModalActionLabel = 'Update';
    this.suppressionReason = suppression.comment || '';
    const durationHours = this.deriveSuppressionDurationHours(suppression);
    this.suppressionDurationHours = durationHours;
    this.originalSuppressionDurationHours = durationHours;
    this.suppressionTarget = suppression;
    this.suppressionAlertTarget = null;
    this.suppressionModalError = '';
    this.showDefinitionModal = false;
    this.showSuppressionModal = true;
    this.setupSuppressionScrollTracking();
  }

  openUnsuppressModal(suppression: PrometheusSuppression): void {
    this.suppressionModalMode = 'unsuppress';
    this.suppressionModalTitle = 'Unsuppress alert';
    this.suppressionModalActionLabel = 'Unsuppress';
    this.suppressionReason = '';
    this.suppressionTarget = suppression;
    this.originalSuppressionDurationHours = null;
    this.suppressionAlertTarget = null;
    this.suppressionModalError = '';
    this.showDefinitionModal = false;
    this.showSuppressionModal = true;
    this.setupSuppressionScrollTracking();
  }

  closeSuppressionModal(): void {
    this.showSuppressionModal = false;
    this.suppressionModalSaving = false;
    this.suppressionModalError = '';
    this.cleanupSuppressionScrollTracking();
  }

  openAlertDefinitionModal(alert: { alertName: string; severity?: string; summary?: string; description?: string }): void {
    this.closeSuppressionModal();
    this.showDefinitionModal = true;
    this.definitionModalSaving = false;
    this.definitionModalError = '';
    this.definitionModalActionLabel = 'Save';
    this.definitionOriginalAlertName = alert.alertName;
    this.definitionBaselineRequest = null;
    this.definitionAlertName = alert.alertName;
    this.definitionExpr = '';
    this.definitionFor = '5m';
    this.definitionSeverity = alert.severity || 'warning';
    this.definitionSummary = alert.summary || '';
    this.definitionDescription = alert.description || '';
    this.definitionGroupName = 'kube-dashboard-custom-alerts';
    this.definitionAlertGroup = '';
    this.definitionLabelEntries = [];
    this.definitionAnnotationEntries = [];
    this.definitionRuleOrigin = 'unknown';
    this.setupSuppressionScrollTracking();
    this.loadAlertGroups();
    this.loadRuleDefinition(alert.alertName);
  }

  closeDefinitionModal(): void {
    this.showDefinitionModal = false;
    this.definitionModalSaving = false;
    this.definitionModalError = '';
    this.definitionBaselineRequest = null;
    this.cleanupSuppressionScrollTracking();
  }

  onDefinitionBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeDefinitionModal();
    }
  }

  submitDefinitionModal(): void {
    if (this.isDefinitionSubmitDisabled()) return;
    const alertName = this.definitionAlertName.trim();
    const expr = this.definitionExpr.trim();
    if (!alertName || !expr) {
      this.definitionModalError = 'Alert name and expression are required.';
      return;
    }

    this.definitionModalSaving = true;
    this.definitionModalError = '';
    const labels = this.buildLabelMap();
    const annotations = this.buildAnnotationMap();
    const request: ApplyPrometheusRuleRequest = {
      alertName,
      originalAlertName: this.definitionOriginalAlertName || alertName,
      expr,
      for: (this.definitionFor || '5m').trim(),
      groupName: (this.definitionGroupName || 'kube-dashboard-custom-alerts').trim(),
      labels,
      annotations
    };

    if (this.definitionBaselineRequest && this.areDefinitionRequestsEquivalent(this.definitionBaselineRequest, request)) {
      this.definitionModalError = 'No changes detected.';
      return;
    }

    this.healthApi.applyPrometheusRuleDefinition(request).subscribe({
      next: (result) => {
        if (!result.changed) {
          this.definitionModalSaving = false;
          this.definitionModalError = 'No changes detected.';
          return;
        }
        this.closeDefinitionModal();
        this.loadAdminData();
      },
      error: (err) => {
        this.definitionModalSaving = false;
        this.definitionModalError = `Failed to update alert definition: ${err?.error?.error || err.message || 'Unknown error'}`;
      }
    });
  }

  suppressionModalActionButtonLabel(): string {
    if (!this.suppressionModalSaving) {
      return this.suppressionModalActionLabel;
    }

    if (this.suppressionModalMode === 'suppress') {
      return 'Suppressing...';
    }

    if (this.suppressionModalMode === 'unsuppress') {
      return 'Unsuppressing...';
    }

    return 'Saving...';
  }

  isSuppressionPrimaryActionDisabled(): boolean {
    if (this.suppressionModalSaving) {
      return true;
    }

    const reason = (this.suppressionReason || '').trim();
    if (!reason) {
      return true;
    }

    const durationHours = Number(this.suppressionDurationHours ?? 0);
    if (this.suppressionModalMode === 'unsuppress') {
      return false;
    }

    if (!Number.isFinite(durationHours) || durationHours <= 0) {
      return true;
    }

    if (this.suppressionModalMode !== 'edit') {
      return false;
    }

    return this.originalSuppressionDurationHours !== null &&
      durationHours === this.originalSuppressionDurationHours;
  }

  suppressionAuditHint(): string {
    if (this.suppressionModalMode === 'unsuppress') {
      return 'Reason is required and will be stored in admin audit logs.';
    }

    return 'Reason and duration are required and will be stored in admin audit logs.';
  }

  suppressionTargetSummary(): string {
    if (this.suppressionModalMode === 'unsuppress') {
      const target = this.suppressionTarget;
      const alertName = target?.matchers?.['alertname'] || 'selected alert';
      return `Unsuppress ${alertName}`;
    }

    if (this.suppressionModalMode === 'suppress') {
      const target = this.suppressionAlertTarget;
      return target?.alertName ? `Suppress ${target.alertName}` : 'Suppress selected alert';
    }

    const target = this.suppressionTarget;
    const alertName = target?.matchers?.['alertname'] || 'selected alert';
    return `Edit suppression for ${alertName}`;
  }

  private deriveSuppressionDurationHours(suppression: PrometheusSuppression): number {
    const startsAt = new Date(suppression.startsAt).getTime();
    const endsAt = new Date(suppression.endsAt).getTime();
    if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt <= startsAt) {
      return 24;
    }

    const durationHours = (endsAt - startsAt) / (60 * 60 * 1000);
    return Math.max(1, Math.round(durationHours));
  }

  private loadRuleDefinition(alertName: string): void {
    this.healthApi.getPrometheusRuleDefinition(alertName).subscribe({
      next: (rule) => this.applyRuleDefinition(rule),
      error: (err) => {
        if (err?.status === 404) {
          return;
        }
        this.definitionModalError = `Failed to load rule definition: ${err?.error?.error || err.message || 'Unknown error'}`;
      }
    });
  }

  private applyRuleDefinition(rule: PrometheusRuleDefinition): void {
    this.definitionOriginalAlertName = rule.alertName;
    this.definitionAlertName = rule.alertName;
    this.definitionExpr = rule.expr || '';
    this.definitionFor = rule.for || '5m';
    this.definitionGroupName = rule.groupName || 'kube-dashboard-custom-alerts';
    this.definitionRuleOrigin = rule.origin || 'unknown';
    this.definitionModalActionLabel = rule.origin === 'ootb' ? 'Replace' : 'Update';
    this.definitionLabelEntries = this.mapToEntries(rule.labels, ['severity', 'alert_group']);
    this.definitionAnnotationEntries = this.mapToEntries(rule.annotations, ['summary', 'description']);
    this.definitionSeverity = rule.labels?.['severity'] || 'warning';
    this.definitionAlertGroup = rule.labels?.['alert_group'] || '';
    this.definitionSummary = rule.annotations?.['summary'] || '';
    this.definitionDescription = rule.annotations?.['description'] || '';
    this.definitionBaselineRequest = this.buildCurrentDefinitionRequest();
  }

  addLabelEntry(): void {
    this.definitionLabelEntries = [
      ...this.definitionLabelEntries,
      { id: ++this.definitionEntryId, key: '', value: '' }
    ];
  }

  removeLabelEntry(id: number): void {
    this.definitionLabelEntries = this.definitionLabelEntries.filter(entry => entry.id !== id);
  }

  addAnnotationEntry(): void {
    this.definitionAnnotationEntries = [
      ...this.definitionAnnotationEntries,
      { id: ++this.definitionEntryId, key: '', value: '' }
    ];
  }

  removeAnnotationEntry(id: number): void {
    this.definitionAnnotationEntries = this.definitionAnnotationEntries.filter(entry => entry.id !== id);
  }

  private mapToEntries(map: Record<string, string> | undefined, excludedKeys: string[]): { id: number; key: string; value: string }[] {
    if (!map) return [];
    return Object.entries(map)
      .filter(([key]) => !excludedKeys.includes(key))
      .map(([key, value]) => ({ id: ++this.definitionEntryId, key, value }));
  }

  private buildLabelMap(): Record<string, string> {
    const labels: Record<string, string> = {};
    for (const entry of this.definitionLabelEntries) {
      if (entry.key?.trim()) {
        labels[entry.key.trim()] = entry.value?.trim() || '';
      }
    }
    if (this.definitionSeverity?.trim()) {
      labels['severity'] = this.definitionSeverity.trim();
    }
    if (this.definitionAlertGroup?.trim()) {
      labels['alert_group'] = this.definitionAlertGroup.trim();
    }
    return labels;
  }

  private buildAnnotationMap(): Record<string, string> {
    const annotations: Record<string, string> = {};
    for (const entry of this.definitionAnnotationEntries) {
      if (entry.key?.trim()) {
        annotations[entry.key.trim()] = entry.value?.trim() || '';
      }
    }
    if (this.definitionSummary?.trim()) {
      annotations['summary'] = this.definitionSummary.trim();
    }
    if (this.definitionDescription?.trim()) {
      annotations['description'] = this.definitionDescription.trim();
    }
    return annotations;
  }

  isDefinitionSubmitDisabled(): boolean {
    if (this.definitionModalSaving) {
      return true;
    }

    const alertName = this.definitionAlertName.trim();
    const expr = this.definitionExpr.trim();
    if (!alertName || !expr) {
      return true;
    }

    if (!this.definitionBaselineRequest) {
      return false;
    }

    return this.areDefinitionRequestsEquivalent(this.definitionBaselineRequest, this.buildCurrentDefinitionRequest());
  }

  private buildCurrentDefinitionRequest(): ApplyPrometheusRuleRequest {
    const alertName = this.definitionAlertName.trim();
    return {
      alertName,
      originalAlertName: this.definitionOriginalAlertName || alertName,
      expr: this.definitionExpr.trim(),
      for: (this.definitionFor || '5m').trim(),
      groupName: (this.definitionGroupName || 'kube-dashboard-custom-alerts').trim(),
      labels: this.buildLabelMap(),
      annotations: this.buildAnnotationMap()
    };
  }

  private areDefinitionRequestsEquivalent(left: ApplyPrometheusRuleRequest, right: ApplyPrometheusRuleRequest): boolean {
    return (left.alertName || '').trim() === (right.alertName || '').trim()
      && (left.originalAlertName || '').trim() === (right.originalAlertName || '').trim()
      && (left.expr || '').trim() === (right.expr || '').trim()
      && (left.for || '').trim() === (right.for || '').trim()
      && (left.groupName || '').trim() === (right.groupName || '').trim()
      && this.areStringMapsEqual(left.labels || {}, right.labels || {})
      && this.areStringMapsEqual(left.annotations || {}, right.annotations || {});
  }

  private areStringMapsEqual(left: Record<string, string>, right: Record<string, string>): boolean {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    for (let i = 0; i < leftKeys.length; i++) {
      const leftKey = leftKeys[i];
      const rightKey = rightKeys[i];
      if (leftKey !== rightKey) {
        return false;
      }

      if ((left[leftKey] || '').trim() !== (right[rightKey] || '').trim()) {
        return false;
      }
    }

    return true;
  }

  openGroupManager(): void {
    this.showGroupManager = true;
    this.groupManagerError = '';
    this.groupManagerSaving = false;
    this.clearGroupForm();
    this.loadAlertGroups();
    this.loadAlertRouteBindings();
    this.loadRouteKeyOptions();
    this.setupSuppressionScrollTracking();
  }

  closeGroupManager(event?: MouseEvent): void {
    if (event && event.target !== event.currentTarget) return;
    this.showGroupManager = false;
    this.groupManagerSaving = false;
    this.groupManagerError = '';
    this.cleanupSuppressionScrollTracking();
  }

  clearGroupForm(): void {
    this.groupNameInput = '';
    this.groupEmailsInput = '';
    this.selectedGroupRouteKeys = [];
    this.isRouteKeyDropdownOpen = false;
  }

  editGroup(group: AlertGroupDefinition): void {
    this.groupNameInput = group.name;
    this.groupEmailsInput = group.emails.join(', ');
    this.selectedGroupRouteKeys = [...(group.routeKeys ?? [])];
    this.mergeRouteKeyOptions(this.selectedGroupRouteKeys);
    this.isRouteKeyDropdownOpen = false;
  }

  saveGroup(): void {
    const name = this.groupNameInput.trim();
    if (!name) {
      this.groupManagerError = 'Group name is required.';
      return;
    }
    const emails = this.groupEmailsInput
      .split(',')
      .map(e => e.trim())
      .filter(e => e.length > 0);
    const routeKeys = this.selectedGroupRouteKeys
      .map(k => k.trim())
      .filter(k => k.length > 0);

    this.groupManagerSaving = true;
    this.groupManagerError = '';
    this.healthApi.upsertAlertGroup({ name, emails, routeKeys }).subscribe({
      next: (groups) => {
        this.alertGroups = groups ?? [];
        this.mergeRouteKeyOptions(this.alertGroups.flatMap(g => g.routeKeys ?? []));
        this.groupManagerSaving = false;
        this.clearGroupForm();
        this.loadAlertGroups();
        this.loadAlertRouteBindings();
        this.loadRouteKeyOptions();
      },
      error: (err) => {
        this.groupManagerSaving = false;
        this.groupManagerError = `Failed to save group: ${err?.error?.error || err.message || 'Unknown error'}`;
      }
    });
  }

  deleteGroup(groupName: string): void {
    this.groupManagerSaving = true;
    this.healthApi.deleteAlertGroup(groupName).subscribe({
      next: () => {
        this.groupManagerSaving = false;
        if (this.groupNameInput.trim().toLowerCase() === groupName.trim().toLowerCase()) {
          this.clearGroupForm();
        }
        this.loadAlertGroups();
        this.loadAlertRouteBindings();
      },
      error: (err) => {
        this.groupManagerSaving = false;
        this.groupManagerError = `Failed to delete group: ${err?.error?.error || err.message || 'Unknown error'}`;
      }
    });
  }

  private loadAlertGroups(): void {
    this.healthApi.getAlertGroups().subscribe({
      next: (groups) => {
        this.alertGroups = groups ?? [];
        this.mergeRouteKeyOptions(this.alertGroups.flatMap(group => group.routeKeys ?? []));
      },
      error: (err) => {
        this.groupManagerError = `Failed to load groups: ${err?.error?.error || err.message || 'Unknown error'}`;
      }
    });
  }

  private loadAlertRouteBindings(): void {
    this.routeBindingsLoading = true;
    this.healthApi.getAlertRouteBindings().subscribe({
      next: (bindings) => {
        this.alertRouteBindings = bindings ?? [];
        this.routeBindingsLoading = false;
      },
      error: () => {
        this.alertRouteBindings = [];
        this.routeBindingsLoading = false;
      }
    });
  }

  baseRouteBindings(): AlertRouteBinding[] {
    return this.alertRouteBindings
      .filter(binding => binding.source.toLowerCase() === 'base')
      .sort((left, right) => `${left.routeKey}|${left.receiver}`.localeCompare(`${right.routeKey}|${right.receiver}`));
  }

  overrideRouteBindings(): AlertRouteBinding[] {
    return this.alertRouteBindings
      .filter(binding => binding.source.toLowerCase() === 'override')
      .sort((left, right) => `${left.routeKey}|${left.receiver}`.localeCompare(`${right.routeKey}|${right.receiver}`));
  }

  bindingRouteLabel(binding: AlertRouteBinding): string {
    const value = (binding.routeKey || '').trim();
    return value.length > 0 ? value : '(no route keys)';
  }

  private loadRouteKeyOptions(): void {
    this.healthApi.getAlertGroupRouteKeys().subscribe({
      next: (routeKeys) => {
        this.mergeRouteKeyOptions(routeKeys ?? []);
      },
      error: () => {
        // Fallback to route keys discovered from currently loaded groups.
        this.mergeRouteKeyOptions(this.alertGroups.flatMap(group => group.routeKeys ?? []));
      }
    });
  }

  private mergeRouteKeyOptions(routeKeys: string[]): void {
    const merged = [
      ...this.routeKeyOptions,
      ...(routeKeys ?? []),
      ...this.selectedGroupRouteKeys
    ]
      .map(key => (key || '').trim())
      .filter(key => key.length > 0);

    this.routeKeyOptions = this.uniqueSorted(merged);
  }

  toggleRouteKeyDropdown(): void {
    this.isRouteKeyDropdownOpen = !this.isRouteKeyDropdownOpen;
  }

  closeRouteKeyDropdown(): void {
    this.isRouteKeyDropdownOpen = false;
  }

  isRouteKeySelected(routeKey: string): boolean {
    return this.selectedGroupRouteKeys.some(key => key.toLowerCase() === routeKey.toLowerCase());
  }

  setRouteKeySelected(routeKey: string, selected: boolean): void {
    const exists = this.isRouteKeySelected(routeKey);
    if (selected && !exists) {
      this.selectedGroupRouteKeys = [...this.selectedGroupRouteKeys, routeKey];
      return;
    }
    if (!selected && exists) {
      this.selectedGroupRouteKeys = this.selectedGroupRouteKeys.filter(
        key => key.toLowerCase() !== routeKey.toLowerCase()
      );
    }
  }

  routeKeyDropdownLabel(): string {
    const selected = this.selectedGroupRouteKeys
      .map(key => key.trim())
      .filter(key => key.length > 0);
    if (selected.length === 0) {
      return 'Select route keys';
    }
    return selected.join(', ');
  }

  private setupSuppressionScrollTracking(): void {
    if (typeof window === 'undefined') return;
    this.updateSuppressionScrollPosition();
    this.suppressionScrollListener = () => this.updateSuppressionScrollPosition();
    window.addEventListener('scroll', this.suppressionScrollListener, true);
  }

  private cleanupSuppressionScrollTracking(): void {
    if (this.suppressionScrollListener && typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.suppressionScrollListener, true);
      this.suppressionScrollListener = undefined;
    }
  }

  private updateSuppressionScrollPosition(): void {
    if (typeof window === 'undefined') return;
    this.suppressionScrollPosition.set({
      top: window.scrollY || 0,
      left: window.scrollX || 0
    });
  }

  onSuppressionBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) {
      this.closeSuppressionModal();
    }
  }

  submitSuppressionModal(): void {
    if (this.suppressionModalSaving) return;
    const reason = (this.suppressionReason || '').trim();

    if (this.suppressionModalMode !== 'unsuppress') {
      if (!reason) {
        this.suppressionModalError = 'Reason is required.';
        return;
      }
      const durationHours = Number(this.suppressionDurationHours ?? 0);
      if (!Number.isFinite(durationHours) || durationHours <= 0) {
        this.suppressionModalError = 'Duration must be a positive number.';
        return;
      }
      if (this.suppressionModalMode === 'suppress' && this.suppressionAlertTarget) {
        this.suppressionModalSaving = true;
        this.healthApi.suppressPrometheusAlert({
          alertName: this.suppressionAlertTarget.alertName,
          namespaceName: this.suppressionAlertTarget.namespaceName,
          severity: this.suppressionAlertTarget.severity,
          podName: this.suppressionAlertTarget.podName,
          firstSeenAtUtc: this.suppressionAlertTarget.firstSeenAtUtc,
          lastSeenAtUtc: this.suppressionAlertTarget.lastSeenAtUtc,
          reason,
          durationHours
        }).subscribe({
          next: () => {
            this.loadAdminData();
            this.closeSuppressionModal();
          },
          error: (err) => {
            this.suppressionModalSaving = false;
            this.suppressionModalError = `Failed to suppress alert: ${err?.error?.error || err.message || 'Unknown error'}`;
          }
        });
        return;
      }

      if (this.suppressionModalMode === 'edit' && this.suppressionTarget) {
        if (this.isSuppressionPrimaryActionDisabled()) {
          this.suppressionModalError = 'Please change duration hours before updating.';
          return;
        }

        this.suppressionModalSaving = true;
        this.healthApi.editPrometheusSuppression(this.suppressionTarget.silenceId, {
          reason,
          durationHours
        }).subscribe({
          next: () => {
            this.loadAdminData();
            this.closeSuppressionModal();
          },
          error: (err) => {
            this.suppressionModalSaving = false;
            this.suppressionModalError = `Failed to edit suppression: ${err?.error?.error || err.message || 'Unknown error'}`;
          }
        });
      }
      return;
    }

    if (this.suppressionTarget) {
      if (!reason) {
        this.suppressionModalError = 'Reason is required.';
        return;
      }

      this.suppressionModalSaving = true;
      this.healthApi.unsuppressPrometheusAlert(this.suppressionTarget.silenceId, reason).subscribe({
        next: () => {
          this.loadAdminData();
          this.closeSuppressionModal();
        },
        error: (err) => {
          this.suppressionModalSaving = false;
          this.suppressionModalError = `Failed to unsuppress alert: ${err?.error?.error || err.message || 'Unknown error'}`;
        }
      });
    }
  }

  suppressionFor(alert: { alertName: string; namespaceName?: string; severity?: string; podName?: string }): PrometheusSuppression | null {
    return this.suppressions.find(s =>
      s.status.toLowerCase() === 'active' &&
      (s.matchers?.['alertname'] || '') === alert.alertName &&
      (!alert.namespaceName || (s.matchers?.['namespace'] || '') === alert.namespaceName) &&
      (!alert.severity || (s.matchers?.['severity'] || '') === alert.severity) &&
      (!alert.podName || (s.matchers?.['pod'] || '') === alert.podName)
    ) || null;
  }

  toggleSort(key: 'severity' | 'firstOccurrenceAt' | 'lastOccurrenceAt'): void {
    if (this.sortKey() === key) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }

    this.sortKey.set(key);
    this.sortDirection.set('desc');
  }

  sortIndicator(key: 'severity' | 'firstOccurrenceAt' | 'lastOccurrenceAt'): string {
    if (this.sortKey() !== key) return '';
    return this.sortDirection() === 'asc' ? '↑' : '↓';
  }

  formatDateTime(value?: string): string {
    if (!value) return 'n/a';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return 'n/a';
    return dt.toLocaleString();
  }

  formatDuration(seconds: number): string {
    if (!seconds || seconds < 60) return `${Math.max(0, seconds)}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h >= 24) {
      const d = Math.floor(h / 24);
      const hRem = h % 24;
      return `${d}d ${hRem}h`;
    }
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  getLastOccurredSeconds(lastOccurrenceAt?: string): number {
    if (!lastOccurrenceAt) return 0;
    const last = new Date(lastOccurrenceAt).getTime();
    if (Number.isNaN(last)) return 0;
    return Math.max(0, Math.floor((Date.now() - last) / 1000));
  }

  getTotalDurationSeconds(firstOccurrenceAt?: string, lastOccurrenceAt?: string): number {
    if (!firstOccurrenceAt) return 0;
    const first = new Date(firstOccurrenceAt).getTime();
    if (Number.isNaN(first)) return 0;

    if (lastOccurrenceAt) {
      const last = new Date(lastOccurrenceAt).getTime();
      if (!Number.isNaN(last)) {
        return Math.max(0, Math.floor((last - first) / 1000));
      }
    }

    return Math.max(0, Math.floor((Date.now() - first) / 1000));
  }

  private uniqueSorted(values: string[]): string[] {
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }

  private toRangeLabel(hours: number): string {
    if (hours % 24 === 0) {
      const days = hours / 24;
      return `${days} day${days > 1 ? 's' : ''}`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }

  private compareAlerts(
    a: { severity: string; firstOccurrenceAt?: string; lastOccurrenceAt?: string },
    b: { severity: string; firstOccurrenceAt?: string; lastOccurrenceAt?: string },
    key: 'severity' | 'firstOccurrenceAt' | 'lastOccurrenceAt'
  ): number {
    if (key === 'severity') {
      return this.severityRank(a.severity) - this.severityRank(b.severity);
    }

    if (key === 'firstOccurrenceAt') {
      return this.toEpoch(a.firstOccurrenceAt) - this.toEpoch(b.firstOccurrenceAt);
    }

    if (key === 'lastOccurrenceAt') {
      return this.toEpoch(a.lastOccurrenceAt) - this.toEpoch(b.lastOccurrenceAt);
    }

    return this.getTotalDurationSeconds(a.firstOccurrenceAt, a.lastOccurrenceAt)
      - this.getTotalDurationSeconds(b.firstOccurrenceAt, b.lastOccurrenceAt);
  }

  private severityRank(value: string): number {
    const normalized = value.toLowerCase();
    if (normalized === 'critical') return 4;
    if (normalized === 'warning') return 3;
    if (normalized === 'info') return 2;
    if (normalized === 'none') return 1;
    return 0;
  }

  private toEpoch(value?: string): number {
    if (!value) return 0;
    const epoch = new Date(value).getTime();
    return Number.isNaN(epoch) ? 0 : epoch;
  }

  getAlertGroup(alert: { labels?: Record<string, string> }): string {
    const value = alert.labels?.['alert_group'] || '';
    return value.trim() ? value.trim() : 'n/a';
  }

  toRouteKey(groupName: string): string {
    const normalized = (groupName || '').trim();
    if (!normalized) return 'n/a';
    if (normalized.toLowerCase().endsWith('-alerts-email')) {
      return normalized.slice(0, -'-alerts-email'.length) || normalized;
    }
    return normalized;
  }

  displayRouteKeys(group: AlertGroupDefinition): string {
    const routeKeys = (group.routeKeys ?? [])
      .map(key => (key || '').trim())
      .filter(key => key.length > 0);
    if (routeKeys.length > 0) {
      return routeKeys.join(', ');
    }
    return this.toRouteKey(group.name);
  }

  private loadAdminData(): void {
    this.loadSuppressions();
  }

  private loadSuppressions(): void {
    this.healthApi.getPrometheusSuppressions().subscribe({
      next: (rows) => {
        this.suppressions = rows ?? [];
      },
      error: () => {
        this.suppressions = [];
      }
    });
  }

}
