import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	MAX_MINIGAME_ATTEMPTS,
	MAX_MINIGAME_IMAGES,
	MAX_MINIGAME_IMAGE_BYTES,
	MINIGAME_DEFAULT_COLOR,
	MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE,
	MINIGAME_DEFAULT_POLL_QUESTIONS,
	MINIGAME_EVENT_STATE_LABELS,
	MINIGAME_IMAGE_CONTENT_TYPES,
	MINIGAME_LIMITS,
	MINIGAME_TYPES,
	MINIGAME_TYPE_EMOJIS,
	MINIGAME_TYPE_LABELS,
	MinigameType,
	isGuessMinigame,
	isPollMinigame,
	minigameEventProblem,
	minigameEventState,
	type MinigameConfigDto,
	type MinigameEventDto,
	type MinigameHeroOption,
	type MinigameImageDto,
	type MinigameMapDto,
	type SaveMinigameEventRequest,
} from '@anubis/shared';
import { MinigamesApi } from '../../core/api/minigames.api';
import { readApiError } from '../../core/error.interceptor';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { MinigamePreview, type MinigamePreviewData } from './minigame-preview';
import { MinigameParticipants } from './participants';

export interface EventDialogData {
	day: string;
	today: string;
	/** `null` pour une creation. */
	event: MinigameEventDto | null;
	/** Type pre-rempli : celui de la semaine derniere, sinon la semaine type. */
	defaultType: MinigameType | null;
	/**
	 * Jeu du meme jour la semaine precedente. Une creation en reprend la
	 * presentation — jamais la reponse, ni les reponses du duel, ni les images :
	 * rejouer la map de la semaine derniere n'est jamais ce qu'on veut.
	 */
	template: MinigameEventDto | null;
	config: MinigameConfigDto;
	heroes: MinigameHeroOption[];
	maps: MinigameMapDto[];
	/** Verrouille sans `minigames:manage`, ou termine : lecture seule. */
	readOnly: boolean;
}

const SNOWFLAKE = /^\d{17,20}$/;

const jourAffiche = (key: string) =>
	new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
		new Date(`${key}T00:00:00Z`),
	);

/**
 * Preparation d'un mini-jeu, avec l'apercu de ce que le bot publiera a minuit.
 *
 * Les images ne s'ajoutent qu'a un jeu enregistre (elles lui sont rattachees en
 * base) : a la creation, la boite reste ouverte apres « Enregistrer » pour les
 * deposer ensuite.
 *
 * Le verrou de la veille 23:59 est tenu par l'API ; la boite ne fait que passer
 * en lecture seule pour ne pas laisser remplir un formulaire qui serait refuse.
 */
@Component({
	selector: 'app-minigame-event-dialog',
	imports: [
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTooltipModule,
		MatTabsModule,
		MinigameParticipants,
		MinigamePreview,
		NgTemplateOutlet,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>
			{{ current() ? 'Mini-jeu' : 'Nouveau mini-jeu' }} du {{ dayLabel }}
		</h2>

		<mat-dialog-content>
			@if (current(); as ev) {
				<div class="status">
					<span class="chip" [attr.data-state]="state()">{{ stateLabels[state()!] }}</span>
					@if (ev.publishedAt) {
						<span>{{ ev.participants }} participant{{ ev.participants > 1 ? 's' : '' }}</span>
						@if (isGuess()) {
							<span>· {{ ev.solved }} trouvé{{ ev.solved > 1 ? 's' : '' }}</span>
						}
						@if (ev.heroOnly) {
							<span>· {{ ev.heroOnly }} héros seul{{ ev.heroOnly > 1 ? 's' : '' }}</span>
						}
					}
					@if (ev.messageUrl) {
						<a matButton [href]="ev.messageUrl" target="_blank" rel="noopener">
							<mat-icon>open_in_new</mat-icon>
							Voir sur Discord
						</a>
					}
				</div>
				@if (ev.lastError) {
					<p class="error" role="alert">Discord a refusé : {{ ev.lastError }}</p>
				}
			}

			@if (templateLabel) {
				<p class="notice">
					<mat-icon>content_copy</mat-icon>
					Pré-rempli avec le jeu du {{ templateLabel }}. La réponse et les images restent à choisir.
				</p>
			}

			@if (data.readOnly) {
				<p class="notice">
					<mat-icon>lock</mat-icon>
					{{
						current()?.closedAt
							? 'Ce mini-jeu est terminé.'
							: 'Verrouillé depuis la veille à 23h59 : seul un administrateur peut encore le modifier.'
					}}
				</p>
			}

			@if (showParticipants() && current(); as ev) {
				<mat-tab-group class="tabs" animationDuration="0ms" mat-stretch-tabs="false" mat-align-tabs="start">
					<mat-tab label="Préparation">
						<ng-container *ngTemplateOutlet="editor" />
					</mat-tab>
					<mat-tab [label]="'Participants (' + ev.participants + ')'">
						<ng-template matTabContent>
							<app-minigame-participants
								[eventId]="ev.id"
								[type]="ev.type"
								[maxAttempts]="ev.maxAttempts ?? data.config.maxAttempts"
								[closed]="!!ev.closedAt"
							/>
						</ng-template>
					</mat-tab>
				</mat-tab-group>
			} @else {
				<ng-container *ngTemplateOutlet="editor" />
			}

			<ng-template #editor>
				<div class="layout">
					<form class="form" [formGroup]="form">
						<mat-form-field>
							<mat-label>Type de jeu</mat-label>
							<mat-select formControlName="type">
								@for (type of types; track type) {
									<mat-option [value]="type">{{ emojis[type] }} {{ typeLabels[type] }}</mat-option>
								}
							</mat-select>
							@if (published()) {
								<mat-hint>Ne peut plus changer : le jeu est publié.</mat-hint>
							}
						</mat-form-field>

						<div class="title-row">
							<mat-form-field>
								<mat-label>Titre</mat-label>
								<input matInput formControlName="title" [maxlength]="limits.title" />
							</mat-form-field>
							<label class="swatch" matTooltip="Couleur de la barre de l'embed">
								<input type="color" formControlName="color" aria-label="Couleur de l'embed" />
							</label>
						</div>

						<mat-form-field>
							<mat-label>Message</mat-label>
							<textarea matInput formControlName="description" rows="5" [maxlength]="limits.description"></textarea>
							<mat-hint>Indices, consignes… Le gras (**texte**) et les liens passent comme sur Discord.</mat-hint>
						</mat-form-field>

						@switch (type()) {
							@case ('GUESS_HERO') {
								<mat-form-field>
									<mat-label>Héros à deviner</mat-label>
									<mat-select formControlName="answerHeroKey">
										@for (hero of heroOptions(); track hero.key) {
											<mat-option [value]="hero.key">{{ hero.name }}</mat-option>
										}
									</mat-select>
								</mat-form-field>
							}
							@case ('GUESS_MAP') {
								<mat-form-field>
									<mat-label>Map à deviner</mat-label>
									<mat-select formControlName="answerMapKey">
										@for (map of mapOptions(); track map.key) {
											<mat-option [value]="map.key">{{ map.name }}</mat-option>
										}
									</mat-select>
									<mat-hint>La liste se gère dans « Maps ».</mat-hint>
								</mat-form-field>
							}
							@case ('GUESS_SKIN') {
								<div class="pair">
									<mat-form-field>
										<mat-label>Nom du skin</mat-label>
										<input matInput formControlName="answerSkin" [maxlength]="limits.skin" />
										<mat-hint>Ex. « Rat de cale ». Fautes de frappe tolérées.</mat-hint>
									</mat-form-field>
									<mat-form-field>
										<mat-label>Héros</mat-label>
										<mat-select formControlName="answerHeroKey">
											@for (hero of heroOptions(); track hero.key) {
												<mat-option [value]="hero.key">{{ hero.name }}</mat-option>
											}
										</mat-select>
										<mat-hint>Le héros seul rapporte la moitié.</mat-hint>
									</mat-form-field>
								</div>
							}
							@case ('TRUE_FALSE') {
								<mat-form-field>
									<mat-label>Bonne réponse</mat-label>
									<mat-select formControlName="answerTrue">
										<mat-option value="true">✅ Vrai — c'est un vrai patch-note</mat-option>
										<mat-option value="false">❌ Faux — c'est inventé</mat-option>
									</mat-select>
								</mat-form-field>
							}
						}

						@if (isPoll()) {
							<mat-form-field>
								<mat-label>Question du sondage</mat-label>
								<input
									matInput
									formControlName="pollQuestion"
									[maxlength]="limits.pollQuestion"
									[placeholder]="defaultPollQuestion()"
								/>
								<mat-hint>
									{{ published() ? 'Un sondage Discord ne se modifie plus une fois publié.' : 'Vide : « ' + defaultPollQuestion() + ' »' }}
								</mat-hint>
							</mat-form-field>
						}

						@if (type() === 'DUEL') {
							<mat-form-field>
								<mat-label>Réponses du sondage</mat-label>
								<textarea matInput formControlName="pollAnswersText" rows="3"></textarea>
								<mat-hint>Une par ligne, de 2 à {{ limits.pollAnswersMax }}, {{ limits.pollAnswer }} caractères au plus.</mat-hint>
							</mat-form-field>
						}

						@if (isGuess()) {
							<div class="pair">
								<mat-form-field>
									<mat-label>Essais</mat-label>
									<input matInput type="number" formControlName="maxAttempts" min="1" [max]="maxAttempts" />
									<mat-hint>Vide : {{ data.config.maxAttempts }} (réglage).</mat-hint>
								</mat-form-field>
								<mat-form-field>
									<mat-label>Message une fois les essais épuisés</mat-label>
									<textarea
										matInput
										formControlName="outOfAttemptsMessage"
										rows="2"
										[maxlength]="limits.outOfAttemptsMessage"
										[placeholder]="defaultOutOfAttempts"
									></textarea>
									<mat-hint>Vide : celui du réglage.</mat-hint>
								</mat-form-field>
							</div>
						}

						<div class="ping">
							<mat-slide-toggle formControlName="pingEnabled">Pinger à {{ data.config.pingTime }}</mat-slide-toggle>
							@if (value().pingEnabled ?? form.controls.pingEnabled.value) {
								<mat-form-field>
									<mat-label>Rôle pingé</mat-label>
									<input matInput formControlName="pingRoleId" placeholder="Identifiant du rôle" />
									<mat-hint>Vide : le rôle du réglage.</mat-hint>
									@if (form.controls.pingRoleId.invalid) {
										<mat-error>Identifiant Discord invalide.</mat-error>
									}
								</mat-form-field>
							}
						</div>

						<section class="images">
							<h3>Images ({{ current()?.images?.length ?? 0 }}/{{ maxImages }})</h3>
							@if (!current()) {
								<p class="hint">Enregistre le jeu pour pouvoir y ajouter des images.</p>
							} @else {
								<ul>
									@for (image of current()!.images; track image.id) {
										<li>
											@if (imageUrls()[image.id]; as src) {
												<img [src]="src" [alt]="image.fileName" />
											}
											<span class="name">{{ image.fileName }}</span>
											@if (!data.readOnly) {
												<button
													matIconButton
													type="button"
													matTooltip="Retirer"
													[disabled]="busy()"
													(click)="removeImage(image)"
												>
													<mat-icon>delete</mat-icon>
												</button>
											}
										</li>
									}
								</ul>
								@if (!data.readOnly && current()!.images.length < maxImages) {
									<button matButton type="button" [disabled]="busy()" (click)="fileInput.click()">
										<mat-icon>add_photo_alternate</mat-icon>
										Ajouter des images
									</button>
									<input #fileInput hidden type="file" multiple [accept]="accept" (change)="onFiles($event)" />
									<p class="hint">PNG, JPEG, GIF ou WebP, {{ maxImageMb }} Mo au plus. Son et vidéo se postent à la main.</p>
								}
							}
						</section>
					</form>

					<aside class="preview">
						<h3>Aperçu de la publication</h3>
						<app-minigame-preview [data]="preview()" />
						@if (answerSummary(); as answer) {
							<p class="hint">Réponse attendue : <strong>{{ answer }}</strong></p>
						}
					</aside>
				</div>
			</ng-template>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions>
			@if (current() && !data.readOnly) {
				<button matButton class="delete" [disabled]="busy()" (click)="remove()">Supprimer</button>
			}
			<span class="spacer"></span>
			@if (!data.readOnly && problem(); as reason) {
				<span class="blocking">{{ reason }}</span>
			}
			<button matButton (click)="close()">Fermer</button>
			@if (!data.readOnly) {
				<button matButton="filled" [disabled]="busy() || !!problem()" (click)="save()">Enregistrer</button>
			}
		</mat-dialog-actions>
	`,
	styles: `
		.layout {
			display: grid;
			grid-template-columns: minmax(0, 1fr) minmax(0, 420px);
			gap: var(--space-6);
			align-items: start;
		}

		.form {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			padding-top: 4px;
		}

		.pair {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-4);
		}

		.tabs {
			margin-top: calc(-1 * var(--space-2));
		}

		.tabs .layout {
			padding-top: var(--space-4);
		}

		/* La couleur ne code que la barre de l'embed : une pastille au bout du
		   titre suffit, un champ entier lui donnait autant de place qu'au texte. */
		.title-row {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: var(--space-3);
			align-items: start;
		}

		.swatch {
			display: block;
			margin-top: 6px;
			cursor: pointer;

			input {
				display: block;
				width: 44px;
				height: 44px;
				padding: 3px;
				border: 1px solid var(--mat-sys-outline-variant);
				border-radius: 8px;
				background: none;
				cursor: pointer;
			}

			input:disabled {
				cursor: default;
			}
		}

		.ping {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			gap: var(--space-4);
			align-items: start;

			mat-slide-toggle {
				margin-top: 14px;
			}
		}

		h3 {
			margin: 0 0 var(--space-2);
			font-size: 0.95rem;
			font-weight: 500;
		}

		.preview {
			position: sticky;
			top: 0;
		}

		.images ul {
			list-style: none;
			margin: 0 0 var(--space-2);
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: var(--space-2);
		}

		.images li {
			display: flex;
			align-items: center;
			gap: var(--space-3);
		}

		.images img {
			width: 64px;
			height: 40px;
			object-fit: cover;
			border-radius: 4px;
		}

		.images .name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.hint {
			margin: var(--space-1) 0 0;
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.status {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: var(--space-2);
			margin-bottom: var(--space-3);
			color: var(--mat-sys-on-surface-variant);
		}

		.chip {
			padding: 2px 10px;
			border-radius: 999px;
			font-size: 0.8rem;
			font-weight: 500;
			background: var(--mat-sys-surface-container-high);
			color: var(--mat-sys-on-surface);
		}

		.chip[data-state='LIVE'] {
			background: var(--mat-sys-primary-container);
			color: var(--mat-sys-on-primary-container);
		}

		.chip[data-state='FAILED'],
		.chip[data-state='MISSED'] {
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		.notice {
			display: flex;
			align-items: center;
			gap: var(--space-2);
			margin: 0 0 var(--space-4);
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-surface-container-high);
		}

		.error {
			margin: var(--space-3) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		.spacer {
			flex: 1;
		}

		.blocking {
			max-width: 320px;
			font-size: 0.85rem;
			color: var(--mat-sys-error);
		}

		.delete {
			color: var(--mat-sys-error);
		}

		@media (max-width: 900px) {
			.layout {
				grid-template-columns: 1fr;
			}

			.preview {
				position: static;
			}
		}

		@media (max-width: 640px) {
			.pair,
			.ping {
				grid-template-columns: 1fr;
			}

			.ping mat-slide-toggle {
				margin-top: 0;
			}
		}
	`,
})
export class MinigameEventDialog {
	private readonly api = inject(MinigamesApi);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);
	private readonly dialogRef = inject(MatDialogRef<MinigameEventDialog, boolean>);
	readonly data = inject<EventDialogData>(MAT_DIALOG_DATA);

	readonly types = MINIGAME_TYPES;
	readonly typeLabels: Record<string, string> = MINIGAME_TYPE_LABELS;
	readonly emojis: Record<string, string> = MINIGAME_TYPE_EMOJIS;
	readonly stateLabels = MINIGAME_EVENT_STATE_LABELS;
	readonly limits = MINIGAME_LIMITS;
	readonly maxAttempts = MAX_MINIGAME_ATTEMPTS;
	readonly maxImages = MAX_MINIGAME_IMAGES;
	readonly maxImageMb = Math.floor(MAX_MINIGAME_IMAGE_BYTES / 1024 / 1024);
	readonly accept = MINIGAME_IMAGE_CONTENT_TYPES.join(',');
	readonly defaultOutOfAttempts = this.data.config.outOfAttemptsMessage ?? MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE;
	readonly dayLabel = jourAffiche(this.data.day);

	readonly current = signal<MinigameEventDto | null>(this.data.event);
	readonly busy = signal(false);
	readonly error = signal<string | null>(null);
	/** Une ecriture a eu lieu : la page doit relire son calendrier en fermant. */
	private changed = false;

	readonly published = computed(() => !!this.current()?.publishedAt);
	readonly state = computed(() => {
		const ev = this.current();
		return ev ? minigameEventState(ev, this.data.today) : null;
	});

	private readonly event = this.data.event;
	/** Ce qui remplit le formulaire hors reponses : le jeu lui-meme, ou celui de la semaine derniere. */
	private readonly base = this.event ?? this.data.template;
	readonly templateLabel = !this.event && this.data.template ? jourAffiche(this.data.template.day) : null;
	readonly form = inject(FormBuilder).nonNullable.group({
		type: [this.base?.type ?? this.data.defaultType ?? MinigameType.CLIP],
		title: [
			this.base?.title ?? MINIGAME_TYPE_LABELS[this.data.defaultType ?? MinigameType.CLIP],
			[Validators.required, Validators.maxLength(MINIGAME_LIMITS.title)],
		],
		description: [this.base?.description ?? ''],
		color: [`#${(this.base?.color ?? MINIGAME_DEFAULT_COLOR).toString(16).padStart(6, '0')}`],
		pingEnabled: [this.base?.pingEnabled ?? true],
		pingRoleId: [this.base?.pingRoleId ?? '', [Validators.pattern(SNOWFLAKE)]],
		maxAttempts: [this.base?.maxAttempts?.toString() ?? ''],
		outOfAttemptsMessage: [this.base?.outOfAttemptsMessage ?? ''],
		answerHeroKey: [this.event?.answerHeroKey ?? ''],
		answerMapKey: [this.event?.answerMapKey ?? ''],
		answerSkin: [this.event?.answerSkin ?? ''],
		answerTrue: [this.event?.answerTrue === null || this.event?.answerTrue === undefined ? '' : String(this.event.answerTrue)],
		pollQuestion: [this.base?.pollQuestion ?? ''],
		pollAnswersText: [(this.event?.pollAnswers ?? []).join('\n')],
	});

	/**
	 * Le formulaire vit hors du graphe de signaux : `toSignal(valueChanges)` est
	 * ce qui redessine l'apercu en `OnPush`, comme la page Messages.
	 */
	readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
	/**
	 * Lu sur la valeur **brute** : une fois le jeu publie, le controle du type
	 * est desactive et disparait de `valueChanges`. Lu la, le type retombait sur
	 * « clip » et la boite masquait la reponse a deviner — impossible de corriger
	 * la map ou le heros d'un jeu deja en ligne.
	 */
	readonly type = computed(() => {
		this.value();
		return this.form.controls.type.getRawValue() as MinigameType;
	});
	/** Onglet des participants : seuls les jeux a deviner et le vrai ou faux en ont. */
	readonly showParticipants = computed(() => {
		const ev = this.current();
		return !!ev?.publishedAt && (isGuessMinigame(ev.type) || ev.type === MinigameType.TRUE_FALSE);
	});
	readonly isGuess = computed(() => isGuessMinigame(this.type()));
	readonly isPoll = computed(() => isPollMinigame(this.type()));
	readonly defaultPollQuestion = computed(() =>
		this.type() === MinigameType.DUEL ? MINIGAME_DEFAULT_POLL_QUESTIONS.DUEL : MINIGAME_DEFAULT_POLL_QUESTIONS.TRUE_FALSE,
	);

	/** Les desactives ne se proposent plus, sauf celui deja choisi. */
	readonly heroOptions = computed(() =>
		this.data.heroes.filter((h) => h.enabled || h.key === this.event?.answerHeroKey),
	);
	readonly mapOptions = computed(() => this.data.maps.filter((m) => m.enabled || m.key === this.event?.answerMapKey));

	readonly imageUrls = signal<Record<string, string>>({});

	readonly request = computed<SaveMinigameEventRequest>(() => {
		const v = this.form.getRawValue();
		// Lu pour l'abonnement : `getRawValue` inclut les champs desactives.
		this.value();
		const attempts = Number.parseInt(v.maxAttempts, 10);
		return {
			day: this.data.day,
			type: v.type,
			title: v.title.trim(),
			description: v.description.trim() || null,
			color: Number.parseInt(v.color.slice(1), 16) || 0,
			pingEnabled: v.pingEnabled,
			pingRoleId: v.pingRoleId.trim() || null,
			maxAttempts: Number.isFinite(attempts) ? attempts : null,
			outOfAttemptsMessage: v.outOfAttemptsMessage.trim() || null,
			answerHeroKey: v.answerHeroKey || null,
			answerMapKey: v.answerMapKey || null,
			answerSkin: v.answerSkin.trim() || null,
			answerTrue: v.answerTrue === '' ? null : v.answerTrue === 'true',
			pollQuestion: v.pollQuestion.trim() || null,
			pollAnswers: v.pollAnswersText
				.split('\n')
				.map((line) => line.trim())
				.filter(Boolean),
		};
	});

	/** Raison du blocage, redite au-dessus du bouton : un `mat-error` peut etre hors de l'ecran. */
	readonly problem = computed(() => {
		const r = this.request();
		if (this.form.controls.pingRoleId.invalid) return "L'identifiant du rôle pingé est invalide.";
		if (r.maxAttempts !== null && (r.maxAttempts! < 1 || r.maxAttempts! > MAX_MINIGAME_ATTEMPTS)) {
			return `Le nombre d'essais doit être entre 1 et ${MAX_MINIGAME_ATTEMPTS}.`;
		}
		return minigameEventProblem(r);
	});

	readonly preview = computed<MinigamePreviewData>(() => {
		const r = this.request();
		const urls = this.imageUrls();
		return {
			type: r.type,
			title: r.title,
			description: r.description ?? '',
			color: r.color ?? MINIGAME_DEFAULT_COLOR,
			maxAttempts: r.maxAttempts ?? this.data.config.maxAttempts,
			playChannelLabel: this.data.config.playChannelId ? '#salon-de-jeu' : null,
			pollQuestion: r.pollQuestion ?? '',
			pollAnswers: r.pollAnswers ?? [],
			images: (this.current()?.images ?? []).map((image) => urls[image.id]).filter((url): url is string => !!url),
		};
	});

	readonly answerSummary = computed(() => {
		const r = this.request();
		const hero = this.data.heroes.find((h) => h.key === r.answerHeroKey)?.name;
		const map = this.data.maps.find((m) => m.key === r.answerMapKey)?.name;
		switch (r.type) {
			case MinigameType.GUESS_HERO:
				return hero ?? null;
			case MinigameType.GUESS_MAP:
				return map ?? null;
			case MinigameType.GUESS_SKIN:
				return r.answerSkin ? `${r.answerSkin}${hero ? ` - ${hero}` : ''}` : null;
			case MinigameType.TRUE_FALSE:
				return r.answerTrue === null || r.answerTrue === undefined ? null : r.answerTrue ? 'Vrai' : 'Faux';
			default:
				return null;
		}
	});

	constructor() {
		if (this.data.readOnly) {
			this.form.disable();
		} else if (this.event?.publishedAt) {
			// Ce qui est deja sur Discord et ne se corrige pas.
			this.form.controls.type.disable();
			if (isPollMinigame(this.event.type)) {
				this.form.controls.pollQuestion.disable();
				this.form.controls.pollAnswersText.disable();
			}
		}

		// A la creation, un titre auquel personne n'a touche suit le type choisi.
		let titreAuto = this.event ? null : this.form.controls.title.value;
		this.form.controls.type.valueChanges.subscribe((type) => {
			if (titreAuto === null || this.form.controls.title.value !== titreAuto) return;
			titreAuto = MINIGAME_TYPE_LABELS[type];
			this.form.controls.title.setValue(titreAuto);
		});

		// Les images sont derriere le JWT : chargees en blob, liberees a la fermeture.
		const urls = new Map<string, string>();
		effect(() => {
			const images = this.current()?.images ?? [];
			for (const image of images) {
				if (urls.has(image.id)) continue;
				urls.set(image.id, '');
				this.api.downloadImage(this.current()!.id, image.id).subscribe({
					next: (blob) => {
						const url = URL.createObjectURL(blob);
						urls.set(image.id, url);
						this.imageUrls.update((all) => ({ ...all, [image.id]: url }));
					},
				});
			}
		});
		inject(DestroyRef).onDestroy(() => {
			for (const url of urls.values()) if (url) URL.revokeObjectURL(url);
		});

		this.dialogRef.disableClose = true;
		this.dialogRef.backdropClick().subscribe(() => this.close());
		this.dialogRef.keydownEvents().subscribe((event) => {
			if (event.key === 'Escape') this.close();
		});
	}

	close(): void {
		this.dialogRef.close(this.changed);
	}

	save(): void {
		if (this.problem()) return;
		this.busy.set(true);
		this.error.set(null);

		const request = this.request();
		const current = this.current();
		const call = current
			? this.api.updateEvent(current.id, this.patchFor(request))
			: this.api.createEvent(request);

		call.subscribe({
			next: (saved) => {
				this.busy.set(false);
				this.changed = true;
				this.current.set(saved);
				this.form.markAsPristine();
				this.notifications.success(
					current
						? saved.publishedAt
							? 'Corrigé — le message sera mis à jour sur Discord dans quelques secondes.'
							: 'Mini-jeu enregistré.'
						: 'Mini-jeu enregistré : tu peux maintenant y ajouter des images.',
				);
			},
			error: (err) => {
				this.busy.set(false);
				this.error.set(readApiError(err));
			},
		});
	}

	/**
	 * Champs envoyes en modification. Apres publication, le type et le sondage
	 * ne partent pas : l'API refuserait la requete entiere pour un champ que le
	 * formulaire montre grise.
	 */
	private patchFor(request: SaveMinigameEventRequest): Partial<SaveMinigameEventRequest> {
		const patch: Partial<SaveMinigameEventRequest> = { ...request };
		delete patch.day;
		if (this.current()?.publishedAt) {
			delete patch.type;
			delete patch.pollQuestion;
			delete patch.pollAnswers;
		}
		return patch;
	}

	remove(): void {
		const current = this.current();
		if (!current) return;
		const data: ConfirmDialogData = {
			title: 'Supprimer le mini-jeu',
			message: current.publishedAt
				? 'Le jeu disparaîtra du calendrier. Ce qui est déjà publié sur Discord y reste : retire-le à la main si besoin.'
				: `Le jeu du ${this.dayLabel} disparaîtra du calendrier.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};
		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;
				this.busy.set(true);
				this.api.removeEvent(current.id).subscribe({
					next: () => {
						this.notifications.success('Mini-jeu supprimé.');
						this.dialogRef.close(true);
					},
					error: (err) => {
						this.busy.set(false);
						this.error.set(readApiError(err));
					},
				});
			});
	}

	onFiles(event: Event): void {
		const input = event.target as HTMLInputElement;
		const current = this.current();
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!current || !files.length) return;

		const place = MAX_MINIGAME_IMAGES - current.images.length;
		const trop = files.find((file) => file.size > MAX_MINIGAME_IMAGE_BYTES);
		if (trop) {
			this.error.set(`« ${trop.name} » dépasse ${this.maxImageMb} Mo.`);
			return;
		}
		if (files.length > place) {
			this.error.set(`Il ne reste de la place que pour ${place} image${place > 1 ? 's' : ''}.`);
			return;
		}

		this.error.set(null);
		this.busy.set(true);
		// Une a une : la position de chaque image se lit sur les precedentes.
		const envoyer = (index: number) => {
			if (index >= files.length) {
				this.busy.set(false);
				return;
			}
			this.api.addImage(current.id, files[index]!).subscribe({
				next: (saved) => {
					this.changed = true;
					this.current.set(saved);
					envoyer(index + 1);
				},
				error: (err) => {
					this.busy.set(false);
					this.error.set(readApiError(err));
				},
			});
		};
		envoyer(0);
	}

	removeImage(image: MinigameImageDto): void {
		const current = this.current();
		if (!current) return;
		this.busy.set(true);
		this.api.removeImage(current.id, image.id).subscribe({
			next: (saved) => {
				this.busy.set(false);
				this.changed = true;
				this.current.set(saved);
			},
			error: (err) => {
				this.busy.set(false);
				this.error.set(readApiError(err));
			},
		});
	}
}
