import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AuthService } from '../auth.service';
import {
  TopicsResponse,
  TopicInfo,
  MessageSearchRequest,
  MessageSearchResponse,
  KafkaMessage,
  RequeueRequest,
  RequeueResponse,
  ConsumerGroupResponse,
  ConsumerGroupDetailResponse,
  ConsumerGroupSummariesResponse,
  ConsumerGroupDetailsResponse,
  TopicPartitionsResponse,
  SearchProgress,
  ConsumerGroupTopicAssociationsResponse,
  KafkaConfig,
} from '../../models/kafka.models';

@Injectable({
  providedIn: 'root',
})
export class KafkaService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private apiUrl = `${environment.apiBaseUrl}/api/kafka`;

  getTopics(): Observable<TopicsResponse> {
    return this.http.get<TopicsResponse>(`${this.apiUrl}/topics`);
  }

  getTopicInfo(topicName: string): Observable<TopicInfo> {
    return this.http.get<TopicInfo>(`${this.apiUrl}/topics/${topicName}`);
  }

  searchMessages(request: MessageSearchRequest): Observable<MessageSearchResponse> {
    return this.http.post<MessageSearchResponse>(`${this.apiUrl}/messages/search`, request);
  }

  getMessageCount(request: MessageSearchRequest): Observable<number> {
    return this.http.post<number>(`${this.apiUrl}/messages/count`, request);
  }

  /**
   * Stream search messages with real-time progress updates using Server-Sent Events
   * Following Single Responsibility Principle - this method only manages the SSE connection
   * Note: EventSource doesn't support custom headers, so we pass the token as a query parameter
   */
  searchMessagesStream(
    request: MessageSearchRequest,
    onProgress: (update: SearchProgress) => void,
    onComplete: () => void,
    onError: (error: string) => void
  ): () => void {
    // Get authentication token
    const token = this.authService.getAccessToken();
    
    if (!token) {
      onError('Authentication token not available');
      return () => {};
    }

    // Build URL with query parameters
    let url = `${this.apiUrl}/messages/search-stream?topic=${encodeURIComponent(request.topic)}&pageSize=${request.pageSize}`;
    
    // Add authentication token as query parameter (EventSource doesn't support headers)
    url += `&access_token=${encodeURIComponent(token)}`;
    
    if (request.key) {
      url += `&key=${encodeURIComponent(request.key)}`;
    }
    if (request.value) {
      url += `&value=${encodeURIComponent(request.value)}`;
    }
    if (request.partition !== null && request.partition !== undefined) {
      url += `&partition=${request.partition}`;
    }
    if (request.timeRange) {
      url += `&startTime=${encodeURIComponent(request.timeRange.startTime)}`;
      url += `&endTime=${encodeURIComponent(request.timeRange.endTime)}`;
    }

    const eventSource = new EventSource(url, {
      withCredentials: true
    });

    eventSource.onmessage = (event) => {
      try {
        const update: SearchProgress = JSON.parse(event.data);
        
        if (update.status === 'complete') {
          onComplete();
          eventSource.close();
        } else if (update.status === 'error') {
          onError(update.error || 'Unknown error occurred');
          eventSource.close();
        } else {
          onProgress(update);
        }
      } catch (err) {
        console.error('Error parsing SSE data:', err);
        onError('Failed to parse server response');
        eventSource.close();
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      onError('Connection error occurred');
      eventSource.close();
    };

    // Return cleanup function following Open/Closed Principle
    return () => {
      eventSource.close();
    };
  }

  requeueMessages(request: RequeueRequest): Observable<RequeueResponse> {
    return this.http.post<RequeueResponse>(`${this.apiUrl}/messages/requeue`, request);
  }

  getConsumerGroups(topicName?: string): Observable<ConsumerGroupResponse> {
    let params = new HttpParams();
    if (topicName) {
      params = params.set('topic', topicName);
    }
    return this.http.get<ConsumerGroupResponse>(`${this.apiUrl}/consumer-groups`, { params });
  }

  getConsumerGroupInfo(groupId: string, topicName: string): Observable<ConsumerGroupDetailResponse> {
    return this.http.get<ConsumerGroupDetailResponse>(
      `${this.apiUrl}/consumer-groups/${groupId}/topics/${topicName}`
    );
  }

  getConsumerGroupSummaries(): Observable<ConsumerGroupSummariesResponse> {
    return this.http.get<ConsumerGroupSummariesResponse>(`${this.apiUrl}/consumer-groups/consumer-group`);
  }

  getConsumerGroupDetails(topicName: string): Observable<ConsumerGroupDetailsResponse> {
    const params = new HttpParams().set('topic', topicName);
    return this.http.get<ConsumerGroupDetailsResponse>(`${this.apiUrl}/consumer-groups/details`, { params });
  }

  getAllConsumerGroupDetails(): Observable<ConsumerGroupDetailsResponse> {
    return this.http.get<ConsumerGroupDetailsResponse>(`${this.apiUrl}/consumer-groups/all-details`);
  }

  getConsumerGroupDetailsById(groupId: string): Observable<ConsumerGroupDetailsResponse> {
    return this.http.get<ConsumerGroupDetailsResponse>(`${this.apiUrl}/consumer-groups/${groupId}`);
  }

  getTopicPartitions(topicName: string): Observable<TopicPartitionsResponse> {
    return this.http.get<TopicPartitionsResponse>(`${this.apiUrl}/topics/${topicName}/partitions`);
  }

  getConsumerGroupTopicAssociations(topicName?: string): Observable<ConsumerGroupTopicAssociationsResponse> {
    let params = new HttpParams();
    if (topicName) {
      params = params.set('topic', topicName);
    }
    return this.http.get<ConsumerGroupTopicAssociationsResponse>(
      `${this.apiUrl}/consumer-groups/associations`,
      { params }
    );
  }

  /**
   * Get a specific message by topic, partition, and offset
   * Uses the dedicated backend endpoint: GET /api/kafka/messages/by-offset
   */
  getMessageByOffset(topic: string, partition: number, offset: number): Observable<KafkaMessage> {
    return this.http.get<KafkaMessage>(
      `${this.apiUrl}/messages/by-offset?topic=${encodeURIComponent(topic)}&partition=${partition}&offset=${offset}`
    );
  }

  /**
   * Get Kafka configuration settings (date range limits, etc.)
   * Uses the dedicated backend endpoint: GET /api/kafka/messages/config
   */
  getKafkaConfig(): Observable<KafkaConfig> {
    return this.http.get<KafkaConfig>(`${this.apiUrl}/messages/config`);
  }
}




