import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  TopicAlertGroup,
  TopicAlertRule,
  UpsertTopicAlertGroupRequest,
  UpsertTopicAlertRuleRequest,
} from '../../models/topic-alerting.models';

@Injectable({
  providedIn: 'root',
})
export class TopicAlertingApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiBaseUrl}/api/topic-alerting`;

  getGroups(): Observable<TopicAlertGroup[]> {
    return this.http.get<TopicAlertGroup[]>(`${this.apiUrl}/groups`);
  }

  createGroup(request: UpsertTopicAlertGroupRequest): Observable<TopicAlertGroup> {
    return this.http.post<TopicAlertGroup>(`${this.apiUrl}/groups`, request);
  }

  updateGroup(groupId: string, request: UpsertTopicAlertGroupRequest): Observable<TopicAlertGroup> {
    return this.http.put<TopicAlertGroup>(`${this.apiUrl}/groups/${encodeURIComponent(groupId)}`, request);
  }

  deleteGroup(groupId: string): Observable<{ success: boolean; groupId: string }> {
    return this.http.delete<{ success: boolean; groupId: string }>(`${this.apiUrl}/groups/${encodeURIComponent(groupId)}`);
  }

  getRules(): Observable<TopicAlertRule[]> {
    return this.http.get<TopicAlertRule[]>(`${this.apiUrl}/rules`);
  }

  createRule(request: UpsertTopicAlertRuleRequest): Observable<TopicAlertRule> {
    return this.http.post<TopicAlertRule>(`${this.apiUrl}/rules`, request);
  }

  updateRule(ruleId: string, request: UpsertTopicAlertRuleRequest): Observable<TopicAlertRule> {
    return this.http.put<TopicAlertRule>(`${this.apiUrl}/rules/${encodeURIComponent(ruleId)}`, request);
  }

  deleteRule(ruleId: string): Observable<{ success: boolean; ruleId: string }> {
    return this.http.delete<{ success: boolean; ruleId: string }>(`${this.apiUrl}/rules/${encodeURIComponent(ruleId)}`);
  }

  setRuleEnabled(ruleId: string, enabled: boolean): Observable<TopicAlertRule> {
    const url = `${this.apiUrl}/rules/${encodeURIComponent(ruleId)}/enabled?enabled=${enabled ? 'true' : 'false'}`;
    return this.http.patch<TopicAlertRule>(url, null);
  }
}
