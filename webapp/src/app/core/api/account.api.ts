import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { DiscordLinkCodeDto, DiscordLinkStatusDto } from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class AccountApi {
	private readonly http = inject(HttpClient);

	getDiscordLink(): Observable<DiscordLinkStatusDto> {
		return this.http.get<DiscordLinkStatusDto>('/api/account/discord-link');
	}

	generateDiscordLinkCode(): Observable<DiscordLinkCodeDto> {
		return this.http.post<DiscordLinkCodeDto>('/api/account/discord-link/code', {});
	}

	unlinkDiscord(): Observable<DiscordLinkStatusDto> {
		return this.http.delete<DiscordLinkStatusDto>('/api/account/discord-link');
	}
}
