import { Component, Input, Output, EventEmitter, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { KafkaService } from '../../../../core/services/api/kafka.service';
import { KafkaMessage, TopicInfo, RequeueRequest } from '../../../../core/models/kafka.models';

@Component({
  selector: 'app-requeue-modal',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="modal-overlay" (click)="onClose()">
      <div class="modal-content" (click)="$event.stopPropagation()">
        <div class="modal-header">
          <h2>
            <i class="fas fa-redo"></i>
            Requeue Message
          </h2>
          <button class="btn-close" (click)="onClose()">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="modal-body">
          <div class="message-details">
            <h3>Message Details</h3>
            <div class="detail-section">
              <div class="detail-row">
                <strong>Partition:</strong>
                <span>{{ message.partition }}</span>
              </div>
              <div class="detail-row">
                <strong>Offset:</strong>
                <span>{{ message.offset }}</span>
              </div>
              <div class="detail-row">
                <strong>Timestamp:</strong>
                <span>{{ formatTimestamp(message.timestamp) }}</span>
              </div>
              @if (message.key) {
                <div class="detail-row">
                  <strong>Key:</strong>
                  <code>{{ message.key }}</code>
                </div>
              }
            </div>

            <div class="detail-section">
              <strong>Value:</strong>
              <pre class="message-value">{{ formatValue(message.value) }}</pre>
            </div>

            @if (message.headers && getHeaders().length > 0) {
              <div class="detail-section">
                <strong>Headers:</strong>
                <div class="headers-list">
                  @for (header of getHeaders(); track header.key) {
                    <div class="header-item">
                      <code>{{ header.key }}</code>: <code>{{ header.value }}</code>
                    </div>
                  }
                </div>
              </div>
            }
          </div>

          <div class="requeue-options">
            <h3>Requeue Options</h3>
            <div class="form-group">
              <label for="targetTopic">Target Topic *</label>
              <select
                id="targetTopic"
                [(ngModel)]="targetTopic"
                [disabled]="isRequeuing()"
              >
                <option value="">Select target topic...</option>
                @for (topic of topics; track topic.name) {
                  <option [value]="topic.name">{{ topic.name }}</option>
                }
              </select>
            </div>

            <div class="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  [(ngModel)]="preserveHeaders"
                  [disabled]="isRequeuing()"
                />
                Preserve original headers
              </label>
            </div>

            <div class="form-group checkbox-group">
              <label>
                <input
                  type="checkbox"
                  [(ngModel)]="addRequeueMetadata"
                  [disabled]="isRequeuing()"
                  [checked]="true"
                />
                Add requeue metadata headers
              </label>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          @if (errorMessage()) {
            <div class="error-message">{{ errorMessage() }}</div>
          }
          @if (successMessage()) {
            <div class="success-message">{{ successMessage() }}</div>
          }
          <div class="footer-actions">
            <button class="btn-cancel" (click)="onClose()" [disabled]="isRequeuing()">
              Cancel
            </button>
            <button
              class="btn-requeue"
              (click)="requeue()"
              [disabled]="!canRequeue() || isRequeuing()"
            >
              @if (isRequeuing()) {
                <i class="fas fa-spinner fa-spin"></i>
                Requeuing...
              } @else {
                <i class="fas fa-redo"></i>
                Requeue
              }
            </button>
          </div>
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
        animation: fadeIn 0.2s ease-out;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .modal-content {
        background: var(--theme-bg-app);
        border-radius: 12px;
        box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
        max-width: 800px;
        width: 100%;
        max-height: 90vh;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: modalSlideIn 0.3s ease-out;
      }

      @keyframes modalSlideIn {
        from {
          transform: translateY(-50px);
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
        padding: 1.5rem 2rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
        background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
        color: white;
        border-radius: 12px 12px 0 0;
        box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
      }

      .modal-header h2 {
        margin: 0;
        font-size: var(--theme-font-page-title);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }

      .btn-close {
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

      .btn-close:hover {
        background-color: rgba(255, 255, 255, 0.2);
        color: white;
      }

      .modal-body {
        padding: 2rem;
        overflow-y: auto;
        flex: 1;
        min-height: 0;
        background: var(--theme-bg-app);
      }

      .modal-body::-webkit-scrollbar {
        width: 6px;
      }

      .modal-body::-webkit-scrollbar-track {
        background: #f1f1f1;
        border-radius: 10px;
      }

      .modal-body::-webkit-scrollbar-thumb {
        background: var(--theme-border-gray);
        border-radius: 10px;
      }

      .modal-body::-webkit-scrollbar-thumb:hover {
        background: var(--theme-border-gray);
      }

      .message-details,
      .requeue-options {
        margin-bottom: 2rem;
      }

      .message-details h3,
      .requeue-options h3 {
        margin: 0 0 1rem 0;
        font-size: var(--theme-font-page-title);
        color: var(--theme-text-dark);
      }

      .detail-section {
        margin-bottom: 1.5rem;
      }

      .detail-row {
        display: flex;
        justify-content: space-between;
        padding: 0.75rem 0;
        border-bottom: 1px solid #f3f4f6;
      }

      .detail-row strong {
        color: var(--theme-text-gray-dark);
      }

      code {
        background: var(--theme-bg-app);
        padding: 0.25rem 0.5rem;
        border-radius: 4px;
        font-size: var(--theme-font-body);
        font-family: monospace;
      }

      .message-value {
        background: var(--theme-bg-surface);
        padding: 1rem;
        border-radius: 6px;
        border: 1px solid var(--theme-border-gray);
        max-height: 200px;
        overflow-y: auto;
        font-family: monospace;
        font-size: var(--theme-font-body);
        white-space: pre-wrap;
        word-break: break-all;
      }

      .headers-list {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }

      .header-item {
        padding: 0.5rem;
        background: var(--theme-bg-surface);
        border-radius: 4px;
        font-size: var(--theme-font-body);
      }

      .form-group {
        margin-bottom: 1.5rem;
      }

      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        font-weight: var(--theme-font-table-body-weight);
        color: var(--theme-text-gray-dark);
      }

      .form-group select {
        width: 100%;
        padding: 0.75rem;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        font-size: var(--theme-font-body);
        transition: all 0.2s;
      }

      .form-group select:focus {
        outline: none;
        border-color: var(--theme-button-primary);
        box-shadow: 0 0 0 3px rgba(147, 41, 154, 0.12);
      }

      .form-group select:disabled {
        background: var(--theme-bg-app);
        cursor: not-allowed;
      }

      .checkbox-group label {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        cursor: pointer;
        padding: 0.75rem;
        border-radius: 6px;
        transition: background 0.2s;
      }

      .checkbox-group label:hover {
        background: var(--theme-bg-app);
      }

      .checkbox-group input[type='checkbox'] {
        width: 18px;
        height: 18px;
        cursor: pointer;
        accent-color: var(--theme-button-primary);
      }

      .modal-footer {
        padding: 1.5rem 2rem;
        border-top: 1px solid var(--theme-border-gray);
        background: var(--theme-bg-app);
        flex-shrink: 0;
      }

      .error-message,
      .success-message {
        padding: 0.75rem;
        border-radius: 6px;
        margin-bottom: 1rem;
      }

      .error-message {
        background: #fee2e2;
        color: #dc2626;
      }

      .success-message {
        background: var(--theme-bg-teal-lighter);
        color: #1e40af;
      }

      .footer-actions {
        display: flex;
        justify-content: flex-end;
        gap: 1rem;
      }

      .btn-cancel,
      .btn-requeue {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 6px;
        font-weight: var(--theme-font-table-body-weight);
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 0.5rem;
        transition: all 0.2s ease;
      }

      .btn-cancel {
        background: var(--theme-text-gray);
        color: white;
      }

      .btn-cancel:hover:not(:disabled) {
        background: #4b5563;
      }

      .btn-requeue {
        background: var(--theme-button-primary);
        color: white;
      }

      .btn-requeue:hover:not(:disabled) {
        background: var(--theme-button-primary-hover);
        transform: translateY(-1px);
        box-shadow: 0 4px 6px -1px rgba(147, 41, 154, 0.3);
      }

      .btn-cancel:disabled,
      .btn-requeue:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `,
  ],
})
export class RequeueModalComponent {
  @Input() message!: KafkaMessage;
  @Input() sourceTopic!: string;
  @Input() topics: TopicInfo[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() requeued = new EventEmitter<void>();

  private kafkaService = inject(KafkaService);

  targetTopic = '';
  preserveHeaders = true;
  addRequeueMetadata = true;
  isRequeuing = signal(false);
  errorMessage = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  canRequeue(): boolean {
    return !!this.targetTopic && this.targetTopic !== this.sourceTopic;
  }

  onClose(): void {
    this.close.emit();
  }

  getHeaders(): Array<{ key: string; value: string }> {
    if (!this.message.headers) {
      return [];
    }
    return Object.entries(this.message.headers).map(([key, value]) => ({ key, value }));
  }

  formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  formatValue(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }

  async requeue(): Promise<void> {
    if (!this.canRequeue() || this.isRequeuing()) {
      return;
    }

    this.isRequeuing.set(true);
    this.errorMessage.set(null);
    this.successMessage.set(null);

    try {
      const request: RequeueRequest = {
        sourceTopic: this.sourceTopic,
        targetTopic: this.targetTopic,
        messages: [
          {
            partition: this.message.partition,
            offset: this.message.offset,
            messageText: this.message.value,
          },
        ],
        preserveHeaders: this.preserveHeaders,
        addRequeueMetadata: this.addRequeueMetadata,
      };

      const response = await this.kafkaService.requeueMessages(request).toPromise();

      if (response && response.requeuedCount > 0) {
        this.successMessage.set(`Successfully requeued ${response.requeuedCount} message(s)`);
        setTimeout(() => {
          this.requeued.emit();
          this.close.emit();
        }, 1500);
      } else {
        this.errorMessage.set(
          response?.errors.join(', ') || 'Failed to requeue message'
        );
      }
    } catch (error: any) {
      this.errorMessage.set(error?.error?.error || 'An error occurred while requeuing the message');
    } finally {
      this.isRequeuing.set(false);
    }
  }
}

