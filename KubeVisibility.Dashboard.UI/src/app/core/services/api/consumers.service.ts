import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import {
  ConsumerControlFlagResponse,
  ToggleConsumerRequest,
  ToggleConsumerResponse,
} from '../../models/cluster-info.models';

@Injectable({
  providedIn: 'root',
})
export class ConsumersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiBaseUrl}/api/consumers`;

  getAllConsumerControlFlags(namespaceName: string): Observable<Record<string, boolean>> {
    return this.http.get<Record<string, boolean>>(`${this.apiUrl}/control-flags`, {
      params: { namespaceName },
    });
  }

  getConsumerControlFlag(
    namespaceName: string,
    deploymentName: string
  ): Observable<ConsumerControlFlagResponse> {
    return this.http.get<ConsumerControlFlagResponse>(`${this.apiUrl}/control-flag`, {
      params: { namespaceName, deploymentName },
    });
  }

  toggleConsumer(request: ToggleConsumerRequest): Observable<ToggleConsumerResponse> {
    return this.http.post<ToggleConsumerResponse>(`${this.apiUrl}/toggle`, request);
  }
}

