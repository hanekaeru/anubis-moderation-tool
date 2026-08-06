import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  MemberDetail,
  MemberListItem,
  MemberSearchQuery,
  NoteDto,
  Paginated,
  RoleSummary,
  TimelineEntry,
  TimelineQuery,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class MembersApi {
  private readonly http = inject(HttpClient);

  search(query: MemberSearchQuery): Observable<Paginated<MemberListItem>> {
    return this.http.get<Paginated<MemberListItem>>('/api/members', {
      params: toHttpParams(query),
    });
  }

  findOne(userId: string): Observable<MemberDetail> {
    return this.http.get<MemberDetail>(`/api/members/${userId}`);
  }

  timeline(
    userId: string,
    query: TimelineQuery,
  ): Observable<Paginated<TimelineEntry>> {
    return this.http.get<Paginated<TimelineEntry>>(
      `/api/members/${userId}/timeline`,
      { params: toHttpParams(query) },
    );
  }

  listRoles(): Observable<RoleSummary[]> {
    return this.http.get<RoleSummary[]>('/api/members/roles');
  }

  notes(userId: string): Observable<NoteDto[]> {
    return this.http.get<NoteDto[]>(`/api/notes/member/${userId}`);
  }
}
