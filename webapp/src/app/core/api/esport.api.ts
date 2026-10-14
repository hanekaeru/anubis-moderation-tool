import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	EsportConfigDto,
	EsportMatchPayload,
	EsportResultRequest,
	EsportTeamDto,
	EsportTeamPayload,
	EsportWeekDto,
	EsportWeekSummaryDto,
	PandascoreResultSuggestionDto,
	PandascoreWeekDto,
	UpdateEsportConfigRequest,
	UpdateEsportWeekRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class EsportApi {
	private readonly http = inject(HttpClient);

	getConfig(): Observable<EsportConfigDto> {
		return this.http.get<EsportConfigDto>('/api/esport/configuration');
	}

	updateConfig(request: UpdateEsportConfigRequest): Observable<EsportConfigDto> {
		return this.http.patch<EsportConfigDto>('/api/esport/configuration', request);
	}

	listTeams(): Observable<EsportTeamDto[]> {
		return this.http.get<EsportTeamDto[]>('/api/esport/equipes');
	}

	createTeam(request: EsportTeamPayload): Observable<EsportTeamDto> {
		return this.http.post<EsportTeamDto>('/api/esport/equipes', request);
	}

	updateTeam(id: string, request: EsportTeamPayload): Observable<EsportTeamDto> {
		return this.http.patch<EsportTeamDto>(`/api/esport/equipes/${id}`, request);
	}

	/** Archive l'equipe si elle a deja joue, la supprime sinon. */
	removeTeam(id: string): Observable<{ archived: EsportTeamDto | null }> {
		return this.http.delete<{ archived: EsportTeamDto | null }>(`/api/esport/equipes/${id}`);
	}

	restoreTeam(id: string): Observable<EsportTeamDto> {
		return this.http.post<EsportTeamDto>(`/api/esport/equipes/${id}/restauration`, {});
	}

	listWeeks(): Observable<EsportWeekSummaryDto[]> {
		return this.http.get<EsportWeekSummaryDto[]>('/api/esport/semaines');
	}

	getWeek(weekStart: string): Observable<{ week: EsportWeekDto | null }> {
		return this.http.get<{ week: EsportWeekDto | null }>(`/api/esport/semaines/${weekStart}`);
	}

	createWeek(weekStart: string): Observable<EsportWeekDto> {
		return this.http.post<EsportWeekDto>('/api/esport/semaines', { weekStart });
	}

	updateWeek(id: string, request: UpdateEsportWeekRequest): Observable<EsportWeekDto> {
		return this.http.patch<EsportWeekDto>(`/api/esport/semaines/${id}`, request);
	}

	deleteWeek(id: string): Observable<void> {
		return this.http.delete<void>(`/api/esport/semaines/${id}`);
	}

	publishWeek(id: string): Observable<EsportWeekDto> {
		return this.http.post<EsportWeekDto>(`/api/esport/semaines/${id}/envoi`, {});
	}

	removeWeekMessage(id: string): Observable<EsportWeekDto> {
		return this.http.post<EsportWeekDto>(`/api/esport/semaines/${id}/retrait`, {});
	}

	addMatch(weekId: string, request: EsportMatchPayload): Observable<EsportWeekDto> {
		return this.http.post<EsportWeekDto>(`/api/esport/semaines/${weekId}/matchs`, request);
	}

	updateMatch(id: string, request: EsportMatchPayload): Observable<EsportWeekDto> {
		return this.http.patch<EsportWeekDto>(`/api/esport/matchs/${id}`, request);
	}

	deleteMatch(id: string): Observable<EsportWeekDto> {
		return this.http.delete<EsportWeekDto>(`/api/esport/matchs/${id}`);
	}

	setResult(id: string, request: EsportResultRequest): Observable<EsportWeekDto> {
		return this.http.put<EsportWeekDto>(`/api/esport/matchs/${id}/resultat`, request);
	}

	reopenMatch(id: string): Observable<EsportWeekDto> {
		return this.http.delete<EsportWeekDto>(`/api/esport/matchs/${id}/resultat`);
	}

	removeResultMessage(id: string): Observable<EsportWeekDto> {
		return this.http.post<EsportWeekDto>(`/api/esport/matchs/${id}/resultat/retrait`, {});
	}

	/** Lit le cache ; PandaScore n'est appele que si la semaine n'a jamais ete recuperee. */
	getPandascoreWeek(weekId: string): Observable<PandascoreWeekDto> {
		return this.http.get<PandascoreWeekDto>(`/api/esport/semaines/${weekId}/pandascore`);
	}

	refreshPandascoreWeek(weekId: string): Observable<PandascoreWeekDto> {
		return this.http.post<PandascoreWeekDto>(
			`/api/esport/semaines/${weekId}/pandascore/actualisation`,
			{},
		);
	}

	importMatches(weekId: string, ids: number[]): Observable<EsportWeekDto> {
		return this.http.post<EsportWeekDto>(`/api/esport/semaines/${weekId}/import`, { ids });
	}

	getPandascoreResult(matchId: string): Observable<PandascoreResultSuggestionDto> {
		return this.http.get<PandascoreResultSuggestionDto>(`/api/esport/matchs/${matchId}/pandascore`);
	}
}
