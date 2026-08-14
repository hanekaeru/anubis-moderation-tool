import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { RaidConfigDto, RaidIncidentDto, UpdateRaidConfigRequest } from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class RaidApi {
	private readonly http = inject(HttpClient);

	getConfig(): Observable<RaidConfigDto> {
		return this.http.get<RaidConfigDto>('/api/raid/config');
	}

	updateConfig(request: UpdateRaidConfigRequest): Observable<RaidConfigDto> {
		return this.http.patch<RaidConfigDto>('/api/raid/config', request);
	}

	listIncidents(): Observable<RaidIncidentDto[]> {
		return this.http.get<RaidIncidentDto[]>('/api/raid/incidents');
	}

	triggerLockdown(): Observable<RaidIncidentDto> {
		return this.http.post<RaidIncidentDto>('/api/raid/lockdown', {});
	}

	resolve(id: string): Observable<RaidIncidentDto> {
		return this.http.post<RaidIncidentDto>(`/api/raid/incidents/${id}/resolve`, {});
	}
}
