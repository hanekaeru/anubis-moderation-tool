import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { AuditLogEntryDto, AuditLogQuery, Paginated } from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class AuditApi {
  private readonly http = inject(HttpClient);

  search(query: AuditLogQuery): Observable<Paginated<AuditLogEntryDto>> {
    return this.http.get<Paginated<AuditLogEntryDto>>('/api/audit', {
      params: toHttpParams(query),
    });
  }
}
