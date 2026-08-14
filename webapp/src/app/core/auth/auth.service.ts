import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import type {
	ChangePasswordRequest,
	LoginRequest,
	LoginResponse,
	Permission,
	SessionUser,
} from '@anubis/shared';

/**
 * Etat de session du dashboard.
 *
 * L'access token vit uniquement en memoire : ni localStorage ni sessionStorage,
 * pour qu'un script injecte ne puisse pas le lire. La persistance entre deux
 * rechargements est assuree par le cookie httpOnly de refresh, rejoue au
 * demarrage par `restoreSession`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
	private readonly http = inject(HttpClient);
	private readonly router = inject(Router);

	private readonly accessToken = signal<string | null>(null);
	private readonly user = signal<SessionUser | null>(null);
	/** Passe a true une fois la tentative de restauration terminee. */
	private readonly ready = signal(false);

	readonly currentUser = this.user.asReadonly();
	readonly isReady = this.ready.asReadonly();
	readonly isAuthenticated = computed(() => this.user() !== null);
	readonly mustChangePassword = computed(() => this.user()?.mustChangePassword ?? false);

	token(): string | null {
		return this.accessToken();
	}

	hasPermission(permission: Permission): boolean {
		return this.user()?.permissions.includes(permission) ?? false;
	}

	hasAnyPermission(permissions: Permission[]): boolean {
		const granted = this.user()?.permissions;
		if (!granted) return false;
		return permissions.some((permission) => granted.includes(permission));
	}

	login(credentials: LoginRequest): Observable<SessionUser> {
		return this.http
			.post<LoginResponse>('/api/auth/login', credentials, {
				withCredentials: true,
			})
			.pipe(
				tap((response) => this.applySession(response)),
				map((response) => response.user),
			);
	}

	/**
	 * Rejoue le cookie de refresh au demarrage.
	 *
	 * Un echec est le cas normal d'un visiteur non connecte : il ne doit rien
	 * casser, seulement laisser la session vide.
	 */
	restoreSession(): Observable<boolean> {
		return this.http.post<LoginResponse>('/api/auth/refresh', {}, { withCredentials: true }).pipe(
			tap((response) => this.applySession(response)),
			map(() => true),
			catchError(() => of(false)),
			tap(() => this.ready.set(true)),
		);
	}

	refreshToken(): Observable<string> {
		return this.http.post<LoginResponse>('/api/auth/refresh', {}, { withCredentials: true }).pipe(
			tap((response) => this.applySession(response)),
			map((response) => response.accessToken),
		);
	}

	/** Relit le profil courant sans passer par le cookie de refresh — utilise apres une action qui modifie le compte (ex. rattachement Discord) sans toucher a la session. */
	refreshMe(): Observable<SessionUser> {
		return this.http
			.get<SessionUser>('/api/auth/me')
			.pipe(tap((user) => this.user.set(user)));
	}

	changePassword(request: ChangePasswordRequest): Observable<void> {
		return this.http.post<void>('/api/auth/password', request, { withCredentials: true }).pipe(
			// Le serveur a revoque toutes les sessions, celle-ci comprise.
			tap(() => this.clearSession()),
		);
	}

	logout(): void {
		this.http.post<void>('/api/auth/logout', {}, { withCredentials: true }).subscribe({
			// La session locale est videe dans tous les cas : si l'appel echoue,
			// rester connecte cote client n'aurait aucun sens.
			next: () => this.redirectToLogin(),
			error: () => this.redirectToLogin(),
		});
	}

	private redirectToLogin(): void {
		this.clearSession();
		void this.router.navigate(['/connexion']);
	}

	clearSession(): void {
		this.accessToken.set(null);
		this.user.set(null);
	}

	private applySession(response: LoginResponse): void {
		this.accessToken.set(response.accessToken);
		this.user.set(response.user);
		this.ready.set(true);
	}
}
