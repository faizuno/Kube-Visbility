namespace KubeVisibility.Dashboard.Api.Models;

public enum AdminAuditEventType
{
    Started,
    Stopped,
    Paused,
    Resumed,
    Unsuppressed,
    Restarted,
    Requeued,
    Updated,
    Created,
    Deleted,
    Suppressed,
    Enabled,
    Disabled
}

public enum AdminAuditEventStatus
{
    Success,
    Failed
}
