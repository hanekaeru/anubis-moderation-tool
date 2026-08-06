import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  DashboardOverview,
  MemberActivityStats,
  StatsPeriod,
  TicketStatsSummary,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class StatsApi {
  private readonly http = inject(HttpClient);

  overview(period: StatsPeriod): Observable<DashboardOverview> {
    return this.http.get<DashboardOverview>('/api/stats/overview', {
      params: toHttpParams({ period }),
    });
  }

  tickets(period: StatsPeriod): Observable<TicketStatsSummary> {
    return this.http.get<TicketStatsSummary>('/api/stats/tickets', {
      params: toHttpParams({ period }),
    });
  }

  memberActivity(
    userId: string,
    period: StatsPeriod,
  ): Observable<MemberActivityStats> {
    return this.http.get<MemberActivityStats>(`/api/stats/members/${userId}`, {
      params: toHttpParams({ period }),
    });
  }
}
