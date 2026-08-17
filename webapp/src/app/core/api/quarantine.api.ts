import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	QuarantineConfigDto,
	QuarantineStatusDto,
	UpdateQuarantineConfigRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class QuarantineApi {
	private readonly http = inject(HttpClient);

	getConfig(): Observable<QuarantineConfigDto> {
		return this.http.get<QuarantineConfigDto>('/api/quarantine/config');
	}

	updateConfig(request: UpdateQuarantineConfigRequest): Observable<QuarantineConfigDto> {
		return this.http.patch<QuarantineConfigDto>('/api/quarantine/config', request);
	}

	listActive(): Observable<QuarantineStatusDto[]> {
		return this.http.get<QuarantineStatusDto[]>('/api/quarantine/status');
	}

	release(userId: string): Observable<QuarantineStatusDto> {
		return this.http.post<QuarantineStatusDto>(`/api/quarantine/status/${userId}/release`, {});
	}
}
