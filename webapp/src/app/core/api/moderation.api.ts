import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateNoteRequest,
	CreateSanctionRequest,
	CreateWarningRequest,
	NoteDto,
	Paginated,
	RevokeRequest,
	SanctionDto,
	SanctionSearchQuery,
	UpdateNoteRequest,
	WarningDto,
	WarningSearchQuery,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class ModerationApi {
	private readonly http = inject(HttpClient);

	searchWarnings(query: WarningSearchQuery): Observable<Paginated<WarningDto>> {
		return this.http.get<Paginated<WarningDto>>('/api/warnings', {
			params: toHttpParams(query),
		});
	}

	createWarning(request: CreateWarningRequest): Observable<WarningDto> {
		return this.http.post<WarningDto>('/api/warnings', request);
	}

	revokeWarning(id: string, request: RevokeRequest): Observable<WarningDto> {
		return this.http.post<WarningDto>(`/api/warnings/${id}/revoke`, request);
	}

	searchSanctions(query: SanctionSearchQuery): Observable<Paginated<SanctionDto>> {
		return this.http.get<Paginated<SanctionDto>>('/api/sanctions', {
			params: toHttpParams(query),
		});
	}

	createSanction(request: CreateSanctionRequest): Observable<SanctionDto> {
		return this.http.post<SanctionDto>('/api/sanctions', request);
	}

	revokeSanction(id: string, request: RevokeRequest): Observable<SanctionDto> {
		return this.http.post<SanctionDto>(`/api/sanctions/${id}/revoke`, request);
	}

	createNote(request: CreateNoteRequest): Observable<NoteDto> {
		return this.http.post<NoteDto>('/api/notes', request);
	}

	updateNote(id: string, request: UpdateNoteRequest): Observable<NoteDto> {
		return this.http.patch<NoteDto>(`/api/notes/${id}`, request);
	}

	deleteNote(id: string): Observable<void> {
		return this.http.delete<void>(`/api/notes/${id}`);
	}
}
