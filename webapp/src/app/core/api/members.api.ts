import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
	AddMemberSeparatorsRequest,
	MemberDetail,
	MemberListItem,
	MemberRoleRequestDto,
	MemberSearchQuery,
	NoteDto,
	Paginated,
	RoleSummary,
	TimelineEntry,
	TimelineQuery,
	UpdateRoleSettingsRequest,
	VoiceSessionDto,
	VoiceSessionQuery,
} from '@anubis/shared';
import { toHttpParams } from './query-params';

@Injectable({ providedIn: 'root' })
export class MembersApi {
	private readonly http = inject(HttpClient);

	search(query: MemberSearchQuery): Observable<Paginated<MemberListItem>> {
		return this.http.get<Paginated<MemberListItem>>('/api/members', {
			params: toHttpParams(query),
		});
	}

	findOne(userId: string): Observable<MemberDetail> {
		return this.http.get<MemberDetail>(`/api/members/${userId}`);
	}

	timeline(userId: string, query: TimelineQuery): Observable<Paginated<TimelineEntry>> {
		return this.http.get<Paginated<TimelineEntry>>(`/api/members/${userId}/timeline`, {
			params: toHttpParams(query),
		});
	}

	voiceSessions(userId: string, query: VoiceSessionQuery): Observable<Paginated<VoiceSessionDto>> {
		return this.http.get<Paginated<VoiceSessionDto>>(`/api/members/${userId}/voice-sessions`, {
			params: toHttpParams(query),
		});
	}

	listRoles(): Observable<RoleSummary[]> {
		return this.http.get<RoleSummary[]>('/api/members/roles');
	}

	/** Reglages d'un role : historisation de ses mouvements, role separateur. */
	updateRoleSettings(roleId: string, request: UpdateRoleSettingsRequest): Observable<RoleSummary> {
		return this.http.patch<RoleSummary>(`/api/members/roles/${roleId}`, request);
	}

	/** Demande l'ajout de separateurs ; le bot les pose au passage suivant. */
	addSeparators(userId: string, request: AddMemberSeparatorsRequest): Observable<MemberRoleRequestDto> {
		return this.http.post<MemberRoleRequestDto>(`/api/members/${userId}/separators`, request);
	}

	notes(userId: string): Observable<NoteDto[]> {
		return this.http.get<NoteDto[]>(`/api/notes/member/${userId}`);
	}
}
