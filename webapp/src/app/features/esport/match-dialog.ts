import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
	addDaysToKey,
	detectEsportRegion,
	esportCalendarDay,
	esportDayKey,
	esportDayLabel,
	esportFormatLabel,
	ESPORT_DAY_START,
	ESPORT_REGIONS,
	EsportMatchFormat,
	ESPORT_TIME_ZONE,
	zonedTimeOfDay,
	zonedWallTimeToUtc,
	type EsportMatchDto,
	type EsportTeamDto,
	type EsportWeekDto,
} from '@anubis/shared';
import { EsportApi } from '../../core/api/esport.api';
import { readApiError } from '../../core/error.interceptor';
import { customEmojiUrl } from './discord-markdown';

export interface MatchDialogData {
	week: EsportWeekDto;
	teams: EsportTeamDto[];
	/** `null` pour un ajout. */
	match: EsportMatchDto | null;
}

/**
 * Ajout ou modification d'un match.
 *
 * La date et l'heure se saisissent **a l'heure de Paris**, quel que soit le
 * fuseau du navigateur : c'est l'heure que le staff lit sur les annonces
 * officielles. La conversion passe par `zonedWallTimeToUtc`, partagee avec
 * l'API qui verifie que le match tombe bien dans sa semaine.
 *
 * On choisit une **journee** puis une heure, comme le recapitulatif les
 * affiche : « dimanche, 01:00 » est la nuit du dimanche au lundi
 * (`esportCalendarDay`), pas la nuit du samedi au dimanche.
 */
@Component({
	selector: 'app-esport-match-dialog',
	imports: [
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatInputModule,
		MatSelectModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>{{ data.match ? 'Modifier le match' : 'Ajouter un match' }}</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form">
				<div class="row">
					<mat-form-field>
						<mat-label>Équipe 1</mat-label>
						<mat-select formControlName="teamAId">
							<mat-option [value]="null"><em>À déterminer</em></mat-option>
							@for (team of choices(); track team.id) {
								<mat-option [value]="team.id">
									@if (emojiUrl(team.emoji); as url) {
										<img class="emoji" [src]="url" alt="" />
									} @else if (team.emoji) {
										{{ team.emoji }}
									}
									{{ team.name }}
								</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<span class="vs">vs</span>

					<mat-form-field>
						<mat-label>Équipe 2</mat-label>
						<mat-select formControlName="teamBId">
							<mat-option [value]="null"><em>À déterminer</em></mat-option>
							@for (team of choices(); track team.id) {
								<mat-option [value]="team.id">
									@if (emojiUrl(team.emoji); as url) {
										<img class="emoji" [src]="url" alt="" />
									} @else if (team.emoji) {
										{{ team.emoji }}
									}
									{{ team.name }}
								</mat-option>
							}
						</mat-select>
					</mat-form-field>
				</div>

				@if (!data.teams.length) {
					<p class="hint">Aucune équipe : ajoutez-les d'abord dans la carte « Équipes ».</p>
				}

				<div class="row">
					<mat-form-field>
						<mat-label>Journée</mat-label>
						<mat-select formControlName="date">
							@for (day of days; track day.key) {
								<mat-option [value]="day.key">{{ day.label }}</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<mat-form-field>
						<mat-label>Heure (Paris)</mat-label>
						<input matInput type="time" formControlName="time" />
						@if (night()) {
							<mat-hint>🌙 Nuit suivante : {{ nightLabel() }}.</mat-hint>
						} @else {
							<mat-hint>Avant 06:00 : la nuit qui suit cette journée.</mat-hint>
						}
					</mat-form-field>
				</div>

				<div class="row">
					<mat-form-field class="region">
						<mat-label>Région</mat-label>
						<mat-select formControlName="region">
							<mat-option [value]="null">—</mat-option>
							@for (region of regions; track region.code) {
								<mat-option [value]="region.code">{{ region.emoji }} {{ region.label }}</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<mat-form-field class="grow">
						<mat-label>Compétition</mat-label>
						<input matInput formControlName="competition" maxlength="120" list="esport-competitions" placeholder="OWCS EMEA" />
						<datalist id="esport-competitions">
							@for (competition of competitions; track competition) {
								<option [value]="competition"></option>
							}
						</datalist>
					</mat-form-field>

					<mat-form-field class="small">
						<mat-label>Format</mat-label>
						<mat-select formControlName="format">
							<mat-option [value]="null">—</mat-option>
							@for (format of formats; track format) {
								<mat-option [value]="format">{{ formatLabel(format) }}</mat-option>
							}
						</mat-select>
					</mat-form-field>
				</div>

				<mat-form-field>
					<mat-label>Lien du stream</mat-label>
					<input matInput formControlName="streamUrl" placeholder="https://twitch.tv/…" />
					@if (form.controls.streamUrl.hasError('pattern')) {
						<mat-error>Adresse http(s) attendue.</mat-error>
					}
				</mat-form-field>
			</form>

			@if (data.match?.pandascoreId) {
				<p class="hint">
					Match importé depuis PandaScore. Vos modifications sont conservées ; seul un nouvel
					import de ce match, demandé depuis « Importer depuis PandaScore », les remplacerait.
				</p>
			}

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving()" (click)="save()">
				{{ data.match ? 'Enregistrer' : 'Ajouter' }}
			</button>
		</mat-dialog-actions>
	`,
	styles: `
		.form {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			min-width: 480px;
			padding-top: 4px;
		}

		.row {
			display: flex;
			align-items: flex-start;
			gap: var(--space-3);

			mat-form-field {
				flex: 1;
			}

			.small {
				flex: 0 0 120px;
			}

			.region {
				flex: 0 0 200px;
			}
		}

		.vs {
			padding-top: 16px;
			color: var(--mat-sys-on-surface-variant);
		}

		.emoji {
			width: 18px;
			height: 18px;
			vertical-align: -3px;
		}

		.hint {
			margin: 0;
			color: var(--mat-sys-on-surface-variant);
			font-size: 0.85rem;
		}

		.error {
			margin: var(--space-3) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 600px) {
			.form {
				min-width: 0;
			}

			.row {
				flex-direction: column;
				align-items: stretch;
				gap: 0;
			}

			.vs {
				display: none;
			}
		}
	`,
})
export class EsportMatchDialog {
	private readonly api = inject(EsportApi);
	private readonly dialogRef = inject(MatDialogRef<EsportMatchDialog, EsportWeekDto>);
	readonly data = inject<MatchDialogData>(MAT_DIALOG_DATA);

	/** « BO3 » : au meilleur des trois manches ; « FT3 » : premier a trois (OWCS). */
	readonly formats = ['BEST_OF:1', 'BEST_OF:3', 'BEST_OF:5', 'BEST_OF:7', 'FIRST_TO:2', 'FIRST_TO:3', 'FIRST_TO:4'];
	readonly lastDay = addDaysToKey(this.data.week.weekStart, 6);
	readonly regions = ESPORT_REGIONS;

	/** Les sept journees de la semaine ; une journee court jusqu'a 05:59 le lendemain. */
	readonly days = Array.from({ length: 7 }, (_, index) => {
		const key = addDaysToKey(this.data.week.weekStart, index);
		return { key, label: esportDayLabel(key) };
	});
	readonly emojiUrl = customEmojiUrl;

	/** Competitions deja saisies cette semaine, proposees a la frappe. */
	readonly competitions = [
		...new Set(
			this.data.week.matches
				.map((match) => match.competition)
				.filter((value): value is string => !!value),
		),
	];

	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	/** Equipes actives, plus une equipe archivee que ce match porterait deja. */
	readonly choices = computed(() => {
		const dejaLa = new Set([this.data.match?.teamA?.id, this.data.match?.teamB?.id]);
		return this.data.teams.filter((team) => !team.archived || dejaLa.has(team.id));
	});

	readonly form = inject(FormBuilder).group({
		teamAId: [this.data.match?.teamA?.id ?? (null as string | null)],
		teamBId: [this.data.match?.teamB?.id ?? (null as string | null)],
		date: [
			this.data.match
				? esportDayKey(new Date(this.data.match.scheduledAt))
				: this.defaultDay(),
			[Validators.required],
		],
		time: [
			this.data.match
				? zonedTimeOfDay(new Date(this.data.match.scheduledAt), ESPORT_TIME_ZONE)
				: '18:00',
			[Validators.required],
		],
		competition: [this.data.match?.competition ?? this.competitions.at(-1) ?? ''],
		region: [
			this.data.match
				? this.data.match.region
				: detectEsportRegion(this.competitions.at(-1) ?? ''),
		],
		format: [this.initialFormat()],
		streamUrl: [this.data.match?.streamUrl ?? '', [Validators.pattern(/^https?:\/\/\S+$/)]],
	});

	private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

	/** Heure saisie avant 06:00 : le match a lieu la nuit qui suit la journee. */
	readonly night = computed(() => (this.value().time ?? '') < ESPORT_DAY_START && !!this.value().time);

	readonly nightLabel = computed(() => {
		const raw = this.value();
		return raw.date && raw.time ? `${esportDayLabel(esportCalendarDay(raw.date, raw.time)).toLowerCase()} à ${raw.time}` : '';
	});

	formatLabel(value: string): string {
		const [format, games] = value.split(':');
		return esportFormatLabel(format as EsportMatchFormat, Number(games)) ?? value;
	}

	private initialFormat(): string | null {
		const match = this.data.match;
		if (!match?.bestOf) return null;
		const value = `${match.format}:${match.bestOf}`;
		// Un format hors liste (BO9…) reste propose plutot que d'etre efface.
		if (!this.formats.includes(value)) this.formats.push(value);
		return value;
	}

	/** Aujourd'hui s'il tombe dans la semaine, le lundi sinon. */
	private defaultDay(): string {
		const today = esportDayKey(new Date());
		return today >= this.data.week.weekStart && today <= this.lastDay
			? today
			: this.data.week.weekStart;
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const raw = this.form.getRawValue();
		if (raw.teamAId && raw.teamAId === raw.teamBId) {
			this.error.set('Une équipe ne peut pas jouer contre elle-même.');
			return;
		}

		const [format, games] = raw.format ? raw.format.split(':') : [EsportMatchFormat.BEST_OF, null];
		const request = {
			teamAId: raw.teamAId ?? null,
			teamBId: raw.teamBId ?? null,
			competition: raw.competition?.trim() || null,
			scheduledAt: zonedWallTimeToUtc(
				esportCalendarDay(raw.date!, raw.time!),
				raw.time!,
				ESPORT_TIME_ZONE,
			).toISOString(),
			region: raw.region ?? null,
			format: format as EsportMatchFormat,
			bestOf: games ? Number(games) : null,
			streamUrl: raw.streamUrl?.trim() || null,
		};

		this.saving.set(true);
		this.error.set(null);
		const appel = this.data.match
			? this.api.updateMatch(this.data.match.id, request)
			: this.api.addMatch(this.data.week.id, request);

		appel.subscribe({
			next: (week) => this.dialogRef.close(week),
			error: (err: unknown) => {
				this.saving.set(false);
				this.error.set(readApiError(err));
			},
		});
	}
}
