import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateVoiceHubPlatformRequest,
	CreateVoiceHubRankRequest,
	CreateVoiceHubRequest,
	LiveVoiceDto,
	UpdateVoiceHubPlatformRequest,
	UpdateVoiceHubRankRequest,
	UpdateVoiceHubRequest,
	VoiceHubDto,
	VoiceHubPlatformDto,
	VoiceHubRankDto,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class VoiceApi {
	private readonly http = inject(HttpClient);

	live(): Observable<LiveVoiceDto> {
		return this.http.get<LiveVoiceDto>('/api/voice/live');
	}

	listHubs(): Observable<VoiceHubDto[]> {
		return this.http.get<VoiceHubDto[]>('/api/voice/hubs');
	}

	createHub(request: CreateVoiceHubRequest): Observable<VoiceHubDto> {
		return this.http.post<VoiceHubDto>('/api/voice/hubs', request);
	}

	updateHub(id: string, request: UpdateVoiceHubRequest): Observable<VoiceHubDto> {
		return this.http.patch<VoiceHubDto>(`/api/voice/hubs/${id}`, request);
	}

	deleteHub(id: string): Observable<{ channelId: string | null }> {
		return this.http.delete<{ channelId: string | null }>(`/api/voice/hubs/${id}`);
	}

	createRank(hubId: string, request: CreateVoiceHubRankRequest): Observable<VoiceHubRankDto> {
		return this.http.post<VoiceHubRankDto>(`/api/voice/hubs/${hubId}/ranks`, request);
	}

	updateRank(
		hubId: string,
		rankId: string,
		request: UpdateVoiceHubRankRequest,
	): Observable<VoiceHubRankDto> {
		return this.http.patch<VoiceHubRankDto>(
			`/api/voice/hubs/${hubId}/ranks/${rankId}`,
			request,
		);
	}

	deleteRank(hubId: string, rankId: string): Observable<void> {
		return this.http.delete<void>(`/api/voice/hubs/${hubId}/ranks/${rankId}`);
	}

	createPlatform(
		hubId: string,
		request: CreateVoiceHubPlatformRequest,
	): Observable<VoiceHubPlatformDto> {
		return this.http.post<VoiceHubPlatformDto>(
			`/api/voice/hubs/${hubId}/platforms`,
			request,
		);
	}

	updatePlatform(
		hubId: string,
		platformId: string,
		request: UpdateVoiceHubPlatformRequest,
	): Observable<VoiceHubPlatformDto> {
		return this.http.patch<VoiceHubPlatformDto>(
			`/api/voice/hubs/${hubId}/platforms/${platformId}`,
			request,
		);
	}

	deletePlatform(hubId: string, platformId: string): Observable<void> {
		return this.http.delete<void>(`/api/voice/hubs/${hubId}/platforms/${platformId}`);
	}
}
