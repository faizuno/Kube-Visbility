// ============================================================
// Overview and Summary Models
// ============================================================

export interface HealthOverview {
  overallHealthScore: number;
  kubernetesHealth: ClusterHealthSummary;
  kafkaHealth: KafkaHealthSummary;
  applicationHealth: ApplicationHealthSummary;
  timestamp: number;
}

export interface ClusterHealthSummary {
  healthScore: number;
  totalNodes: number;
  readyNodes: number;
  notReadyNodes: number;
  unknownNodes: number;
  resourceUtilization: ResourceUtilization;
}

export interface KafkaHealthSummary {
  healthScore: number;
  totalBrokers: number;
  onlineBrokers: number;
  offlineBrokers: number;
  totalControllers: number;
  onlineControllers: number;
  offlineControllers: number;
  activeControllers: number;
  totalTopics: number;
  topicsWithIssues: number;
  totalConsumerLag: number;
}

export interface ApplicationHealthSummary {
  healthScore: number;
  totalDeployments: number;
  healthyDeployments: number;
  degradedDeployments: number;
  failedDeployments: number;
  totalPods: number;
  runningPods: number;
  pendingPods: number;
  failedPods: number;
  
  // Detailed breakdown by category
  totalServices: number;
  healthyServices: number;
  totalConsumers: number;
  healthyConsumers: number;
  stoppedConsumers: number;
  totalJobs: number;
  healthyJobs: number;
  pausedJobs: number;
  
  // Aggregated count for UI display
  totalApplications: number;
  healthyApplications: number;
}

// ============================================================
// Kubernetes Node Models
// ============================================================

export interface NodeHealthResponse {
  nodes: NodeHealth[];
  summary: NodeHealthSummary;
}

export interface NodeHealth {
  name: string;
  status: 'Ready' | 'NotReady' | 'Unknown';
  exactStatus?: string;
  isSchedulable?: boolean;
  statusFlags?: string[];
  type: string;
  conditions: NodeCondition[];
  currentMetrics?: NodeMetrics;
  labels: Record<string, string>;
  kubernetesVersion: string;
  containerRuntimeVersion: string;
  capacity: NodeCapacity;
  allocatable?: NodeAllocatable;
  creationTime?: string;
  runningPods: number;
  totalPods: number;
}

export interface NodeCondition {
  type: string;
  status: string;
  reason: string;
  message: string;
  lastTransitionTime?: string;
}

export interface NodeMetrics {
  cpuUsage: string;
  memoryUsage: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  timestamp: string;
}

export interface NodeCapacity {
  cpu: string;
  memory: string;
  pods: string;
}

/** Resources allocatable for pods (capacity minus system/kube-reserved). */
export interface NodeAllocatable {
  cpu: string;
  memory: string;
  pods: string;
}

export interface NodeHealthSummary {
  total: number;
  ready: number;
  notReady: number;
  unknown: number;
  averageCpuUsagePercent: number;
  averageMemoryUsagePercent: number;
}

export interface NodeMetricsResponse {
  nodeName: string;
  metrics: NodeMetricsDataPoint[];
}

export interface NodeMetricsDataPoint {
  timestamp: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  cpuUsage: string;
  memoryUsage: string;
}

/** Current node metrics from Prometheus (node_exporter). */
export interface NodePrometheusMetricsCurrentResponse {
  nodes: NodePrometheusMetricCurrent[];
  timestamp?: string;
}

export interface NodePrometheusMetricCurrent {
  nodeName: string;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
  diskUsagePercent?: number;
}

/** Time series node metrics from Prometheus for charts. */
export interface NodePrometheusMetricsTimeSeriesResponse {
  nodeName: string;
  series: MetricSeries[];
}

export interface MetricSeries {
  metricType: string;
  dataPoints: MetricDataPoint[];
}

export interface MetricDataPoint {
  timestamp: string;
  value: number;
}

// ============================================================
// Resource Utilization Models
// ============================================================

export interface ResourceUtilization {
  cpuUsagePercent: number;
  memoryUsagePercent: number;
  diskUsagePercent: number;
  cpuUsed: string;
  cpuTotal: string;
  memoryUsed: string;
  memoryTotal: string;
}

export interface ResourceSummaryResponse {
  namespaces: Record<string, NamespaceResourceSummary>;
  clusterTotal: ResourceSummary;
}

export interface NamespaceResourceSummary {
  namespaceName: string;
  resources: ResourceSummary;
  podCount: number;
  deploymentCount: number;
}

export interface ResourceSummary {
  cpuRequests: string;
  cpuLimits: string;
  memoryRequests: string;
  memoryLimits: string;
}

export interface ResourceTrendsResponse {
  resourceTrends: Record<string, ResourceTrendDataPoint[]>;
}

export interface ResourceTrendDataPoint {
  timestamp: string;
  resourceName: string;
  cpuUsagePercent: number;
  memoryUsagePercent: number;
}

// ============================================================
// Application Health Models
// ============================================================

export interface ApplicationHealthResponse {
  namespaces: Record<string, NamespaceHealthDetail>;
  summary: ApplicationHealthSummary;
}

export interface NamespaceHealthDetail {
  namespaceName: string;
  totalDeployments: number;
  healthyDeployments: number;
  degradedDeployments: number;
  failedDeployments: number;
  totalPods: number;
  runningPods: number;
  pendingPods: number;
  failedPods: number;
  unhealthyResources: UnhealthyResource[];
}

export interface UnhealthyResource {
  name: string;
  type: string;
  status: string;
  reason: string;
  readyReplicas: number;
  desiredReplicas: number;
}

export interface NamespaceHealthResponse {
  namespaceName: string;
  details: NamespaceHealthDetail;
  resources: any[]; // Using any for ResourceInfo to avoid circular dependency
}

// ============================================================
// Kafka Health Models
// ============================================================

export interface KafkaClusterHealth {
  clusterId: string;
  totalBrokers: number;
  onlineBrokers: number;
  offlineBrokers: number;
  totalControllers?: number;
  onlineControllers?: number;
  offlineControllers?: number;
  activeControllers?: number;
  healthScore: number;
  brokers: BrokerHealth[];
  controllers?: ControllerHealth[];
  timestamp: string;
}

export interface BrokerHealth {
  brokerId: number;
  host: string;
  port: number;
  isOnline: boolean;
  partitionCount: number;
  leaderPartitionCount: number;
  nodeType?: string;
  // Resource Utilization
  cpuUsage?: string;
  cpuLimit?: string;
  cpuRequest?: string;
  cpuUsagePercent?: number;
  memoryUsage?: string;
  memoryLimit?: string;
  memoryRequest?: string;
  memoryUsagePercent?: number;
  podName?: string;
}

export interface ControllerHealth {
  controllerId: number;
  host: string;
  port: number;
  isOnline: boolean;
  isActive: boolean;
  // Resource Utilization
  cpuUsage?: string;
  cpuLimit?: string;
  cpuRequest?: string;
  cpuUsagePercent?: number;
  memoryUsage?: string;
  memoryLimit?: string;
  memoryRequest?: string;
  memoryUsagePercent?: number;
  podName?: string;
}

export interface KafkaBrokerHealthResponse {
  brokers: BrokerHealth[];
  totalBrokers: number;
  onlineBrokers: number;
  offlineBrokers: number;
}

export interface TopicHealthSummaryResponse {
  totalTopics: number;
  healthyTopics: number;
  topicsWithUnderReplicatedPartitions: number;
  topicsWithLag: number;
  topics: TopicHealth[];
}

export interface TopicHealth {
  topicName: string;
  partitionCount: number;
  replicationFactor: number;
  underReplicatedPartitions: number;
  totalMessages: number;
  totalLag: number;
  consumerGroupCount: number;
  healthStatus: 'Healthy' | 'Warning' | 'Critical' | 'Unknown';
  hasActiveConsumers?: boolean; // True if topic has active consumers, false if only inactive, undefined if unknown
}

export interface ConsumerLagSummaryResponse {
  consumerGroups: Record<string, ConsumerGroupHealth>;
  totalLag: number;
  groupsWithLag: number;
  timestamp: string;
}

export interface ConsumerGroupHealth {
  groupId: string;
  topicName: string;
  totalLag: number;
  activeConsumers: number;
  partitionLags: PartitionLag[];
  state: string;
}

export interface PartitionLag {
  partitionId: number;
  currentOffset: number;
  logEndOffset: number;
  lag: number;
}

// ============================================================
// Time Series Models
// ============================================================

export interface TimeSeriesMetrics {
  metricType: string;
  series: Record<string, TimeSeriesDataPoint[]>;
}

export interface TimeSeriesDataPoint {
  timestamp: string;
  value: number;
  labels?: Record<string, string>;
}

export interface PrometheusAlertStats {
  totalFiring: number;
  bySeverity: Record<string, number>;
  byAlertName: Record<string, number>;
  byNamespace: Record<string, number>;
  lastUpdatedUtc: string;
}

export interface PrometheusFiringAlert {
  alertName: string;
  severity: string;
  state: string;
  namespaceName?: string;
  podName?: string;
  summary?: string;
  description?: string;
  firstOccurrenceAt?: string;
  lastOccurrenceAt?: string;
  startsAt?: string;
  updatedAt?: string;
  firingForSeconds: number;
  labels: Record<string, string>;
}

export interface PrometheusFiringAlertsPage {
  total: number;
  limit: number;
  offset: number;
  items: PrometheusFiringAlert[];
}

export interface SuppressPrometheusAlertRequest {
  alertName: string;
  namespaceName?: string;
  severity?: string;
  podName?: string;
  firstSeenAtUtc?: string;
  lastSeenAtUtc?: string;
  reason: string;
  durationHours: number;
}

export interface EditPrometheusSuppressionRequest {
  reason: string;
  durationHours: number;
}

export interface PrometheusSuppression {
  silenceId: string;
  status: string;
  createdBy: string;
  comment: string;
  startsAt: string;
  endsAt: string;
  updatedAt: string;
  matchers: Record<string, string>;
}

export interface PrometheusAlertRuleProposal {
  id: string;
  alertName: string;
  expr: string;
  for: string;
  severity: string;
  summary: string;
  description: string;
  groupName: string;
  status: string;
  createdAtUtc: string;
  updatedAtUtc: string;
  createdBy: string;
  updatedBy?: string;
}

export interface CreatePrometheusAlertRuleProposalRequest {
  alertName: string;
  expr: string;
  for: string;
  severity: string;
  summary: string;
  description: string;
  groupName: string;
}

export interface UpdatePrometheusAlertRuleProposalRequest {
  alertName: string;
  expr: string;
  for: string;
  severity: string;
  summary: string;
  description: string;
  groupName: string;
  status: string;
}

export interface PrometheusRuleDefinition {
  alertName: string;
  expr: string;
  for?: string | null;
  groupName: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  namespace: string;
  resourceName: string;
  origin: string;
}

export interface ApplyPrometheusRuleRequest {
  alertName: string;
  originalAlertName?: string;
  expr: string;
  for?: string | null;
  groupName: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

export interface ApplyPrometheusRuleResponse {
  changed: boolean;
  action: string;
  result?: PrometheusRuleDefinition;
}

export interface AlertGroupDefinition {
  name: string;
  emails: string[];
  routeKeys: string[];
}

export interface AlertGroupUpdateRequest {
  name: string;
  emails: string[];
  routeKeys: string[];
}

export interface AlertRouteBinding {
  routeKey: string;
  receiver: string;
  source: 'base' | 'override' | string;
  emails: string[];
}

// ============================================================
// Services, Consumers, and Jobs Health Models
// ============================================================

export interface ServicesHealthResponse {
  summary: ServicesSummary;
  services: ServiceDetail[];
}

export interface ServicesSummary {
  totalServices: number;
  runningServices: number;
  stoppedServices: number;
  failedServices: number;
  degradedServices: number;
  healthScore: number;
}

export interface ServiceDetail {
  name: string;
  metadataName: string;
  namespace: string;
  type: string;
  status: 'Running' | 'Stopped' | 'Failed' | 'Degraded';
  desiredReplicas: number;
  readyReplicas: number;
  currentReplicas: number;
  lastUpdated?: string;
  totalPods: number;
  runningPods: number;
}

export interface ConsumersHealthResponse {
  summary: ConsumersSummary;
  consumers: ConsumerDetail[];
}

export interface ConsumersSummary {
  totalConsumers: number;
  runningConsumers: number;
  stoppedConsumers: number;
  failedConsumers: number;
  degradedConsumers: number;
  healthScore: number;
}

export interface ConsumerDetail {
  name: string;
  metadataName: string;
  namespace: string;
  type: string;
  status: 'Running' | 'Stopped' | 'Failed' | 'Degraded';
  consumerEnabled: boolean;
  desiredReplicas: number;
  readyReplicas: number;
  currentReplicas: number;
  lastUpdated?: string;
  totalPods: number;
  runningPods: number;
}

export interface JobsHealthResponse {
  summary: JobsSummary;
  jobs: JobDetail[];
}

export interface JobsSummary {
  totalJobs: number;
  scheduledJobs: number;
  pausedJobs: number;
  failedJobs: number;
  degradedJobs: number;
  healthScore: number;
}

export interface JobDetail {
  name: string;
  metadataName: string;
  namespace: string;
  type: string;
  status: 'Scheduled' | 'Paused' | 'Failed' | 'Degraded';
  schedule: string;
  suspended: boolean;
  lastScheduleTime?: string;
  recentRuns: WorkflowRunInfo[];
}

export interface WorkflowRunInfo {
  name: string;
  phase: string;
  startTime?: string;
  finishTime?: string;
}

// ============================================================
// Chart Data Models
// ============================================================

export interface ChartDataPoint {
  name: string;
  value: number;
  timestamp?: number;
}

export interface ChartSeries {
  name: string;
  data: ChartDataPoint[];
  color?: string;
}

