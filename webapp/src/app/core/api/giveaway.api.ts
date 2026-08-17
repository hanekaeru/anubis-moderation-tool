import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateGiveawayRequest,
	GiveawayDto,
	GiveawayEntryDto,
	GiveawaySearchQuery,
	Paginated,
	UpdateGiveawayRequest,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class GiveawayApi {
	private readonly http = inject(HttpClient);

	list(query: GiveawaySearchQuery): Observable<Paginated<GiveawayDto>> {
		return this.http.get<Paginated<GiveawayDto>>('/api/giveaways', {
			params: toHttpParams(query),
		});
	}

	listEntries(id: string): Observable<GiveawayEntryDto[]> {
		return this.http.get<GiveawayEntryDto[]>(`/api/giveaways/${id}/participations`);
	}

	create(request: CreateGiveawayRequest): Observable<GiveawayDto> {
		return this.http.post<GiveawayDto>('/api/giveaways', request);
	}

	update(id: string, request: UpdateGiveawayRequest): Observable<GiveawayDto> {
		return this.http.patch<GiveawayDto>(`/api/giveaways/${id}`, request);
	}

	cancel(id: string): Observable<GiveawayDto> {
		return this.http.post<GiveawayDto>(`/api/giveaways/${id}/annulation`, {});
	}

	reroll(id: string): Observable<GiveawayDto> {
		return this.http.post<GiveawayDto>(`/api/giveaways/${id}/nouveau-tirage`, {});
	}
}
