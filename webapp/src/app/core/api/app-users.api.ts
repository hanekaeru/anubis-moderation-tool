import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	AppUserDto,
	AppUserSearchQuery,
	CreateAppUserRequest,
	CreateAppUserResponse,
	Paginated,
	ResetPasswordResponse,
	UpdateAppUserRequest,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class AppUsersApi {
	private readonly http = inject(HttpClient);

	search(query: AppUserSearchQuery): Observable<Paginated<AppUserDto>> {
		return this.http.get<Paginated<AppUserDto>>('/api/app-users', {
			params: toHttpParams(query),
		});
	}

	create(request: CreateAppUserRequest): Observable<CreateAppUserResponse> {
		return this.http.post<CreateAppUserResponse>('/api/app-users', request);
	}

	update(id: string, request: UpdateAppUserRequest): Observable<AppUserDto> {
		return this.http.patch<AppUserDto>(`/api/app-users/${id}`, request);
	}

	resetPassword(id: string): Observable<ResetPasswordResponse> {
		return this.http.post<ResetPasswordResponse>(`/api/app-users/${id}/reset-password`, {});
	}

	/**
	 * Retire la double authentification d'un compte qui n'y a plus acces.
	 *
	 * Reserve au proprietaire : la route exige `sessions:revoke` en plus de
	 * `users:write`, parce qu'elle coupe aussi les sessions du compte vise.
	 */
	resetTwoFactor(id: string): Observable<AppUserDto> {
		return this.http.post<AppUserDto>(
			`/api/app-users/${id}/double-authentification/reinitialisation`,
			{},
		);
	}

	unlock(id: string): Observable<AppUserDto> {
		return this.http.post<AppUserDto>(`/api/app-users/${id}/unlock`, {});
	}
}
