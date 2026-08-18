import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateXpRewardRoleRequest,
	Paginated,
	UpdateXpConfigRequest,
	UpdateXpRewardRoleRequest,
	XpConfigDto,
	XpLeaderboardQuery,
	XpLeaderboardRowDto,
	XpOverviewDto,
	XpRewardRoleDto,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class XpApi {
	private readonly http = inject(HttpClient);

	overview(): Observable<XpOverviewDto> {
		return this.http.get<XpOverviewDto>('/api/experience');
	}

	leaderboard(query: XpLeaderboardQuery): Observable<Paginated<XpLeaderboardRowDto>> {
		return this.http.get<Paginated<XpLeaderboardRowDto>>('/api/experience/classement', {
			params: toHttpParams(query),
		});
	}

	memberProgress(userId: string): Observable<XpLeaderboardRowDto> {
		return this.http.get<XpLeaderboardRowDto>(`/api/experience/membres/${userId}`);
	}

	getConfig(): Observable<XpConfigDto> {
		return this.http.get<XpConfigDto>('/api/experience/configuration');
	}

	updateConfig(request: UpdateXpConfigRequest): Observable<XpConfigDto> {
		return this.http.patch<XpConfigDto>('/api/experience/configuration', request);
	}

	listRewards(): Observable<XpRewardRoleDto[]> {
		return this.http.get<XpRewardRoleDto[]>('/api/experience/recompenses');
	}

	createReward(request: CreateXpRewardRoleRequest): Observable<XpRewardRoleDto> {
		return this.http.post<XpRewardRoleDto>('/api/experience/recompenses', request);
	}

	updateReward(
		id: string,
		request: UpdateXpRewardRoleRequest,
	): Observable<XpRewardRoleDto> {
		return this.http.patch<XpRewardRoleDto>(
			`/api/experience/recompenses/${id}`,
			request,
		);
	}

	removeReward(id: string): Observable<void> {
		return this.http.delete<void>(`/api/experience/recompenses/${id}`);
	}
}
