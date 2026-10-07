import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateGuildConfigRequest,
	GuildConfigDto,
	MentionSettingsDto,
	UpdateGuildConfigRequest,
	UpdateMentionSettingsRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class GuildConfigApi {
	private readonly http = inject(HttpClient);

	list(): Observable<GuildConfigDto[]> {
		return this.http.get<GuildConfigDto[]>('/api/guild-config');
	}

	create(request: CreateGuildConfigRequest): Observable<GuildConfigDto> {
		return this.http.post<GuildConfigDto>('/api/guild-config', request);
	}

	update(id: string, request: UpdateGuildConfigRequest): Observable<GuildConfigDto> {
		return this.http.patch<GuildConfigDto>(`/api/guild-config/${id}`, request);
	}

	delete(id: string): Observable<void> {
		return this.http.delete<void>(`/api/guild-config/${id}`);
	}

	getMentions(): Observable<MentionSettingsDto> {
		return this.http.get<MentionSettingsDto>('/api/guild-config/mentions');
	}

	updateMentions(request: UpdateMentionSettingsRequest): Observable<MentionSettingsDto> {
		return this.http.put<MentionSettingsDto>('/api/guild-config/mentions', request);
	}
}
