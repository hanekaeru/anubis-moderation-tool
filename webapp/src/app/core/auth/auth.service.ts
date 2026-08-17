import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, tap } from 'rxjs';
import type {
	ChangePasswordRequest,
	DisableTwoFactorRequest,
	LoginRequest,
	LoginResponse,
	LoginResult,
	Permission,
	SessionUser,
	TwoFactorLoginRequest,
	TwoFactorRecoveryCodesResponse,
	TwoFactorSetupResponse,
	TwoFactorStatus,
} from '@anubis/shared';
import { isTwoFactorChallenge } from '@anubis/shared';

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

	/**
	 * Premier facteur.
	 *
	 * Le resultat est l'un **ou** l'autre : une session ouverte, ou un defi de
	 * second facteur. Il est rendu tel quel a l'appelant, qui seul sait quel
	 * ecran afficher ensuite — la session n'est appliquee que dans le premier
	 * cas.
	 */
	login(credentials: LoginRequest): Observable<LoginResult> {
		return this.http
			.post<LoginResult>('/api/auth/login', credentials, {
				withCredentials: true,
			})
			.pipe(
				tap((result) => {
					if (!isTwoFactorChallenge(result)) this.applySession(result);
				}),
			);
	}

	/** Second facteur : c'est ici que la session s'ouvre pour un compte protege. */
	completeTwoFactorLogin(request: TwoFactorLoginRequest): Observable<SessionUser> {
		return this.http
			.post<LoginResponse>('/api/auth/login/double-authentification', request, {
				withCredentials: true,
			})
			.pipe(
				tap((response) => this.applySession(response)),
				map((response) => response.user),
			);
	}

	twoFactorStatus(): Observable<TwoFactorStatus> {
		return this.http.get<TwoFactorStatus>('/api/auth/double-authentification');
	}

	prepareTwoFactor(): Observable<TwoFactorSetupResponse> {
		return this.http.post<TwoFactorSetupResponse>(
			'/api/auth/double-authentification/preparation',
			{},
		);
	}

	enableTwoFactor(code: string): Observable<TwoFactorRecoveryCodesResponse> {
		return this.http
			.post<TwoFactorRecoveryCodesResponse>(
				'/api/auth/double-authentification/activation',
				{ code },
			)
			// Le profil porte `twoFactorEnabled` : sans relecture, l'en-tete et la
			// page continueraient d'annoncer un compte non protege.
			.pipe(tap(() => this.refreshMe().subscribe()));
	}

	disableTwoFactor(request: DisableTwoFactorRequest): Observable<void> {
		return this.http
			.post<void>('/api/auth/double-authentification/desactivation', request)
			.pipe(tap(() => this.refreshMe().subscribe()));
	}

	regenerateRecoveryCodes(code: string): Observable<TwoFactorRecoveryCodesResponse> {
		return this.http.post<TwoFactorRecoveryCodesResponse>(
			'/api/auth/double-authentification/codes-de-secours',
			{ code },
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
