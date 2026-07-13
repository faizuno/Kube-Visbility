import { Component, OnInit, OnDestroy, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { KafkaService } from '../../../../core/services/api/kafka.service';
import { KafkaMessage, MessageSearchRequest } from '../../../../core/models/kafka.models';
import { LoadingSkeletonComponent } from '../../../../shared/components/loading-skeleton/loading-skeleton.component';
import { ViewportScaleService } from '../../../../core/services/viewport-scale.service';

@Component({
  selector: 'app-message-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, LoadingSkeletonComponent],
  template: `
    <div class="message-detail-page" [ngStyle]="pageHeightStyle()">
      <div class="detail-header">
        <div class="header-content">
          <button class="btn-back" (click)="navigateBack()">
            <i class="fas fa-arrow-left"></i>
            Back
          </button>
          <h1>
            <i class="fas fa-envelope"></i>
            Message Details
          </h1>
          <div class="header-actions">
            <button class="btn-copy-link" (click)="copyShareableLink()" [title]="linkCopied() ? 'Copied!' : 'Copy Link'">
              @if (linkCopied()) {
                <i class="fas fa-check"></i>
                Copied!
              } @else {
                <i class="fas fa-link"></i>
                Copy Link
              }
            </button>
          </div>
        </div>
      </div>

      @if (isLoading()) {
        <div class="detail-loading">
          <app-loading-skeleton [count]="5" />
        </div>
      } @else if (errorMessage()) {
        <div class="detail-error">
          <i class="fas fa-exclamation-triangle"></i>
          <h2>Unable to load message</h2>
          <p>{{ errorMessage() }}</p>
          <div class="error-actions">
            <button class="btn-retry" (click)="loadMessage()">
              <i class="fas fa-redo"></i>
              Try Again
            </button>
            @if (hasMissingParams()) {
              <button class="btn-secondary-action" (click)="goToMessagingScanning()">
                <i class="fas fa-list"></i>
                Go to Messaging Scanning
              </button>
              @if (topicName()) {
                <button class="btn-secondary-action" (click)="goToTopicDeepDive()">
                  <i class="fas fa-stream"></i>
                  Go to Last Topic
                </button>
              }
            }
          </div>
        </div>
      } @else if (message(); as msg) {
        <div class="detail-content">
          <!-- Tab Navigation -->
          <div class="detail-tabs">
            <button 
              class="detail-tab" 
              [class.active]="selectedTab() === 'metadata'"
              (click)="setTab('metadata')"
            >
              <i class="fas fa-info-circle"></i> Metadata
            </button>
            
            <!-- Dynamic tabs for special keys (payload, body, etc.) -->
            @for (dynamicTab of availableDynamicTabs(); track dynamicTab.key) {
              <button 
                class="detail-tab" 
                [class.active]="selectedTab() === 'dynamic' && activeDynamicTabKey() === dynamicTab.key"
                (click)="setDynamicTab(dynamicTab.key)"
              >
                <i class="fas fa-database"></i> {{ dynamicTab.displayName }}
              </button>
            }
            
            <button 
              class="detail-tab" 
              [class.active]="selectedTab() === 'message'"
              (click)="setTab('message')"
            >
              <i class="fas fa-envelope"></i> Message Value
            </button>
            <button 
              class="detail-tab" 
              [class.active]="selectedTab() === 'raw'"
              (click)="setTab('raw')"
            >
              <i class="fas fa-file-alt"></i> Raw
            </button>
          </div>

          <!-- Tab Content -->
          <div class="tab-content">
            <!-- Metadata Tab -->
            @if (selectedTab() === 'metadata') {
              <div class="detail-section">
                <div class="section-header">
                  <h2>
                    <i class="fas fa-info-circle"></i>
                    Message Metadata
                  </h2>
                </div>
                <div class="metadata-grid">
                  <div class="metadata-card">
                    <div class="metadata-label">Topic</div>
                    <div class="metadata-value">{{ topicName() }}</div>
                    <button class="btn-copy-small" (click)="copyField(topicName()!, 'topic')" [title]="copiedField() === 'topic' ? 'Copied!' : 'Copy'">
                      <i class="fas" [class.fa-check]="copiedField() === 'topic'" [class.fa-copy]="copiedField() !== 'topic'"></i>
                    </button>
                  </div>
                  <div class="metadata-card">
                    <div class="metadata-label">Partition</div>
                    <div class="metadata-value">{{ msg.partition }}</div>
                    <button class="btn-copy-small" (click)="copyField(msg.partition.toString(), 'partition')" [title]="copiedField() === 'partition' ? 'Copied!' : 'Copy'">
                      <i class="fas" [class.fa-check]="copiedField() === 'partition'" [class.fa-copy]="copiedField() !== 'partition'"></i>
                    </button>
                  </div>
                  <div class="metadata-card">
                    <div class="metadata-label">Offset</div>
                    <div class="metadata-value">{{ msg.offset }}</div>
                    <button class="btn-copy-small" (click)="copyField(msg.offset.toString(), 'offset')" [title]="copiedField() === 'offset' ? 'Copied!' : 'Copy'">
                      <i class="fas" [class.fa-check]="copiedField() === 'offset'" [class.fa-copy]="copiedField() !== 'offset'"></i>
                    </button>
                  </div>
                  <div class="metadata-card">
                    <div class="metadata-label">Timestamp</div>
                    <div class="metadata-value">{{ formatTimestamp(msg.timestamp) }}</div>
                    <button class="btn-copy-small" (click)="copyField(msg.timestamp, 'timestamp')" [title]="copiedField() === 'timestamp' ? 'Copied!' : 'Copy'">
                      <i class="fas" [class.fa-check]="copiedField() === 'timestamp'" [class.fa-copy]="copiedField() !== 'timestamp'"></i>
                    </button>
                  </div>
                  <div class="metadata-card">
                    <div class="metadata-label">Timestamp Type</div>
                    <div class="metadata-value">{{ msg.timestampType }}</div>
                    <button class="btn-copy-small" (click)="copyField(msg.timestampType, 'timestampType')" [title]="copiedField() === 'timestampType' ? 'Copied!' : 'Copy'">
                      <i class="fas" [class.fa-check]="copiedField() === 'timestampType'" [class.fa-copy]="copiedField() !== 'timestampType'"></i>
                    </button>
                  </div>
                  <div class="metadata-card">
                    <div class="metadata-label">Key</div>
                    <div class="metadata-value">{{ msg.key || '-' }}</div>
                    @if (msg.key) {
                      <button class="btn-copy-small" (click)="copyField(msg.key, 'key')" [title]="copiedField() === 'key' ? 'Copied!' : 'Copy'">
                        <i class="fas" [class.fa-check]="copiedField() === 'key'" [class.fa-copy]="copiedField() !== 'key'"></i>
                      </button>
                    }
                  </div>
                </div>

                <!-- Headers Section within Metadata Tab -->
                @if (msg.headers && getHeaders(msg.headers).length > 0) {
                  <div class="subsection-header">
                    <h3>
                      <i class="fas fa-tags"></i>
                      Headers ({{ getHeaders(msg.headers).length }})
                    </h3>
                  </div>
                  <div class="headers-list">
                    @for (header of getHeaders(msg.headers); track header.key) {
                      <div class="header-item">
                        <span class="header-key">{{ header.key }}:</span>
                        <span class="header-value">{{ header.value }}</span>
                        <button class="btn-copy-small" (click)="copyField(header.value, 'header-' + header.key)" [title]="copiedField() === 'header-' + header.key ? 'Copied!' : 'Copy'">
                          <i class="fas" [class.fa-check]="copiedField() === 'header-' + header.key" [class.fa-copy]="copiedField() !== 'header-' + header.key"></i>
                        </button>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            <!-- Dynamic Tab Content (Payload, etc.) -->
            @if (selectedTab() === 'dynamic' && activeDynamicTabKey()) {
              <div class="detail-section">
                <div class="section-header">
                  <h2>
                    <i class="fas fa-database"></i>
                    {{ capitalizeFirstLetter(activeDynamicTabKey()!) }}
                  </h2>
                  <div class="section-actions">
                    @if (isValidJson(msg.value)) {
                      @let parsed = parseJson(msg.value);
                      @let dynamicValue = getDynamicKeyValue(parsed, activeDynamicTabKey()!);
                      @if (dynamicValue !== null) {
                        @let parsedDynamic = parsePayloadValue(dynamicValue);
                        @if (parsedDynamic !== null) {
                          <div class="view-toggle">
                            <button class="toggle-btn" [class.active]="viewMode() === 'tree'" (click)="setViewMode('tree')">
                              <i class="fas fa-sitemap"></i>
                              Tree
                            </button>
                            <button class="toggle-btn" [class.active]="viewMode() === 'json'" (click)="setViewMode('json')">
                              <i class="fas fa-code"></i>
                              JSON
                            </button>
                          </div>
                        }
                      }
                    }
                    <button class="btn-copy" (click)="copyDynamicValue()" [title]="valueCopied() ? 'Copied!' : 'Copy Value'">
                      @if (valueCopied()) {
                        <i class="fas fa-check"></i>
                        Copied
                      } @else {
                        <i class="far fa-copy"></i>
                        Copy
                      }
                    </button>
                  </div>
                </div>
                <div class="message-value-container">
                  @if (isValidJson(msg.value)) {
                    @let parsed = parseJson(msg.value);
                    @let dynamicValue = getDynamicKeyValue(parsed, activeDynamicTabKey()!);
                    
                    @if (dynamicValue !== null) {
                      @let parsedDynamic = parsePayloadValue(dynamicValue);
                      
                      @if (parsedDynamic !== null) {
                        <!-- Dynamic key is valid JSON - show with toggle -->
                        @if (viewMode() === 'tree') {
                          <div class="tree-view-container">
                            @let treeData = detectNestedJson(parsedDynamic);
                            @if (treeData && getTreeEntries(treeData).length > 0) {
                              <div class="tree-nodes">
                                @for (item of renderTreeNode(treeData, capitalizeFirstLetter(activeDynamicTabKey()!), 0); track item.path) {
                                  <div class="tree-node" [style.padding-left]="(item.depth * 1.5 + 1) + 'rem'">
                                    <div class="tree-node-header">
                                      @if (item.hasChildren) {
                                        <button 
                                          class="tree-toggle" 
                                          (click)="toggleNode(item.path)"
                                        >
                                          <i 
                                            class="fas" 
                                            [class.fa-chevron-right]="!isNodeExpanded(item.path)"
                                            [class.fa-chevron-down]="isNodeExpanded(item.path)"
                                          ></i>
                                        </button>
                                      } @else {
                                        <span class="tree-toggle-spacer"></span>
                                      }
                                      <span class="tree-key">{{ item.key }}:</span>
                                      <span class="tree-type-badge" [attr.data-type]="item.type">
                                        {{ item.type }}
                                      </span>
                                      @if (item.hasChildren) {
                                        <span class="tree-value-summary">{{ item.display }}</span>
                                      } @else {
                                        <span class="tree-value">{{ item.display }}</span>
                                      }
                                      <button 
                                        class="btn-copy-field" 
                                        (click)="copyField(item.value, item.path)"
                                        [title]="copiedField() === item.path ? 'Copied!' : 'Copy value'"
                                      >
                                        @if (copiedField() === item.path) {
                                          <i class="fas fa-check"></i>
                                        } @else {
                                          <i class="far fa-copy"></i>
                                        }
                                      </button>
                                    </div>
                                  </div>
                                }
                              </div>
                            } @else {
                              <div class="no-tree-data">
                                <i class="fas fa-info-circle"></i>
                                <p>No structured data to display</p>
                              </div>
                            }
                          </div>
                        } @else {
                          <pre class="message-value formatted">{{ formatJsonObject(parsedDynamic) }}</pre>
                        }
                      } @else {
                        <!-- Dynamic key is not valid JSON - show raw view -->
                        <pre class="message-value raw">{{ dynamicValue }}</pre>
                      }
                    } @else {
                      <div class="no-tree-data">
                        <i class="fas fa-info-circle"></i>
                        <p>No {{ capitalizeFirstLetter(activeDynamicTabKey()!) }} found in message</p>
                      </div>
                    }
                  } @else {
                    <div class="no-tree-data">
                      <i class="fas fa-exclamation-triangle"></i>
                      <p>Cannot parse as JSON</p>
                      <span class="hint-text">This message is not valid JSON.</span>
                    </div>
                  }
                </div>
              </div>
            }

            <!-- Message Value Tab -->
            @if (selectedTab() === 'message') {
              <div class="detail-section">
                <div class="section-header">
                  <h2>
                    <i class="fas fa-file-code"></i>
                    Message Value
                  </h2>
                  <div class="section-actions">
                    @if (isValidJson(msg.value)) {
                      <div class="view-toggle">
                        <button class="toggle-btn" [class.active]="viewMode() === 'tree'" (click)="setViewMode('tree')">
                          <i class="fas fa-sitemap"></i>
                          Tree
                        </button>
                        <button class="toggle-btn" [class.active]="viewMode() === 'json'" (click)="setViewMode('json')">
                          <i class="fas fa-code"></i>
                          JSON
                        </button>
                        <button class="toggle-btn" [class.active]="viewMode() === 'raw'" (click)="setViewMode('raw')">
                          <i class="fas fa-file-alt"></i>
                          Raw
                        </button>
                      </div>
                    }
                    <button class="btn-copy" (click)="copyMessageValue()" [title]="valueCopied() ? 'Copied!' : 'Copy Value'">
                      @if (valueCopied()) {
                        <i class="fas fa-check"></i>
                        Copied
                      } @else {
                        <i class="far fa-copy"></i>
                        Copy
                      }
                    </button>
                  </div>
                </div>
                <div class="message-value-container">
                  @if (viewMode() === 'tree' && isValidJson(msg.value)) {
                    <div class="tree-view-container">
                      @let treeData = parseMessageToTree(msg.value);
                      @if (treeData && getTreeEntries(treeData).length > 0) {
                        <div class="tree-nodes">
                          @for (item of renderTreeNode(treeData, 'root', 0); track item.path) {
                            <div class="tree-node" [style.padding-left]="(item.depth * 1.5 + 1) + 'rem'">
                              <div class="tree-node-header">
                                @if (item.hasChildren) {
                                  <button 
                                    class="tree-toggle" 
                                    (click)="toggleNode(item.path)"
                                  >
                                    <i 
                                      class="fas" 
                                      [class.fa-chevron-right]="!isNodeExpanded(item.path)"
                                      [class.fa-chevron-down]="isNodeExpanded(item.path)"
                                    ></i>
                                  </button>
                                } @else {
                                  <span class="tree-toggle-spacer"></span>
                                }
                                <span class="tree-key">{{ item.key }}:</span>
                                <span class="tree-type-badge" [attr.data-type]="item.type">
                                  {{ item.type }}
                                </span>
                                @if (item.hasChildren) {
                                  <span class="tree-value-summary">{{ item.display }}</span>
                                } @else {
                                  <span class="tree-value">{{ item.display }}</span>
                                }
                                <button 
                                  class="btn-copy-field" 
                                  (click)="copyField(item.value, item.path)"
                                  [title]="copiedField() === item.path ? 'Copied!' : 'Copy value'"
                                >
                                  @if (copiedField() === item.path) {
                                    <i class="fas fa-check"></i>
                                  } @else {
                                    <i class="far fa-copy"></i>
                                  }
                                </button>
                              </div>
                            </div>
                          }
                        </div>
                      } @else {
                        <div class="no-tree-data">
                          <i class="fas fa-info-circle"></i>
                          <p>No structured data to display</p>
                        </div>
                      }
                    </div>
                  } @else if (viewMode() === 'json' && isValidJson(msg.value)) {
                    <pre class="message-value formatted">{{ formatJson(msg.value) }}</pre>
                  } @else {
                    <pre class="message-value raw">{{ msg.value }}</pre>
                  }
                </div>
              </div>
            }

            <!-- Raw Tab -->
            @if (selectedTab() === 'raw') {
              <div class="detail-section">
                <div class="section-header">
                  <h2>
                    <i class="fas fa-file-alt"></i>
                    Raw Message Value
                  </h2>
                  <div class="section-actions">
                    <button class="btn-copy" (click)="copyMessageValue()" [title]="valueCopied() ? 'Copied!' : 'Copy Value'">
                      @if (valueCopied()) {
                        <i class="fas fa-check"></i>
                        Copied
                      } @else {
                        <i class="far fa-copy"></i>
                        Copy
                      }
                    </button>
                  </div>
                </div>
                <div class="message-value-container">
                  <pre class="message-value raw">{{ msg.value }}</pre>
                </div>
              </div>
            }
          </div>
        </div>
      } @else {
        <div class="detail-error">
          <i class="fas fa-inbox"></i>
          <h2>Message Not Found</h2>
          <p>The requested message could not be found.</p>
        </div>
      }
    </div>
  `,
  styles: [`
    .message-detail-page {
      min-height: 100vh;
      overflow-y: auto;
      overflow-x: hidden;
      scrollbar-width: thin;
      scrollbar-color: var(--theme-border-gray) transparent;
      background: #f5f7fa;
    }

    .message-detail-page::-webkit-scrollbar {
      width: 17px;
    }

    .message-detail-page::-webkit-scrollbar-track {
      background: transparent;
    }

    .message-detail-page::-webkit-scrollbar-thumb {
      background-color: var(--theme-border-gray);
      border-radius: 10px;
      border: 3px solid transparent;
      background-clip: content-box;
    }

    .message-detail-page::-webkit-scrollbar-thumb:hover {
      background-color: var(--theme-border-gray);
    }

    .detail-header {
      background: linear-gradient(135deg, var(--theme-button-primary-hover) 0%, var(--theme-button-primary) 50%, var(--theme-primary-teal-light) 100%);
      color: white;
      padding: 2rem;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2rem;
      flex-wrap: wrap;
    }

    .btn-back {
      background: rgba(255, 255, 255, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.3);
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .btn-back:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateX(-2px);
    }

    .detail-header h1 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      display: flex;
      align-items: center;
      gap: 1rem;
      flex: 1;
    }

    .header-actions {
      display: flex;
      gap: 0.75rem;
    }

    .btn-copy-link {
      background: rgba(16, 185, 129, 0.9);
      border: none;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .btn-copy-link:hover {
      background: rgba(16, 185, 129, 1);
      transform: translateY(-2px);
      box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
    }

    .detail-loading,
    .detail-error {
      max-width: 1400px;
      margin: 2rem auto;
      padding: 0 2rem;
    }

    .detail-error {
      text-align: center;
      padding: 4rem 2rem;
      background: var(--theme-bg-surface);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    }

    .detail-error i {
      font-size: var(--theme-font-page-title);
      color: #ef4444;
      margin-bottom: 1.5rem;
    }

    .detail-error h2 {
      font-size: var(--theme-font-page-title);
      color: var(--theme-text-gray-dark);
      margin: 0 0 0.5rem 0;
    }

    .detail-error p {
      color: var(--theme-text-gray);
      margin: 0 0 2rem 0;
    }

    .btn-retry {
      background: var(--theme-button-primary);
      border: none;
      color: white;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .btn-retry:hover {
      background: var(--theme-button-primary-hover);
      transform: translateY(-1px);
    }
    .error-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 0.75rem;
    }
    .btn-secondary-action {
      background: var(--theme-bg-app);
      border: 1px solid var(--theme-border-gray);
      color: var(--theme-table-header-color);
      padding: 0.75rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }
    .btn-secondary-action:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-gray);
    }

    .detail-content {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .detail-tabs {
      display: flex;
      background: var(--theme-bg-app);
      border-bottom: 2px solid var(--theme-border-gray);
      margin-bottom: 2rem;
      gap: 0.5rem;
      border-radius: 8px 8px 0 0;
      padding: 0.5rem 0.5rem 0 0.5rem;
    }

    .detail-tab {
      flex: 1;
      background: none;
      border: none;
      padding: 1rem 1.5rem;
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-gray);
      cursor: pointer;
      transition: all 0.2s;
      border-bottom: 3px solid transparent;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      border-radius: 6px 6px 0 0;
    }

    .detail-tab:hover {
      background: var(--theme-bg-app);
      color: var(--theme-text-gray-dark);
    }

    .detail-tab.active {
      color: var(--theme-text-teal);
      background: var(--theme-bg-surface);
      border-bottom-color: var(--theme-button-primary);
    }

    .detail-tab i {
      font-size: var(--theme-font-body);
    }

    .tab-content {
      min-height: 400px;
    }

    .subsection-header {
      padding: 1.5rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid var(--theme-border-gray);
    }

    .subsection-header h3 {
      margin: 0;
      font-size: var(--theme-font-section-title);
      color: var(--theme-text-gray-dark);
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .subsection-header h3 i {
      color: var(--theme-text-teal);
      font-size: var(--theme-font-body);
    }

    .detail-section {
      background: var(--theme-bg-surface);
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      overflow: hidden;
    }

    .section-header {
      padding: 1.5rem;
      border-bottom: 2px solid var(--theme-border-gray);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .section-header h2 {
      margin: 0;
      font-size: var(--theme-font-page-title);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray-dark);
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .section-header h2 i {
      color: var(--theme-text-teal);
    }

    .section-actions {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .view-toggle {
      display: flex;
      gap: 0.5rem;
      background: var(--theme-bg-app);
      padding: 0.25rem;
      border-radius: 6px;
    }

    .toggle-btn {
      padding: 0.5rem 0.75rem;
      background: transparent;
      border: none;
      border-radius: 4px;
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-gray);
      cursor: pointer;
      transition: all 0.2s;
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }

    .toggle-btn:hover {
      color: var(--theme-text-gray-dark);
      background: var(--theme-border-gray);
    }

    .toggle-btn.active {
      background: var(--theme-bg-surface);
      color: var(--theme-text-teal);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
    }

    .btn-copy {
      background: var(--theme-button-primary);
      border: none;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      cursor: pointer;
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-body-weight);
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }

    .btn-copy:hover {
      background: var(--theme-button-primary-hover);
    }

    .metadata-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1rem;
      padding: 1.5rem;
    }

    .metadata-card {
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray);
      border-radius: 8px;
      padding: 1rem;
      position: relative;
    }

    .metadata-label {
      font-size: var(--theme-font-table-header);
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .metadata-value {
      font-size: var(--theme-font-body);
      color: var(--theme-text-dark);
      font-weight: var(--theme-font-table-body-weight);
      word-break: break-word;
      padding-right: 2.5rem;
    }

    .btn-copy-small {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: var(--theme-bg-surface);
      border: 1px solid #d1d5db;
      color: var(--theme-text-gray);
      cursor: pointer;
      padding: 0.375rem;
      width: 32px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      transition: all 0.2s;
    }

    .btn-copy-small:hover {
      background: var(--theme-bg-app);
      border-color: var(--theme-border-teal);
      color: var(--theme-text-teal);
    }

    .btn-copy-small .fa-check {
      color: #10b981;
    }

    .headers-list {
      padding: 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .header-item {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--theme-bg-surface);
      border: 1px solid var(--theme-border-gray);
      border-radius: 8px;
      position: relative;
    }

    .header-key {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray);
      flex-shrink: 0;
    }

    .header-value {
      color: var(--theme-text-dark);
      flex: 1;
      word-break: break-word;
      padding-right: 2.5rem;
    }

    .message-value-container {
      padding: 1.5rem;
    }

    .message-value {
      margin: 0;
      padding: 1.5rem;
      border-radius: 8px;
      font-family: 'Courier New', Courier, monospace;
      font-size: var(--theme-font-body);
      line-height: 1.6;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message-value.formatted {
      background: var(--theme-text-dark);
      color: #a5f3fc;
    }

    .message-value.raw {
      background: var(--theme-text-dark);
      color: #fbbf24;
    }

    /* Tree View Styles */
    .tree-view-container {
      background: var(--theme-bg-surface);
      border-radius: 8px;
      padding: 1.5rem;
      max-height: 600px;
      overflow-y: auto;
    }

    .tree-nodes {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .tree-node {
      font-size: var(--theme-font-body);
      line-height: 1.5;
    }

    .tree-node-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .tree-node-header:hover {
      background: var(--theme-bg-app);
    }

    .tree-toggle {
      background: none;
      border: none;
      color: var(--theme-text-gray);
      cursor: pointer;
      padding: 0;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: color 0.2s;
    }

    .tree-toggle:hover {
      color: var(--theme-text-gray-dark);
    }

    .tree-toggle i {
      font-size: var(--theme-font-caption);
    }

    .tree-toggle-spacer {
      width: 16px;
      flex-shrink: 0;
    }

    .tree-key {
      font-weight: var(--theme-font-table-header-weight);
      color: var(--theme-text-gray-dark);
      flex-shrink: 0;
    }

    .tree-type-badge {
      font-size: var(--theme-font-caption);
      padding: 0.125rem 0.375rem;
      border-radius: 3px;
      font-weight: var(--theme-font-table-body-weight);
      text-transform: uppercase;
      flex-shrink: 0;
    }

    .tree-type-badge[data-type="string"] {
      background: var(--theme-bg-teal-lighter);
      color: #1e40af;
    }

    .tree-type-badge[data-type="number"] {
      background: #fef3c7;
      color: #92400e;
    }

    .tree-type-badge[data-type="boolean"] {
      background: #e0e7ff;
      color: var(--theme-text-teal-dark);
    }

    .tree-type-badge[data-type="object"] {
      background: #f3e8ff;
      color: #6b21a8;
    }

    .tree-type-badge[data-type="array"] {
      background: #fce7f3;
      color: #9f1239;
    }

    .tree-type-badge[data-type="nested-json"] {
      background: #d1fae5;
      color: #065f46;
    }

    .tree-type-badge[data-type="null"] {
      background: var(--theme-bg-app);
      color: var(--theme-text-gray);
    }

    .tree-value {
      color: var(--theme-text-gray);
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-value-summary {
      color: var(--theme-text-gray);
      flex: 1;
      font-style: italic;
      font-size: var(--theme-font-table-header);
    }

    .btn-copy-field {
      background: none;
      border: none;
      color: var(--theme-text-gray);
      cursor: pointer;
      padding: 0.25rem;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      opacity: 0;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .tree-node-header:hover .btn-copy-field {
      opacity: 1;
    }

    .btn-copy-field:hover {
      background: var(--theme-bg-app);
      color: var(--theme-text-teal);
    }

    .btn-copy-field i.fa-check {
      color: #10b981;
    }

    .no-tree-data {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 3rem 1rem;
      text-align: center;
      color: var(--theme-text-gray);
    }

    .no-tree-data i {
      font-size: var(--theme-font-page-title);
      margin-bottom: 1rem;
      color: var(--theme-border-gray);
    }

    .no-tree-data p {
      font-size: var(--theme-font-body);
      font-weight: var(--theme-font-table-body-weight);
      color: var(--theme-text-gray);
      margin: 0;
    }

    @media (max-width: 768px) {
      .header-content {
        flex-direction: column;
        align-items: flex-start;
      }

      .detail-header h1 {
        font-size: var(--theme-font-page-title);
      }

      .metadata-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class MessageDetailComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private kafkaService = inject(KafkaService);
  private viewportScaleService = inject(ViewportScaleService);
  private platformId = inject(PLATFORM_ID);

  // Signal to track the Y offset of this component from top of viewport
  private componentOffsetTop = signal<number>(0);
  
  // Dynamic height style for the page - accounts for header and padding
  pageHeightStyle = computed(() => {
    const baseHeight = this.viewportScaleService.baseHeight();
    const offsetTop = this.componentOffsetTop();
    
    // Calculate available height: baseHeight - offset from top
    const availableHeight = Math.max(baseHeight - offsetTop, 300); // Minimum 300px
    
    return {
      height: `${availableHeight}px`
    };
  });

  topicName = signal<string | null>(null);
  partition = signal<number | null>(null);
  offset = signal<number | null>(null);
  
  message = signal<KafkaMessage | null>(null);
  isLoading = signal(false);
  errorMessage = signal<string | null>(null);
  hasMissingParams = signal(false);
  
  viewMode = signal<'tree' | 'json' | 'raw'>('tree');
  linkCopied = signal(false);
  valueCopied = signal(false);
  copiedField = signal<string | null>(null);
  expandedNodes = signal<Set<string>>(new Set(['root']));
  selectedTab = signal<'metadata' | 'dynamic' | 'message' | 'raw'>('metadata');

  // List of keys to create dynamic tabs for
  dynamicTabKeys = ['payload'];
  
  // Current active dynamic tab key (if any)
  activeDynamicTabKey = signal<string | null>(null);
  
  // Computed signal to find which dynamic keys exist in the current message
  availableDynamicTabs = computed(() => {
    const msg = this.message();
    if (!msg || !this.isValidJson(msg.value)) {
      return [];
    }
    
    const parsed = this.parseJson(msg.value);
    if (!parsed || typeof parsed !== 'object') {
      return [];
    }
    
    const found: Array<{ key: string; displayName: string }> = [];
    
    for (const dynamicKey of this.dynamicTabKeys) {
      // Check both lowercase and capitalized versions
      const lowerKey = dynamicKey.toLowerCase();
      const capitalizedKey = lowerKey.charAt(0).toUpperCase() + lowerKey.slice(1);
      
      if (lowerKey in parsed || capitalizedKey in parsed) {
        found.push({
          key: lowerKey,
          displayName: capitalizedKey
        });
      }
    }
    
    return found;
  });

  ngOnInit(): void {
    // Calculate the offset from top of viewport
    this.calculateComponentOffset();
    
    // Recalculate on window resize
    if (isPlatformBrowser(this.platformId)) {
      window.addEventListener('resize', () => this.calculateComponentOffset());
    }
    
    // Read query parameters
    this.route.queryParams.subscribe(params => {
      this.topicName.set(params['topic'] || null);
      const partition = parseInt(params['partition']);
      const offset = parseInt(params['offset']);
      
      this.partition.set(isNaN(partition) ? null : partition);
      this.offset.set(isNaN(offset) ? null : offset);
      
      if (this.topicName() && this.partition() !== null && this.offset() !== null) {
        this.hasMissingParams.set(false);
        this.loadMessage();
      } else {
        this.hasMissingParams.set(true);
        this.errorMessage.set('Missing required parameters: topic, partition, and offset');
      }
    });
  }
  
  ngOnDestroy(): void {
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
      const element = document.querySelector('.message-detail-page');
      if (element) {
        const rect = element.getBoundingClientRect();
        const scale = this.viewportScaleService.scaleFactor();
        
        // Convert actual pixel offset to base coordinates
        const offsetInBaseCoords = rect.top / scale;
        
        this.componentOffsetTop.set(offsetInBaseCoords);
      }
    }, 0);
  }

  async loadMessage(): Promise<void> {
    const topic = this.topicName();
    const partition = this.partition();
    const offset = this.offset();
    
    if (!topic || partition === null || offset === null) {
      this.errorMessage.set('Missing required parameters');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    try {
      // Use the new dedicated endpoint to get message by offset
      const message = await this.kafkaService.getMessageByOffset(topic, partition, offset).toPromise();
      
      if (message) {
        this.message.set(message);
      } else {
        this.errorMessage.set('Message not found at the specified offset');
      }
    } catch (error: any) {
      console.error('Error loading message:', error);
      
      if (error?.status === 404) {
        this.errorMessage.set(
          error?.error?.error || `Message not found at offset ${offset} in partition ${partition}. ` +
          `The message may have been deleted, compacted, or the offset is outside the retention window.`
        );
      } else {
        this.errorMessage.set(
          error?.error?.error || error?.message || 'Failed to load message'
        );
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  navigateBack(): void {
    this.router.navigate(['/messages'], {
      queryParams: {
        view: 'deepdive',
        topic: this.topicName(),
        tab: 'messages'
      }
    });
  }

  goToMessagingScanning(): void {
    this.router.navigate(['/messages'], { queryParams: { view: 'scanning' } });
  }

  goToTopicDeepDive(): void {
    const topic = this.topicName();
    this.router.navigate(['/messages'], {
      queryParams: topic
        ? { view: 'deepdive', topic, tab: 'messages' }
        : { view: 'scanning' }
    });
  }

  async copyShareableLink(): Promise<void> {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  }

  async copyMessageValue(): Promise<void> {
    const msg = this.message();
    if (!msg) return;

    try {
      let textToCopy = msg.value;
      
      // Always format as JSON if valid JSON
      if (this.isValidJson(msg.value)) {
        textToCopy = this.formatJson(msg.value);
      }
      
      await navigator.clipboard.writeText(textToCopy);
      this.valueCopied.set(true);
      setTimeout(() => this.valueCopied.set(false), 2000);
    } catch (error) {
      console.error('Failed to copy value:', error);
    }
  }

  async copyDynamicValue(): Promise<void> {
    const msg = this.message();
    const dynamicKey = this.activeDynamicTabKey();
    if (!msg || !dynamicKey) return;

    try {
      let textToCopy = '';
      
      if (this.isValidJson(msg.value)) {
        const parsed = this.parseJson(msg.value);
        const dynamicValue = this.getDynamicKeyValue(parsed, dynamicKey);
        
        if (dynamicValue !== null) {
          // Try to parse as JSON and format
          const parsedDynamic = this.parsePayloadValue(dynamicValue);
          if (parsedDynamic !== null) {
            // It's valid JSON, format it
            textToCopy = this.formatJsonObject(parsedDynamic);
          } else {
            // Not valid JSON, copy raw value
            textToCopy = dynamicValue.toString();
          }
        } else {
          textToCopy = `No ${this.capitalizeFirstLetter(dynamicKey)} found in message`;
        }
      } else {
        textToCopy = msg.value;
      }
      
      await navigator.clipboard.writeText(textToCopy);
      this.valueCopied.set(true);
      setTimeout(() => this.valueCopied.set(false), 2000);
    } catch (error) {
      console.error('Failed to copy dynamic value:', error);
    }
  }

  async copyField(value: any, field: string): Promise<void> {
    try {
      let textToCopy = '';
      if (typeof value === 'object' && value !== null) {
        textToCopy = JSON.stringify(value, null, 2);
      } else {
        textToCopy = value?.toString() || '';
      }
      
      await navigator.clipboard.writeText(textToCopy);
      this.copiedField.set(field);
      setTimeout(() => {
        if (this.copiedField() === field) {
          this.copiedField.set(null);
        }
      }, 2000);
    } catch (error) {
      console.error('Failed to copy field:', error);
    }
  }

  getHeaders(headers: Record<string, string>): Array<{ key: string; value: string }> {
    return Object.entries(headers).map(([key, value]) => ({ key, value }));
  }

  formatTimestamp(timestamp: string): string {
    return new Date(timestamp).toLocaleString();
  }

  isValidJson(value: string): boolean {
    if (!value) return false;
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }

  formatJson(value: string): string {
    try {
      const parsed = JSON.parse(value);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return value;
    }
  }

  setViewMode(mode: 'tree' | 'json' | 'raw'): void {
    this.viewMode.set(mode);
    // Auto-expand root level on tree view
    if (mode === 'tree') {
      const expanded = new Set<string>();
      expanded.add('root');
      this.expandedNodes.set(expanded);
    }
  }

  // Tree view methods
  parseMessageToTree(value: string): any {
    try {
      const parsed = JSON.parse(value);
      return this.detectNestedJson(parsed);
    } catch {
      return { _raw: value, _type: 'text' };
    }
  }

  detectNestedJson(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    
    if (typeof obj === 'string') {
      // Try to detect and parse escaped JSON
      try {
        // Check for escaped JSON patterns
        if ((obj.includes('\\u0022') || obj.includes('\\"') || obj.includes('{"')) && 
            (obj.startsWith('{') || obj.startsWith('['))) {
          const unescaped = obj
            .replace(/\\u0022/g, '"')
            .replace(/\\"/g, '"')
            .replace(/\\\\/g, '\\');
          const parsed = JSON.parse(unescaped);
          return {
            _value: obj,
            _parsed: this.detectNestedJson(parsed),
            _type: 'nested-json'
          };
        }
      } catch {}
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.detectNestedJson(item));
    }
    
    if (typeof obj === 'object') {
      const result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.detectNestedJson(value);
      }
      return result;
    }
    
    return obj;
  }

  getTreeEntries(obj: any): [string, any][] {
    if (this.getNodeType(obj) === 'nested-json') {
      return Object.entries(obj._parsed);
    }
    if (this.getNodeType(obj) === 'text') {
      return [];
    }
    if (typeof obj === 'object' && obj !== null && !Array.isArray(obj)) {
      return Object.entries(obj).filter(([key]) => !key.startsWith('_'));
    }
    if (Array.isArray(obj)) {
      return obj.map((item, index) => [index.toString(), item]);
    }
    return [];
  }

  toggleNode(path: string): void {
    const expanded = this.expandedNodes();
    const newExpanded = new Set(expanded);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    this.expandedNodes.set(newExpanded);
  }

  isNodeExpanded(path: string): boolean {
    return this.expandedNodes().has(path);
  }

  getNodeType(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object' && value._type === 'nested-json') return 'nested-json';
    if (typeof value === 'object' && value._type === 'text') return 'text';
    if (Array.isArray(value)) return 'array';
    if (typeof value === 'object') return 'object';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'unknown';
  }

  getNodeDisplay(value: any): string {
    const type = this.getNodeType(value);
    
    if (type === 'nested-json') {
      return 'Nested JSON (parsed)';
    }
    if (type === 'text') {
      return value._raw.substring(0, 100) + (value._raw.length > 100 ? '...' : '');
    }
    if (type === 'null') return 'null';
    if (type === 'undefined') return 'undefined';
    if (type === 'array') return `Array (${value.length} items)`;
    if (type === 'object') {
      const keys = Object.keys(value).filter(k => !k.startsWith('_'));
      return `Object (${keys.length} ${keys.length === 1 ? 'property' : 'properties'})`;
    }
    if (type === 'string') {
      const str = value.toString();
      return str.length > 50 ? `"${str.substring(0, 50)}..."` : `"${str}"`;
    }
    return value.toString();
  }

  renderTreeNode(value: any, basePath: string, depth: number): Array<{
    key: string;
    value: any;
    path: string;
    type: string;
    display: string;
    hasChildren: boolean;
    depth: number;
  }> {
    const result: Array<{
      key: string;
      value: any;
      path: string;
      type: string;
      display: string;
      hasChildren: boolean;
      depth: number;
    }> = [];
    
    const entries = this.getTreeEntries(value);
    
    for (const [key, val] of entries) {
      const path = `${basePath}.${key}`;
      const type = this.getNodeType(val);
      const hasChildren = (type === 'object' || type === 'array' || type === 'nested-json');
      
      result.push({
        key,
        value: val,
        path,
        type,
        display: this.getNodeDisplay(val),
        hasChildren,
        depth
      });
      
      // If expanded and has children, recursively add children
      if (hasChildren && this.isNodeExpanded(path)) {
        const children = this.renderTreeNode(val, path, depth + 1);
        result.push(...children);
      }
    }
    
    return result;
  }

  getDynamicKeyValue(parsed: any, key: string): any {
    if (!parsed || typeof parsed !== 'object') return null;
    
    const lowerKey = key.toLowerCase();
    const capitalizedKey = lowerKey.charAt(0).toUpperCase() + lowerKey.slice(1);
    
    // Check both lowercase and capitalized versions
    if (capitalizedKey in parsed) {
      return parsed[capitalizedKey];
    }
    
    if (lowerKey in parsed) {
      return parsed[lowerKey];
    }
    
    return null;
  }
  
  capitalizeFirstLetter(str: string): string {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
  
  parsePayloadValue(payloadValue: any): any {
    // If it's already an object or array, return it
    if (typeof payloadValue === 'object' && payloadValue !== null) {
      return payloadValue;
    }
    
    // If it's a string, try to parse it as JSON
    if (typeof payloadValue === 'string') {
      try {
        return JSON.parse(payloadValue);
      } catch {
        return null; // Not valid JSON
      }
    }
    
    // For other types (number, boolean), return null to show raw view
    return null;
  }
  
  parseJson(value: string): any {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  
  formatJsonObject(obj: any): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  setTab(tab: 'metadata' | 'message' | 'raw'): void {
    this.selectedTab.set(tab);
    // Clear dynamic tab key if not on dynamic tab
    this.activeDynamicTabKey.set(null);
    // Auto-expand root level on tree view
    if (tab === 'message' && this.viewMode() === 'tree') {
      const expanded = new Set<string>();
      expanded.add('root');
      this.expandedNodes.set(expanded);
    }
  }

  setDynamicTab(key: string): void {
    this.selectedTab.set('dynamic');
    this.activeDynamicTabKey.set(key);
    // Auto-expand root level on dynamic tab tree view
    if (this.viewMode() === 'tree') {
      const expanded = new Set<string>();
      expanded.add(this.capitalizeFirstLetter(key));
      this.expandedNodes.set(expanded);
    }
  }
}

