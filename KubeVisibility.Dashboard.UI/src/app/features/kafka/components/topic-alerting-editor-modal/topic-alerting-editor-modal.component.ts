import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TopicAlertingApiService } from '../../../../core/services/api/topic-alerting-api.service';
import {
  TopicAlertCondition,
  TopicAlertGroup,
  TopicAlertRule,
  UpsertTopicAlertGroupRequest,
  UpsertTopicAlertRuleRequest,
} from '../../../../core/models/topic-alerting.models';

type EditorMode = 'group' | 'rule';
type TargetType = 'topics' | 'group';
type RuleWizardStep = 1 | 2 | 3;

interface RuleConditionForm {
  joinWithPrevious: 'AND' | 'OR';
  negate: boolean;
  field: 'message' | 'exception' | 'serviceName' | 'applicationName';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'wildcard';
  value: string;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-topic-alerting-editor-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="overlay" (click)="close.emit()">
      <div class="modal" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title-block">
            <h3>{{ title() }}</h3>
            <p>{{ mode() === 'group' ? 'Configure reusable topic groups.' : 'Configure rule target, conditions, and recipients.' }}</p>
          </div>
          <button class="modal-close" (click)="close.emit()" aria-label="Close">&times;</button>
        </div>

        <div class="modal-body">
          @if (errorMessage()) {
            <div class="error-banner">{{ errorMessage() }}</div>
          }

          @if (mode() === 'group') {
            <div class="form-grid">
              <label>
                Name
                <input type="text" [(ngModel)]="groupName" />
              </label>
              <label>
                Description
                <input type="text" [(ngModel)]="groupDescription" />
              </label>
            </div>
            <div class="topic-picker-card">
              <div class="topic-picker-header">
                <label class="topic-picker-label">Select topics</label>
                <div class="topic-picker-actions">
                  <button type="button" class="btn-secondary small" (click)="selectAllGroupTopics()">Select all</button>
                  <button type="button" class="btn-secondary small" (click)="clearGroupTopics()">Clear</button>
                </div>
              </div>
              <input
                type="text"
                [ngModel]="groupTopicSearch()"
                (ngModelChange)="groupTopicSearch.set($event ?? '')"
                placeholder="Search topics..."
              />
              @if (groupSelectedTopics().length > 0) {
                <div class="selected-chips">
                  @for (topic of groupSelectedTopics(); track topic) {
                    <button type="button" class="chip" (click)="toggleGroupTopic(topic)">
                      {{ topic }} <span>&times;</span>
                    </button>
                  }
                </div>
              }
              <div class="topic-options">
                @for (topic of filteredGroupTopicOptions(); track topic) {
                  <label class="topic-option">
                    <input
                      type="checkbox"
                      [ngModel]="groupSelectedTopics().includes(topic)"
                      (ngModelChange)="toggleGroupTopic(topic)"
                    />
                    <span>{{ topic }}</span>
                  </label>
                }
              </div>
            </div>
            @if (groupValidationError()) {
              <div class="field-error">{{ groupValidationError() }}</div>
            }
          } @else {
            <div class="wizard-stepper">
              <button type="button" class="wizard-step" [class.active]="ruleWizardStep() === 1" (click)="goToRuleStep(1)"><span>1</span> Target</button>
              <button type="button" class="wizard-step" [class.active]="ruleWizardStep() === 2" (click)="goToRuleStep(2)"><span>2</span> Conditions</button>
              <button type="button" class="wizard-step" [class.active]="ruleWizardStep() === 3" (click)="goToRuleStep(3)"><span>3</span> Recipients</button>
            </div>

            @if (ruleWizardStep() === 1) {
              <div class="step-one-stack">
                <label>
                  Name
                  <input type="text" [(ngModel)]="ruleName" />
                </label>
                <label>
                  Target Type
                  <select [(ngModel)]="ruleTargetType">
                    <option value="topics">Topics</option>
                    <option value="group">Group</option>
                  </select>
                </label>
                @if (ruleTargetType === 'group') {
                  <label>
                    Group
                    <select [(ngModel)]="ruleTopicGroupId">
                      <option value="">Select group</option>
                      @for (group of groups(); track group.groupId) {
                        <option [value]="group.groupId">{{ group.name }}</option>
                      }
                    </select>
                  </label>
                } @else {
                  <div class="topic-picker-card">
                    <div class="topic-picker-header">
                      <label class="topic-picker-label">Select topics</label>
                      <div class="topic-picker-actions">
                        <button type="button" class="btn-secondary small" (click)="selectAllRuleTopics()">Select all</button>
                        <button type="button" class="btn-secondary small" (click)="clearRuleTopics()">Clear</button>
                      </div>
                    </div>
                    <input
                      type="text"
                      [ngModel]="ruleTopicSearch()"
                      (ngModelChange)="ruleTopicSearch.set($event ?? '')"
                      placeholder="Search topics..."
                    />
                    @if (ruleSelectedTopics().length > 0) {
                      <div class="selected-chips">
                        @for (topic of ruleSelectedTopics(); track topic) {
                          <button type="button" class="chip" (click)="toggleRuleTopic(topic)">
                            {{ topic }} <span>&times;</span>
                          </button>
                        }
                      </div>
                    }
                    <div class="topic-options">
                      @for (topic of filteredRuleTopicOptions(); track topic) {
                        <label class="topic-option">
                          <input type="checkbox" [ngModel]="ruleSelectedTopics().includes(topic)" (ngModelChange)="toggleRuleTopic(topic)" />
                          <span>{{ topic }}</span>
                        </label>
                      }
                    </div>
                  </div>
                }
                <div class="enabled-row">
                  <label class="checkbox-label stacked">
                    <input type="checkbox" [(ngModel)]="ruleEnabled" />
                    Enabled
                  </label>
                </div>
              </div>
            }

            @if (ruleWizardStep() === 2) {
              <div class="conditions">
                <div class="conditions-header">
                  <h5>Conditions</h5>
                  <div class="conditions-header-actions">
                    <button class="btn-secondary" (click)="addCondition()">Add Condition</button>
                    @if (hasWildcardOperator() && !showWildcardHints()) {
                      <button type="button" class="btn-secondary small" (click)="showWildcardHints.set(true)">Show wildcard help</button>
                    }
                  </div>
                </div>
                @for (condition of conditionForms(); track $index) {
                  @if ($index > 0) {
                    <div class="condition-join-row">
                      <span class="condition-join-label">Join with previous</span>
                      <select [(ngModel)]="condition.joinWithPrevious">
                        <option value="AND">AND</option>
                        <option value="OR">OR</option>
                      </select>
                    </div>
                  }
                  <div class="condition-row">
                    <label class="checkbox-label small">
                      <input type="checkbox" [(ngModel)]="condition.negate" />
                      NOT
                    </label>
                    <select [(ngModel)]="condition.field">
                      <option value="message">message</option>
                      <option value="exception">exception</option>
                      <option value="serviceName">serviceName</option>
                      <option value="applicationName">applicationName</option>
                    </select>
                    <select [(ngModel)]="condition.operator">
                      <option value="contains">contains</option>
                      <option value="equals">equals</option>
                      <option value="startsWith">startsWith</option>
                      <option value="endsWith">endsWith</option>
                      <option value="wildcard">wildcard</option>
                    </select>
                    <input type="text" [(ngModel)]="condition.value" placeholder="match text" />
                    <button class="btn-danger small" (click)="removeCondition($index)">X</button>
                  </div>
                }
                @if (hasWildcardOperator() && showWildcardHints()) {
                  <div class="wildcard-help">
                    <div class="wildcard-help-header">
                      <div class="wildcard-help-title">Wildcard examples</div>
                      <button type="button" class="wildcard-help-dismiss" (click)="showWildcardHints.set(false)" aria-label="Hide wildcard help">&times;</button>
                    </div>
                    <div><code>abc*</code> starts with <b>abc</b></div>
                    <div><code>*abc*</code> contains <b>abc</b></div>
                    <div><code>ERR-202?-*</code> <code>?</code> = single character, <code>*</code> = any length</div>
                  </div>
                }
              </div>
            }

            @if (ruleWizardStep() === 3) {
              <label>
                Recipient emails
                <div class="recipient-picker-card">
                  <div class="recipient-input-row">
                    <input
                      type="text"
                      [(ngModel)]="ruleRecipientInput"
                      (keydown.enter)="addRecipientFromInput($event)"
                      (paste)="handleRecipientPaste($event)"
                      (blur)="addRecipientFromInput()"
                      placeholder="Type email and press Enter (or Add)"
                    />
                    <button type="button" class="btn-secondary small" (click)="addRecipientFromInput($event)">Add</button>
                    <button type="button" class="btn-secondary small" (click)="clearRecipients()" [disabled]="ruleRecipientEmails().length === 0">Clear</button>
                  </div>
                  @if (ruleRecipientInputError()) {
                    <div class="field-error">{{ ruleRecipientInputError() }}</div>
                  }
                  @if (ruleRecipientEmails().length > 0) {
                    <div class="selected-chips">
                      @for (email of ruleRecipientEmails(); track email) {
                        <button type="button" class="chip" (click)="removeRecipient(email)" [title]="'Remove ' + email">
                          {{ email }} <span>&times;</span>
                        </button>
                      }
                    </div>
                  } @else {
                    <div class="empty-recipients">No recipients added yet.</div>
                  }
                </div>
              </label>
              @if (showValidationHints() && invalidEmails().length > 0) {
                <div class="field-error">Invalid email(s): {{ invalidEmails().join(', ') }}</div>
              }
            }
          }
        </div>

        <div class="footer">
          @if (mode() === 'rule' && ruleWizardStep() > 1) {
            <button class="btn-secondary" [disabled]="isSaving()" (click)="goToRuleStep(ruleWizardStep() - 1)">Back</button>
          }
          @if (mode() === 'rule' && ruleWizardStep() < 3) {
            <button class="btn-primary" [disabled]="isSaving() || !canGoToNextRuleStep()" (click)="goToRuleStep(ruleWizardStep() + 1)">Next</button>
          } @else {
            <button class="btn-primary" [disabled]="isSaving()" (click)="save()">{{ isSaving() ? 'Saving...' : saveLabel() }}</button>
          }
          <button class="btn-secondary" [disabled]="isSaving()" (click)="close.emit()">Cancel</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
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
      width: min(1100px, 95vw);
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
    .form-grid { display: grid; gap: 0.65rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .form-grid label, .modal-body > label { display: flex; flex-direction: column; gap: 0.3rem; color: var(--theme-table-header-color); font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .step-one-stack { display: flex; flex-direction: column; gap: 0.65rem; }
    .step-one-stack > label { display: flex; flex-direction: column; gap: 0.3rem; color: var(--theme-table-header-color); font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .enabled-row { display: flex; justify-content: flex-end; align-items: center; margin-top: 0.1rem; }
    .enabled-row .checkbox-label { font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); color: var(--theme-table-header-color); }
    input, select { border: 1px solid var(--theme-border-gray); border-radius: 8px; padding: 0.45rem 0.55rem; font-size: var(--theme-font-table-header); background: var(--theme-bg-surface); color: var(--theme-text-dark); }
    .checkbox-label { display: inline-flex !important; flex-direction: row !important; align-items: center; gap: 0.45rem; margin-top: 1.5rem; }
    .checkbox-label.stacked { margin-top: 0; align-self: flex-start; }
    .checkbox-label.small { margin-top: 0; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
    .topic-picker-card { border: 1px solid #dbe7f5; border-radius: 10px; padding: 0.65rem; display: flex; flex-direction: column; gap: 0.45rem; background: var(--theme-bg-app); }
    .topic-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 0.45rem; }
    .topic-picker-actions { display: inline-flex; gap: 0.35rem; }
    .topic-picker-label { font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); color: var(--theme-table-header-color); letter-spacing: normal; }
    .topic-options { max-height: 350px; overflow: auto; border: 1px solid var(--theme-border-gray-light); border-radius: 8px; background: var(--theme-bg-surface); }
    .topic-option { display: flex; flex-direction: row !important; gap: 0.45rem; align-items: center; justify-content: flex-start; padding: 0.35rem 0.45rem; font-size: var(--theme-font-caption); color: var(--theme-table-header-color); }
    .topic-option input[type='checkbox'] { width: 14px; height: 14px; margin: 0; flex: 0 0 14px; }
    .topic-option span { line-height: 1.2; display: inline-block; font-weight: var(--theme-font-table-header-weight); color: var(--theme-text-dark); }
    .selected-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; }
    .chip { border: 1px solid var(--theme-border-gray); border-radius: 999px; background: var(--theme-bg-surface); color: var(--theme-table-header-color); padding: 0.2rem 0.5rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .recipient-picker-card { border: 1px solid #dbe7f5; border-radius: 10px; padding: 0.65rem; display: flex; flex-direction: column; gap: 0.45rem; background: var(--theme-bg-app); }
    .recipient-input-row { display: flex; align-items: center; gap: 0.35rem; }
    .recipient-input-row input { flex: 1; min-width: 220px; }
    .empty-recipients { font-size: var(--theme-font-caption); color: var(--theme-text-gray); font-weight: var(--theme-font-table-header-weight); }
    .wizard-stepper { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.5rem; }
    .wizard-step { border: 1px solid var(--theme-border-gray); background: var(--theme-bg-app); color: var(--theme-table-header-color); border-radius: 8px; padding: 0.4rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); display: inline-flex; align-items: center; gap: 0.35rem; justify-content: center; cursor: pointer; }
    .wizard-step span { width: 18px; height: 18px; border-radius: 50%; background: var(--theme-bg-teal-lighter); color: var(--theme-text-dark); display: inline-flex; align-items: center; justify-content: center; font-size: var(--theme-font-caption); }
    .wizard-step.active { border-color: var(--theme-button-primary); background: var(--theme-bg-teal-lighter); color: var(--theme-text-teal-dark); }
    .wizard-step.active span { background: var(--theme-button-primary); color: #fff; }
    .conditions { border: 1px solid var(--theme-border-gray-light); border-radius: 10px; padding: 0.65rem; background: var(--theme-bg-app); display: flex; flex-direction: column; gap: 0.5rem; }
    .conditions-header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
    .conditions-header-actions { display: inline-flex; align-items: center; gap: 0.4rem; }
    .conditions-header h5 { margin: 0; font-size: var(--theme-font-table-header); color: var(--theme-text-dark); }
    .condition-join-row { display: inline-flex; align-items: center; gap: 0.45rem; align-self: flex-start; margin-top: 0.1rem; }
    .condition-join-label { font-size: var(--theme-font-caption); color: var(--theme-text-gray); font-weight: var(--theme-font-table-header-weight); }
    .condition-join-row select { min-width: 84px; font-size: var(--theme-font-caption); padding: 0.28rem 0.42rem; }
    .condition-row { display: grid; grid-template-columns: 90px 130px 130px 1fr auto; gap: 0.4rem; align-items: center; }
    .wildcard-help { border: 1px dashed #93c5fd; background: var(--theme-bg-teal-lighter); border-radius: 8px; padding: 0.5rem 0.6rem; color: #1e3a8a; font-size: var(--theme-font-caption); display: flex; flex-direction: column; gap: 0.2rem; }
    .wildcard-help-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
    .wildcard-help-title { font-weight: var(--theme-font-table-header-weight); color: var(--theme-text-teal-dark); margin-bottom: 0.1rem; }
    .wildcard-help code { background: var(--theme-bg-teal-lighter); border: 1px solid #bfdbfe; border-radius: 5px; padding: 0.02rem 0.25rem; font-size: var(--theme-font-caption); color: #1e3a8a; }
    .wildcard-help-dismiss { border: 1px solid #bfdbfe; background: var(--theme-bg-surface); color: var(--theme-text-teal-dark); width: 20px; height: 20px; border-radius: 999px; line-height: 1; font-size: var(--theme-font-body); font-weight: var(--theme-font-table-header-weight); cursor: pointer; padding: 0; }
    .btn-primary { border: 1px solid var(--theme-button-primary); background: var(--theme-button-primary); color: #fff; border-radius: 8px; padding: 0.42rem 0.65rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .btn-secondary { border: 1px solid var(--theme-border-gray); background: var(--theme-bg-surface); color: var(--theme-table-header-color); border-radius: 8px; padding: 0.42rem 0.65rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .btn-danger { border: 1px solid #ef4444; background: #fff1f2; color: #b91c1c; border-radius: 8px; padding: 0.42rem 0.65rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); cursor: pointer; }
    .btn-secondary.small, .btn-danger.small { padding: 0.22rem 0.45rem; font-size: var(--theme-font-caption); }
    .error-banner, .field-error { border: 1px solid #fecaca; background: #fff1f2; color: #b91c1c; border-radius: 8px; padding: 0.42rem 0.55rem; font-size: var(--theme-font-caption); font-weight: var(--theme-font-table-header-weight); }
  `],
})
export class TopicAlertingEditorModalComponent {
  readonly close = output<void>();
  readonly saved = output<void>();
  readonly mode = input<EditorMode>('group');
  readonly topics = input<string[]>([]);
  readonly groups = input<TopicAlertGroup[]>([]);
  readonly group = input<TopicAlertGroup | null>(null);
  readonly rule = input<TopicAlertRule | null>(null);

  private readonly api = inject(TopicAlertingApiService);

  readonly showValidationHints = signal(false);
  readonly showWildcardHints = signal(true);
  readonly errorMessage = signal('');
  readonly isSaving = signal(false);

  groupName = '';
  groupDescription = '';
  readonly groupTopicSearch = signal('');
  readonly groupSelectedTopics = signal<string[]>([]);
  readonly groupValidationError = signal('');

  ruleName = '';
  ruleEnabled = true;
  ruleTargetType: TargetType = 'topics';
  readonly ruleTopicSearch = signal('');
  readonly ruleSelectedTopics = signal<string[]>([]);
  ruleTopicGroupId = '';
  readonly ruleRecipientEmails = signal<string[]>([]);
  readonly ruleRecipientInputError = signal('');
  ruleRecipientInput = '';
  readonly ruleWizardStep = signal<RuleWizardStep>(1);
  readonly conditionForms = signal<RuleConditionForm[]>([
    { joinWithPrevious: 'AND', negate: false, field: 'message', operator: 'wildcard', value: '' },
  ]);

  readonly title = computed(() => {
    if (this.mode() === 'group') {
      return this.group() ? 'Edit Group' : 'Create Group';
    }
    return this.rule() ? 'Edit Rule' : 'Create Rule';
  });

  readonly saveLabel = computed(() => {
    if (this.mode() === 'group') {
      return this.group() ? 'Update Group' : 'Create Group';
    }
    return this.rule() ? 'Update Rule' : 'Create Rule';
  });

  readonly sortedTopicOptions = computed(() =>
    [...this.topics()].filter((topic) => topic && topic.trim().length > 0).sort((a, b) => a.localeCompare(b))
  );
  readonly filteredGroupTopicOptions = computed(() => {
    const q = this.groupTopicSearch().trim().toLowerCase();
    return !q ? this.sortedTopicOptions() : this.sortedTopicOptions().filter((topic) => topic.toLowerCase().includes(q));
  });
  readonly filteredRuleTopicOptions = computed(() => {
    const q = this.ruleTopicSearch().trim().toLowerCase();
    return !q ? this.sortedTopicOptions() : this.sortedTopicOptions().filter((topic) => topic.toLowerCase().includes(q));
  });
  readonly invalidEmails = computed(() => this.ruleRecipientEmails().filter((email) => !EMAIL_REGEX.test(email)));
  private getConditionValidationErrors(): string[] {
    const issues: string[] = [];
    this.conditionForms().forEach((item, index) => {
      if (!item.value.trim()) {
        issues.push(`Condition ${index + 1}: value is required.`);
      }
    });
    return issues;
  }

  constructor() {
    effect(() => {
      this.seedForm();
    });
  }

  private seedForm(): void {
    this.errorMessage.set('');
    this.groupValidationError.set('');
    this.showValidationHints.set(false);
    this.showWildcardHints.set(true);

    if (this.mode() === 'group') {
      const group = this.group();
      this.groupName = group?.name ?? '';
      this.groupDescription = group?.description ?? '';
      this.groupSelectedTopics.set([...(group?.topicNames ?? [])].sort((a, b) => a.localeCompare(b)));
      this.groupTopicSearch.set('');
      return;
    }
    const rule = this.rule();
    this.ruleName = rule?.name ?? '';
    this.ruleEnabled = rule?.enabled ?? true;
    this.ruleTargetType = rule?.targetType ?? 'topics';
    this.ruleSelectedTopics.set([...(rule?.topicNames ?? [])].sort((a, b) => a.localeCompare(b)));
    this.ruleTopicGroupId = rule?.topicGroupId ?? '';
    this.ruleRecipientEmails.set(
      [...new Set((rule?.recipientEmails ?? []).map((item) => item.trim()).filter((item) => item.length > 0))]
    );
    this.ruleRecipientInput = '';
    this.ruleRecipientInputError.set('');
    this.ruleTopicSearch.set('');
    this.ruleWizardStep.set(1);
    const initialConditions = (rule?.conditions ?? []).map((condition, index) => ({
      joinWithPrevious: index === 0 ? 'AND' : condition.joinWithPrevious,
      negate: !!condition.negate,
      field: condition.field,
      operator: this.normalizeConditionOperator(condition.operator),
      value: condition.value ?? '',
    }));
    this.conditionForms.set(initialConditions.length > 0 ? initialConditions : [{
      joinWithPrevious: 'AND',
      negate: false,
      field: 'message',
      operator: 'wildcard',
      value: '',
    }]);
  }

  save(): void {
    if (this.mode() === 'group') {
      this.saveGroup();
      return;
    }
    this.saveRule();
  }

  private saveGroup(): void {
    this.errorMessage.set('');
    this.groupValidationError.set('');
    const payload: UpsertTopicAlertGroupRequest = {
      name: this.groupName.trim(),
      description: this.groupDescription.trim() || null,
      topicNames: this.groupSelectedTopics(),
    };
    if (!payload.name) {
      this.errorMessage.set('Group name is required.');
      return;
    }
    if (payload.topicNames.length === 0) {
      this.groupValidationError.set('Select at least one topic for the group.');
      return;
    }

    this.isSaving.set(true);
    const editingGroupId = this.group()?.groupId;
    const request$ = editingGroupId ? this.api.updateGroup(editingGroupId, payload) : this.api.createGroup(payload);
    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.saved.emit();
      },
      error: () => {
        this.errorMessage.set('Failed to save group.');
        this.isSaving.set(false);
      },
    });
  }

  private saveRule(): void {
    this.errorMessage.set('');
    this.showValidationHints.set(true);

    if (!this.ruleName.trim()) {
      this.ruleWizardStep.set(1);
      this.errorMessage.set('Rule name is required.');
      return;
    }
    if (this.ruleTargetType === 'group' && !this.ruleTopicGroupId) {
      this.ruleWizardStep.set(1);
      this.errorMessage.set('Please select a group for target type "group".');
      return;
    }
    if (this.ruleTargetType === 'topics' && this.ruleSelectedTopics().length === 0) {
      this.ruleWizardStep.set(1);
      this.errorMessage.set('At least one topic is required for target type "topics".');
      return;
    }
    if (this.ruleRecipientInput.trim()) {
      this.addRecipientFromInput();
      if (this.ruleRecipientInputError()) {
        this.ruleWizardStep.set(3);
        this.errorMessage.set(this.ruleRecipientInputError());
        return;
      }
    }

    if (this.ruleRecipientEmails().length === 0) {
      this.ruleWizardStep.set(3);
      this.errorMessage.set('At least one recipient email is required.');
      return;
    }
    if (this.invalidEmails().length > 0) {
      this.ruleWizardStep.set(3);
      this.errorMessage.set('Please fix invalid email entries.');
      return;
    }
    if (this.getConditionValidationErrors().length > 0) {
      this.ruleWizardStep.set(2);
      this.errorMessage.set('Please fix condition validation errors.');
      return;
    }

    const payload: UpsertTopicAlertRuleRequest = {
      name: this.ruleName.trim(),
      enabled: this.ruleEnabled,
      targetType: this.ruleTargetType,
      topicNames: this.ruleTargetType === 'topics' ? this.ruleSelectedTopics() : [],
      topicGroupId: this.ruleTargetType === 'group' ? this.ruleTopicGroupId : null,
      recipientEmailsCsv: this.ruleRecipientEmails().join(', '),
      conditions: this.conditionForms().map((item, index) => ({
        joinWithPrevious: index === 0 ? 'AND' : item.joinWithPrevious,
        negate: item.negate,
        field: item.field,
        operator: this.normalizeConditionOperator(item.operator),
        value: item.value.trim(),
      })) as TopicAlertCondition[],
    };

    this.isSaving.set(true);
    const editingRuleId = this.rule()?.ruleId;
    const request$ = editingRuleId ? this.api.updateRule(editingRuleId, payload) : this.api.createRule(payload);
    request$.subscribe({
      next: () => {
        this.isSaving.set(false);
        this.saved.emit();
      },
      error: () => {
        this.errorMessage.set('Failed to save rule.');
        this.isSaving.set(false);
      },
    });
  }

  toggleGroupTopic(topic: string): void {
    const current = this.groupSelectedTopics();
    this.groupSelectedTopics.set(current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic].sort((a, b) => a.localeCompare(b)));
  }
  selectAllGroupTopics(): void {
    this.groupSelectedTopics.set([...new Set([...this.groupSelectedTopics(), ...this.filteredGroupTopicOptions()])].sort((a, b) => a.localeCompare(b)));
  }
  clearGroupTopics(): void {
    this.groupSelectedTopics.set([]);
  }

  toggleRuleTopic(topic: string): void {
    const current = this.ruleSelectedTopics();
    this.ruleSelectedTopics.set(current.includes(topic) ? current.filter((item) => item !== topic) : [...current, topic].sort((a, b) => a.localeCompare(b)));
  }
  selectAllRuleTopics(): void {
    this.ruleSelectedTopics.set([...new Set([...this.ruleSelectedTopics(), ...this.filteredRuleTopicOptions()])].sort((a, b) => a.localeCompare(b)));
  }
  clearRuleTopics(): void {
    this.ruleSelectedTopics.set([]);
  }

  addRecipientFromInput(event?: Event): void {
    event?.preventDefault();
    this.ruleRecipientInputError.set('');

    const raw = this.ruleRecipientInput.trim();
    if (!raw) {
      return;
    }

    const candidates = this.tokenizeRecipients(raw);

    if (candidates.length === 0) {
      return;
    }

    const existing = this.ruleRecipientEmails();
    const existingLower = new Set(existing.map((item) => item.toLowerCase()));
    const next = [...existing];

    for (const email of candidates) {
      if (!EMAIL_REGEX.test(email)) {
        this.ruleRecipientInputError.set(`Invalid email: ${email}`);
        return;
      }
      if (existingLower.has(email.toLowerCase())) {
        continue;
      }
      next.push(email);
      existingLower.add(email.toLowerCase());
    }

    this.ruleRecipientEmails.set(next);
    this.ruleRecipientInput = '';
  }

  handleRecipientPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text')?.trim() ?? '';
    if (!text) {
      return;
    }

    event.preventDefault();
    this.ruleRecipientInput = text;
    this.addRecipientFromInput();
  }

  removeRecipient(email: string): void {
    this.ruleRecipientEmails.set(this.ruleRecipientEmails().filter((item) => item !== email));
  }

  clearRecipients(): void {
    this.ruleRecipientEmails.set([]);
    this.ruleRecipientInput = '';
    this.ruleRecipientInputError.set('');
  }

  private tokenizeRecipients(raw: string): string[] {
    return raw
      .split(/[,\s;]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  addCondition(): void {
    this.conditionForms.set([...this.conditionForms(), { joinWithPrevious: 'AND', negate: false, field: 'message', operator: 'wildcard', value: '' }]);
  }
  removeCondition(index: number): void {
    const next = [...this.conditionForms()];
    next.splice(index, 1);
    this.conditionForms.set(next.length > 0 ? next : [{ joinWithPrevious: 'AND', negate: false, field: 'message', operator: 'wildcard', value: '' }]);
  }

  hasWildcardOperator(): boolean {
    return this.conditionForms().some((item) => (item.operator ?? '').toLowerCase() === 'wildcard');
  }

  private normalizeConditionOperator(
    operator: RuleConditionForm['operator'] | string | null | undefined
  ): RuleConditionForm['operator'] {
    const normalized = (operator ?? '').trim().toLowerCase();
    if (normalized === 'contains' || normalized === 'equals' || normalized === 'startswith' || normalized === 'endswith') {
      return normalized === 'startswith'
        ? 'startsWith'
        : normalized === 'endswith'
          ? 'endsWith'
          : (normalized as 'contains' | 'equals');
    }
    return 'wildcard';
  }

  goToRuleStep(step: number): void {
    const safe = Math.max(1, Math.min(3, step)) as RuleWizardStep;
    this.ruleWizardStep.set(safe);
  }
  canGoToNextRuleStep(): boolean {
    const step = this.ruleWizardStep();
    if (step === 1) {
      if (!this.ruleName.trim()) {
        return false;
      }
      return this.ruleTargetType === 'group' ? !!this.ruleTopicGroupId : this.ruleSelectedTopics().length > 0;
    }
    if (step === 2) {
      return this.getConditionValidationErrors().length === 0;
    }
    return true;
  }

}
