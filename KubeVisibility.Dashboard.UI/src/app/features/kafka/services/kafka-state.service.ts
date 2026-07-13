import { Injectable, signal, computed, inject } from '@angular/core';
import { KafkaService } from '../../../core/services/api/kafka.service';
import {
  TopicInfo,
  MessageSearchRequest,
  MessageSearchResponse,
  KafkaMessage,
  ConsumerGroupInfo,
  ConsumerGroupSummary,
  ConsumerGroupDetail,
} from '../../../core/models/kafka.models';

export type KafkaViewMode = 'scanning' | 'deepdive';

@Injectable({
  providedIn: 'root',
})
export class KafkaStateService {
  private kafkaService = inject(KafkaService);
  private _refreshCallbacks = new Map<string, () => Promise<void>>();

  // Core state signals
  private _topics = signal<TopicInfo[]>([]);
  private _consumerGroups = signal<ConsumerGroupInfo[]>([]);
  private _consumerGroupSummaries = signal<ConsumerGroupSummary[]>([]);
  private _allConsumerGroupDetails = signal<ConsumerGroupDetail[]>([]);
  private _selectedTopic = signal<string | null>(null);
  private _currentView = signal<KafkaViewMode>('scanning');
  private _currentTab = signal<'overview' | 'messages' | 'consumers' | 'settings' | 'statistics'>('overview');
  private _searchRequest = signal<MessageSearchRequest | null>(null);
  private _searchResults = signal<MessageSearchResponse | null>(null);
  private _searchQuery = signal<string>('');
  private _selectedMessage = signal<KafkaMessage | null>(null);
  private _loadingStates = signal<Record<string, boolean>>({});
  private _lastUpdated = signal<Date>(new Date());

  // Public readonly signals
  readonly topics = this._topics.asReadonly();
  readonly consumerGroups = this._consumerGroups.asReadonly();
  readonly consumerGroupSummaries = this._consumerGroupSummaries.asReadonly();
  readonly allConsumerGroupDetails = this._allConsumerGroupDetails.asReadonly();
  readonly selectedTopic = this._selectedTopic.asReadonly();
  readonly currentView = this._currentView.asReadonly();
  readonly currentTab = this._currentTab.asReadonly();
  readonly searchRequest = this._searchRequest.asReadonly();
  readonly searchResults = this._searchResults.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly selectedMessage = this._selectedMessage.asReadonly();
  readonly loadingStates = this._loadingStates.asReadonly();
  readonly lastUpdated = this._lastUpdated.asReadonly();

  // Computed signals
  readonly filteredTopics = computed(() => {
    const topics = this._topics();
    const query = this._searchQuery().toLowerCase().trim();
    
    if (!query) {
      return topics;
    }
    
    return topics.filter(topic => 
      topic.name.toLowerCase().includes(query)
    );
  });

  readonly filteredConsumerGroupSummaries = computed(() => {
    const summaries = this._consumerGroupSummaries();
    const query = this._searchQuery().toLowerCase().trim();
    
    if (!query) {
      return summaries;
    }
    
    return summaries.filter(summary => 
      summary.groupId.toLowerCase().includes(query)
    );
  });

  // Get consumer groups for a specific topic (client-side filtering)
  getConsumerGroupsForTopic(topicName: string): ConsumerGroupDetail[] {
    const allDetails = this._allConsumerGroupDetails();
    return allDetails.filter(
      (group) => group.topics && group.topics.some((topic) => topic.toLowerCase() === topicName.toLowerCase())
    );
  }

  // Methods
  setCurrentView(view: KafkaViewMode): void {
    this._currentView.set(view);
  }

  setCurrentTab(tab: 'overview' | 'messages' | 'consumers' | 'settings' | 'statistics'): void {
    this._currentTab.set(tab);
  }

  setSelectedTopic(topic: string | null): void {
    this._selectedTopic.set(topic);
    // When topic is selected, switch to deep-dive view if not already
    if (topic && this._currentView() === 'scanning') {
      this._currentView.set('deepdive');
    }
  }

  setSearchRequest(request: MessageSearchRequest): void {
    this._searchRequest.set(request);
  }

  setSearchResults(results: MessageSearchResponse): void {
    this._searchResults.set(results);
    this._lastUpdated.set(new Date());
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setSelectedMessage(message: KafkaMessage | null): void {
    this._selectedMessage.set(message);
  }

  setLoadingState(key: string, loading: boolean): void {
    this._loadingStates.update((states) => ({
      ...states,
      [key]: loading,
    }));
  }

  async loadTopics(): Promise<void> {
    this.setLoadingState('topics', true);
    try {
      const response = await this.kafkaService.getTopics().toPromise();
      if (response) {
        this._topics.set(response.topics);
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error('Error loading topics:', error);
      throw error;
    } finally {
      this.setLoadingState('topics', false);
    }
  }

  async loadConsumerGroups(topicName?: string): Promise<void> {
    this.setLoadingState('consumerGroups', true);
    try {
      const response = await this.kafkaService.getConsumerGroups(topicName).toPromise();
      if (response) {
        this._consumerGroups.set(response.groups);
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error('Error loading consumer groups:', error);
      throw error;
    } finally {
      this.setLoadingState('consumerGroups', false);
    }
  }

  async loadConsumerGroupSummaries(): Promise<void> {
    this.setLoadingState('consumerGroupSummaries', true);
    try {
      const response = await this.kafkaService.getConsumerGroupSummaries().toPromise();
      if (response) {
        this._consumerGroupSummaries.set(response.summaries);
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error('Error loading consumer group summaries:', error);
      throw error;
    } finally {
      this.setLoadingState('consumerGroupSummaries', false);
    }
  }

  async loadAllConsumerGroupDetails(): Promise<void> {
    this.setLoadingState('allConsumerGroupDetails', true);
    try {
      const response = await this.kafkaService.getAllConsumerGroupDetails().toPromise();
      if (response) {
        this._allConsumerGroupDetails.set(response.groups);
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error('Error loading all consumer group details:', error);
      throw error;
    } finally {
      this.setLoadingState('allConsumerGroupDetails', false);
    }
  }

  async searchMessages(request: MessageSearchRequest): Promise<void> {
    this.setLoadingState('search', true);
    try {
      const response = await this.kafkaService.searchMessages(request).toPromise();
      if (response) {
        this.setSearchResults(response);
      }
    } catch (error) {
      console.error('Error searching messages:', error);
      throw error;
    } finally {
      this.setLoadingState('search', false);
    }
  }

  clearSearch(): void {
    this._searchRequest.set(null);
    this._searchResults.set(null);
    this._selectedMessage.set(null);
  }

  /**
   * Update a specific consumer group in the cached all consumer group details
   * Used when refreshing individual group details
   */
  updateConsumerGroupDetail(updatedGroup: ConsumerGroupDetail): void {
    const allGroups = this._allConsumerGroupDetails();
    const updatedGroups = allGroups.map(g => 
      g.groupId === updatedGroup.groupId ? updatedGroup : g
    );
    this._allConsumerGroupDetails.set(updatedGroups);
  }

  /**
   * Set all consumer group details (used for caching)
   */
  setAllConsumerGroupDetails(groups: ConsumerGroupDetail[]): void {
    this._allConsumerGroupDetails.set(groups);
  }

  registerRefreshCallback(contextId: string, callback: () => Promise<void>): void {
    this._refreshCallbacks.set(contextId, callback);
  }

  unregisterRefreshCallback(contextId: string): void {
    this._refreshCallbacks.delete(contextId);
  }

  getRefreshCallback(contextId: string): (() => Promise<void>) | undefined {
    return this._refreshCallbacks.get(contextId);
  }
}

