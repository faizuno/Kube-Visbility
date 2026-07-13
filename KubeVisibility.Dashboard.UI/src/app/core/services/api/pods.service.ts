import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { PodLogsResponse, RestartPodRequest } from '../../models/cluster-info.models';

@Injectable({
  providedIn: 'root',
})
export class PodsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/pods`;

  getPodLogs(
    namespaceName: string,
    resourceName: string,
    resourceType: string,
    tailLines: number = 500,
    podName?: string
  ): Observable<PodLogsResponse> {
    const params: Record<string, string | number> = {
      namespaceName,
      resourceName,
      resourceType,
      tailLines: tailLines.toString(),
    };
    if (podName) {
      params['podName'] = podName;
    }
    return this.http.get<PodLogsResponse>(`${this.apiUrl}/logs`, { params });
  }

  restartPod(request: RestartPodRequest): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/restart`,
      request
    );
  }
}

