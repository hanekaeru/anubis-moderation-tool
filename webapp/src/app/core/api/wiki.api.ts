import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	CreateWikiArticleRequest,
	UpdateWikiArticleRequest,
	WikiArticleDto,
	WikiArticleSummaryDto,
	WikiSearchQuery,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class WikiApi {
	private readonly http = inject(HttpClient);

	search(query?: WikiSearchQuery & { deleted?: boolean }): Observable<WikiArticleSummaryDto[]> {
		return this.http.get<WikiArticleSummaryDto[]>('/api/wiki', {
			params: toHttpParams(query),
		});
	}

	/** Lecture par slug : c'est l'adresse partagee, pas l'identifiant technique. */
	findOne(slug: string): Observable<WikiArticleDto> {
		return this.http.get<WikiArticleDto>(`/api/wiki/${encodeURIComponent(slug)}`);
	}

	create(request: CreateWikiArticleRequest): Observable<WikiArticleDto> {
		return this.http.post<WikiArticleDto>('/api/wiki', request);
	}

	update(id: string, request: UpdateWikiArticleRequest): Observable<WikiArticleDto> {
		return this.http.patch<WikiArticleDto>(`/api/wiki/${id}`, request);
	}

	remove(id: string): Observable<void> {
		return this.http.delete<void>(`/api/wiki/${id}`);
	}

	restore(id: string): Observable<WikiArticleDto> {
		return this.http.post<WikiArticleDto>(`/api/wiki/${id}/restore`, {});
	}
}
