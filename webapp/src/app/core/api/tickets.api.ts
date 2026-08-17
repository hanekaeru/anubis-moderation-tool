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

	update(id: string, request: UpdateTicketRequest): Observable<TicketDetail> {
		return this.http.patch<TicketDetail>(`/api/tickets/${id}`, request);
	}

	addNote(id: string, request: AddTicketNoteRequest): Observable<TicketDetail> {
		return this.http.post<TicketDetail>(`/api/tickets/${id}/notes`, request);
	}

	/**
	 * Octets d'une piece jointe. Protegee par JWT (Authorization pose par
	 * `auth.interceptor.ts`), donc pas exploitable en `<img src>` direct — le
	 * blob est transforme en URL objet par `TicketAttachment`.
	 */
	downloadAttachment(ticketId: string, attachmentId: string): Observable<Blob> {
		return this.http.get(`/api/tickets/${ticketId}/attachments/${attachmentId}`, {
			responseType: 'blob',
		});
	}
}
