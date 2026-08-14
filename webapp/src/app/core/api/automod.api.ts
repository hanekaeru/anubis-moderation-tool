import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	AutomodIncidentDto,
	AutomodIncidentSearchQuery,
	AutomodRuleDto,
	AutomodRuleType,
	Paginated,
	UpdateAutomodRuleRequest,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class AutomodApi {
	private readonly http = inject(HttpClient);

	listRules(): Observable<AutomodRuleDto[]> {
		return this.http.get<AutomodRuleDto[]>('/api/automod/rules');
	}

	upsertRule(type: AutomodRuleType, request: UpdateAutomodRuleRequest): Observable<AutomodRuleDto> {
		return this.http.patch<AutomodRuleDto>(`/api/automod/rules/${type}`, request);
	}

	listIncidents(query: AutomodIncidentSearchQuery): Observable<Paginated<AutomodIncidentDto>> {
		return this.http.get<Paginated<AutomodIncidentDto>>('/api/automod/incidents', {
			params: toHttpParams(query),
		});
	}
}
