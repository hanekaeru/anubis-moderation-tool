import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateVoiceHubRequest,
	LiveVoiceDto,
	UpdateVoiceHubRequest,
	VoiceHubDto,
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
}
