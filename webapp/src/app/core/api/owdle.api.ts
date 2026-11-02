import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateOwdleHeroRequest,
	OwdleAffiliationDto,
	OwdleConfigDto,
	OwdleHeroDto,
	OwdleOverviewDto,
	SaveOwdleAffiliationRequest,
	UpdateOwdleConfigRequest,
	UpdateOwdleHeroRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class OwdleApi {
	private readonly http = inject(HttpClient);

	overview(): Observable<OwdleOverviewDto> {
		return this.http.get<OwdleOverviewDto>('/api/owdle');
	}

	updateConfig(request: UpdateOwdleConfigRequest): Observable<OwdleConfigDto> {
		return this.http.patch<OwdleConfigDto>('/api/owdle/configuration', request);
	}

	createHero(request: CreateOwdleHeroRequest): Observable<OwdleHeroDto> {
		return this.http.post<OwdleHeroDto>('/api/owdle/heros', request);
	}

	updateHero(key: string, request: UpdateOwdleHeroRequest): Observable<OwdleHeroDto> {
		return this.http.patch<OwdleHeroDto>(`/api/owdle/heros/${encodeURIComponent(key)}`, request);
	}

	createAffiliation(request: SaveOwdleAffiliationRequest): Observable<OwdleAffiliationDto> {
		return this.http.post<OwdleAffiliationDto>('/api/owdle/affiliations', request);
	}

	renameAffiliation(key: string, request: SaveOwdleAffiliationRequest): Observable<OwdleAffiliationDto> {
		return this.http.patch<OwdleAffiliationDto>(
			`/api/owdle/affiliations/${encodeURIComponent(key)}`,
			request,
		);
	}

	removeAffiliation(key: string): Observable<void> {
		return this.http.delete<void>(`/api/owdle/affiliations/${encodeURIComponent(key)}`);
	}
}
