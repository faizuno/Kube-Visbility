import { Injectable, computed, signal, inject } from '@angular/core';
import { ClustersService } from './api/clusters.service';
import { ResourcesService } from './api/resources.service';
import { CronWorkflowsService } from './api/cron-workflows.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import {
  ClusterInfoResponse,
  NamespaceInfo,
  ResourceInfo,
  ViewMode,
  HealthFilter,
  HealthFilterSelection,
} from '../models/cluster-info.models';

@Injectable({
  providedIn: 'root',
})
export class ClusterStateService {
  private clustersService = inject(ClustersService);
  private resourcesService = inject(ResourcesService);
  private cronWorkflowsService = inject(CronWorkflowsService);
  private authService = inject(AuthService);

  // Core state signals
  private _clusterData = signal<ClusterInfoResponse>({ namespaces: {} });
  private _selectedResource = signal<{
    namespace: string;
    resource: ResourceInfo;
  } | null>(null);
  private _currentView = signal<ViewMode>(this.getInitialViewFromUrl());
  private _searchQuery = signal<string>('');
  private _healthFilter = signal<HealthFilterSelection>([]);
  private _autoRefreshInterval = signal<number>(60); // seconds
  private _autoRefreshEnabled = signal<boolean>(true);
  private _loadingStates = signal<Record<string, boolean>>({});
  private _lastUpdated = signal<Date>(new Date());
  
  // Context-aware refresh callbacks
  private _refreshCallbacks = new Map<string, () => Promise<void>>();

  // Guard to prevent concurrent refresh calls
  private _isRefreshing = false;

  /**
   * Initialize current view from URL on service creation
   */
  private getInitialViewFromUrl(): ViewMode {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const view = params.get('view');
      if (view === 'deepdive') {
        return 'deepdive';
      }
    }
    return 'scanning';
  }

  // Public readonly signals
  readonly clusterData = this._clusterData.asReadonly();
  readonly selectedResource = this._selectedResource.asReadonly();
  readonly currentView = this._currentView.asReadonly();
  readonly searchQuery = this._searchQuery.asReadonly();
  readonly healthFilter = this._healthFilter.asReadonly();
  readonly autoRefreshInterval = this._autoRefreshInterval.asReadonly();
  readonly autoRefreshEnabled = this._autoRefreshEnabled.asReadonly();
  readonly loadingStates = this._loadingStates.asReadonly();
  readonly lastUpdated = this._lastUpdated.asReadonly();

  // Computed signals
  readonly hasConsumersNamespace = computed(() => {
    const consumersNamespace = this.authService.consumersNamespace();
    const userNamespaces = this.authService.namespaces();
    if (!userNamespaces.includes(consumersNamespace)) {
      return false;
    }
    
    // If namespace is in user's list, check cluster data
    // If cluster data hasn't loaded yet or namespace doesn't exist in cluster, 
    // we still enable it based on user's namespace list (from /api/user/info)
    const data = this._clusterData();
    const consumersNs = data.namespaces[consumersNamespace];
    
    // If cluster data exists for this namespace, check if it succeeded
    // If cluster data doesn't exist yet, default to true (enabled) since it's in user's list
    if (consumersNs !== undefined) {
      return consumersNs.success === true && consumersNs.resources !== undefined;
    }
    
    // Namespace is in user's list but cluster data not loaded yet - enable it
    return true;
  });

  readonly hasJobsNamespace = computed(() => {
    const jobsNamespace = this.authService.jobsNamespace();
    const userNamespaces = this.authService.namespaces();
    if (!userNamespaces.includes(jobsNamespace)) {
      return false;
    }
    
    // If namespace is in user's list, check cluster data
    // If cluster data hasn't loaded yet or namespace doesn't exist in cluster, 
    // we still enable it based on user's namespace list (from /api/user/info)
    const data = this._clusterData();
    const jobsNs = data.namespaces[jobsNamespace];
    
    // If cluster data exists for this namespace, check if it succeeded
    // If cluster data doesn't exist yet, default to true (enabled) since it's in user's list
    if (jobsNs !== undefined) {
      return jobsNs.success === true && jobsNs.resources !== undefined;
    }
    
    // Namespace is in user's list but cluster data not loaded yet - enable it
    return true;
  });

  readonly filteredResources = computed(() => {
    const data = this._clusterData();
    const query = this._searchQuery().toLowerCase();
    const healthFilter = this._healthFilter();

    const allResources: Array<{ namespace: string; resource: ResourceInfo }> = [];

    Object.entries(data.namespaces).forEach(([namespace, nsInfo]) => {
      if (nsInfo.success && nsInfo.resources) {
        nsInfo.resources.forEach((resource) => {
          allResources.push({ namespace, resource });
        });
      }
    });

    let filtered = allResources;

    // Apply search filter
    if (query) {
      filtered = filtered.filter(({ resource }) => {
        const searchableText = [
          resource.name,
          resource.metadataName,
          resource.type,
          ...resource.containers.map((c) => c.image),
          ...Object.values(resource.containers[0]?.environmentVariables || {}),
        ]
          .join(' ')
          .toLowerCase();
        return searchableText.includes(query);
      });
    }

    // Apply health filter
    if (healthFilter.length > 0) {
      filtered = filtered.filter(({ resource }) => {
        const filterKey = this.getResourceFilterKey(resource);
        return filterKey ? healthFilter.includes(filterKey) : false;
      });
    }

    return filtered;
  });

  /**
   * Get ASPNETCORE_ENVIRONMENT from any pod in application namespaces
   */
  readonly aspNetCoreEnvironment = computed(() => {
    const data = this._clusterData();
    const applicationNamespaces = this.authService.applicationNamespaces();

    for (const nsName of applicationNamespaces) {
      const nsInfo = data.namespaces[nsName];
      if (!nsInfo?.success || !nsInfo.resources) {
        continue;
      }

      for (const resource of nsInfo.resources) {
        if (resource.containers && resource.containers.length > 0) {
          for (const container of resource.containers) {
            if (container.environmentVariables && container.environmentVariables['ASPNETCORE_ENVIRONMENT']) {
              return container.environmentVariables['ASPNETCORE_ENVIRONMENT'];
            }
          }
        }
      }
    }
    
    return null;
  });

  readonly stats = computed(() => {
    const data = this._clusterData();
    let total = 0;
    let healthy = 0;
    let degraded = 0;
    let failed = 0;
    let paused = 0;
    let stopped = 0;

    Object.values(data.namespaces).forEach((nsInfo) => {
      if (nsInfo.success && nsInfo.resources) {
        nsInfo.resources.forEach((resource) => {
          total++;
          
          // Check for paused status (CronWorkflow with suspend === true)
          if (resource.type === 'CronWorkflow' && resource.suspend === true) {
            paused++;
            return; // Don't count as other statuses
          }
          
          // Check for stopped status (Deployment/DaemonSet/StatefulSet with consumerEnabled === false)
          if (
            (resource.type === 'Deployment' ||
              resource.type === 'DaemonSet' ||
              resource.type === 'StatefulSet') &&
            resource.consumerEnabled === false
          ) {
            stopped++;
            return; // Don't count as other statuses
          }
          
          // Handle CronWorkflow jobs specially (they use pod statuses instead of health statuses)
          if (resource.type === 'CronWorkflow') {
            // CronWorkflows that are not suspended should be counted based on pod status
            // Pod statuses like "Succeeded" or "Running" indicate healthy jobs
            const podStatus = resource.healthStatus?.toLowerCase() || '';
            if (podStatus === 'succeeded' || podStatus === 'running' || podStatus === 'healthy') {
              healthy++;
            } else if (podStatus === 'failed' || podStatus === 'error') {
              failed++;
            } else if (podStatus === 'degraded') {
              degraded++;
            } else if (podStatus !== 'never run' && podStatus !== 'unknown') {
              // For other statuses that might indicate issues, count as degraded
              degraded++;
            }
            // "Never Run" and "Unknown" are not counted in any status category
            return;
          }
          
          // Count health statuses for other resource types
          switch (resource.healthStatus) {
            case 'Healthy':
              healthy++;
              break;
            case 'Degraded':
              degraded++;
              break;
            case 'Failed':
              failed++;
              break;
          }
        });
      }
    });

    return { total, healthy, degraded, failed, paused, stopped };
  });

  // Actions
  setCurrentView(view: ViewMode): void {
    this._currentView.set(view);
  }

  setSearchQuery(query: string): void {
    this._searchQuery.set(query);
  }

  setHealthFilter(filter: HealthFilterSelection): void {
    this._healthFilter.set(filter);
  }

  setSelectedResource(namespace: string, resource: ResourceInfo): void {
    this._selectedResource.set({ namespace, resource });
  }

  clearSelectedResource(): void {
    this._selectedResource.set(null);
  }

  setAutoRefreshInterval(seconds: number): void {
    this._autoRefreshInterval.set(seconds);
  }

  setAutoRefreshEnabled(enabled: boolean): void {
    this._autoRefreshEnabled.set(enabled);
  }

  setLoadingState(namespace: string, loading: boolean): void {
    this._loadingStates.update((states) => ({
      ...states,
      [namespace]: loading,
    }));
  }

  async loadClusterData(): Promise<void> {
    try {
      const data = await this.clustersService.getClusterInfo().toPromise();
      if (data) {
        this._clusterData.set(data);
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error('Error loading cluster data:', error);
      throw error;
    }
  }

  async loadNamespaceData(namespace: string, isRefresh: boolean = false): Promise<void> {
    // Set loading state to track API call progress (needed for refresh button spinning)
    this.setLoadingState(namespace, true);
    
    // Check if we have existing data (for error handling during refresh)
    const hasExistingData = this._clusterData().namespaces[namespace]?.success === true;
    
    try {
      const nsInfo = await this.clustersService.getNamespaceInfo(namespace).toPromise();
      if (nsInfo) {
        // Update data atomically - this will trigger UI update only when new data arrives
        this._clusterData.update((data) => ({
          ...data,
          namespaces: {
            ...data.namespaces,
            [namespace]: nsInfo,
          },
        }));
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error(`Error loading namespace ${namespace}:`, error);
      // Only update error state if we don't have existing data, or if it's a critical error
      // During refresh errors, keep existing data visible
      if (!hasExistingData) {
      this._clusterData.update((data) => ({
        ...data,
        namespaces: {
          ...data.namespaces,
          [namespace]: {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
          },
        },
      }));
      }
    } finally {
      this.setLoadingState(namespace, false);
    }
  }

  async loadAllNamespacesProgressive(isRefresh: boolean = false): Promise<void> {
    // Get user's configured namespaces
    const userNamespaces = this.authService.namespaces();
    
    if (!isRefresh) {
      // On initial load, get cluster info to see which namespaces exist and succeeded
      // This single call loads all namespaces at once from the backend
      try {
        const clusterInfo = await this.clustersService.getClusterInfo().toPromise();
        if (clusterInfo) {
          // Update cluster data with the full response
          this._clusterData.set(clusterInfo);
          this._lastUpdated.set(new Date());
          
          // Filter cluster data to only include namespaces that:
          // 1. Are in the user's configured namespaces list
          // 2. Successfully loaded (exist in cluster)
          const filteredNamespaces: Record<string, NamespaceInfo> = {};
          userNamespaces.forEach(ns => {
            const nsInfo = clusterInfo.namespaces[ns];
            if (nsInfo && nsInfo.success === true) {
              filteredNamespaces[ns] = nsInfo;
            }
          });
          
          // Update cluster data with filtered namespaces only
          this._clusterData.update((data) => ({
            ...data,
            namespaces: filteredNamespaces,
          }));
        }
      } catch (error) {
        console.error('Error loading cluster info:', error);
        // On error, try to load individual namespaces as fallback
        const promises = userNamespaces.map((ns) => this.loadNamespaceData(ns, false));
        await Promise.allSettled(promises);
      }
    } else {
      // On refresh, use existing cluster data to determine available namespaces
      const clusterData = this._clusterData();
      const availableNamespaces = Object.keys(clusterData.namespaces).filter(
        ns => clusterData.namespaces[ns]?.success === true && userNamespaces.includes(ns)
      );
      
      // Reload all available namespaces to get fresh data
      const promises = availableNamespaces.map((ns) => this.loadNamespaceData(ns, true));
      await Promise.allSettled(promises);
    }
  }

  /**
   * Refresh a single resource and update it in the datastore
   * @param namespace The namespace containing the resource
   * @param resourceName The name of the resource to refresh
   * @param resourceType The type of the resource (Deployment, CronWorkflow, etc.)
   */
  async refreshSingleResource(
    namespace: string,
    resourceName: string,
    resourceType: string
  ): Promise<void> {
    try {
      let updatedResource: ResourceInfo | null = null;

      // Call the appropriate API based on resource type
      if (resourceType === 'CronWorkflow') {
        const resource = await this.cronWorkflowsService
          .getCronWorkflow(namespace, resourceName)
          .toPromise();
        if (resource) {
          updatedResource = resource;
        }
      } else if (
        resourceType === 'Deployment' ||
        resourceType === 'DaemonSet' ||
        resourceType === 'StatefulSet'
      ) {
        // Use getDeployment API for all workload types (Deployment, DaemonSet, StatefulSet)
        const resource = await this.resourcesService
          .getDeployment(namespace, resourceName)
          .toPromise();
        if (resource) {
          updatedResource = resource;
        }
      } else {
        // For other types, fall back to loading the namespace
        console.warn(
          `No specific API for resource type ${resourceType}, falling back to namespace refresh`
        );
        await this.loadNamespaceData(namespace, true);
        return;
      }

      // Update the resource in the datastore
      if (updatedResource) {
        this.updateResourceInState(namespace, updatedResource);
        this._lastUpdated.set(new Date());
      }
    } catch (error) {
      console.error(
        `Error refreshing resource ${resourceName} in ${namespace}:`,
        error
      );
      // On error, fall back to namespace refresh
      await this.loadNamespaceData(namespace, true);
    }
  }

  updateResourceInState(namespace: string, updatedResource: ResourceInfo): void {
    this._clusterData.update((data) => {
      const nsInfo = data.namespaces[namespace];
      if (nsInfo?.success && nsInfo.resources) {
        const index = nsInfo.resources.findIndex(
          (r) => r.metadataName === updatedResource.metadataName
        );
        if (index >= 0) {
          // Create new arrays and objects to ensure change detection
          const updatedResources = [...nsInfo.resources];
          updatedResources[index] = { ...updatedResource };
          
          return {
            ...data,
            namespaces: {
              ...data.namespaces,
              [namespace]: {
                ...nsInfo,
                resources: updatedResources,
              },
            },
          };
        }
      }
      return { ...data };
    });
    
    // Also update selected resource if it matches
    const selected = this._selectedResource();
    if (selected && selected.namespace === namespace && selected.resource.metadataName === updatedResource.metadataName) {
      this._selectedResource.set({ namespace, resource: updatedResource });
    }
  }

  /**
   * Register a refresh callback for a specific context
   * @param contextId Unique identifier for the context (e.g., 'logs-viewer', 'deep-dive')
   * @param callback Function to call when this context should be refreshed
   */
  registerRefreshCallback(contextId: string, callback: () => Promise<void>): void {
    this._refreshCallbacks.set(contextId, callback);
  }

  /**
   * Unregister a refresh callback for a specific context
   * @param contextId Unique identifier for the context
   */
  unregisterRefreshCallback(contextId: string): void {
    this._refreshCallbacks.delete(contextId);
  }

  /**
   * Get a refresh callback for a specific context
   * @param contextId Unique identifier for the context
   * @returns The callback function if it exists, undefined otherwise
   */
  getRefreshCallback(contextId: string): (() => Promise<void>) | undefined {
    return this._refreshCallbacks.get(contextId);
  }

  /**
   * Perform context-aware refresh based on current state
   * Priority:
   * 1. Logs viewer (if open)
   * 2. Deep-dive view (if resource selected)
   * 3. Default: Refresh cluster data
   */
  async performContextAwareRefresh(): Promise<void> {
    // Prevent concurrent refresh calls
    if (this._isRefreshing) {
      console.log('Refresh already in progress, skipping...');
      return;
    }

    this._isRefreshing = true;
    try {
    const view = this._currentView();
    const selectedResource = this._selectedResource();
    
    // Priority 1: Check if logs viewer is open
    if (this._refreshCallbacks.has('logs-viewer')) {
      const logsCallback = this._refreshCallbacks.get('logs-viewer');
      if (logsCallback) {
        try {
          await logsCallback();
          // Wait for all loading states to clear before marking refresh as complete
          await this.waitForAllLoadingStatesToComplete();
          return;
        } catch (error) {
          console.error('Error refreshing logs:', error);
          // Fall through to default refresh
        }
      }
    }
    
    // Priority 2: Deep-dive view with selected resource
    if (view === 'deepdive' && selectedResource) {
      // Use registered callback if available (includes pod refresh), otherwise just refresh namespace
      if (this._refreshCallbacks.has('deep-dive-view')) {
        const deepDiveCallback = this._refreshCallbacks.get('deep-dive-view');
        if (deepDiveCallback) {
          try {
            await deepDiveCallback();
            // Wait for all loading states to clear before marking refresh as complete
            await this.waitForAllLoadingStatesToComplete();
            return;
          } catch (error) {
            console.error('Error refreshing deep-dive view:', error);
            // Fall through to default refresh
          }
        }
      }
      // Fallback: just refresh namespace data
      await this.loadNamespaceData(selectedResource.namespace, true);
      // Wait for all loading states to clear before marking refresh as complete
      await this.waitForAllLoadingStatesToComplete();
      return;
    }
    
    // Default: Refresh all cluster data (isRefresh = true to prevent flicker)
    await this.loadAllNamespacesProgressive(true);
    
    // Wait for all loading states to clear before marking refresh as complete
    await this.waitForAllLoadingStatesToComplete();
    } finally {
      this._isRefreshing = false;
    }
  }

  /**
   * Wait for all loading states to complete (for refresh button spinning)
   */
  private async waitForAllLoadingStatesToComplete(): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds max wait
    const checkInterval = 100; // Check every 100ms
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const states = this._loadingStates();
      const hasLoading = Object.values(states).some(loading => loading === true);
      
      if (!hasLoading) {
        return; // All loading states cleared
      }
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }
    
    // Timeout reached, but continue anyway
    console.warn('Timeout waiting for all loading states to complete');
  }

  private getResourceFilterKey(resource: ResourceInfo): HealthFilter | null {
    if (resource.type === 'CronWorkflow' && resource.suspend === true) {
      return 'paused';
    }
    if (
      (resource.type === 'Deployment' ||
        resource.type === 'DaemonSet' ||
        resource.type === 'StatefulSet') &&
      resource.consumerEnabled === false
    ) {
      return 'stopped';
    }
    const map: Record<string, HealthFilter> = {
      Healthy: 'healthy',
      Degraded: 'degraded',
      Failed: 'failed',
    };
    return map[resource.healthStatus] ?? null;
  }

}

