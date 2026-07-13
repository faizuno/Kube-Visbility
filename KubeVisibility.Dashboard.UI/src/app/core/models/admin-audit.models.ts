export type AdminAuditEventType =
  | 'Started'
  | 'Stopped'
  | 'Paused'
  | 'Resumed'
  | 'Restarted'
  | 'Requeued'
  | 'Updated'
  | 'Created'
  | 'Deleted'
  | 'Suppressed'
  | 'Enabled'
  | 'Disabled';

export type AdminAuditEventStatus = 'Success' | 'Failed';

export interface AdminAuditEvent {
  eventId: string;
  timestampUtc: string;
  eventType: AdminAuditEventType | string;
  serviceName: string;
  actionPerformedOn: string;
  eventStatus: AdminAuditEventStatus | string;
  action: string;
  resourceType?: string | null;
  resourceName?: string | null;
  namespace?: string | null;
  eventDescription: string;
  actor: string;
  actorEmail?: string | null;
  actorGroups: string[];
  httpMethod: string;
  path: string;
  endpointDisplayName?: string | null;
  statusCode: number;
  success: boolean;
  correlationId?: string | null;
  requestBody?: string | null;
  error?: string | null;
}

export interface AdminAuditQueryResponse {
  startUtc: string;
  endUtc: string;
  count: number;
  items: AdminAuditEvent[];
}
