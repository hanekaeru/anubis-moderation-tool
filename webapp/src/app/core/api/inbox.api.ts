import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { InboxDto } from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class InboxApi {
	private readonly http = inject(HttpClient);

	get(): Observable<InboxDto> {
		return this.http.get<InboxDto>('/api/a-traiter');
	}
}
