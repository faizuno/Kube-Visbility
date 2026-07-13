import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Kube Visibility Dashboard',
    loadComponent: () => import('./features/health-dashboard/health-dashboard.component').then(m => m.HealthDashboardComponent),
  },
  {
    path: 'cluster',
    title: 'Cluster Info',
    loadComponent: () => import('./features/cluster-info/cluster-info.component').then(m => m.ClusterInfoComponent),
  },
  {
    path: 'messages',
    title: 'Messaging',
    loadComponent: () => import('./features/kafka/kafka.component').then(m => m.KafkaComponent),
  },
  {
    path: 'messages/alerts',
    redirectTo: 'messages/alerts/groups',
    pathMatch: 'full',
  },
  {
    path: 'messages/alerts/groups',
    title: 'Topic Alert Groups',
    loadComponent: () => import('./features/kafka/topic-alerting-page.component').then(m => m.TopicAlertingPageComponent),
  },
  {
    path: 'messages/alerts/rules',
    title: 'Topic Alert Rules',
    loadComponent: () => import('./features/kafka/topic-alerting-page.component').then(m => m.TopicAlertingPageComponent),
  },
  {
    path: 'nodes',
    title: 'Nodes',
    loadComponent: () => import('./features/nodes/nodes.component').then(m => m.NodesComponent),
  },
  {
    path: 'errors',
    title: 'Error Analytics',
    loadComponent: () => import('./features/error-analytics/error-analytics.component').then(m => m.ErrorAnalyticsComponent),
  },
  {
    path: 'dashboard/errors',
    redirectTo: 'errors',
    pathMatch: 'full'
  },
  {
    path: 'audit',
    title: 'Admin Audit',
    loadComponent: () => import('./features/admin-audit/admin-audit.component').then(m => m.AdminAuditComponent),
  },
  {
    path: 'dashboard/audit',
    redirectTo: 'audit',
    pathMatch: 'full'
  },
  {
    path: 'messages/message-detail',
    title: 'Message Detail',
    loadComponent: () => import('./features/kafka/components/message-detail/message-detail.component').then(m => m.MessageDetailComponent),
  },
  // Legacy redirects for backward compatibility
  {
    path: 'dashboard',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/nodes',
    redirectTo: 'nodes',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/cluster',
    redirectTo: 'cluster',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/messages',
    redirectTo: 'messages',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/messages/alerts',
    redirectTo: 'messages/alerts/groups',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/messages/alerts/groups',
    redirectTo: 'messages/alerts/groups',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/messages/alerts/rules',
    redirectTo: 'messages/alerts/rules',
    pathMatch: 'full'
  },
  {
    path: 'dashboard/messages/message-detail',
    redirectTo: 'messages/message-detail',
    pathMatch: 'full'
  },
  {
    path: 'cluster-info/cluster',
    redirectTo: 'cluster',
    pathMatch: 'full'
  },
  {
    path: 'cluster-info/messaging',
    redirectTo: 'messages',
    pathMatch: 'full'
  },
  {
    path: 'cluster-info/messaging/message-detail',
    redirectTo: 'messages/message-detail',
    pathMatch: 'full'
  },
  {
    path: 'cluster-info/dashboard',
    redirectTo: '',
    pathMatch: 'full'
  },
  {
    path: 'cluster-info',
    redirectTo: 'cluster',
    pathMatch: 'full'
  },
  {
    path: 'kafka',
    redirectTo: 'messages',
    pathMatch: 'full'
  },
  {
    path: 'kafka/message-detail',
    redirectTo: 'messages/message-detail',
    pathMatch: 'full'
  },
];
