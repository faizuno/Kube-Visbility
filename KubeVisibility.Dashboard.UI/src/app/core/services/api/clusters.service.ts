import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ClusterInfoResponse,
  NamespaceInfo,
  PodInfo,
  EventInfo,
} from '../../models/cluster-info.models';

@Injectable({
  providedIn: 'root',
})
export class ClustersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/clusters`;

  getClusterInfo(): Observable<ClusterInfoResponse> {
    return this.http.get<ClusterInfoResponse>(this.apiUrl);
  }

  getNamespaceInfo(namespaceName: string): Observable<NamespaceInfo> {
    return this.http.get<NamespaceInfo>(`${this.apiUrl}/${namespaceName}`);
  }

  getPodsForResource(
    namespaceName: string,
    resourceName: string,
    resourceType: string
  ): Observable<PodInfo[]> {
    return this.http.get<PodInfo[]>(`${environment.apiBaseUrl}/api/pods`, {
      params: {
        namespaceName,
        resourceName,
        resourceType,
      },
    });
  }

  getEventsForResource(
    namespaceName: string,
    resourceName: string,
    resourceType: string
  ): Observable<EventInfo[]> {
    return this.http.get<EventInfo[]>(
      `${environment.apiBaseUrl}/api/resources/events`,
      {
        params: {
          namespaceName,
          resourceName,
          resourceType,
        },
      }
    );
  }
}

