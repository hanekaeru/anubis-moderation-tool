import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { UpdateWelcomeConfigRequest, WelcomeConfigDto } from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class WelcomeApi {
	private readonly http = inject(HttpClient);

	getConfig(): Observable<WelcomeConfigDto> {
		return this.http.get<WelcomeConfigDto>('/api/welcome/configuration');
	}

	updateConfig(request: UpdateWelcomeConfigRequest): Observable<WelcomeConfigDto> {
		return this.http.patch<WelcomeConfigDto>('/api/welcome/configuration', request);
	}
}
