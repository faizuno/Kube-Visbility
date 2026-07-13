import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  HealthOverview,
  KafkaHealthSummary,
  ApplicationHealthSummary,
  NodeHealthResponse,
  NodeMetricsResponse,
  NodePrometheusMetricsCurrentResponse,
  NodePrometheusMetricsTimeSeriesResponse,
  ApplicationHealthResponse,
  NamespaceHealthResponse,
  ResourceSummaryResponse,
  KafkaClusterHealth,
  KafkaBrokerHealthResponse,
  TopicHealthSummaryResponse,
  ConsumerLagSummaryResponse,
  PrometheusAlertStats,
  PrometheusFiringAlertsPage,
  SuppressPrometheusAlertRequest,
  EditPrometheusSuppressionRequest,
  PrometheusSuppression,
  PrometheusAlertRuleProposal,
  CreatePrometheusAlertRuleProposalRequest,
  UpdatePrometheusAlertRuleProposalRequest,
  PrometheusRuleDefinition,
  ApplyPrometheusRuleRequest,
  ApplyPrometheusRuleResponse,
  AlertGroupDefinition,
  AlertGroupUpdateRequest,
  AlertRouteBinding,
  TimeSeriesMetrics,
  ServicesHealthResponse,
  ConsumersHealthResponse,
  JobsHealthResponse
} from '../models/health.models';

@Injectable({
  providedIn: 'root'
})
export class HealthApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiBaseUrl}/api/health`;

  /**
   * Gets overall system health overview
   */
  getHealthOverview(): Observable<HealthOverview> {
    return this.http.get<HealthOverview>(`${this.apiUrl}/overview`);
  }

  /**
   * Gets Kafka health summary only
   */
  getKafkaOverview(): Observable<KafkaHealthSummary> {
    return this.http.get<KafkaHealthSummary>(`${this.apiUrl}/overview/kafka`);
  }

  /**
   * Gets Application health summary only
   */
  getApplicationOverview(): Observable<ApplicationHealthSummary> {
    return this.http.get<ApplicationHealthSummary>(`${this.apiUrl}/overview/application`);
  }

  /**
   * Gets Kubernetes node health information
   */
  getNodeHealth(): Observable<NodeHealthResponse> {
    return this.http.get<NodeHealthResponse>(`${this.apiUrl}/kubernetes/nodes`);
  }

  /**
   * Gets current node metrics from Prometheus (CPU, memory, disk % per node).
   */
  getNodeMetricsCurrentFromPrometheus(): Observable<NodePrometheusMetricsCurrentResponse> {
    return this.http.get<NodePrometheusMetricsCurrentResponse>(`${this.apiUrl}/kubernetes/nodes/metrics/current`);
  }

  /**
   * Gets node metrics time series from Prometheus for charts.
   */
  getNodeMetricsSeriesFromPrometheus(params: {
    nodeName?: string;
    start?: string;
    end?: string;
    step?: string;
  }): Observable<NodePrometheusMetricsTimeSeriesResponse[]> {
    let httpParams = new HttpParams();
    if (params.nodeName) httpParams = httpParams.set('nodeName', params.nodeName);
    if (params.start) httpParams = httpParams.set('start', params.start);
    if (params.end) httpParams = httpParams.set('end', params.end);
    if (params.step) httpParams = httpParams.set('step', params.step);
    return this.http.get<NodePrometheusMetricsTimeSeriesResponse[]>(
      `${this.apiUrl}/kubernetes/nodes/metrics/series`,
      { params: httpParams }
    );
  }

  /**
   * Gets metrics for a specific node
   */
  getNodeMetrics(
    nodeName: string,
    startTime?: Date,
    endTime?: Date
  ): Observable<NodeMetricsResponse> {
    let params = new HttpParams();
    
    if (startTime) {
      params = params.set('startTime', startTime.toISOString());
    }
    if (endTime) {
      params = params.set('endTime', endTime.toISOString());
    }

    return this.http.get<NodeMetricsResponse>(
      `${this.apiUrl}/kubernetes/nodes/${nodeName}/metrics`,
      { params }
    );
  }

  /**
   * Gets application health aggregated by namespace
   */
  getApplicationHealth(): Observable<ApplicationHealthResponse> {
    return this.http.get<ApplicationHealthResponse>(`${this.apiUrl}/applications`);
  }

  /**
   * Gets health information for a specific namespace
   */
  getNamespaceHealth(namespaceName: string): Observable<NamespaceHealthResponse> {
    return this.http.get<NamespaceHealthResponse>(
      `${this.apiUrl}/applications/${namespaceName}`
    );
  }

  /**
   * Gets resource summary across namespaces
   */
  getResourceSummary(): Observable<ResourceSummaryResponse> {
    return this.http.get<ResourceSummaryResponse>(
      `${this.apiUrl}/kubernetes/resources/summary`
    );
  }

  /**
   * Gets Kafka cluster health
   */
  getKafkaClusterHealth(): Observable<KafkaClusterHealth> {
    return this.http.get<KafkaClusterHealth>(`${this.apiUrl}/kafka/cluster`);
  }

  /**
   * Gets Kafka broker health
   */
  getBrokerHealth(): Observable<KafkaBrokerHealthResponse> {
    return this.http.get<KafkaBrokerHealthResponse>(`${this.apiUrl}/kafka/brokers`);
  }

  /**
   * Gets topic health summary
   */
  getTopicHealthSummary(): Observable<TopicHealthSummaryResponse> {
    return this.http.get<TopicHealthSummaryResponse>(`${this.apiUrl}/kafka/topics/health`);
  }

  /**
   * Gets consumer lag summary
   */
  getConsumerLagSummary(topicNames?: string[]): Observable<ConsumerLagSummaryResponse> {
    let params = new HttpParams();
    
    if (topicNames && topicNames.length > 0) {
      topicNames.forEach(topic => {
        params = params.append('topicNames', topic);
      });
    }

    return this.http.get<ConsumerLagSummaryResponse>(
      `${this.apiUrl}/kafka/consumers/lag`,
      { params }
    );
  }

  /**
   * Gets aggregate stats for Prometheus alerts in a selected range.
   */
  getPrometheusAlertStats(rangeHours?: number): Observable<PrometheusAlertStats> {
    let params = new HttpParams();
    if (typeof rangeHours === 'number') {
      params = params.set('rangeHours', rangeHours);
    }

    return this.http.get<PrometheusAlertStats>(`${environment.apiBaseUrl}/api/prometheus-alerts/stats`, { params });
  }

  /**
   * Searches alerts that fired in a selected range.
   */
  getPrometheusFiringAlerts(params: {
    severity?: string;
    namespaceName?: string;
    alertName?: string;
    rangeHours?: number;
    limit?: number;
    offset?: number;
  }): Observable<PrometheusFiringAlertsPage> {
    let httpParams = new HttpParams();
    if (params.severity) httpParams = httpParams.set('severity', params.severity);
    if (params.namespaceName) httpParams = httpParams.set('namespace', params.namespaceName);
    if (params.alertName) httpParams = httpParams.set('alertName', params.alertName);
    if (typeof params.rangeHours === 'number') httpParams = httpParams.set('rangeHours', params.rangeHours);
    if (typeof params.limit === 'number') httpParams = httpParams.set('limit', params.limit);
    if (typeof params.offset === 'number') httpParams = httpParams.set('offset', params.offset);

    return this.http.get<PrometheusFiringAlertsPage>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/firing/search`,
      { params: httpParams }
    );
  }

  suppressPrometheusAlert(request: SuppressPrometheusAlertRequest): Observable<PrometheusSuppression> {
    return this.http.post<PrometheusSuppression>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/suppress`,
      request
    );
  }

  editPrometheusSuppression(silenceId: string, request: EditPrometheusSuppressionRequest): Observable<PrometheusSuppression> {
    return this.http.put<PrometheusSuppression>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/suppress/${encodeURIComponent(silenceId)}`,
      request
    );
  }

  unsuppressPrometheusAlert(silenceId: string, reason?: string): Observable<{ success: boolean; silenceId: string }> {
    let params = new HttpParams();
    if (reason) params = params.set('reason', reason);
    return this.http.delete<{ success: boolean; silenceId: string }>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/suppress/${encodeURIComponent(silenceId)}`,
      { params }
    );
  }

  getPrometheusSuppressions(): Observable<PrometheusSuppression[]> {
    return this.http.get<PrometheusSuppression[]>(`${environment.apiBaseUrl}/api/prometheus-alerts/suppressions`);
  }

  getPrometheusRuleDefinitions(): Observable<PrometheusRuleDefinition[]> {
    return this.http.get<PrometheusRuleDefinition[]>(`${environment.apiBaseUrl}/api/prometheus-alerts/rules`);
  }

  getPrometheusRuleDefinition(alertName: string): Observable<PrometheusRuleDefinition> {
    return this.http.get<PrometheusRuleDefinition>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/rules/${encodeURIComponent(alertName)}`
    );
  }

  applyPrometheusRuleDefinition(request: ApplyPrometheusRuleRequest): Observable<ApplyPrometheusRuleResponse> {
    return this.http.post<ApplyPrometheusRuleResponse>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/rules/apply`,
      request
    );
  }

  getAlertGroups(): Observable<AlertGroupDefinition[]> {
    return this.http.get<AlertGroupDefinition[]>(`${environment.apiBaseUrl}/api/prometheus-alerts/alert-groups`);
  }

  getAlertGroupRouteKeys(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiBaseUrl}/api/prometheus-alerts/alert-groups/route-keys`);
  }

  getAlertRouteBindings(): Observable<AlertRouteBinding[]> {
    return this.http.get<AlertRouteBinding[]>(`${environment.apiBaseUrl}/api/prometheus-alerts/alert-bindings`);
  }

  upsertAlertGroup(request: AlertGroupUpdateRequest): Observable<AlertGroupDefinition[]> {
    return this.http.put<AlertGroupDefinition[]>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/alert-groups`,
      request
    );
  }

  deleteAlertGroup(groupName: string): Observable<AlertGroupDefinition[]> {
    return this.http.delete<AlertGroupDefinition[]>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/alert-groups/${encodeURIComponent(groupName)}`
    );
  }

  getPrometheusAlertRuleProposals(): Observable<PrometheusAlertRuleProposal[]> {
    return this.http.get<PrometheusAlertRuleProposal[]>(`${environment.apiBaseUrl}/api/prometheus-alerts/proposals`);
  }

  createPrometheusAlertRuleProposal(
    request: CreatePrometheusAlertRuleProposalRequest
  ): Observable<PrometheusAlertRuleProposal> {
    return this.http.post<PrometheusAlertRuleProposal>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/proposals`,
      request
    );
  }

  updatePrometheusAlertRuleProposal(
    proposalId: string,
    request: UpdatePrometheusAlertRuleProposalRequest
  ): Observable<PrometheusAlertRuleProposal> {
    return this.http.put<PrometheusAlertRuleProposal>(
      `${environment.apiBaseUrl}/api/prometheus-alerts/proposals/${encodeURIComponent(proposalId)}`,
      request
    );
  }

  /**
   * Gets time series metrics for charting
   */
  getTimeSeriesMetrics(
    metricType: string,
    resources: string[],
    startTime: Date,
    endTime: Date,
    intervalMinutes: number = 5
  ): Observable<TimeSeriesMetrics> {
    let params = new HttpParams()
      .set('metricType', metricType)
      .set('startTime', startTime.toISOString())
      .set('endTime', endTime.toISOString())
      .set('intervalMinutes', intervalMinutes.toString());
    
    resources.forEach(r => {
      params = params.append('resources', r);
    });

    return this.http.get<TimeSeriesMetrics>(
      `${this.apiUrl}/metrics/timeseries`,
      { params }
    );
  }

  /**
   * Gets services health (application namespaces)
   */
  getServicesHealth(): Observable<ServicesHealthResponse> {
    return this.http.get<ServicesHealthResponse>(`${this.apiUrl}/services`);
  }

  /**
   * Gets consumers health (configured consumers namespace)
   */
  getConsumersHealth(): Observable<ConsumersHealthResponse> {
    return this.http.get<ConsumersHealthResponse>(`${this.apiUrl}/consumers`);
  }

  /**
   * Gets jobs health (configured jobs namespace with CronWorkflows)
   */
  getJobsHealth(): Observable<JobsHealthResponse> {
    return this.http.get<JobsHealthResponse>(`${this.apiUrl}/jobs`);
  }
}

