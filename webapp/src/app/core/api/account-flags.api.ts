import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { AccountFlagDto, AccountFlagSearchQuery, Paginated } from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class AccountFlagsApi {
	private readonly http = inject(HttpClient);

	search(query: AccountFlagSearchQuery): Observable<Paginated<AccountFlagDto>> {
		return this.http.get<Paginated<AccountFlagDto>>('/api/account-flags', {
			params: toHttpParams(query),
		});
	}

	review(id: string): Observable<AccountFlagDto> {
		return this.http.post<AccountFlagDto>(`/api/account-flags/${id}/review`, {});
	}
}
