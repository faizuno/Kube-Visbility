import { Component, Input, OnInit, OnChanges, OnDestroy, SimpleChanges, inject, signal } from '@angular/core';

import { KafkaService } from '../../../../../core/services/api/kafka.service';
import { TopicInfo } from '../../../../../core/models/kafka.models';
import { KafkaStateService } from '../../../services/kafka-state.service';

@Component({
  selector: 'app-settings-tab',
  standalone: true,
  imports: [],
  template: `
    <div class="settings-tab">
      <div class="tab-header">
        <h3><i class="fas fa-cog"></i> Topic Configuration</h3>
        <button class="btn-refresh" (click)="loadTopicInfo()" [disabled]="isLoading()">
          <i class="fas fa-sync-alt" [class.spinning]="isLoading()"></i>
          Refresh
        </button>
      </div>

      @if (error()) {
        <div class="error-message">
          <i class="fas fa-exclamation-circle"></i>
          <p>{{ error() }}</p>
        </div>
      } @else {
        <div class="config-section">
          <div class="config-info">
            <p class="info-text">
              <i class="fas fa-info-circle"></i>
              These are the current configuration settings for this topic. Changes are read-only in this view.
            </p>
          </div>

          @if (!isLoading() && configs().length === 0) {
            <div class="empty-state">
              <i class="fas fa-cog"></i>
              <p>No configuration settings available</p>
            </div>
          } @else {
            <div class="config-table-container">
              <table class="config-table">
                <thead>
                  <tr>
                    <th>Configuration Key</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  @if (isLoading()) {
                    @for (row of skeletonRows; track row) {
                      <tr class="skeleton-row">
                        <td><span class="table-skeleton skeleton-key"></span></td>
                        <td><span class="table-skeleton skeleton-value"></span></td>
                      </tr>
                    }
                  } @else {
                    @for (config of configs(); track config.key) {
                      <tr>
                        <td>
                          <code class="config-key">{{ config.key }}</code>
                        </td>
                        <td>
                          <code class="config-value">{{ config.value }}</code>
                        </td>
                      </tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .settings-tab {
        display: flex;
        flex-direction: column;
        gap: 2rem;
      }

      .tab-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .tab-header h3 {
        margin: 0;
        font-size: var(--theme-font-section-title);
        color: var(--theme-text-dark);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .btn-refresh {
        padding: 0.5rem 1rem;
        background: #10b981;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: var(--theme-font-table-body-weight);
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
      }

      .btn-refresh:hover:not(:disabled) {
        background: #059669;
        transform: translateY(-1px);
      }

      .btn-refresh:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }

      .btn-refresh i.spinning {
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

      .error-message {
        text-align: center;
        padding: 3rem;
        color: #ef4444;
      }

      .error-message i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        opacity: 0.5;
      }

      .config-section {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
      }

      .config-info {
        background: var(--theme-bg-teal-lighter);
        border: 1px solid #bfdbfe;
        border-radius: 8px;
        padding: 1rem;
      }

      .info-text {
        margin: 0;
        color: #1e40af;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
      }

      .empty-state {
        text-align: center;
        padding: 3rem;
        color: var(--theme-text-gray);
      }

      .empty-state i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 1rem;
        opacity: 0.5;
      }

      .config-table-container {
        overflow-x: auto;
      }

      .config-table {
        width: 100%;
        border-collapse: collapse;
      }

      thead {
        background: var(--theme-bg-app);
      }

      th {
        padding: 1rem;
        text-align: left;
        font-weight: var(--theme-font-table-header-weight);
        color: var(--theme-table-header-color);
        border-bottom: 2px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
      }

      td {
        padding: 1rem;
        border-bottom: 1px solid var(--theme-border-gray-light);
        font-size: var(--theme-font-body);
      }

      tbody tr:hover {
        background: var(--theme-bg-app);
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
        animation: table-skeleton-shimmer 1.4s ease-in-out infinite;
      }

      .skeleton-key {
        width: min(60%, 320px);
        height: 14px;
      }

      .skeleton-value {
        width: 92%;
        height: 14px;
      }

      @keyframes table-skeleton-shimmer {
        0% {
          background-position: 200% 0;
        }
        100% {
          background-position: -200% 0;
        }
      }

      .config-key,
      .config-value {
        background: var(--theme-bg-surface);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-body);
        font-family: 'Courier New', monospace;
      }

      .config-key {
        color: #7c3aed;
        font-weight: var(--theme-font-table-header-weight);
      }

      .config-value {
        color: var(--theme-text-gray-dark);
        word-break: break-all;
      }
    `,
  ],
})
export class SettingsTabComponent implements OnInit, OnChanges, OnDestroy {
  @Input({ required: true }) topicName!: string;

  private kafkaService = inject(KafkaService);
  private stateService = inject(KafkaStateService);

  topicInfo = signal<TopicInfo | null>(null);
  isLoading = signal(false);
  error = signal<string | null>(null);
  readonly skeletonRows = [1, 2, 3, 4, 5, 6];
  private lastLoadedTopic: string | null = null;

  configs = signal<Array<{ key: string; value: string }>>([]);
  
  // Static cache to persist data across component destruction/recreation
  private static dataCache = new Map<string, TopicInfo>();

  ngOnInit(): void {
    this.stateService.registerRefreshCallback('settings-tab', async () => {
      await this.loadTopicInfo(false);
    });
    this.loadTopicInfoIfNeeded();
  }

  ngOnDestroy(): void {
    this.stateService.unregisterRefreshCallback('settings-tab');
  }

  ngOnChanges(changes: SimpleChanges): void {
    // Only reload if topic actually changed
    if (changes['topicName'] && !changes['topicName'].firstChange) {
      const previousTopic = changes['topicName'].previousValue;
      const currentTopic = changes['topicName'].currentValue;
      
      if (previousTopic !== currentTopic) {
        // Topic changed - reload with loading state
        this.loadTopicInfoIfNeeded(true);
      }
      // If topic is the same, do nothing - data is already displayed
    }
  }

  private loadTopicInfoIfNeeded(showLoading: boolean = true): void {
    // Check static cache first - this persists across component destruction
    const cachedData = SettingsTabComponent.dataCache.get(this.topicName);
    if (cachedData) {
      // Use cached data instantly - no loading, no API call
      this.topicInfo.set(cachedData);
      const configsArray = Object.entries(cachedData.configs || {}).map(([key, value]) => ({
        key,
        value,
      }));
      this.configs.set(configsArray);
      this.lastLoadedTopic = this.topicName;
      return;
    }

    // No cached data - load it with loading state (showLoading defaults to true for initial load)
    this.loadTopicInfo(showLoading);
  }

  async loadTopicInfo(showLoading: boolean = true): Promise<void> {
    if (showLoading) {
      this.isLoading.set(true);
    }
    this.error.set(null);
    try {
      const info = await this.kafkaService.getTopicInfo(this.topicName).toPromise();
      if (info) {
        // Store in static cache for future use
        SettingsTabComponent.dataCache.set(this.topicName, info);
        this.topicInfo.set(info);
        const configsArray = Object.entries(info.configs || {}).map(([key, value]) => ({
          key,
          value,
        }));
        this.configs.set(configsArray);
        this.lastLoadedTopic = this.topicName;
      }
    } catch (err: any) {
      this.error.set(err?.error?.error || err?.message || 'Failed to load topic configuration');
      console.error('Error loading topic info:', err);
    } finally {
      if (showLoading) {
        this.isLoading.set(false);
      }
    }
  }
}

