import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  UpdateCronWorkflowRequest,
  UpdateCronWorkflowResponse,
  UpdateCronWorkflowLogLevelRequest,
  UpdateCronWorkflowLogLevelResponse,
  ToggleSuspendRequest,
  ToggleSuspendResponse,
  SubmitCronWorkflowRequest,
  SubmitCronWorkflowResponse,
  ResourceInfo,
} from '../../models/cluster-info.models';

@Injectable({
  providedIn: 'root',
})
export class CronWorkflowsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/cronworkflows`;

  updateCronWorkflow(request: UpdateCronWorkflowRequest): Observable<UpdateCronWorkflowResponse> {
    return this.http.post<UpdateCronWorkflowResponse>(`${this.apiUrl}/update`, request);
  }

  updateLogLevel(
    request: UpdateCronWorkflowLogLevelRequest
  ): Observable<UpdateCronWorkflowLogLevelResponse> {
    return this.http.post<UpdateCronWorkflowLogLevelResponse>(`${this.apiUrl}/log-level`, request);
  }

  toggleSuspend(request: ToggleSuspendRequest): Observable<ToggleSuspendResponse> {
    return this.http.post<ToggleSuspendResponse>(`${this.apiUrl}/toggle-suspend`, request);
  }

  submitCronWorkflow(request: SubmitCronWorkflowRequest): Observable<SubmitCronWorkflowResponse> {
    return this.http.post<SubmitCronWorkflowResponse>(`${this.apiUrl}/submit`, request);
  }

  getCronWorkflow(namespaceName: string, resourceName: string): Observable<ResourceInfo> {
    return this.http.get<ResourceInfo>(`${this.apiUrl}/resource`, {
      params: { namespaceName, resourceName },
    });
  }
}

