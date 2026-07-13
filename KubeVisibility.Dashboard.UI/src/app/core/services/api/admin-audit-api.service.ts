import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { AdminAuditQueryResponse } from '../../models/admin-audit.models';

@Injectable({
  providedIn: 'root'
})
export class AdminAuditApiService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiBaseUrl}/api/admin-audit`;

  getAudits(params: {
    startUtc: string;
    endUtc: string;
    limit?: number;
    user?: string;
    action?: string;
    resourceName?: string;
    namespaces?: string[];
  }): Observable<AdminAuditQueryResponse> {
    let httpParams = new HttpParams();
    httpParams = httpParams.set('startUtc', params.startUtc);
    httpParams = httpParams.set('endUtc', params.endUtc);
    if (typeof params.limit === 'number') httpParams = httpParams.set('limit', params.limit);
    if (params.user?.trim()) httpParams = httpParams.set('user', params.user.trim());
    if (params.action?.trim()) httpParams = httpParams.set('action', params.action.trim());
    if (params.resourceName?.trim()) httpParams = httpParams.set('resourceName', params.resourceName.trim());

    if (params.namespaces?.length) {
      for (const ns of params.namespaces) {
        const value = ns.trim();
        if (!value) continue;
        httpParams = httpParams.append('namespace', value);
      }
    }

    return this.http.get<AdminAuditQueryResponse>(this.apiUrl, { params: httpParams });
  }
}
