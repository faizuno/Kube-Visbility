import { Component, OnInit, inject, computed, signal } from '@angular/core';

import { KafkaStateService } from '../../services/kafka-state.service';
import { KafkaService } from '../../../../core/services/api/kafka.service';
import { TopicInfo } from '../../../../core/models/kafka.models';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';
import { TopicDetailsModalComponent } from '../topic-details-modal/topic-details-modal.component';

@Component({
  selector: 'app-topic-list',
  standalone: true,
  imports: [LoadingSkeletonComponent, TopicDetailsModalComponent],
  template: `
    <div class="topic-list-container">
      <div class="topic-list-header">
        <h2>Topics</h2>
        <button class="btn-refresh" (click)="refreshTopics()" [disabled]="isLoading()">
          <i class="fas fa-sync-alt" [class.spinning]="isLoading()"></i>
          Refresh
        </button>
      </div>

      @if (isLoading()) {
        <app-loading-skeleton [count]="5" />
      } @else if (topics().length === 0) {
        <div class="empty-state">
          <i class="fas fa-inbox"></i>
          <p>No topics found</p>
        </div>
      } @else {
        <div class="topics-table">
          <table>
            <thead>
              <tr>
                <th>Topic Name</th>
                <th>Partitions</th>
                <th>Replication Factor</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (topic of topics(); track topic.name) {
                <tr>
                  <td>
                    <strong>{{ topic.name }}</strong>
                  </td>
                  <td>{{ topic.partitionCount }}</td>
                  <td>{{ topic.replicationFactor }}</td>
                  <td>
                    <button
                      class="btn-action"
                      (click)="viewTopicDetails(topic.name)"
                      title="View Details"
                    >
                      <i class="fas fa-eye"></i>
                      View Details
                    </button>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    @if (selectedTopicForDetails()) {
      <app-topic-details-modal
        [topicName]="selectedTopicForDetails()!"
        (close)="closeTopicDetails()"
      />
    }
  `,
  styles: [
    `
      .topic-list-container {
        background: var(--theme-bg-surface);
        border-radius: 12px;
        padding: 2rem;
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      }

      .topic-list-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1.5rem;
      }

      .topic-list-header h2 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-dark);
      }

      .btn-refresh {
        padding: 0.5rem 1rem;
        background: var(--theme-button-primary);
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
        background: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px var(--theme-button-primary-shadow);
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

      .topics-table {
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
        color: var(--theme-table-header-color);
        border-bottom: 2px solid var(--theme-border-gray);
      }

      td {
        padding: 1rem;
        border-bottom: 1px solid var(--theme-border-gray);
      }

      tbody tr:hover {
        background: var(--theme-bg-app);
      }

      .btn-action {
        padding: 0.5rem 1rem;
        background: var(--theme-button-primary);
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: var(--theme-font-body);
        font-weight: var(--theme-font-table-body-weight);
      }

      .btn-action:hover {
        background: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px var(--theme-button-primary-shadow);
      }
    `,
  ],
})
export class TopicListComponent implements OnInit {
  private stateService = inject(KafkaStateService);
  private kafkaService = inject(KafkaService);

  topics = this.stateService.topics;
  loadingStates = this.stateService.loadingStates;
  isLoading = computed(() => this.loadingStates()['topics'] === true);
  selectedTopicForDetails = signal<string | null>(null);

  ngOnInit(): void {
    if (this.topics().length === 0) {
      this.refreshTopics();
    }
  }

  async refreshTopics(): Promise<void> {
    try {
      await this.stateService.loadTopics();
    } catch (error) {
      console.error('Error refreshing topics:', error);
    }
  }

  viewTopicDetails(topicName: string): void {
    this.selectedTopicForDetails.set(topicName);
  }

  closeTopicDetails(): void {
    this.selectedTopicForDetails.set(null);
  }
}

