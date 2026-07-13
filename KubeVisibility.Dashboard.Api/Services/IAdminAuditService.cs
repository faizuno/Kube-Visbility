using KubeVisibility.Dashboard.Api.Models;

namespace KubeVisibility.Dashboard.Api.Services;

public interface IAdminAuditService
{
    Task WriteEventAsync(AdminAuditEvent auditEvent, CancellationToken cancellationToken = default);
    Task<IReadOnlyList<AdminAuditEvent>> ReadEventsAsync(
        DateTime startUtc,
        DateTime endUtc,
        int limit = 500,
        string? user = null,
        string? actor = null,
        string? actorEmail = null,
        IReadOnlyList<string>? namespaces = null,
        string? action = null,
        string? resourceName = null,
        CancellationToken cancellationToken = default);
}
