import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateEmbedMessageRequest,
	EmbedMessageDto,
	EmbedMessageSearchQuery,
	Paginated,
	UpdateEmbedMessageRequest,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class EmbedsApi {
	private readonly http = inject(HttpClient);

	list(query: EmbedMessageSearchQuery): Observable<Paginated<EmbedMessageDto>> {
		return this.http.get<Paginated<EmbedMessageDto>>('/api/messages', {
			params: toHttpParams(query),
		});
	}

	create(request: CreateEmbedMessageRequest): Observable<EmbedMessageDto> {
		return this.http.post<EmbedMessageDto>('/api/messages', request);
	}

	update(id: string, request: UpdateEmbedMessageRequest): Observable<EmbedMessageDto> {
		return this.http.patch<EmbedMessageDto>(`/api/messages/${id}`, request);
	}

	/** Met le message en file : c'est le bot qui le publiera, quelques secondes plus tard. */
	send(id: string): Observable<EmbedMessageDto> {
		return this.http.post<EmbedMessageDto>(`/api/messages/${id}/envoi`, {});
	}

	remove(id: string): Observable<void> {
		return this.http.delete<void>(`/api/messages/${id}`);
	}
}
