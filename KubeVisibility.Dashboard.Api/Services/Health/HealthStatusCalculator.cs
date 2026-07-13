using KubeVisibility.Dashboard.Api.Models;
using KubeVisibility.Dashboard.Api.Models.Health;

namespace KubeVisibility.Dashboard.Api.Services.Health
{
    /// <summary>
    /// Responsible for calculating health status based on resource metrics
    /// Follows Single Responsibility Principle
    /// </summary>
    public static class HealthStatusCalculator
    {
        /// <summary>
        /// Determines status for deployments/services based on replica counts
        /// </summary>
        public static string GetDeploymentStatus(int desiredReplicas, int readyReplicas, int currentReplicas)
        {
            // Stopped: No desired replicas or no current replicas
            if (desiredReplicas == 0 || currentReplicas == 0)
                return "Stopped";
            
            // Running: All replicas are ready
            if (readyReplicas == desiredReplicas && desiredReplicas > 0)
                return "Running";
            
            // Failed: No ready replicas but desired replicas exist
            if (readyReplicas == 0 && desiredReplicas > 0)
                return "Failed";
            
            // Degraded: Some replicas ready but not all
            if (readyReplicas > 0 && readyReplicas < desiredReplicas)
                return "Degraded";
            
            return "Unknown";
        }

        /// <summary>
        /// Determines status for consumers considering ConfigMap flag
        /// </summary>
        public static string GetConsumerStatus(bool consumerEnabled, int desiredReplicas, int readyReplicas, int currentReplicas)
        {
            // If ConfigMap flag says disabled, status is always "Stopped"
            if (!consumerEnabled)
                return "Stopped";
            
            // Otherwise, use standard deployment status logic
            return GetDeploymentStatus(desiredReplicas, readyReplicas, currentReplicas);
        }

        /// <summary>
        /// Determines status for CronWorkflow jobs
        /// Only considers failed runs within the last 7 days for degraded status
        /// </summary>
        public static string GetJobStatus(bool suspended, List<WorkflowRunInfo> recentRuns)
        {
            // Paused: CronWorkflow is suspended
            if (suspended)
                return "Paused";
            
            // Check recent runs for failures (if we have run data)
            if (recentRuns.Count > 0)
            {
                var cutoffDate = DateTime.UtcNow.AddDays(-1);
                
                // Filter to only failed runs within the last 7 days
                var recentFailedRuns = recentRuns.Where(run =>
                {
                    if (run.Phase != "Failed" && run.Phase != "Error")
                        return false;
                    
                    // Use FinishTime if available, otherwise StartTime
                    var runTime = run.FinishTime ?? run.StartTime;
                    return runTime.HasValue && runTime.Value >= cutoffDate;
                }).ToList();
                
                var recentTotal = recentRuns.Count;
                var recentFailed = recentFailedRuns.Count;
                
                // Failed: All recent runs failed (within last 7 days)
                if (recentFailed == recentTotal && recentTotal > 0)
                    return "Failed";
                
                // Degraded: Some recent runs failed within the last 7 days
                if (recentFailed > 0)
                    return "Degraded";
            }
            
            // Scheduled: Active and no recent failures within last 7 days
            return "Scheduled";
        }

        /// <summary>
        /// Calculates health score based on counts
        /// </summary>
        public static double CalculateHealthScore(int total, int healthy, int degraded, int failed)
        {
            if (total == 0) return 100;
            
            double score = 100;
            score -= (failed / (double)total) * 50;      // Failed reduces by up to 50%
            score -= (degraded / (double)total) * 30;    // Degraded reduces by up to 30%
            
            return Math.Max(0, Math.Round(score, 2));
        }
    }
}

