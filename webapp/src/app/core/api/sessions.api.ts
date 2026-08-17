import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	RevokeSessionsResponse,
	SessionDto,
	SessionSearchQuery,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class SessionsApi {
	private readonly http = inject(HttpClient);

	list(query: SessionSearchQuery = {}): Observable<SessionDto[]> {
		return this.http.get<SessionDto[]>('/api/sessions', {
			params: toHttpParams(query),
		});
	}

	revoke(familyId: string): Observable<RevokeSessionsResponse> {
		return this.http.delete<RevokeSessionsResponse>(`/api/sessions/${familyId}`);
	}

	revokeAllForUser(appUserId: string): Observable<RevokeSessionsResponse> {
		return this.http.delete<RevokeSessionsResponse>(
			`/api/sessions/compte/${appUserId}`,
		);
	}
}
