import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
	FormBuilder,
	ReactiveFormsModule,
	Validators,
	type AbstractControl,
	type ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	DEFAULT_GIVEAWAY_EMOJI,
	GIVEAWAY_STATUS_LABELS,
	GiveawayStatus,
	MAX_GIVEAWAY_DURATION_MINUTES,
	MAX_GIVEAWAY_WINNERS,
	MIN_GIVEAWAY_DURATION_MINUTES,
	Permission,
	isValidGiveawayEmoji,
	type GiveawayDto,
} from '@anubis/shared';
import { GiveawayApi } from '../../core/api/giveaway.api';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../shared/pipes/format.pipes';

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * La regle vit dans `@anubis/shared` : le formulaire refuse exactement ce que
 * l'API refuse, sans que les deux aient a la reecrire chacun de leur cote.
 */
function emojiValidator(control: AbstractControl): ValidationErrors | null {
	return isValidGiveawayEmoji(String(control.value ?? '')) ? null : { emoji: true };
}

/**
 * Concours du serveur.
 *
 * La page ecrit en base et rien d'autre : la publication de l'embed, la pose de
 * la reaction et le tirage appartiennent au bot. C'est pourquoi un concours
 * cree ici apparait d'abord « Programmé » — l'etat devient « En cours » quand le
 * bot l'a effectivement publie sur Discord, quelques secondes plus tard.
 */
@Component({
	selector: 'app-giveaway',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatChipsModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSelectModule,
		MatTooltipModule,
		ReactiveFormsModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './giveaway.html',
	styleUrl: './giveaway.scss',
})
export class GiveawayPage {
	private readonly giveawayApi = inject(GiveawayApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);

	readonly Permission = Permission;
	readonly Status = GiveawayStatus;
	// Index en `string` : les libelles sont lus depuis le template avec une
	// valeur que TypeScript n'y voit que comme une chaine.
	readonly statusLabels: Record<string, string> = GIVEAWAY_STATUS_LABELS;
	readonly statuses = Object.values(GiveawayStatus);
	readonly maxWinners = MAX_GIVEAWAY_WINNERS;
	readonly defaultEmoji = DEFAULT_GIVEAWAY_EMOJI;

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly giveaways = signal<GiveawayDto[]>([]);
	readonly statusFilter = signal<GiveawayStatus | null>(null);
	readonly editingId = signal<string | null>(null);

	readonly editing = computed(() =>
		this.giveaways().find((giveaway) => giveaway.id === this.editingId()) ?? null,
	);

	readonly form = this.formBuilder.nonNullable.group({
		channelId: ['', [Validators.required, Validators.pattern(SNOWFLAKE)]],
		title: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(160)]],
		description: ['', [Validators.maxLength(2000)]],
		prize: ['', [Validators.required, Validators.maxLength(200)]],
		imageUrl: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
		reactionEmoji: [DEFAULT_GIVEAWAY_EMOJI, [Validators.required, emojiValidator]],
		winnerCount: [1, [Validators.required, Validators.min(1), Validators.max(MAX_GIVEAWAY_WINNERS)]],
		announceChannelId: ['', [Validators.pattern(SNOWFLAKE)]],
		durationMinutes: [
			60,
			[
				Validators.required,
				Validators.min(MIN_GIVEAWAY_DURATION_MINUTES),
				Validators.max(MAX_GIVEAWAY_DURATION_MINUTES),
			],
		],
	});

	constructor() {
		this.load();
	}

	filterBy(status: GiveawayStatus | null): void {
		this.statusFilter.set(status);
		this.load();
	}

	/** Un concours en cours ou programmé se modifie ; un concours clos, jamais. */
	canEdit(giveaway: GiveawayDto): boolean {
		return (
			giveaway.status === GiveawayStatus.SCHEDULED || giveaway.status === GiveawayStatus.RUNNING
		);
	}

	edit(giveaway: GiveawayDto): void {
		this.editingId.set(giveaway.id);

		// La duree est ressaisie en minutes restantes plutot qu'en date de fin :
		// c'est ce que l'API attend, et « encore 30 minutes » se decide plus
		// facilement qu'une heure de fin absolue.
		const remaining = Math.max(
			MIN_GIVEAWAY_DURATION_MINUTES,
			Math.round((new Date(giveaway.endsAt).getTime() - Date.now()) / 60_000),
		);

		this.form.setValue({
			channelId: giveaway.channelId,
			title: giveaway.title,
			description: giveaway.description ?? '',
			prize: giveaway.prize,
			imageUrl: giveaway.imageUrl ?? '',
			reactionEmoji: giveaway.reactionEmoji,
			winnerCount: giveaway.winnerCount,
			announceChannelId: giveaway.announceChannelId ?? '',
			durationMinutes: remaining,
		});

		// Le salon de publication ne se change plus une fois l'embed poste : le
		// deplacer supposerait de supprimer le message et d'en republier un autre,
		// en perdant toutes les participations deja enregistrees.
		if (giveaway.status === GiveawayStatus.RUNNING) this.form.controls.channelId.disable();
		else this.form.controls.channelId.enable();
	}

	cancelEdit(): void {
		this.editingId.set(null);
		this.form.controls.channelId.enable();
		this.form.reset({
			channelId: '',
			title: '',
			description: '',
			prize: '',
			imageUrl: '',
			reactionEmoji: DEFAULT_GIVEAWAY_EMOJI,
			winnerCount: 1,
			announceChannelId: '',
			durationMinutes: 60,
		});
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		this.saving.set(true);
		const raw = this.form.getRawValue();
		const id = this.editingId();

		// Les champs facultatifs laisses vides partent a `null` et non en chaine
		// vide : `""` passerait la validation d'URL et Discord afficherait un
		// emplacement d'image cassé.
		const payload = {
			title: raw.title,
			description: raw.description || null,
			prize: raw.prize,
			imageUrl: raw.imageUrl || null,
			reactionEmoji: raw.reactionEmoji,
			winnerCount: raw.winnerCount,
			announceChannelId: raw.announceChannelId || null,
			durationMinutes: raw.durationMinutes,
		};

		const request$ = id
			? this.giveawayApi.update(id, payload)
			: this.giveawayApi.create({ ...payload, channelId: raw.channelId });

		request$.subscribe({
			next: () => {
				this.saving.set(false);
				this.notifications.success(
					id
						? 'Concours mis à jour — le bot corrigera l’embed dans quelques secondes.'
						: 'Concours enregistré — le bot le publiera dans quelques secondes.',
				);
				this.cancelEdit();
				this.load();
			},
			error: () => this.saving.set(false),
		});
	}

	cancel(giveaway: GiveawayDto): void {
		const data: ConfirmDialogData = {
			title: 'Annuler le concours',
			message: `« ${giveaway.title} » sera clos sans tirage, et son message barré sur Discord. ${giveaway.entryCount} participation(s) seront perdues.`,
			confirmLabel: 'Annuler le concours',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.giveawayApi.cancel(giveaway.id).subscribe({
					next: () => {
						this.notifications.success('Concours annulé.');
						if (this.editingId() === giveaway.id) this.cancelEdit();
						this.load();
					},
				});
			});
	}

	reroll(giveaway: GiveawayDto): void {
		const data: ConfirmDialogData = {
			title: 'Tirer à nouveau',
			message: `Un nouveau gagnant sera tiré parmi les ${giveaway.entryCount} participant(s), et annoncé sur Discord. Le tirage précédent est effacé.`,
			confirmLabel: 'Tirer à nouveau',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.giveawayApi.reroll(giveaway.id).subscribe({
					next: () => {
						this.notifications.success('Nouveau tirage demandé.');
						this.load();
					},
				});
			});
	}

	private load(): void {
		this.loading.set(true);

		this.giveawayApi
			.list({ page: 1, pageSize: 50, status: this.statusFilter() ?? undefined })
			.subscribe({
				next: (page) => {
					this.giveaways.set(page.items);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
