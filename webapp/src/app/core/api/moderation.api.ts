import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateNoteRequest,
	CreateSanctionRequest,
	CreateWarningRequest,
	ModerationAttachmentRef,
	ModerationPointsConfigDto,
	NoteDto,
	Paginated,
	RevokeRequest,
	SanctionDto,
	SanctionSearchQuery,
	UpdateModerationPointsRequest,
	UpdateNoteRequest,
	WarningDto,
	WarningSearchQuery,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

/** Segment d'URL de la decision qui porte la piece jointe. */
export type ModerationTarget = 'sanctions' | 'warnings';

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

	/**
	 * Depot d'une piece jointe.
	 *
	 * `FormData` sans en-tete explicite : le navigateur pose lui-meme le
	 * `Content-Type: multipart/form-data` avec la frontiere qu'il a tiree, et
	 * le fixer a la main casserait le decoupage cote serveur.
	 */
	uploadAttachment(
		kind: ModerationTarget,
		id: string,
		file: File,
		spoiler = false,
	): Observable<ModerationAttachmentRef> {
		const body = new FormData();
		body.append('file', file);
		// Un champ multipart est toujours une chaine : l'API ne reconnait que le
		// mot exact `true`, et un `Boolean("false")` y vaudrait `true`.
		body.append('spoiler', String(spoiler));

		return this.http.post<ModerationAttachmentRef>(
			`/api/${kind}/${id}/attachments`,
			body,
		);
	}

	/** Les octets sont derriere le JWT : chargement en blob, pas en `<img src>`. */
	downloadAttachment(kind: ModerationTarget, id: string, attachmentId: string): Observable<Blob> {
		return this.http.get(`/api/${kind}/${id}/attachments/${attachmentId}`, {
			responseType: 'blob',
		});
	}

	deleteAttachment(kind: ModerationTarget, id: string, attachmentId: string): Observable<void> {
		return this.http.delete<void>(`/api/${kind}/${id}/attachments/${attachmentId}`);
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

	getPointsConfig(): Observable<ModerationPointsConfigDto> {
		return this.http.get<ModerationPointsConfigDto>('/api/moderation-points');
	}

	updatePointsConfig(
		request: UpdateModerationPointsRequest,
	): Observable<ModerationPointsConfigDto> {
		return this.http.put<ModerationPointsConfigDto>('/api/moderation-points', request);
	}
}
