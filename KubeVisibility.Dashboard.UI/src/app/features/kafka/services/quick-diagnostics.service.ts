import { Injectable } from '@angular/core';
import { AggregatedMetricsSnapshot } from '../models/metrics.models';
import {
  DiagnosticResult,
  DiagnosticStatus,
  DiagnosticCategory,
  QuickAction,
  QuickDiagnostics,
  HealthStatus
} from '../models/diagnostics.models';

/**
 * Interface for a diagnostic check
 */
interface DiagnosticCheck {
  id: string;
  name: string;
  category: DiagnosticCategory;
  check: (snapshot: AggregatedMetricsSnapshot, previousSnapshot?: AggregatedMetricsSnapshot) => DiagnosticResult;
}

/**
 * Service for running quick diagnostics on Kafka topics
 * Following Single Responsibility Principle - only runs diagnostics
 */
@Injectable({
  providedIn: 'root',
})
export class QuickDiagnosticsService {
  
  private checks: DiagnosticCheck[] = [
    // Consumer Health Checks
    {
      id: 'consumer-active',
      name: 'Active Consumers',
      category: 'consumer',
      check: (snapshot) => {
        const groupsWithNoConsumers = snapshot.consumerGroupMetrics
          .filter(g => g.activeConsumers === 0 && g.totalLag > 0);

        if (groupsWithNoConsumers.length > 0) {
          return {
            checkId: 'consumer-active',
            checkName: 'Active Consumers',
            category: 'consumer',
            status: 'fail',
            message: `${groupsWithNoConsumers.length} consumer group(s) have no active consumers`,
            details: `Affected groups: ${groupsWithNoConsumers.map(g => g.groupId).join(', ')}`,
            action: {
              id: 'check-consumer-logs',
              label: 'Check Consumer Logs',
              type: 'check_logs',
              description: 'Review consumer application logs for errors'
            },
            timestamp: snapshot.timestamp
          };
        }

        const totalGroups = snapshot.consumerGroupMetrics.length;
        return {
          checkId: 'consumer-active',
          checkName: 'Active Consumers',
          category: 'consumer',
          status: 'pass',
          message: `All ${totalGroups} consumer group(s) have active consumers`,
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'consumer-lag',
      name: 'Consumer Lag',
      category: 'consumer',
      check: (snapshot) => {
        const totalLag = snapshot.consumerGroupMetrics
          .reduce((sum, g) => sum + g.totalLag, 0);

        if (totalLag > 50000) {
          return {
            checkId: 'consumer-lag',
            checkName: 'Consumer Lag',
            category: 'consumer',
            status: 'fail',
            message: `Critical lag: ${totalLag.toLocaleString()} messages behind`,
            details: 'Consumers cannot keep up with message production rate',
            action: {
              id: 'scale-consumers',
              label: 'Scale Up Consumers',
              type: 'scale_consumers',
              description: 'Increase number of consumer instances'
            },
            timestamp: snapshot.timestamp
          };
        }

        if (totalLag > 10000) {
          return {
            checkId: 'consumer-lag',
            checkName: 'Consumer Lag',
            category: 'consumer',
            status: 'warning',
            message: `Moderate lag: ${totalLag.toLocaleString()} messages`,
            details: 'Monitor closely, may need scaling soon',
            timestamp: snapshot.timestamp
          };
        }

        return {
          checkId: 'consumer-lag',
          checkName: 'Consumer Lag',
          category: 'consumer',
          status: 'pass',
          message: `Lag is healthy: ${totalLag.toLocaleString()} messages`,
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'partition-balance',
      name: 'Partition Balance',
      category: 'partition',
      check: (snapshot) => {
        const counts = snapshot.partitionMetrics.map(p => p.messageCount);
        if (counts.length === 0) {
          return {
            checkId: 'partition-balance',
            checkName: 'Partition Balance',
            category: 'partition',
            status: 'pass',
            message: 'No partitions to check',
            timestamp: snapshot.timestamp
          };
        }

        const avg = counts.reduce((sum, c) => sum + c, 0) / counts.length;
        const max = Math.max(...counts);
        const imbalanceRatio = avg > 0 ? max / avg : 1;

        if (imbalanceRatio > 3) {
          const hotPartition = snapshot.partitionMetrics
            .find(p => p.messageCount === max)?.partitionId;

          return {
            checkId: 'partition-balance',
            checkName: 'Partition Balance',
            category: 'partition',
            status: 'warning',
            message: `Severe partition imbalance detected`,
            details: `Partition ${hotPartition} has ${imbalanceRatio.toFixed(1)}x more messages than average (${max.toLocaleString()} vs ${avg.toFixed(0)})`,
            action: {
              id: 'review-partitioning',
              label: 'Review Partition Strategy',
              type: 'adjust_config',
              description: 'Consider revising partition key for better distribution'
            },
            timestamp: snapshot.timestamp
          };
        }

        if (imbalanceRatio > 2) {
          return {
            checkId: 'partition-balance',
            checkName: 'Partition Balance',
            category: 'partition',
            status: 'warning',
            message: `Moderate partition imbalance (${imbalanceRatio.toFixed(1)}x)`,
            timestamp: snapshot.timestamp
          };
        }

        return {
          checkId: 'partition-balance',
          checkName: 'Partition Balance',
          category: 'partition',
          status: 'pass',
          message: 'Partitions are well balanced',
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'partition-replication',
      name: 'Partition Replication',
      category: 'broker',
      check: (snapshot) => {
        const urp = snapshot.topicMetrics.underReplicatedPartitions;

        if (urp > 0) {
          return {
            checkId: 'partition-replication',
            checkName: 'Partition Replication',
            category: 'broker',
            status: 'fail',
            message: `${urp} under-replicated partition(s)`,
            details: 'Risk of data loss if broker fails',
            action: {
              id: 'check-broker-health',
              label: 'Check Broker Health',
              type: 'check_logs',
              description: 'Investigate broker status and replication issues'
            },
            timestamp: snapshot.timestamp
          };
        }

        return {
          checkId: 'partition-replication',
          checkName: 'Partition Replication',
          category: 'broker',
          status: 'pass',
          message: 'All partitions fully replicated',
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'message-production',
      name: 'Message Production',
      category: 'producer',
      check: (snapshot) => {
        const messageCount = snapshot.topicMetrics.messageCount;

        if (messageCount === 0) {
          return {
            checkId: 'message-production',
            checkName: 'Message Production',
            category: 'producer',
            status: 'warning',
            message: 'No messages in topic',
            details: 'Producer may be down or topic is intentionally empty',
            timestamp: snapshot.timestamp
          };
        }

        return {
          checkId: 'message-production',
          checkName: 'Message Production',
          category: 'producer',
          status: 'pass',
          message: `Topic contains ${messageCount.toLocaleString()} messages`,
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'consumer-processing-rate',
      name: 'Consumer Processing Rate',
      category: 'consumer',
      check: (snapshot, previousSnapshot) => {
        for (const group of snapshot.consumerGroupMetrics) {
          if (group.activeConsumers === 0) continue;

          const lagPerConsumer = group.totalLag / group.activeConsumers;

          if (lagPerConsumer > 10000) {
            return {
              checkId: 'consumer-processing-rate',
              checkName: 'Consumer Processing Rate',
              category: 'consumer',
              status: 'warning',
              message: `Consumer group "${group.groupId}" processing slowly`,
              details: `${lagPerConsumer.toFixed(0)} lag per consumer (${group.totalLag.toLocaleString()} total / ${group.activeConsumers} consumers)`,
              action: {
                id: 'optimize-consumers',
                label: 'Scale or Optimize',
                type: 'scale_consumers',
                description: 'Add more consumers or optimize processing logic'
              },
              timestamp: snapshot.timestamp
            };
          }
        }

        return {
          checkId: 'consumer-processing-rate',
          checkName: 'Consumer Processing Rate',
          category: 'consumer',
          status: 'pass',
          message: 'Consumers processing efficiently',
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'leader-distribution',
      name: 'Leader Distribution',
      category: 'broker',
      check: (snapshot) => {
        const leaders = snapshot.partitionMetrics.map(p => p.leader);
        if (leaders.length === 0) {
          return {
            checkId: 'leader-distribution',
            checkName: 'Leader Distribution',
            category: 'broker',
            status: 'pass',
            message: 'No leaders to check',
            timestamp: snapshot.timestamp
          };
        }

        const uniqueLeaders = new Set(leaders);
        const leaderCounts = new Map<number, number>();

        leaders.forEach(leader => {
          leaderCounts.set(leader, (leaderCounts.get(leader) || 0) + 1);
        });

        const maxLeaderCount = Math.max(...leaderCounts.values());
        const avgLeaderCount = leaders.length / uniqueLeaders.size;

        if (maxLeaderCount > avgLeaderCount * 2) {
          return {
            checkId: 'leader-distribution',
            checkName: 'Leader Distribution',
            category: 'broker',
            status: 'warning',
            message: 'Uneven leader distribution across brokers',
            details: `One broker is handling ${maxLeaderCount} partitions (avg: ${avgLeaderCount.toFixed(1)})`,
            timestamp: snapshot.timestamp
          };
        }

        return {
          checkId: 'leader-distribution',
          checkName: 'Leader Distribution',
          category: 'broker',
          status: 'pass',
          message: `Leaders distributed across ${uniqueLeaders.size} broker(s)`,
          timestamp: snapshot.timestamp
        };
      }
    },

    {
      id: 'partition-count',
      name: 'Partition Count',
      category: 'partition',
      check: (snapshot) => {
        const partitionCount = snapshot.topicMetrics.partitionCount;

        if (partitionCount === 0) {
          return {
            checkId: 'partition-count',
            checkName: 'Partition Count',
            category: 'partition',
            status: 'fail',
            message: 'Topic has no partitions',
            details: 'Topic configuration issue',
            timestamp: snapshot.timestamp
          };
        }

        if (partitionCount === 1) {
          return {
            checkId: 'partition-count',
            checkName: 'Partition Count',
            category: 'partition',
            status: 'warning',
            message: 'Topic has only 1 partition',
            details: 'Limited parallelism for consumers',
            action: {
              id: 'increase-partitions',
              label: 'Consider More Partitions',
              type: 'adjust_config',
              description: 'Increase partitions for better parallelism'
            },
            timestamp: snapshot.timestamp
          };
        }

        return {
          checkId: 'partition-count',
          checkName: 'Partition Count',
          category: 'partition',
          status: 'pass',
          message: `Topic has ${partitionCount} partition(s)`,
          timestamp: snapshot.timestamp
        };
      }
    }
  ];

  /**
   * Run all diagnostic checks
   */
  runDiagnostics(
    snapshot: AggregatedMetricsSnapshot,
    previousSnapshot?: AggregatedMetricsSnapshot
  ): QuickDiagnostics {
    
    const results = this.checks.map(check => check.check(snapshot, previousSnapshot));

    // Categorize results
    const failedChecks = results.filter(r => r.status === 'fail');
    const warningChecks = results.filter(r => r.status === 'warning');
    const passedChecks = results.filter(r => r.status === 'pass');

    // Calculate overall health and score
    const { overallHealth, score } = this.calculateOverallHealth(failedChecks.length, warningChecks.length);

    // Get top issues
    const topIssues = [...failedChecks, ...warningChecks]
      .sort((a, b) => a.status === 'fail' ? -1 : 1)
      .slice(0, 5);

    // Generate recommendations
    const recommendations = this.generateRecommendations(results, snapshot);

    // Collect unique quick actions
    const quickActions = this.collectQuickActions(results);

    // Generate summary
    const summary = this.generateSummary(overallHealth, failedChecks.length, warningChecks.length);

    return {
      overallHealth,
      score,
      timestamp: snapshot.timestamp,
      checks: results,
      failedChecks,
      warningChecks,
      passedChecks,
      topIssues,
      recommendations,
      quickActions,
      summary
    };
  }

  /**
   * Calculate overall health and score
   */
  private calculateOverallHealth(
    failCount: number,
    warnCount: number
  ): { overallHealth: HealthStatus; score: number } {
    
    let overallHealth: HealthStatus;
    let score: number;

    if (failCount > 0) {
      overallHealth = 'critical';
      score = Math.max(0, 100 - (failCount * 30 + warnCount * 10));
    } else if (warnCount > 0) {
      overallHealth = 'degraded';
      score = Math.max(50, 100 - (warnCount * 15));
    } else {
      overallHealth = 'healthy';
      score = 100;
    }

    return { overallHealth, score };
  }

  /**
   * Generate recommendations
   */
  private generateRecommendations(
    results: DiagnosticResult[],
    snapshot: AggregatedMetricsSnapshot
  ): string[] {
    
    const recommendations: string[] = [];

    const noConsumers = results.find(r => r.checkId === 'consumer-active' && r.status === 'fail');
    const highLag = results.find(r => r.checkId === 'consumer-lag' && r.status !== 'pass');
    const urp = results.find(r => r.checkId === 'partition-replication' && r.status === 'fail');
    const imbalance = results.find(r => r.checkId === 'partition-balance' && r.status === 'warning');

    if (noConsumers) {
      recommendations.push('🚨 URGENT: Restart consumer applications immediately');
      recommendations.push('Check consumer application logs for errors or crashes');
    } else if (highLag) {
      recommendations.push('Scale consumer instances horizontally to reduce lag');
      recommendations.push('Review consumer processing logic for optimization opportunities');
      recommendations.push('Consider implementing batch processing if applicable');
    }

    if (urp) {
      recommendations.push('🚨 URGENT: Check broker health and cluster stability');
      recommendations.push('Verify network connectivity between brokers');
      recommendations.push('Review broker resource utilization (CPU, disk, memory)');
    }

    if (imbalance) {
      recommendations.push('Review partition key strategy to ensure even distribution');
      recommendations.push('Consider using a hash-based partition key');
    }

    if (results.every(r => r.status === 'pass')) {
      recommendations.push('✅ All checks passed - system is healthy');
      recommendations.push('Continue monitoring metrics for trends');
    }

    return recommendations.slice(0, 5); // Limit to 5 recommendations
  }

  /**
   * Collect unique quick actions
   */
  private collectQuickActions(results: DiagnosticResult[]): QuickAction[] {
    const actions: QuickAction[] = [];
    const seen = new Set<string>();

    for (const result of results) {
      if (result.action && !seen.has(result.action.id)) {
        actions.push(result.action);
        seen.add(result.action.id);
      }
    }

    return actions.slice(0, 5); // Limit to 5 actions
  }

  /**
   * Generate summary text
   */
  private generateSummary(
    health: HealthStatus,
    failCount: number,
    warnCount: number
  ): string {
    
    if (health === 'critical') {
      return `Critical issues detected: ${failCount} failed check(s) require immediate attention`;
    }

    if (health === 'degraded') {
      return `System is degraded: ${warnCount} warning(s) detected, monitoring recommended`;
    }

    return 'All systems healthy: No issues detected';
  }

  /**
   * Get check by ID
   */
  getCheck(checkId: string): DiagnosticCheck | undefined {
    return this.checks.find(c => c.id === checkId);
  }

  /**
   * Get all check IDs
   */
  getAllCheckIds(): string[] {
    return this.checks.map(c => c.id);
  }
}

