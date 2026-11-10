import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { BattlenetLinkDto, UnlinkBattlenetRequest } from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class BattlenetApi {
	private readonly http = inject(HttpClient);

	getLink(userId: string): Observable<BattlenetLinkDto> {
		return this.http.get<BattlenetLinkDto>(`/api/battlenet/links/${userId}`);
	}

	unlink(userId: string, request: UnlinkBattlenetRequest): Observable<BattlenetLinkDto> {
		return this.http.post<BattlenetLinkDto>(`/api/battlenet/links/${userId}/unlink`, request);
	}
}
