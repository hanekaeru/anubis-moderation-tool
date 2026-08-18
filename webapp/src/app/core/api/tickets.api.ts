import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	AddTicketNoteRequest,
	CreateTicketSubjectRequest,
	Paginated,
	TicketConfigDto,
	TicketDetail,
	TicketListItem,
	TicketModeratorPrefixDto,
	TicketSearchQuery,
	TicketSubjectDto,
	UpdateTicketConfigRequest,
	UpdateTicketRequest,
	UpdateTicketSubjectRequest,
	UpsertTicketPrefixRequest,
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

	getConfig(): Observable<TicketConfigDto> {
		return this.http.get<TicketConfigDto>('/api/tickets/config');
	}

	updateConfig(request: UpdateTicketConfigRequest): Observable<TicketConfigDto> {
		return this.http.patch<TicketConfigDto>('/api/tickets/config', request);
	}

	listSubjects(): Observable<TicketSubjectDto[]> {
		return this.http.get<TicketSubjectDto[]>('/api/tickets/subjects');
	}

	createSubject(request: CreateTicketSubjectRequest): Observable<TicketSubjectDto> {
		return this.http.post<TicketSubjectDto>('/api/tickets/subjects', request);
	}

	updateSubject(
		subjectId: string,
		request: UpdateTicketSubjectRequest,
	): Observable<TicketSubjectDto> {
		return this.http.patch<TicketSubjectDto>(
			`/api/tickets/subjects/${subjectId}`,
			request,
		);
	}

	deleteSubject(subjectId: string): Observable<void> {
		return this.http.delete<void>(`/api/tickets/subjects/${subjectId}`);
	}

	listPrefixes(): Observable<TicketModeratorPrefixDto[]> {
		return this.http.get<TicketModeratorPrefixDto[]>('/api/tickets/prefixes');
	}

	upsertPrefix(
		userId: string,
		request: UpsertTicketPrefixRequest,
	): Observable<TicketModeratorPrefixDto> {
		return this.http.put<TicketModeratorPrefixDto>(
			`/api/tickets/prefixes/${userId}`,
			request,
		);
	}

	deletePrefix(userId: string): Observable<void> {
		return this.http.delete<void>(`/api/tickets/prefixes/${userId}`);
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
