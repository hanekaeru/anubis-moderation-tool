import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	AddTicketNoteRequest,
	Paginated,
	TicketDetail,
	TicketListItem,
	TicketSearchQuery,
	UpdateTicketRequest,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class TicketsApi {
	private readonly http = inject(HttpClient);

	search(query: TicketSearchQuery): Observable<Paginated<TicketListItem>> {
		return this.http.get<Paginated<TicketListItem>>('/api/tickets', {
			params: toHttpParams(query),
		});
	}

	findOne(id: string): Observable<TicketDetail> {
		return this.http.get<TicketDetail>(`/api/tickets/${id}`);
	}

	listCategories(): Observable<string[]> {
		return this.http.get<string[]>('/api/tickets/categories');
	}

	update(id: string, request: UpdateTicketRequest): Observable<TicketDetail> {
		return this.http.patch<TicketDetail>(`/api/tickets/${id}`, request);
	}

	addNote(id: string, request: AddTicketNoteRequest): Observable<TicketDetail> {
		return this.http.post<TicketDetail>(`/api/tickets/${id}/notes`, request);
	}
}
