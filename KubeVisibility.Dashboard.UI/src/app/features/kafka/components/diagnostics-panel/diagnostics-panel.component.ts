import { Component, Input, computed, signal } from '@angular/core';

import { QuickDiagnostics, DiagnosticResult } from '../../models/diagnostics.models';

/**
 * Component for displaying quick diagnostics panel
 * Following Single Responsibility Principle - only displays diagnostics
 */
@Component({
  selector: 'app-diagnostics-panel',
  standalone: true,
  imports: [],
  template: `
    <div class="diagnostics-panel">
      @if (diagnostics(); as diag) {
        <!-- Health Score Header -->
        <div class="diagnostics-header" [class]="'health-' + diag.overallHealth">
          <div class="health-indicator">
            <div class="health-icon">
              <i class="fas" [class.fa-check-circle]="diag.overallHealth === 'healthy'"
                             [class.fa-exclamation-triangle]="diag.overallHealth === 'degraded'"
                             [class.fa-times-circle]="diag.overallHealth === 'critical'"></i>
            </div>
            <div class="health-info">
              <div class="health-status">{{ getHealthLabel(diag.overallHealth) }}</div>
              <div class="health-summary">{{ diag.summary }}</div>
            </div>
          </div>
          <div class="health-score">
            <div class="score-circle" [style.--score]="diag.score">
              <svg viewBox="0 0 36 36">
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                      fill="none" stroke="var(--theme-border-gray)" stroke-width="3"/>
                <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                      fill="none" 
                      [attr.stroke]="getScoreColor(diag.score)" 
                      stroke-width="3"
                      [style.stroke-dasharray]="diag.score + ', 100'"/>
              </svg>
              <span class="score-value">{{ diag.score }}</span>
            </div>
            <div class="score-label">Health Score</div>
          </div>
        </div>

        <!-- Top Issues -->
        @if (diag.topIssues.length > 0) {
          <div class="top-issues">
            <h4><i class="fas fa-exclamation-circle"></i> Top Issues</h4>
            <div class="issues-list">
              @for (issue of diag.topIssues; track issue.checkId) {
                <div class="issue-item" [class]="'status-' + issue.status">
                  <div class="issue-header">
                    <span class="issue-icon">
                      <i class="fas" [class.fa-times]="issue.status === 'fail'"
                                     [class.fa-exclamation-triangle]="issue.status === 'warning'"></i>
                    </span>
                    <span class="issue-name">{{ issue.checkName }}</span>
                    <span class="issue-badge">{{ issue.category }}</span>
                  </div>
                  <div class="issue-message">{{ issue.message }}</div>
                  @if (issue.details) {
                    <div class="issue-details">{{ issue.details }}</div>
                  }
                  @if (issue.action) {
                    <button class="issue-action" (click)="onActionClick(issue.action)">
                      <i class="fas fa-wrench"></i>
                      {{ issue.action.label }}
                    </button>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- Recommendations -->
        @if (diag.recommendations.length > 0) {
          <div class="recommendations">
            <h4><i class="fas fa-lightbulb"></i> Recommendations</h4>
            <ul>
              @for (rec of diag.recommendations; track $index) {
                <li>{{ rec }}</li>
              }
            </ul>
          </div>
        }

        <!-- All Checks (Collapsible) -->
        <div class="all-checks">
          <button class="checks-toggle" (click)="toggleAllChecks()">
            <i class="fas" [class.fa-chevron-down]="!showAllChecks()" 
                          [class.fa-chevron-up]="showAllChecks()"></i>
            View All Checks ({{ diag.passedChecks.length }} passed, {{ diag.warningChecks.length }} warnings, {{ diag.failedChecks.length }} failed)
          </button>
          
          @if (showAllChecks()) {
            <div class="checks-grid">
              @for (check of diag.checks; track check.checkId) {
                <div class="check-item" [class]="'check-' + check.status">
                  <div class="check-status-icon">
                    <i class="fas" [class.fa-check]="check.status === 'pass'"
                                   [class.fa-exclamation-triangle]="check.status === 'warning'"
                                   [class.fa-times]="check.status === 'fail'"></i>
                  </div>
                  <div class="check-info">
                    <div class="check-name">{{ check.checkName }}</div>
                    <div class="check-message">{{ check.message }}</div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .diagnostics-panel {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      border: 1px solid var(--theme-border-gray);
      overflow: hidden;
    }

    .diagnostics-header {
      padding: 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid var(--theme-border-gray);
    }

    .diagnostics-header.health-healthy {
      background: linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%);
    }

    .diagnostics-header.health-degraded {
      background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    }

    .diagnostics-header.health-critical {
      background: linear-gradient(135deg, #fee2e2 0%, #fecaca 100%);
    }

    .health-indicator {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .health-icon {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--theme-bg-surface);
      font-size: var(--theme-font-page-title);
    }

    .health-healthy .health-icon {
      color: #10b981;
    }

    .health-degraded .health-icon {
      color: #f59e0b;
    }

    .health-critical .health-icon {
      color: #ef4444;
    }

    .health-info {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .health-status {
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .health-summary {
      font-size: var(--theme-font-body);
      color: var(--theme-text-gray);
    }

    .health-score {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }

    .score-circle {
      position: relative;
      width: 64px;
      height: 64px;
    }

    .score-circle svg {
      transform: rotate(-90deg);
    }

    .score-value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
    }

    .score-label {
      font-size: var(--theme-font-caption);
      color: var(--theme-text-gray);
      font-weight: var(--theme-font-table-header-weight);
    }

    .top-issues {
      padding: 1.5rem;
      border-bottom: 1px solid var(--theme-border-gray);
    }

    .top-issues h4 {
      margin: 0 0 1rem 0;
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .issues-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .issue-item {
      padding: 1rem;
      border-radius: 6px;
      border: 1px solid;
    }

    .issue-item.status-fail {
      background: #fee2e2;
      border-color: #fecaca;
    }

    .issue-item.status-warning {
      background: #fef3c7;
      border-color: #fde68a;
    }

    .issue-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }

    .issue-icon {
      font-size: var(--theme-font-body);
    }

    .issue-item.status-fail .issue-icon {
      color: #ef4444;
    }

    .issue-item.status-warning .issue-icon {
      color: #f59e0b;
    }

    .issue-name {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      flex: 1;
    }

    .issue-badge {
      padding: 0.25rem 0.5rem;
      border-radius: 4px;
      font-size: var(--theme-font-caption);
      font-weight: var(--theme-font-table-header-weight);
      background: var(--theme-bg-surface);
      color: var(--theme-text-gray);
    }

    .issue-message {
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      margin-bottom: 0.25rem;
    }

    .issue-details {
      font-size: var(--theme-font-table-header);
      color: var(--theme-text-gray);
      margin-bottom: 0.5rem;
    }

    .issue-action {
      padding: 0.5rem 1rem;
      background: var(--theme-button-primary);
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.2s;
    }

    .issue-action:hover {
      background: var(--theme-button-primary-hover);
    }

    .recommendations {
      padding: 1.5rem;
      border-bottom: 1px solid var(--theme-border-gray);
    }

    .recommendations h4 {
      margin: 0 0 1rem 0;
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .recommendations ul {
      margin: 0;
      padding-left: 1.5rem;
    }

    .recommendations li {
      margin-bottom: 0.5rem;
      color: var(--theme-table-header-color);
      font-size: var(--theme-font-body);
    }

    .all-checks {
      padding: 1.5rem;
    }

    .checks-toggle {
      width: 100%;
      padding: 0.75rem;
      background: var(--theme-bg-app);
      border: 1px solid var(--theme-border-gray);
      border-radius: 6px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.2s;
    }

    .checks-toggle:hover {
      background: var(--theme-bg-app);
    }

    .checks-grid {
      margin-top: 1rem;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
      gap: 0.75rem;
    }

    .check-item {
      padding: 0.75rem;
      border-radius: 6px;
      border: 1px solid var(--theme-border-gray);
      display: flex;
      gap: 0.75rem;
    }

    .check-item.check-pass {
      background: #f0fdf4;
    }

    .check-item.check-warning {
      background: #fefce8;
    }

    .check-item.check-fail {
      background: #fef2f2;
    }

    .check-status-icon {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--theme-font-caption);
    }

    .check-pass .check-status-icon {
      background: #10b981;
      color: white;
    }

    .check-warning .check-status-icon {
      background: #f59e0b;
      color: white;
    }

    .check-fail .check-status-icon {
      background: #ef4444;
      color: white;
    }

    .check-info {
      flex: 1;
      min-width: 0;
    }

    .check-name {
      font-weight: var(--theme-font-table-header-weight);
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      margin-bottom: 0.25rem;
    }

    .check-message {
      font-size: var(--theme-font-table-header);
      color: var(--theme-text-gray);
    }
  `]
})
export class DiagnosticsPanelComponent {
  @Input() set data(value: QuickDiagnostics | null) {
    this.diagnostics.set(value);
  }

  diagnostics = signal<QuickDiagnostics | null>(null);
  showAllChecks = signal(false);

  toggleAllChecks(): void {
    this.showAllChecks.update(v => !v);
  }

  getHealthLabel(health: string): string {
    switch (health) {
      case 'healthy': return 'Healthy';
      case 'degraded': return 'Degraded';
      case 'critical': return 'Critical';
      default: return 'Unknown';
    }
  }

  getScoreColor(score: number): string {
    if (score >= 80) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#ef4444';
  }

  onActionClick(action: any): void {
    console.log('Action clicked:', action);
    // Could emit event or navigate to specific page
  }
}

