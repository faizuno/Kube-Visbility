import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TopicAlertingApiService } from '../../../../core/services/api/topic-alerting-api.service';
import { TopicAlertGroup, TopicAlertRule } from '../../../../core/models/topic-alerting.models';
import { TopicAlertingEditorModalComponent } from '../topic-alerting-editor-modal/topic-alerting-editor-modal.component';

type AlertTab = 'groups' | 'rules';
type EditorMode = 'group' | 'rule';
type SortDirection = 'asc' | 'desc';
type GroupSortColumn = 'name' | 'updated';
type RuleSortColumn = 'name' | 'updated';

@Component({
  selector: 'app-topic-alerting-list-page',
  standalone: true,
  imports: [CommonModule, FormsModule, TopicAlertingEditorModalComponent],
  template: `
    <div class="list-page">
      <div class="toolbar">
        <div class="tab-segmented" role="tablist" aria-label="Topic alert sections">
          <button class="tab-btn" [class.active]="selectedTab() === 'groups'" (click)="setTab('groups')">
            <i class="fas fa-layer-group icon-groups"></i>
            <span>Groups</span>
            <span class="tab-count">{{ groups().length }}</span>
          </button>
          <button class="tab-btn" [class.active]="selectedTab() === 'rules'" (click)="setTab('rules')">
            <i class="fas fa-bell icon-rules"></i>
            <span>Rules</span>
            <span class="tab-count">{{ rules().length }}</span>
          </button>
        </div>
      </div>

      @if (errorMessage()) {
        <div class="error-banner">{{ errorMessage() }}</div>
      }
      @if (successMessage()) {
        <div class="success-banner">{{ successMessage() }}</div>
      }

      @if (selectedTab() === 'groups') {
        <section class="panel">
          <div class="section-head">
            <div class="section-actions">
              <button class="btn-primary" (click)="openCreate()">
                <i class="fas fa-plus"></i>
                Create Group
              </button>
            </div>
            <input
              type="text"
              class="filter-input section-filter"
              [ngModel]="filterText()"
              (ngModelChange)="filterText.set(($event ?? '').toString())"
              placeholder="Filter by name, topic, description..." />
          </div>
          <div class="action-legend">
            <span class="legend-item"><i class="fas fa-pen legend-icon legend-edit"></i> Edit</span>
            <span class="legend-item"><i class="fas fa-trash legend-icon legend-delete"></i> Delete</span>
          </div>
          @if (isLoadingGroups()) {
            <div class="table-wrap">
              <table class="data-table groups-table">
                <thead>
                  <tr>
                    <th class="sortable" [class.active-sort]="groupSortColumn() === 'name'" (click)="setGroupSort('name')">
                      Name
                      <i class="fas" [class.fa-sort-up]="groupSortColumn() === 'name' && groupSortDirection() === 'asc'" [class.fa-sort-down]="groupSortColumn() === 'name' && groupSortDirection() === 'desc'" [class.fa-sort]="groupSortColumn() !== 'name'"></i>
                    </th>
                    <th>Topics</th>
                    <th class="sortable" [class.active-sort]="groupSortColumn() === 'updated'" (click)="setGroupSort('updated')">
                      Updated
                      <i class="fas" [class.fa-sort-up]="groupSortColumn() === 'updated' && groupSortDirection() === 'asc'" [class.fa-sort-down]="groupSortColumn() === 'updated' && groupSortDirection() === 'desc'" [class.fa-sort]="groupSortColumn() !== 'updated'"></i>
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of skeletonRows; track row) {
                    <tr class="skeleton-row">
                      <td><span class="table-skeleton sk-name"></span><span class="table-skeleton sk-sub"></span></td>
                      <td><span class="table-skeleton sk-chip"></span><span class="table-skeleton sk-chip"></span></td>
                      <td><span class="table-skeleton sk-date"></span></td>
                      <td><span class="table-skeleton sk-action"></span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (filteredGroups().length === 0) {
            <div class="empty-state">No groups found.</div>
          } @else {
            <div class="table-wrap">
              <table class="data-table groups-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Topics</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (group of filteredGroups(); track group.groupId) {
                    <tr>
                      <td>
                        <div class="main-text">{{ group.name }}</div>
                        <div class="sub-text">{{ group.description || '-' }}</div>
                      </td>
                      <td>
                        <div class="topics-cell">
                          <div class="cell-chip-wrap" [title]="group.topicNames.join(', ')">
                            @for (topic of group.topicNames.slice(0, 4); track topic) {
                              <span class="cell-chip">{{ topic }}</span>
                            }
                            @if (group.topicNames.length > 4) {
                              <span class="cell-more">+{{ group.topicNames.length - 4 }} more</span>
                            }
                          </div>
                          <button class="btn-icon-action btn-view-topics-scanning" (click)="openTopicsModal(group.topicNames, 'Group Topics')" title="View topics list" aria-label="View topics list">
                            <i class="fas fa-list"></i>
                          </button>
                        </div>
                      </td>
                      <td>{{ formatUtc(group.updatedAtUtc) }}</td>
                      <td>
                        <div class="action-buttons">
                          <button class="btn-icon-action btn-edit-scanning" (click)="openEditGroup(group)" title="Edit group" aria-label="Edit group">
                            <i class="fas fa-pen"></i>
                          </button>
                          <button class="btn-icon-action btn-delete-scanning" (click)="deleteGroup(group)" title="Delete group" aria-label="Delete group">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      } @else {
        <section class="panel">
          <div class="section-head">
            <div class="section-actions">
              <button class="btn-primary" (click)="openCreate()">
                <i class="fas fa-plus"></i>
                Create Rule
              </button>
            </div>
            <input
              type="text"
              class="filter-input section-filter"
              [ngModel]="filterText()"
              (ngModelChange)="filterText.set(($event ?? '').toString())"
              placeholder="Filter by name, target, recipient..." />
          </div>
          <div class="action-legend">
            <span class="legend-item"><i class="fas fa-play legend-icon legend-enable"></i> Enable</span>
            <span class="legend-item"><i class="fas fa-pause legend-icon legend-disable"></i> Disable</span>
            <span class="legend-item"><i class="fas fa-pen legend-icon legend-edit"></i> Edit</span>
            <span class="legend-item"><i class="fas fa-trash legend-icon legend-delete"></i> Delete</span>
          </div>
          @if (isLoadingRules()) {
            <div class="table-wrap">
              <table class="data-table rules-table">
                <thead>
                  <tr>
                    <th class="sortable" [class.active-sort]="ruleSortColumn() === 'name'" (click)="setRuleSort('name')">
                      Name
                      <i class="fas" [class.fa-sort-up]="ruleSortColumn() === 'name' && ruleSortDirection() === 'asc'" [class.fa-sort-down]="ruleSortColumn() === 'name' && ruleSortDirection() === 'desc'" [class.fa-sort]="ruleSortColumn() !== 'name'"></i>
                    </th>
                    <th>Target</th>
                    <th>Recipients</th>
                    <th class="sortable" [class.active-sort]="ruleSortColumn() === 'updated'" (click)="setRuleSort('updated')">
                      Updated
                      <i class="fas" [class.fa-sort-up]="ruleSortColumn() === 'updated' && ruleSortDirection() === 'asc'" [class.fa-sort-down]="ruleSortColumn() === 'updated' && ruleSortDirection() === 'desc'" [class.fa-sort]="ruleSortColumn() !== 'updated'"></i>
                    </th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of skeletonRows; track row) {
                    <tr class="skeleton-row">
                      <td><span class="table-skeleton sk-name"></span><span class="table-skeleton sk-sub"></span></td>
                      <td><span class="table-skeleton sk-chip"></span></td>
                      <td><span class="table-skeleton sk-chip"></span><span class="table-skeleton sk-chip"></span></td>
                      <td><span class="table-skeleton sk-status"></span></td>
                      <td><span class="table-skeleton sk-action"></span></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (filteredRules().length === 0) {
            <div class="empty-state">No rules found.</div>
          } @else {
            <div class="table-wrap">
              <table class="data-table rules-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Target</th>
                    <th>Recipients</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  @for (rule of filteredRules(); track rule.ruleId) {
                    <tr>
                      <td>
                        <div class="main-text">{{ rule.name }}</div>
                        <div class="sub-text">Updated: {{ formatUtc(rule.updatedAtUtc) }}</div>
                      </td>
                      <td>
                        <div class="topics-cell">
                          @if (rule.targetType === 'group') {
                            <div class="sub-text target-label">Group: {{ resolveGroupName(rule.topicGroupId) }}</div>
                          }
                          <div class="cell-chip-wrap" [title]="getRuleTargetTopics(rule).join(', ')">
                            @for (topic of getRuleTargetTopics(rule).slice(0, 3); track topic) {
                              <span class="cell-chip">{{ topic }}</span>
                            }
                            @if (getRuleTargetTopics(rule).length > 3) {
                              <span class="cell-more">+{{ getRuleTargetTopics(rule).length - 3 }} more</span>
                            }
                          </div>
                          <button class="btn-icon-action btn-view-topics-scanning" (click)="openTopicsModal(getRuleTargetTopics(rule), 'Rule Topics')" title="View topics list" aria-label="View topics list">
                            <i class="fas fa-list"></i>
                          </button>
                        </div>
                      </td>
                      <td>
                        <div class="cell-chip-wrap" [title]="rule.recipientEmails.join(', ')">
                          @for (email of rule.recipientEmails.slice(0, 2); track email) {
                            <span class="cell-chip neutral">{{ email }}</span>
                          }
                        </div>
                      </td>
                      <td>
                        {{ formatUtc(rule.updatedAtUtc) }}
                        <div class="sub-text">{{ rule.enabled ? 'Enabled' : 'Disabled' }}</div>
                      </td>
                      <td>
                        <div class="action-buttons">
                          <button
                            class="btn-icon-action"
                            [class.btn-stop-action]="rule.enabled"
                            [class.btn-start-action]="!rule.enabled"
                            (click)="toggleRule(rule)"
                            [title]="rule.enabled ? 'Disable rule' : 'Enable rule'"
                            [attr.aria-label]="rule.enabled ? 'Disable rule' : 'Enable rule'">
                            <i class="fas" [class.fa-pause]="rule.enabled" [class.fa-play]="!rule.enabled"></i>
                          </button>
                          <button class="btn-icon-action btn-edit-scanning" (click)="openEditRule(rule)" title="Edit rule" aria-label="Edit rule">
                            <i class="fas fa-pen"></i>
                          </button>
                          <button class="btn-icon-action btn-delete-scanning" (click)="deleteRule(rule)" title="Delete rule" aria-label="Delete rule">
                            <i class="fas fa-trash"></i>
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </section>
      }

      @if (isEditorOpen()) {
        <app-topic-alerting-editor-modal
          [mode]="editorMode()"
          [topics]="topics()"
          [groups]="groups()"
          [group]="editingGroup()"
          [rule]="editingRule()"
          (close)="closeEditor()"
          (saved)="onEditorSaved()"
        />
      }
      @if (isTopicsModalOpen()) {
        <div class="overlay" (click)="closeTopicsModal()">
          <div class="modal topics-list-modal" (click)="$event.stopPropagation()">
            <div class="modal-header">
              <div class="modal-title-block">
                <h3>{{ topicsModalTitle() }}</h3>
                <p>Topics ({{ topicsModalItems().length }})</p>
              </div>
              <button class="modal-close" (click)="closeTopicsModal()" aria-label="Close">&times;</button>
            </div>
            <div class="modal-body">
              @if (topicsModalItems().length === 0) {
                <div class="empty-state">No topics available.</div>
              } @else {
                <div class="topics-modal-list">
                  @for (topic of topicsModalItems(); track $index) {
                    <div class="topics-modal-item">{{ topic }}</div>
                  }
                </div>
              }
            </div>
            <div class="footer">
              <button class="btn-secondary" (click)="closeTopicsModal()">Close</button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .list-page { display: flex; flex-direction: column; gap: 0.9rem; }
    .toolbar { display: flex; align-items: center; justify-content: flex-start; }
    .tab-segmented {
      display: inline-grid;
      grid-template-columns: repeat(2, minmax(150px, 1fr));
      gap: 0.35rem;
      border: 1px solid #d5dde8;
      border-radius: 12px;
      padding: 0.24rem;
      background: var(--theme-bg-app);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }
    .tab-btn {
      border: 1px solid transparent;
      background: transparent;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      padding: 0.5rem 0.8rem;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      border-radius: 9px;
      transition: all 0.18s ease;
    }
    .tab-btn:hover { background: rgba(255, 255, 255, 0.65); }
    .tab-btn.active {
      background: var(--theme-button-primary);
      border-color: #fbbf24;
      color: #ffffff;
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.24);
    }
    .tab-btn.active .icon-groups,
    .tab-btn.active .icon-rules { color: #ffffff; }
    .tab-count {
      border-radius: 999px;
      min-width: 22px;
      height: 22px;
      padding: 0 0.42rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      background: var(--theme-bg-teal-lighter);
      color: var(--theme-text-dark);
    }
    .tab-btn.active .tab-count { background: rgba(255, 255, 255, 0.18); color: #ffffff; border: 1px solid rgba(255, 255, 255, 0.3); }
    .filter-input { border: 1px solid var(--theme-border-gray); border-radius: 8px; padding: 0.45rem 0.6rem; background: var(--theme-bg-surface); color: var(--theme-text-dark); font-size: var(--theme-font-table-header); }
    .panel { border: 1px solid #dbe4ee; border-radius: 14px; padding: 1rem; background: var(--theme-bg-surface); box-shadow: 0 8px 20px rgba(15, 23, 42, 0.06); }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 0.6rem; margin-bottom: 0.75rem; }
    .action-legend {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
      gap: 0.6rem;
      margin: 0.2rem 0 0.72rem;
      padding-right: 5rem;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      width: 100%;
    }
    .legend-item { display: inline-flex; align-items: center; gap: 0.28rem; }
    .legend-icon { font-size: var(--theme-font-caption); }
    .legend-enable { color: #059669; }
    .legend-disable { color: #b91c1c; }
    .legend-edit { color: var(--theme-button-primary); }
    .legend-delete { color: #b91c1c; }
    .section-filter { flex: 1; max-width: none; min-width: 260px; }
    .section-actions { display: inline-flex; align-items: center; gap: 0.45rem; }
    .table-wrap {
      overflow-x: auto;
      overflow-y: auto;
      min-height: clamp(400px, 58vh, 620px);
      max-height: clamp(500px, 62vh, 680px);
      border: 1px solid var(--theme-border-gray-light);
      border-radius: 10px;
      position: relative;
    }
    .data-table { width: 100%; border-collapse: collapse; min-width: 820px; }
    .groups-table { min-width: 920px; }
    .groups-table th:nth-child(1), .groups-table td:nth-child(1) { width: 20%; }
    .groups-table th:nth-child(2), .groups-table td:nth-child(2) { width: 56%; }
    .groups-table th:nth-child(3), .groups-table td:nth-child(3) { width: 14%; }
    .groups-table th:nth-child(4), .groups-table td:nth-child(4) { width: 10%; }
    .rules-table { min-width: 960px; }
    .rules-table th:nth-child(1), .rules-table td:nth-child(1) { width: 20%; }
    .rules-table th:nth-child(2), .rules-table td:nth-child(2) { width: 38%; }
    .rules-table th:nth-child(3), .rules-table td:nth-child(3) { width: 22%; }
    .rules-table th:nth-child(4), .rules-table td:nth-child(4) { width: 10%; }
    .rules-table th:nth-child(5), .rules-table td:nth-child(5) { width: 10%; }
    .data-table th { text-align: left; background: var(--theme-bg-app); color: var(--theme-table-header-color); font-size: var(--theme-font-table-header); padding: 0.58rem 0.55rem; border-bottom: 1px solid var(--theme-border-gray-light); text-transform: uppercase; position: sticky; top: 0; z-index: 4; }
    .data-table th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }
    .data-table th.sortable i { margin-left: 0.35rem; font-size: var(--theme-font-caption); opacity: 0.7; }
    .data-table th.sortable:hover { background: var(--theme-bg-app); }
    .data-table th.sortable.active-sort {
      color: var(--theme-text-dark);
      background: var(--theme-bg-teal-lighter);
    }
    .data-table th.sortable.active-sort i {
      opacity: 1;
      color: var(--theme-text-teal-dark);
    }
    .data-table td { padding: 0.58rem 0.55rem; border-bottom: 1px solid var(--theme-border-gray-light); color: var(--theme-table-body-color); font-size: var(--theme-font-table-body); vertical-align: middle; }
    .main-text { font-weight: var(--theme-font-table-header-weight); color: var(--theme-text-dark); }
    .sub-text { font-size: var(--theme-font-caption); color: var(--theme-text-gray); margin-top: 0.15rem; }
    .cell-chip-wrap { display: flex; flex-wrap: wrap; gap: 0.28rem; }
    .topics-cell {
      position: relative;
      display: flex;
      flex-direction: row;
      align-items: center;
      gap: 0.45rem;
      min-height: 24px;
    }
    .target-label { margin-top: 0; }
    .cell-chip { border: 1px solid var(--theme-border-gray); border-radius: 999px; background: var(--theme-bg-app); color: var(--theme-table-header-color); font-size: var(--theme-font-caption); padding: 0.15rem 0.45rem; font-weight: var(--theme-font-table-header-weight); }
    .cell-chip.neutral { background: var(--theme-bg-surface); }
    .cell-more { color: var(--theme-text-gray); font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .action-buttons { display: inline-flex; gap: 0.35rem; align-items: center; }
    .btn-primary { border: 1px solid #10b981; background: #10b981; color: #fff; border-radius: 8px; padding: 0.4rem 0.65rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .btn-secondary { border: 1px solid var(--theme-border-gray); background: var(--theme-bg-surface); color: var(--theme-table-header-color); border-radius: 8px; padding: 0.35rem 0.55rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .btn-secondary.small { padding: 0.25rem 0.5rem; font-size: var(--theme-font-caption); }
    .view-list-btn { flex: 0 0 auto; margin-left: 0.1rem; }
    .btn-danger { border: 1px solid #ef4444; background: #fff1f2; color: #b91c1c; border-radius: 8px; padding: 0.35rem 0.55rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .btn-icon-action {
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid #d1d5db;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      border-radius: 6px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
      font-size: var(--theme-font-table-header);
      line-height: 1;
    }
    .btn-icon-action:hover {
      background-color: var(--theme-bg-app);
      transform: translateY(-1px);
      box-shadow: 0 4px 8px rgba(148, 163, 184, 0.25);
    }
    .btn-icon-action.btn-start-action { color: #059669; }
    .btn-icon-action.btn-start-action:hover { border-color: #059669; }
    .btn-icon-action.btn-stop-action { color: #b91c1c; }
    .btn-icon-action.btn-stop-action:hover { border-color: #b91c1c; }
    .btn-icon-action.btn-edit-scanning {
      color: var(--theme-button-primary);
    }
    .btn-icon-action.btn-edit-scanning:hover {
      border-color: var(--theme-button-primary);
      color: var(--theme-button-primary-hover, #851697);
    }
    .btn-icon-action.btn-delete-scanning { color: #b91c1c; }
    .btn-icon-action.btn-delete-scanning:hover { border-color: #b91c1c; }
    .btn-icon-action.btn-view-topics-scanning { color: #059669; }
    .btn-icon-action.btn-view-topics-scanning:hover { border-color: #059669; }
    .overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      height: calc(100vh * 20);
      background: rgba(0, 0, 0, 0.5);
      z-index: var(--z-modal-backdrop, 1000000);
      pointer-events: auto;
      overflow-y: auto;
      padding: 1rem;
    }
    .modal {
      width: min(860px, 95vw);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      background: var(--theme-bg-app);
      border-radius: 12px;
      border: 1px solid var(--theme-border-gray-light);
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
      pointer-events: auto;
      margin: 5vh auto 0;
      position: relative;
      z-index: var(--z-modal-content, 1000001);
    }
    .topics-list-modal { width: min(760px, 92vw); }
    .modal-header {
      padding: 0.9rem 1.25rem;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 1px solid rgba(255, 255, 255, 0.2);
      background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
      color: #fff;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    }
    .modal-title-block { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
    .modal-header h3 { margin: 0; color: #fff; font-size: var(--theme-font-section-title); font-weight: var(--theme-font-table-header-weight); }
    .modal-title-block p { margin: 0; color: rgba(255, 255, 255, 0.92); font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-body-weight); }
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
    .modal-close:hover { background-color: rgba(255, 255, 255, 0.2); color: white; }
    .modal-body { padding: 0.95rem 1.15rem; overflow-y: auto; display: flex; flex-direction: column; gap: 0.75rem; background: var(--theme-bg-app); }
    .footer { padding: 0.8rem 1rem; border-top: 1px solid var(--theme-border-gray-light); display: flex; gap: 0.5rem; justify-content: flex-end; background: var(--theme-bg-app); }
    .topics-modal-list {
      max-height: 54vh;
      overflow: auto;
      border: 1px solid #dbe7f5;
      border-radius: 10px;
      background: var(--theme-bg-app);
      padding: 0.65rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.42rem;
    }
    .topics-modal-item {
      border: 1px solid var(--theme-border-gray);
      border-radius: 999px;
      background: var(--theme-bg-surface);
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-caption);
      padding: 0.22rem 0.52rem;
      font-weight: var(--theme-font-table-header-weight);
    }
    .skeleton-row { pointer-events: none; }
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
      vertical-align: middle;
    }
    .sk-name { width: min(70%, 260px); height: 12px; display: block; }
    .sk-sub { width: min(45%, 180px); height: 10px; display: block; margin-top: 0.28rem; }
    .sk-chip { width: 86px; height: 22px; margin-right: 0.28rem; border-radius: 999px; }
    .sk-date { width: 110px; height: 12px; }
    .sk-status { width: 72px; height: 24px; border-radius: 8px; }
    .sk-action { width: 116px; height: 24px; border-radius: 8px; }
    @keyframes table-skeleton-shimmer {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    .empty-state { color: var(--theme-text-gray); font-size: var(--theme-font-table-header); padding: 0.8rem; text-align: center; }
    .error-banner { border: 1px solid #fecaca; background: #fff1f2; color: #b91c1c; border-radius: 8px; padding: 0.4rem 0.55rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .success-banner { border: 1px solid #86efac; background: #f0fdf4; color: #166534; border-radius: 8px; padding: 0.4rem 0.55rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .icon-groups { color: var(--theme-icon-kubernetes, #10b981); }
    .icon-rules { color: var(--theme-icon-alert, #f59e0b); }
  `],
})
export class TopicAlertingListPageComponent {
  readonly tabChange = output<AlertTab>();
  readonly topics = input<string[]>([]);
  readonly initialTab = input<AlertTab>('groups');

  private readonly api = inject(TopicAlertingApiService);

  readonly groups = signal<TopicAlertGroup[]>([]);
  readonly rules = signal<TopicAlertRule[]>([]);
  readonly isLoadingGroups = signal(false);
  readonly isLoadingRules = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly filterText = signal('');
  readonly activeTab = signal<AlertTab>('groups');

  readonly isEditorOpen = signal(false);
  readonly editorMode = signal<EditorMode>('group');
  readonly editingGroup = signal<TopicAlertGroup | null>(null);
  readonly editingRule = signal<TopicAlertRule | null>(null);
  readonly skeletonRows = [1, 2, 3, 4, 5];
  readonly isTopicsModalOpen = signal(false);
  readonly topicsModalItems = signal<string[]>([]);
  readonly topicsModalTitle = signal('Topics');
  readonly groupSortColumn = signal<GroupSortColumn>('updated');
  readonly groupSortDirection = signal<SortDirection>('desc');
  readonly ruleSortColumn = signal<RuleSortColumn>('updated');
  readonly ruleSortDirection = signal<SortDirection>('desc');
  private refreshDelayTimer?: ReturnType<typeof setTimeout>;

  readonly filteredGroups = computed(() => {
    const q = this.filterText().trim().toLowerCase();
    if (!q) {
      return this.sortGroups(this.groups());
    }
    const filtered = this.groups().filter((group) =>
      group.name.toLowerCase().includes(q) ||
      (group.description ?? '').toLowerCase().includes(q) ||
      (group.topicNames ?? []).some((topic) => topic.toLowerCase().includes(q))
    );
    return this.sortGroups(filtered);
  });

  readonly filteredRules = computed(() => {
    const q = this.filterText().trim().toLowerCase();
    if (!q) {
      return this.sortRules(this.rules());
    }
    const filtered = this.rules().filter((rule) =>
      rule.name.toLowerCase().includes(q) ||
      (rule.topicNames ?? []).some((topic) => topic.toLowerCase().includes(q)) ||
      (rule.recipientEmails ?? []).some((email) => email.toLowerCase().includes(q))
    );
    return this.sortRules(filtered);
  });

  constructor() {
    effect(() => {
      this.activeTab.set(this.initialTab());
    });
    this.loadGroups();
    this.loadRules();
  }

  selectedTab(): AlertTab {
    return this.activeTab();
  }

  setTab(tab: AlertTab): void {
    this.closeTopicsModal();
    this.activeTab.set(tab);
    this.tabChange.emit(tab);
  }

  setGroupSort(column: GroupSortColumn): void {
    if (this.groupSortColumn() === column) {
      this.groupSortDirection.set(this.groupSortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }
    this.groupSortColumn.set(column);
    this.groupSortDirection.set(column === 'updated' ? 'desc' : 'asc');
  }

  setRuleSort(column: RuleSortColumn): void {
    if (this.ruleSortColumn() === column) {
      this.ruleSortDirection.set(this.ruleSortDirection() === 'asc' ? 'desc' : 'asc');
      return;
    }
    this.ruleSortColumn.set(column);
    this.ruleSortDirection.set(column === 'updated' ? 'desc' : 'asc');
  }

  openCreate(): void {
    this.closeTopicsModal();
    this.errorMessage.set('');
    this.editorMode.set(this.selectedTab() === 'groups' ? 'group' : 'rule');
    this.editingGroup.set(null);
    this.editingRule.set(null);
    this.isEditorOpen.set(true);
  }

  openEditGroup(group: TopicAlertGroup): void {
    this.closeTopicsModal();
    this.errorMessage.set('');
    this.editorMode.set('group');
    this.editingGroup.set(group);
    this.editingRule.set(null);
    this.isEditorOpen.set(true);
  }

  openEditRule(rule: TopicAlertRule): void {
    this.closeTopicsModal();
    this.errorMessage.set('');
    this.editorMode.set('rule');
    this.editingRule.set(rule);
    this.editingGroup.set(null);
    this.isEditorOpen.set(true);
  }

  closeEditor(): void {
    this.closeTopicsModal();
    this.isEditorOpen.set(false);
    this.editingGroup.set(null);
    this.editingRule.set(null);
  }

  onEditorSaved(): void {
    this.closeEditor();
    this.successMessage.set(this.selectedTab() === 'groups' ? 'Group saved successfully.' : 'Rule saved successfully.');
    this.scheduleRefresh('both');
  }

  deleteGroup(group: TopicAlertGroup): void {
    this.errorMessage.set('');
    if (!window.confirm(`Delete group "${group.name}"?`)) {
      return;
    }
    this.api.deleteGroup(group.groupId).subscribe({
      next: () => {
        this.successMessage.set('Group deleted successfully.');
        this.scheduleRefresh('both');
      },
      error: () => this.errorMessage.set('Failed to delete group.'),
    });
  }

  deleteRule(rule: TopicAlertRule): void {
    this.errorMessage.set('');
    if (!window.confirm(`Delete rule "${rule.name}"?`)) {
      return;
    }
    this.api.deleteRule(rule.ruleId).subscribe({
      next: () => {
        this.successMessage.set('Rule deleted successfully.');
        this.scheduleRefresh('rules');
      },
      error: () => this.errorMessage.set('Failed to delete rule.'),
    });
  }

  toggleRule(rule: TopicAlertRule): void {
    this.closeTopicsModal();
    this.errorMessage.set('');
    this.api.setRuleEnabled(rule.ruleId, !rule.enabled).subscribe({
      next: () => {
        this.successMessage.set(`Rule "${rule.name}" is now ${rule.enabled ? 'disabled' : 'enabled'}.`);
        this.scheduleRefresh('rules');
      },
      error: () => this.errorMessage.set('Failed to update rule status.'),
    });
  }

  refreshCurrentTab(): void {
    this.closeTopicsModal();
    if (this.selectedTab() === 'rules') {
      this.refreshRulesOnly();
      return;
    }
    this.refreshGroupsOnly();
  }

  refreshGroupsOnly(): void {
    this.closeTopicsModal();
    this.errorMessage.set('');
    this.loadGroups();
  }

  refreshRulesOnly(): void {
    this.closeTopicsModal();
    this.errorMessage.set('');
    this.loadRules();
  }

  resolveGroupName(groupId?: string | null): string {
    if (!groupId) {
      return 'Unknown group';
    }
    return this.groups().find((item) => item.groupId === groupId)?.name ?? groupId;
  }

  formatUtc(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  }

  getRuleTargetTopics(rule: TopicAlertRule): string[] {
    if (rule.targetType === 'group') {
      const group = this.groups().find((item) => item.groupId === rule.topicGroupId);
      return group?.topicNames ?? [];
    }
    return rule.topicNames ?? [];
  }

  openTopicsModal(topics: string[], title: string): void {
    this.topicsModalItems.set((topics ?? []).filter((item) => !!item));
    this.topicsModalTitle.set(title);
    this.isTopicsModalOpen.set(true);
  }

  closeTopicsModal(): void {
    this.isTopicsModalOpen.set(false);
    this.topicsModalItems.set([]);
  }

  private sortGroups(groups: TopicAlertGroup[]): TopicAlertGroup[] {
    const column = this.groupSortColumn();
    const direction = this.groupSortDirection();
    const sorted = [...groups].sort((a, b) => {
      if (column === 'name') {
        return a.name.localeCompare(b.name);
      }
      return this.toTimestamp(a.updatedAtUtc) - this.toTimestamp(b.updatedAtUtc);
    });
    return direction === 'asc' ? sorted : sorted.reverse();
  }

  private sortRules(rules: TopicAlertRule[]): TopicAlertRule[] {
    const column = this.ruleSortColumn();
    const direction = this.ruleSortDirection();
    const sorted = [...rules].sort((a, b) => {
      if (column === 'name') {
        return a.name.localeCompare(b.name);
      }
      return this.toTimestamp(a.updatedAtUtc) - this.toTimestamp(b.updatedAtUtc);
    });
    return direction === 'asc' ? sorted : sorted.reverse();
  }

  private toTimestamp(value: string): number {
    const ts = new Date(value).getTime();
    return Number.isNaN(ts) ? 0 : ts;
  }

  private scheduleRefresh(scope: 'groups' | 'rules' | 'both'): void {
    if (this.refreshDelayTimer) {
      clearTimeout(this.refreshDelayTimer);
      this.refreshDelayTimer = undefined;
    }

    this.refreshDelayTimer = setTimeout(() => {
      if (scope === 'groups') {
        this.loadGroups();
      } else if (scope === 'rules') {
        this.loadRules();
      } else {
        this.loadGroups();
        this.loadRules();
      }
    }, 1500);
  }

  private loadGroups(): void {
    this.isLoadingGroups.set(true);
    this.api.getGroups().subscribe({
      next: (groups) => {
        this.groups.set(groups ?? []);
        this.isLoadingGroups.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to load groups.');
        this.isLoadingGroups.set(false);
      },
    });
  }

  private loadRules(): void {
    this.isLoadingRules.set(true);
    this.api.getRules().subscribe({
      next: (rules) => {
        this.rules.set(rules ?? []);
        this.isLoadingRules.set(false);
      },
      error: () => {
        this.errorMessage.set('Failed to load rules.');
        this.isLoadingRules.set(false);
      },
    });
  }
}
