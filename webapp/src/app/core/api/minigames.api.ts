import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateMinigameMapRequest,
	MinigameCalendarDto,
	MinigameConfigDto,
	MinigameEventDto,
	MinigameMapDto,
	MinigameParticipantDto,
	SaveMinigameEventRequest,
	UpdateMinigameConfigRequest,
	UpdateMinigameEventRequest,
	UpdateMinigameMapRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class MinigamesApi {
	private readonly http = inject(HttpClient);

	calendar(from: string, to: string): Observable<MinigameCalendarDto> {
		return this.http.get<MinigameCalendarDto>('/api/mini-jeux', { params: { from, to } });
	}

	updateConfig(request: UpdateMinigameConfigRequest): Observable<MinigameConfigDto> {
		return this.http.patch<MinigameConfigDto>('/api/mini-jeux/configuration', request);
	}

	createEvent(request: SaveMinigameEventRequest): Observable<MinigameEventDto> {
		return this.http.post<MinigameEventDto>('/api/mini-jeux/jeux', request);
	}

	updateEvent(id: string, request: UpdateMinigameEventRequest): Observable<MinigameEventDto> {
		return this.http.patch<MinigameEventDto>(`/api/mini-jeux/jeux/${id}`, request);
	}

	removeEvent(id: string): Observable<void> {
		return this.http.delete<void>(`/api/mini-jeux/jeux/${id}`);
	}

	participants(id: string): Observable<MinigameParticipantDto[]> {
		return this.http.get<MinigameParticipantDto[]>(`/api/mini-jeux/jeux/${id}/participants`);
	}

	addImage(id: string, file: File): Observable<MinigameEventDto> {
		const body = new FormData();
		body.append('file', file);
		return this.http.post<MinigameEventDto>(`/api/mini-jeux/jeux/${id}/images`, body);
	}

	removeImage(id: string, imageId: string): Observable<MinigameEventDto> {
		return this.http.delete<MinigameEventDto>(`/api/mini-jeux/jeux/${id}/images/${imageId}`);
	}

	/** Les octets sont derriere le JWT : chargement en blob, pas en `<img src>`. */
	downloadImage(id: string, imageId: string): Observable<Blob> {
		return this.http.get(`/api/mini-jeux/jeux/${id}/images/${imageId}`, { responseType: 'blob' });
	}

	createMap(request: CreateMinigameMapRequest): Observable<MinigameMapDto> {
		return this.http.post<MinigameMapDto>('/api/mini-jeux/maps', request);
	}

	updateMap(key: string, request: UpdateMinigameMapRequest): Observable<MinigameMapDto> {
		return this.http.patch<MinigameMapDto>(`/api/mini-jeux/maps/${encodeURIComponent(key)}`, request);
	}
}
