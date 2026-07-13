import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

interface UserInfo {
  accessToken: string;
  isAdmin: boolean;
  userName: string;
  userEmail: string;
  userGroups: string[];
  namespaces: string[];
  consumersNamespace?: string;
  jobsNamespace?: string;
  applicationNamespaces?: string[];
  adminGroups?: string[];
  environment: string;
  /** When true, Prometheus-backed node metrics and nodes monitoring features are available. */
  prometheusEnabled?: boolean;
}

const DEFAULT_CONSUMERS_NAMESPACE = 'app-consumers';
const DEFAULT_JOBS_NAMESPACE = 'app-jobs';
const DEFAULT_APPLICATION_NAMESPACES = ['app', 'app-services'];
const DEFAULT_ADMIN_GROUPS = ['Dashboard-Admin'];

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/user`;

  // User info signal
  userInfo = signal<{
    accessToken: string | null;
    isAdmin: boolean;
    userName: string | null;
    userEmail: string | null;
    userGroups: string[];
    namespaces: string[];
    consumersNamespace: string;
    jobsNamespace: string;
    applicationNamespaces: string[];
    adminGroups: string[];
    environment: string | null;
    prometheusEnabled: boolean;
  }>({
    accessToken: null,
    isAdmin: false,
    userName: null,
    userEmail: null,
    userGroups: [],
    namespaces: [],
    consumersNamespace: DEFAULT_CONSUMERS_NAMESPACE,
    jobsNamespace: DEFAULT_JOBS_NAMESPACE,
    applicationNamespaces: DEFAULT_APPLICATION_NAMESPACES,
    adminGroups: DEFAULT_ADMIN_GROUPS,
    environment: null,
    prometheusEnabled: false,
  });

  // Computed signals
  isUserAdmin = computed(() => this.userInfo().isAdmin);
  isAuthenticated = computed(() => !!this.userInfo().accessToken);
  
  // Flag to indicate we should exclude credentials from requests to trigger OAuth2 proxy
  private shouldExcludeCredentials = signal<boolean>(false);
  
  // Namespaces from API
  namespaces = computed(() => {
    return this.userInfo().namespaces;
  });

  consumersNamespace = computed(() => this.userInfo().consumersNamespace);
  jobsNamespace = computed(() => this.userInfo().jobsNamespace);
  applicationNamespaces = computed(() => this.userInfo().applicationNamespaces);
  adminGroups = computed(() => this.userInfo().adminGroups);

  /** True when Prometheus-backed node metrics are enabled (nodes monitoring page, etc.). */
  prometheusEnabled = computed(() => this.userInfo().prometheusEnabled);

  /**
   * Check if credentials should be excluded from requests
   */
  shouldExcludeCredentialsFromRequest(): boolean {
    return this.shouldExcludeCredentials();
  }

  loadUserInfo(): Promise<void> {
    // Check if dev access token is configured (for local development without oauth2-proxy)
    if (environment.devAccessToken) {
      try {
        const parsedInfo = this.parseJwtToken(environment.devAccessToken);
        const isDevForcedNonAdmin = !!environment.devForceNonAdmin;
        const adminGroupsLower = DEFAULT_ADMIN_GROUPS.map(g => g.toLowerCase());
        const devUserGroups = (parsedInfo.userGroups || []).filter(
          group => !group || !adminGroupsLower.includes(group.toLowerCase())
        );

        // For dev mode, use sample namespaces for local testing
        const devNamespaces = [
          ...DEFAULT_APPLICATION_NAMESPACES,
          DEFAULT_CONSUMERS_NAMESPACE,
          DEFAULT_JOBS_NAMESPACE,
        ];
        this.userInfo.set({
          accessToken: environment.devAccessToken,
          isAdmin: isDevForcedNonAdmin ? false : parsedInfo.isAdmin,
          userName: parsedInfo.userName,
          userEmail: parsedInfo.userEmail || null,
          userGroups: isDevForcedNonAdmin ? devUserGroups : (parsedInfo.userGroups || []),
          namespaces: devNamespaces,
          consumersNamespace: DEFAULT_CONSUMERS_NAMESPACE,
          jobsNamespace: DEFAULT_JOBS_NAMESPACE,
          applicationNamespaces: DEFAULT_APPLICATION_NAMESPACES,
          adminGroups: DEFAULT_ADMIN_GROUPS,
          environment: null, // Will be loaded from API
          prometheusEnabled: true, // Dev token has no API; set when loading from API
        });
        return Promise.resolve();
      } catch (error) {
        console.error('Failed to parse dev access token, falling back to API call:', error);
        // Fall through to API call if token parsing fails
      }
    }

    // Fall back to API call if no dev token or parsing failed
    return new Promise((resolve, reject) => {
      this.http.get<UserInfo>(`${this.apiUrl}/info`).subscribe({
        next: (data) => {
          this.userInfo.set({
            accessToken: data.accessToken || null,
            isAdmin: data.isAdmin || false,
            userName: data.userName || null,
            userEmail: data.userEmail || null,
            userGroups: data.userGroups || [],
            namespaces: data.namespaces || [],
            consumersNamespace: data.consumersNamespace || DEFAULT_CONSUMERS_NAMESPACE,
            jobsNamespace: data.jobsNamespace || DEFAULT_JOBS_NAMESPACE,
            applicationNamespaces: data.applicationNamespaces?.length
              ? data.applicationNamespaces
              : DEFAULT_APPLICATION_NAMESPACES,
            adminGroups: data.adminGroups?.length ? data.adminGroups : DEFAULT_ADMIN_GROUPS,
            environment: data.environment || null,
            prometheusEnabled: data.prometheusEnabled ?? false,
          });
          // Reset credentials exclusion on successful authentication
          this.resetCredentialsExclusion();
          resolve();
        },
        error: (error) => {
          console.error('Failed to load user info:', error);
          
          // Check if this is an authentication error (401/403/302)
          // OAuth2 proxy returns 302 redirect when authentication fails
          const status = error?.status;
          if (status === 401 || status === 403 || status === 302) {
            // Authentication failure - clear state and let interceptor handle reload
            this.handleAuthError();
            reject(error);
          } else {
            reject(error);
          }
        },
      });
    });
  }

  handleAuthError(): void {
    this.userInfo.set({
      accessToken: null,
      isAdmin: false,
      userName: null,
      userEmail: null,
      userGroups: [],
      namespaces: [],
      consumersNamespace: DEFAULT_CONSUMERS_NAMESPACE,
      jobsNamespace: DEFAULT_JOBS_NAMESPACE,
      applicationNamespaces: DEFAULT_APPLICATION_NAMESPACES,
      adminGroups: DEFAULT_ADMIN_GROUPS,
      environment: null,
      prometheusEnabled: false,
    });
    this.shouldExcludeCredentials.set(true);
  }

  resetCredentialsExclusion(): void {
    this.shouldExcludeCredentials.set(false);
  }

  private parseJwtToken(token: string): {
    userName: string | null;
    isAdmin: boolean;
    userEmail: string | null;
    userGroups: string[];
  } {
    try {
      // JWT format: header.payload.signature
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      // Decode the payload (second part)
      const payload = parts[1];
      // Add padding if needed for base64 decoding
      const paddedPayload = payload + '='.repeat((4 - (payload.length % 4)) % 4);
      const decodedPayload = atob(paddedPayload);
      const claims = JSON.parse(decodedPayload);

      // Extract user name - try multiple claim names
      let userName: string | null = null;
      if (claims.name && typeof claims.name === 'string') {
        userName = claims.name;
      } else if (claims.preferred_username && typeof claims.preferred_username === 'string') {
        userName = claims.preferred_username;
      } else if (claims.email && typeof claims.email === 'string') {
        userName = claims.email;
      } else if (claims.sub && typeof claims.sub === 'string') {
        userName = claims.sub;
      }

      // Extract admin status from groups claim
      let isAdmin = false;
      let userGroups: string[] = [];
      const adminGroupsLower = DEFAULT_ADMIN_GROUPS.map(g => g.toLowerCase());
      
      if (claims.groups && Array.isArray(claims.groups)) {
        userGroups = claims.groups;
        isAdmin = claims.groups.some((group: string) =>
          adminGroupsLower.includes(group.toLowerCase())
        );
      } else if (claims.groups && typeof claims.groups === 'string') {
        // Handle comma-separated groups string
        userGroups = claims.groups.split(',').map((g: string) => g.trim());
        isAdmin = userGroups.some((group: string) =>
          adminGroupsLower.includes(group.toLowerCase())
        );
      }

      // Extract email
      const userEmail = claims.email && typeof claims.email === 'string' ? claims.email : null;

      return { userName, isAdmin, userEmail, userGroups };
    } catch (error) {
      console.error('Error parsing JWT token:', error);
      throw new Error('Failed to parse JWT token');
    }
  }

  getAccessToken(): string | null {
    return this.userInfo().accessToken;
  }
}
