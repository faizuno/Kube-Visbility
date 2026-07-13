export interface ClusterInfoResponse {
  namespaces: Record<string, NamespaceInfo>;
}

export interface NamespaceInfo {
  success: boolean;
  resources?: ResourceInfo[];
  error?: string;
}

export interface ResourceInfo {
  name: string;
  metadataName: string;
  type: string;
  lastUpdated?: string;
  containers: ContainerInfo[];
  pods: PodInfo[];
  healthStatus: 'Healthy' | 'Degraded' | 'Failed' | 'Unknown';
  desiredReplicas: number;
  currentReplicas: number;
  readyReplicas: number;
  schedule?: string;
  lastScheduleTime?: string;
  creationTime?: string;
  recentEvents: EventInfo[];
  schedules?: string[];
  startingDeadlineSeconds?: number;
  concurrencyPolicy?: string;
  successfulJobsHistoryLimit?: number;
  failedJobsHistoryLimit?: number;
  suspend?: boolean;
  consumerEnabled?: boolean;
}

export interface ContainerInfo {
  name: string;
  image: string;
  version: string;
  environmentVariables: Record<string, string>;
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  imagePullPolicy: string;
}

export interface PodInfo {
  name: string;
  status: string;
  startTime?: string;
  restartCount?: string;
  isReady: boolean;
  reason: string;
  message: string;
  nodeName: string;
  // Resource Utilization
  cpuUsage?: string;
  memoryUsage?: string;
  cpuLimit?: string;
  memoryLimit?: string;
  cpuRequest?: string;
  memoryRequest?: string;
  cpuUsagePercent?: number;
  memoryUsagePercent?: number;
}

export interface EventInfo {
  type: string;
  reason: string;
  message: string;
  timestamp: string;
}

export interface ConsumerControlFlagResponse {
  enabled: boolean;
  exists: boolean;
}

export interface ToggleConsumerRequest {
  namespaceName: string;
  deploymentName: string;
  enabled: boolean;
}

export interface ToggleConsumerResponse {
  success: boolean;
  message: string;
  updatedResource?: ResourceInfo;
}

export interface UpdateCronWorkflowRequest {
  namespaceName: string;
  resourceName: string;
  schedules: string[];
  startingDeadlineSeconds: number;
  concurrencyPolicy: string;
  successfulJobsHistoryLimit: number;
  failedJobsHistoryLimit: number;
  suspend: boolean;
}

export interface UpdateCronWorkflowResponse {
  success: boolean;
  message: string;
  updatedResource?: ResourceInfo;
}

export interface UpdateCronWorkflowLogLevelRequest {
  namespaceName: string;
  resourceName: string;
  logLevel: string;
}

export interface UpdateCronWorkflowLogLevelResponse {
  success: boolean;
  message: string;
  updatedResource?: ResourceInfo;
}

export interface ToggleSuspendRequest {
  namespaceName: string;
  resourceName: string;
  suspend: boolean;
}

export interface ToggleSuspendResponse {
  success: boolean;
  message: string;
  currentSuspendState?: boolean;
  updatedResource?: ResourceInfo;
}

export interface SubmitCronWorkflowRequest {
  namespaceName: string;
  resourceName: string;
}

export interface SubmitCronWorkflowResponse {
  success: boolean;
  message: string;
  workflowName?: string;
}

export interface RestartPodRequest {
  namespaceName: string;
  podName: string;
}

export interface RestartResourceRequest {
  namespaceName: string;
  resourceName: string;
  resourceType: string;
}

export interface UpdateLogLevelRequest {
  namespaceName: string;
  resourceName: string;
  resourceType: string;
  logLevel: string;
}

export interface UpdateLogLevelResponse {
  success: boolean;
  message: string;
}

export interface PodLogsResponse {
  logs: string;
}

export type ViewMode = 'scanning' | 'deepdive';
export type HealthFilter = 'healthy' | 'degraded' | 'failed' | 'paused' | 'stopped';
export type HealthFilterSelection = HealthFilter[];

