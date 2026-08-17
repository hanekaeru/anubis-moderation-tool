import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { interval, startWith, switchMap, takeWhile } from 'rxjs';
import type { DiscordLinkCodeDto, DiscordLinkStatusDto } from '@anubis/shared';
import { AccountApi } from '../../../core/api/account.api';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/notification.service';
import { RelativeTimePipe } from '../../../shared/pipes/format.pipes';

/** Intervalle de sondage pendant qu'un code est actif, en attente du /lier-compte cote Discord. */
const POLL_INTERVAL_MS = 4000;

@Component({
	selector: 'app-discord-link',
	imports: [
		MatButtonModule,
		MatCardModule,
		MatIconModule,
		MatProgressSpinnerModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './discord-link.html',
	styleUrl: './discord-link.scss',
})
export class DiscordLinkPage {
	private readonly accountApi = inject(AccountApi);
	private readonly auth = inject(AuthService);
	private readonly notifications = inject(NotificationService);
	private readonly destroyRef = inject(DestroyRef);

	readonly loading = signal(true);
	readonly link = signal<DiscordLinkStatusDto | null>(null);
	readonly code = signal<DiscordLinkCodeDto | null>(null);
	readonly generating = signal(false);
	readonly unlinking = signal(false);

	constructor() {
		this.accountApi.getDiscordLink().subscribe({
			next: (status) => {
				this.link.set(status);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	generateCode(): void {
		this.generating.set(true);

		this.accountApi.generateDiscordLinkCode().subscribe({
			next: (generated) => {
				this.generating.set(false);
				this.code.set(generated);
				this.pollUntilLinked();
			},
			error: () => this.generating.set(false),
		});
	}

	unlink(): void {
		this.unlinking.set(true);

		this.accountApi.unlinkDiscord().subscribe({
			next: (status) => {
				this.unlinking.set(false);
				this.link.set(status);
				this.code.set(null);
				this.auth.refreshMe().subscribe();
				this.notifications.success('Compte Discord détaché.');
			},
			error: () => this.unlinking.set(false),
		});
	}

	/** S'arrete des que le rattachement est detecte, ou si le code affiche expire. */
	private pollUntilLinked(): void {
		interval(POLL_INTERVAL_MS)
			.pipe(
				startWith(0),
				switchMap(() => this.accountApi.getDiscordLink()),
				takeWhile((status) => {
					const codeStillValid = (this.code()?.expiresAt ?? '') > new Date().toISOString();
					return !status.discordUserId && codeStillValid;
				}, true),
				takeUntilDestroyed(this.destroyRef),
			)
			.subscribe((status) => {
				this.link.set(status);
				if (status.discordUserId) {
					this.code.set(null);
					this.auth.refreshMe().subscribe();
					this.notifications.success('Compte Discord rattaché avec succès.');
				}
			});
	}
}
