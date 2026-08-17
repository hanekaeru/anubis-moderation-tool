import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { StatusDto } from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class StatusApi {
	private readonly http = inject(HttpClient);

	get(): Observable<StatusDto> {
		return this.http.get<StatusDto>('/api/status');
	}
}
