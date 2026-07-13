import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  RestartResourceRequest,
  ResourceInfo,
  UpdateLogLevelRequest,
  UpdateLogLevelResponse,
} from '../../models/cluster-info.models';

@Injectable({
  providedIn: 'root',
})
export class ResourcesService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/resources`;

  restartResource(
    request: RestartResourceRequest
  ): Observable<{ success: boolean; message: string }> {
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/restart`,
      request
    );
  }

  updateLogLevel(request: UpdateLogLevelRequest): Observable<UpdateLogLevelResponse> {
    return this.http.post<UpdateLogLevelResponse>(`${this.apiUrl}/log-level`, request);
  }

  getDeployment(namespaceName: string, deploymentName: string): Observable<ResourceInfo> {
    return this.http.get<ResourceInfo>(`${this.apiUrl}/deployment`, {
      params: { namespaceName, deploymentName },
    });
  }
}

