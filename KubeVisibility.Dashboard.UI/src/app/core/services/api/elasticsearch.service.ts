import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export interface ElasticsearchLogsRequest {
  serviceName?: string;
  podName?: string;
  logKey?: string;
  message?: string;
  logLevels?: string[];
  timeFrom?: string;  // ISO 8601 format
  timeTo?: string;    // ISO 8601 format
  size?: number;
  from?: number;     // Pagination offset
}

export interface ElasticsearchLogEntry {
  timestamp: string;
  serviceName?: string;
  podName?: string;
  message?: string;
  logLevel?: string;
  logKey?: string;
  exception?: string;
  additionalFields?: { [key: string]: any };
}

export interface ElasticsearchLogsResponse {
  logs: ElasticsearchLogEntry[];
  total: number;
}

export interface ErrorAnalyticsResponse {
  errorGroups: ErrorGroup[];
  totalErrors: number; // Sum of all error group counts
  totalErrorDocuments: number; // Total number of error log documents
  timeFrom: string;
  timeTo: string;
}

export interface ErrorGroup {
  errorMessage: string;
  normalizedMessage: string;
  count: number;
  similarityScore?: number;
  serviceName?: string;
  logKey?: string;
  firstOccurrence: string;
  lastOccurrence: string;
  sampleLogs: ElasticsearchLogEntry[];
}

export interface SimilarErrorsResponse {
  originalMessage: string;
  serviceName?: string;
  includeAllServices?: boolean;
  days?: number;
  strictPattern?: boolean;
  queryMode?: 'fuzzy' | 'exact' | string;
  requestedGroups?: number;
  candidateCount?: number;
  groupCount?: number;
  elapsedMs?: number;
  similarErrors: ErrorGroup[];
}

export interface TopicErrorsRequest {
  timeFrom?: string;  // ISO 8601 format
  timeTo?: string;   // ISO 8601 format
  serviceName?: string;
}

export interface TopicErrorEntry {
  applicationName: string;
  serviceName?: string;
  message?: string;
  exception?: string;
  topicName: string;
  offset?: number;
  partition?: number;
  timestamp: string;
}

export interface TopicErrorsResponse {
  errors: TopicErrorEntry[];
  total: number;
}

@Injectable({
  providedIn: 'root',
})
export class ElasticsearchService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/elasticsearch`;

  getLogs(request: ElasticsearchLogsRequest): Observable<ElasticsearchLogsResponse> {
    let params = new HttpParams();
    if (request.serviceName) params = params.set('serviceName', request.serviceName);
    if (request.podName) params = params.set('podName', request.podName);
    if (request.logKey) params = params.set('logKey', request.logKey);
    if (request.message) params = params.set('message', request.message);
    if (request.logLevels?.length) {
      request.logLevels.forEach(level => {
        params = params.append('logLevel', level);
      });
    }
    if (request.timeFrom) params = params.set('timeFrom', request.timeFrom);
    if (request.timeTo) params = params.set('timeTo', request.timeTo);
    if (request.size) params = params.set('size', request.size.toString());
    if (request.from !== undefined) params = params.set('from', request.from.toString());
    
    return this.http.get<ElasticsearchLogsResponse>(`${this.apiUrl}/logs`, { params });
  }

  getErrorAnalytics(serviceName?: string, days: number = 7, minCount: number = 1): Observable<ErrorAnalyticsResponse> {
    let params = new HttpParams();
    if (serviceName) params = params.set('serviceName', serviceName);
    params = params.set('days', days.toString());
    params = params.set('minCount', minCount.toString());
    
    return this.http.get<ErrorAnalyticsResponse>(`${this.apiUrl}/errors/analytics`, { params });
  }

  getSimilarErrors(
    serviceName: string,
    errorMessage: string,
    days: number = 7,
    maxResults: number = 10,
    strictPattern: boolean = false,
    includeAllServices: boolean = false
  ): Observable<SimilarErrorsResponse> {
    let params = new HttpParams();
    params = params.set('serviceName', serviceName);
    params = params.set('errorMessage', errorMessage);
    params = params.set('days', days.toString());
    params = params.set('maxResults', maxResults.toString());
    params = params.set('strictPattern', strictPattern ? 'true' : 'false');
    params = params.set('includeAllServices', includeAllServices ? 'true' : 'false');
    
    return this.http.get<SimilarErrorsResponse>(`${this.apiUrl}/errors/similar`, { params });
  }

  getTopicErrors(request?: TopicErrorsRequest): Observable<TopicErrorsResponse> {
    let params = new HttpParams();
    if (request?.timeFrom) params = params.set('timeFrom', request.timeFrom);
    if (request?.timeTo) params = params.set('timeTo', request.timeTo);
    if (request?.serviceName) params = params.set('serviceName', request.serviceName);
    
    return this.http.get<TopicErrorsResponse>(`${this.apiUrl}/errors/topics`, { params });
  }
}

