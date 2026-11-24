import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MinigameType, type MinigameParticipantDto } from '@anubis/shared';
import { MinigamesApi } from '../../core/api/minigames.api';
import { readApiError } from '../../core/error.interceptor';
import { MemberAvatar } from '../../shared/components/member-avatar';

type Outcome = 'SOLVED' | 'HERO' | 'FAILED' | 'PLAYING' | 'RIGHT' | 'WRONG';

const OUTCOME_LABELS: Record<Outcome, string> = {
	SOLVED: '✅ Trouvé',
	HERO: '🦸 Héros seul',
	FAILED: '❌ Pas trouvé',
	PLAYING: '⏳ En jeu',
	RIGHT: '✅ Bonne réponse',
	WRONG: '❌ Mauvaise réponse',
};

/**
 * Qui a joue a un mini-jeu, et comment.
 *
 * Les jeux a deviner ont une ligne par membre des son premier essai ; le vrai
 * ou faux n'en a qu'a la fermeture, quand le bot releve les votes finaux. Le
 * duel et le clip n'en ont aucune : la boite ne montre pas cet onglet pour eux.
 */
@Component({
	selector: 'app-minigame-participants',
	imports: [DatePipe, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MemberAvatar],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="toolbar">
			<p class="summary">{{ summary() }}</p>
			@if (!closed()) {
				<button matIconButton matTooltip="Actualiser" aria-label="Actualiser" [disabled]="loading()" (click)="load()">
					<mat-icon>refresh</mat-icon>
				</button>
			}
		</div>

		@if (loading()) {
			<mat-progress-bar mode="indeterminate" />
		}

		@if (error(); as message) {
			<p class="error" role="alert">{{ message }}</p>
		} @else if (!loading() && !rows().length) {
			<p class="empty">{{ emptyLabel() }}</p>
		} @else {
			<ul class="list">
				@for (row of rows(); track row.member.userId) {
					<li [attr.data-outcome]="row.outcome">
						<app-member-avatar
							class="who"
							[username]="row.member.username"
							[globalName]="row.member.globalName"
							[avatarUrl]="row.member.avatarUrl"
							[size]="28"
						/>
						<span class="outcome">
							{{ outcomeLabels[row.outcome] }}
							@if (isGuess()) {
								<span class="attempts">· {{ row.attempts }}/{{ maxAttempts() }}</span>
							}
						</span>
						<span class="guesses">
							@for (guess of row.guesses; track $index; let last = $last) {
								<span class="guess" [class.hit]="last && row.solvedAt">{{ guess }}</span>
							}
						</span>
						<span class="xp" [matTooltip]="(row.solvedAt ?? row.heroFoundAt ?? row.playedAt | date: 'HH:mm') ?? ''">
							{{ row.xpAwarded ? '+' + row.xpAwarded + ' XP' : '—' }}
						</span>
					</li>
				}
			</ul>
		}
	`,
	styles: `
		.toolbar {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			min-height: 40px;
		}

		.summary {
			flex: 1;
			margin: 0;
			color: var(--mat-sys-on-surface-variant);
		}

		.list {
			list-style: none;
			margin: var(--space-2) 0 0;
			padding: 0;
		}

		li {
			display: grid;
			grid-template-columns: minmax(140px, 220px) 170px minmax(0, 1fr) 72px;
			align-items: center;
			gap: var(--space-3);
			min-height: 44px;
			padding: var(--space-1) 0;
			border-bottom: 1px solid var(--mat-sys-outline-variant);
		}

		.who {
			min-width: 0;
		}

		.outcome {
			font-size: 0.85rem;
			white-space: nowrap;
		}

		.attempts {
			color: var(--mat-sys-on-surface-variant);
		}

		.guesses {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-1);
		}

		.guess {
			padding: 1px 8px;
			border-radius: 999px;
			font-size: 0.8rem;
			background: var(--mat-sys-surface-container-high);
		}

		.guess.hit {
			background: var(--mat-sys-primary-container);
			color: var(--mat-sys-on-primary-container);
			font-weight: 500;
		}

		.xp {
			text-align: right;
			font-size: 0.85rem;
			font-variant-numeric: tabular-nums;
		}

		.empty {
			margin: var(--space-4) 0;
			color: var(--mat-sys-on-surface-variant);
		}

		.error {
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 720px) {
			li {
				grid-template-columns: minmax(0, 1fr) auto;
				row-gap: var(--space-1);
				padding: var(--space-2) 0;
			}

			.guesses {
				grid-column: 1 / -1;
			}

			.xp {
				grid-row: 1;
				grid-column: 2;
			}
		}
	`,
})
export class MinigameParticipants {
	private readonly api = inject(MinigamesApi);

	readonly eventId = input.required<string>();
	readonly type = input.required<MinigameType>();
	readonly maxAttempts = input.required<number>();
	/** Jeu ferme : plus rien ne bouge, inutile d'actualiser. */
	readonly closed = input(false);

	readonly outcomeLabels = OUTCOME_LABELS;
	readonly loading = signal(true);
	readonly error = signal<string | null>(null);
	private readonly participants = signal<MinigameParticipantDto[]>([]);

	readonly isGuess = computed(() => this.type() !== MinigameType.TRUE_FALSE);

	readonly rows = computed(() =>
		this.participants().map((p) => ({ ...p, outcome: this.outcomeOf(p) })),
	);

	readonly summary = computed(() => {
		const rows = this.rows();
		const n = rows.length;
		const total = `${n} participant${n > 1 ? 's' : ''}`;
		if (!this.isGuess()) {
			const right = rows.filter((r) => r.outcome === 'RIGHT').length;
			return `${total} · ${right} bonne${right > 1 ? 's' : ''} réponse${right > 1 ? 's' : ''}`;
		}
		const solved = rows.filter((r) => r.outcome === 'SOLVED').length;
		const hero = rows.filter((r) => r.outcome === 'HERO').length;
		return [total, `${solved} trouvé${solved > 1 ? 's' : ''}`, hero ? `${hero} héros seul${hero > 1 ? 's' : ''}` : null]
			.filter(Boolean)
			.join(' · ');
	});

	readonly emptyLabel = computed(() =>
		this.isGuess()
			? 'Personne n’a encore joué.'
			: this.closed()
				? 'Personne n’a voté.'
				: 'Les votes sont relevés à la fermeture du sondage, à minuit.',
	);

	constructor() {
		effect(() => {
			this.eventId();
			this.load();
		});
	}

	load(): void {
		this.loading.set(true);
		this.error.set(null);
		this.api.participants(this.eventId()).subscribe({
			next: (list) => {
				this.participants.set(list);
				this.loading.set(false);
			},
			error: (err) => {
				this.loading.set(false);
				this.error.set(readApiError(err));
			},
		});
	}

	private outcomeOf(p: MinigameParticipantDto): Outcome {
		if (!this.isGuess()) return p.solvedAt ? 'RIGHT' : 'WRONG';
		if (p.solvedAt) return 'SOLVED';
		if (p.attempts >= this.maxAttempts() || this.closed()) return p.heroFoundAt ? 'HERO' : 'FAILED';
		return p.heroFoundAt ? 'HERO' : 'PLAYING';
	}
}
