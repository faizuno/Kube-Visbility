import { Component, Input, Output, EventEmitter, OnInit, inject, signal, computed } from '@angular/core';

import { KafkaService } from '../../../../core/services/api/kafka.service';
import { TopicInfo, ConsumerGroupInfo } from '../../../../core/models/kafka.models';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';

@Component({
  selector: 'app-topic-details-modal',
  standalone: true,
  imports: [LoadingSkeletonComponent],
  template: `
    <div class="modal-overlay" (click)="onClose()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>
            <i class="fas fa-info-circle"></i>
            Topic Details: {{ topicName }}
          </h2>
          <button class="btn-close" (click)="onClose()">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="modal-body">
          @if (isLoading()) {
            <app-loading-skeleton [count]="5" />
          } @else if (topicInfo()) {
            <div class="topic-details">
              <div class="detail-section">
                <h3>Basic Information</h3>
                <div class="detail-grid">
                  <div class="detail-item">
                    <strong>Topic Name:</strong>
                    <span>{{ topicInfo()!.name }}</span>
                  </div>
                  <div class="detail-item">
                    <strong>Partitions:</strong>
                    <span>{{ topicInfo()!.partitionCount }}</span>
                  </div>
                  <div class="detail-item">
                    <strong>Replication Factor:</strong>
                    <span>{{ topicInfo()!.replicationFactor }}</span>
                  </div>
                </div>
              </div>

              @if (getConfigs().length > 0) {
                <div class="detail-section">
                  <h3>Configuration</h3>
                  <div class="config-list">
                    @for (config of getConfigs(); track config.key) {
                      <div class="config-item">
                        <code>{{ config.key }}</code>
                        <span>{{ config.value }}</span>
                      </div>
                    }
                  </div>
                </div>
              }

              <div class="detail-section">
                <h3>Consumer Groups</h3>
                @if (consumerGroups().length === 0) {
                  <div class="empty-state">
                    <i class="fas fa-users"></i>
                    <p>No consumer groups found for this topic</p>
                  </div>
                } @else {
                  <div class="consumer-groups-list">
                    <table>
                      <thead>
                        <tr>
                          <th>Consumer Group ID</th>
                          <th>Partition</th>
                          <th>Current Offset</th>
                          <th>Log End Offset</th>
                          <th>Lag</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (group of consumerGroups(); track getGroupKey(group)) {
                          <tr [class.has-lag]="group.lag > 0">
                            <td><strong>{{ group.groupId }}</strong></td>
                            <td>{{ group.partition }}</td>
                            <td>{{ group.currentOffset }}</td>
                            <td>{{ group.logEndOffset }}</td>
                            <td>
                              <span class="lag-badge" [class.warning]="group.lag > 1000" [class.error]="group.lag > 10000">
                                {{ group.lag }}
                              </span>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            </div>
          }
        </div>

        <div class="modal-footer">
          <button class="btn-close-footer" (click)="onClose()">Close</button>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
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
        z-index: var(--z-modal-backdrop, 1000000);
        padding: 2rem;
      }

      .modal-content {
        background: var(--theme-bg-app);
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
        max-width: 900px;
        width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1.5rem 2rem;
        border-bottom: 1px solid var(--theme-border-gray);
        background: linear-gradient(135deg, #10b981 0%, #059669 100%);
        color: white;
      }

      .modal-header h2 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .btn-close {
        background: rgba(255, 255, 255, 0.2);
        border: none;
        color: white;
        width: 2rem;
        height: 2rem;
        border-radius: 6px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s ease;
      }

      .btn-close:hover {
        background: rgba(255, 255, 255, 0.3);
      }

      .modal-body {
        padding: 2rem;
        overflow-y: auto;
        flex: 1;
        background: var(--theme-bg-app);
      }

      .detail-section {
        margin-bottom: 2rem;
      }

      .detail-section h3 {
        margin: 0 0 1rem 0;
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-dark);
        border-bottom: 2px solid var(--theme-border-gray);
        padding-bottom: 0.5rem;
      }

      .detail-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1rem;
      }

      .detail-item {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
      }

      .detail-item strong {
        color: var(--theme-text-gray-dark);
        font-size: var(--theme-font-body);
      }

      .config-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .config-item {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem;
        background: var(--theme-bg-app);
        border-radius: 6px;
        align-items: center;
      }

      .config-item code {
        background: var(--theme-border-gray);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-body);
      }

      .empty-state {
        text-align: center;
        padding: 2rem;
        color: var(--theme-text-gray);
      }

      .empty-state i {
        font-size: var(--theme-font-page-title);
        margin-bottom: 0.5rem;
        opacity: 0.5;
      }

      .consumer-groups-list {
        overflow-x: auto;
      }

      table {
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
        color: var(--theme-text-gray-dark);
        border-bottom: 2px solid var(--theme-border-gray);
        font-size: var(--theme-font-body);
      }

      td {
        padding: 0.75rem 1rem;
        border-bottom: 1px solid var(--theme-border-gray);
        font-size: var(--theme-font-body);
      }

      tbody tr:hover {
        background: var(--theme-bg-app);
      }

      tbody tr.has-lag {
        background: #fef3c7;
      }

      .lag-badge {
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background: #10b981;
        color: white;
        border-radius: 12px;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }

      .lag-badge.warning {
        background: #f59e0b;
      }

      .lag-badge.error {
        background: #dc2626;
      }

      .modal-footer {
        padding: 1.5rem 2rem;
        border-top: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        display: flex;
        justify-content: flex-end;
      }

      .btn-close-footer {
        padding: 0.75rem 1.5rem;
        background: var(--theme-text-gray);
        color: white;
        border: none;
        border-radius: 6px;
        font-weight: var(--theme-font-table-body-weight);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .btn-close-footer:hover {
        background: #4b5563;
      }
    `,
  ],
})
export class TopicDetailsModalComponent implements OnInit {
  @Input() topicName!: string;
  @Output() close = new EventEmitter<void>();

  private kafkaService = inject(KafkaService);

  topicInfo = signal<TopicInfo | null>(null);
  consumerGroups = signal<ConsumerGroupInfo[]>([]);
  isLoading = signal(true);

  ngOnInit(): void {
    this.loadTopicDetails();
  }

  async loadTopicDetails(): Promise<void> {
    this.isLoading.set(true);
    try {
      const [topicInfoResult, consumerGroupsResult] = await Promise.all([
        this.kafkaService.getTopicInfo(this.topicName).toPromise(),
        this.kafkaService.getConsumerGroups(this.topicName).toPromise(),
      ]);

      if (topicInfoResult) {
        this.topicInfo.set(topicInfoResult);
      }

      if (consumerGroupsResult) {
        this.consumerGroups.set(consumerGroupsResult.groups);
      }
    } catch (error) {
      console.error('Error loading topic details:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  getConfigs(): Array<{ key: string; value: string }> {
    if (!this.topicInfo()?.configs) {
      return [];
    }
    return Object.entries(this.topicInfo()!.configs).map(([key, value]) => ({ key, value }));
  }

  getGroupKey(group: ConsumerGroupInfo): string {
    return `${group.groupId}-${group.partition}`;
  }

  onClose(): void {
    this.close.emit();
  }
}

