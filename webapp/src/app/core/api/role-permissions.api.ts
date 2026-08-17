import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	AppUserRole,
	RolePermissionsDto,
	RolePermissionsMatrixDto,
	UpdateRolePermissionsRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class RolePermissionsApi {
	private readonly http = inject(HttpClient);

	getMatrix(): Observable<RolePermissionsMatrixDto> {
		return this.http.get<RolePermissionsMatrixDto>('/api/role-permissions');
	}

	updateRole(
		role: AppUserRole,
		request: UpdateRolePermissionsRequest,
	): Observable<RolePermissionsDto> {
		return this.http.put<RolePermissionsDto>(`/api/role-permissions/${role}`, request);
	}
}
