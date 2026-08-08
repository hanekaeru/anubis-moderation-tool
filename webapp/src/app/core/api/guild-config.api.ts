import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CreateGuildConfigRequest,
  GuildConfigDto,
  UpdateGuildConfigRequest,
} from '@anubis/shared';

@Injectable({ providedIn: 'root' })
export class GuildConfigApi {
  private readonly http = inject(HttpClient);

  list(): Observable<GuildConfigDto[]> {
    return this.http.get<GuildConfigDto[]>('/api/guild-config');
  }

  create(request: CreateGuildConfigRequest): Observable<GuildConfigDto> {
    return this.http.post<GuildConfigDto>('/api/guild-config', request);
  }

  update(id: string, request: UpdateGuildConfigRequest): Observable<GuildConfigDto> {
    return this.http.patch<GuildConfigDto>(`/api/guild-config/${id}`, request);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/guild-config/${id}`);
  }
}
