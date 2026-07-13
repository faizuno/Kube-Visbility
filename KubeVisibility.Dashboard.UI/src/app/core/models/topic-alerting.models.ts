export interface TopicAlertCondition {
  joinWithPrevious: 'AND' | 'OR';
  negate: boolean;
  field: 'message' | 'exception' | 'serviceName' | 'applicationName';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'wildcard';
  value: string;
}

export interface TopicAlertGroup {
  groupId: string;
  docType: string;
  name: string;
  description?: string | null;
  topicNames: string[];
  createdAtUtc: string;
  updatedAtUtc: string;
  createdBy: string;
  updatedBy: string;
}

export interface TopicAlertRule {
  ruleId: string;
  docType: string;
  name: string;
  enabled: boolean;
  targetType: 'topics' | 'group';
  topicNames: string[];
  topicGroupId?: string | null;
  recipientEmails: string[];
  conditions: TopicAlertCondition[];
  createdAtUtc: string;
  updatedAtUtc: string;
  createdBy: string;
  updatedBy: string;
}

export interface UpsertTopicAlertGroupRequest {
  groupId?: string | null;
  name: string;
  description?: string | null;
  topicNames: string[];
}

export interface UpsertTopicAlertRuleRequest {
  ruleId?: string | null;
  name: string;
  enabled: boolean;
  targetType: 'topics' | 'group';
  topicNames: string[];
  topicGroupId?: string | null;
  recipientEmailsCsv: string;
  conditions: TopicAlertCondition[];
}
