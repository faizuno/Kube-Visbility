/**
 * Models for diagnostics and anomaly detection
 * Following Interface Segregation Principle
 */

/**
 * Types of anomalies that can be detected
 */
export type AnomalyType = 
  | 'lag_spike' 
  | 'throughput_drop' 
  | 'partition_imbalance' 
  | 'consumer_down' 
  | 'message_gap'
  | 'rebalance_detected'
  | 'trend_warning';

/**
 * Severity levels for issues
 */
export type Severity = 'low' | 'medium' | 'high' | 'critical';

/**
 * Detected anomaly
 */
export interface Anomaly {
  type: AnomalyType;
  severity: Severity;
  timestamp: number;
  description: string;
  details?: string;
  affectedPartitions?: number[];
  affectedConsumerGroups?: string[];
  suggestedAction: string;
  metric?: {
    name: string;
    currentValue: number;
    expectedValue?: number;
    threshold?: number;
  };
}

/**
 * Statistical baseline for a metric
 */
export interface Baseline {
  metric: string;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  p50: number;  // Median
  p95: number;  // 95th percentile
  p99: number;  // 99th percentile
  sampleSize: number;
  lastUpdated: number;
  trend: 'stable' | 'increasing' | 'decreasing';
}

/**
 * Category of diagnostic check
 */
export type DiagnosticCategory = 'consumer' | 'partition' | 'producer' | 'broker';

/**
 * Status of a diagnostic check
 */
export type DiagnosticStatus = 'pass' | 'warning' | 'fail';

/**
 * Result of a diagnostic check
 */
export interface DiagnosticResult {
  checkId: string;
  checkName: string;
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  message: string;
  details?: string;
  action?: QuickAction;
  timestamp: number;
}

/**
 * Quick action that can be taken
 */
export interface QuickAction {
  id: string;
  label: string;
  type: 'scale_consumers' | 'restart_consumer' | 'check_logs' | 'adjust_config' | 'view_details';
  description?: string;
  command?: string;
  url?: string;
}

/**
 * Overall health assessment
 */
export type HealthStatus = 'healthy' | 'degraded' | 'critical' | 'unknown';

/**
 * Complete diagnostics report
 */
export interface QuickDiagnostics {
  overallHealth: HealthStatus;
  score: number;  // 0-100
  timestamp: number;
  checks: DiagnosticResult[];
  failedChecks: DiagnosticResult[];
  warningChecks: DiagnosticResult[];
  passedChecks: DiagnosticResult[];
  topIssues: DiagnosticResult[];
  recommendations: string[];
  quickActions: QuickAction[];
  summary: string;
}

/**
 * Anomaly detection configuration
 */
export interface AnomalyDetectionConfig {
  enabled: boolean;
  sensitivity: 'low' | 'medium' | 'high';  // Affects threshold multiplier
  minBaselineSamples: number;  // Minimum samples needed for baseline
  maxAnomaliesPerType: number;  // Max similar anomalies to report
}

/**
 * Time-based comparison for anomaly detection
 */
export interface TemporalComparison {
  metric: string;
  current: number;
  previous: number;
  percentChange: number;
  isAnomalous: boolean;
  period: 'minute' | 'hour' | 'day';
}

