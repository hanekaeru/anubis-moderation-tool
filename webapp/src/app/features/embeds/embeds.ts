import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	DEFAULT_EMBED_COLOR,
	EMBED_LIMITS,
	EMBED_MESSAGE_STATUS_LABELS,
	EMBED_TOTAL_LIMIT,
	EmbedMessageStatus,
	Permission,
	embedCharacterCount,
	hasEmbedContent,
	type EmbedFieldDto,
	type EmbedMessageDto,
} from '@anubis/shared';
import { EmbedsApi } from '../../core/api/embeds.api';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { FrDatePipe, RelativeTimePipe } from '../../shared/pipes/format.pipes';

const SNOWFLAKE = /^\d{17,20}$/;

/** Le formulaire manipule une couleur en `#rrggbb` ; Discord attend un entier. */
function hexToInt(hex: string): number {
	return Number.parseInt(hex.replace('#', ''), 16) || 0;
}

function intToHex(value: number): string {
	return `#${value.toString(16).padStart(6, '0')}`;
}

/**
 * Composition et envoi de messages.
 *
 * La page ecrit en base et rien d'autre : la publication appartient au bot,
 * comme pour les concours et les sanctions posees depuis la webapp. C'est
 * pourquoi un message envoye ici passe d'abord par « En attente d'envoi » — il
 * devient « Envoyé » quand le bot l'a effectivement publié, quelques secondes
 * plus tard.
 *
 * L'apercu est **fidele mais pas garanti** : il reproduit le rendu de Discord,
 * qui reste seul juge. Ce qu'il garantit, en revanche, c'est le decompte de
 * caracteres — la limite de 6000 porte sur la somme de tous les champs, et
 * c'est celle qu'on depasse sans s'en rendre compte.
 */
@Component({
	selector: 'app-embeds',
	imports: [
		FrDatePipe,
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatCheckboxModule,
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
	templateUrl: './embeds.html',
	styleUrl: './embeds.scss',
})
export class EmbedsPage {
	private readonly embedsApi = inject(EmbedsApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);

	readonly Permission = Permission;
	readonly Status = EmbedMessageStatus;
	readonly statusLabels: Record<string, string> = EMBED_MESSAGE_STATUS_LABELS;
	readonly statuses = Object.values(EmbedMessageStatus);
	readonly limits = EMBED_LIMITS;
	readonly totalLimit = EMBED_TOTAL_LIMIT;

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly messages = signal<EmbedMessageDto[]>([]);
	readonly statusFilter = signal<EmbedMessageStatus | null>(null);
	readonly editingId = signal<string | null>(null);

	readonly form = this.formBuilder.nonNullable.group({
		channelId: ['', [Validators.required, Validators.pattern(SNOWFLAKE)]],
		name: ['', [Validators.required, Validators.maxLength(EMBED_LIMITS.name)]],
		content: ['', [Validators.maxLength(EMBED_LIMITS.content)]],
		title: ['', [Validators.maxLength(EMBED_LIMITS.title)]],
		description: ['', [Validators.maxLength(EMBED_LIMITS.description)]],
		color: [intToHex(DEFAULT_EMBED_COLOR), [Validators.required]],
		url: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
		authorName: ['', [Validators.maxLength(EMBED_LIMITS.authorName)]],
		authorIconUrl: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
		thumbnailUrl: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
		imageUrl: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
		footerText: ['', [Validators.maxLength(EMBED_LIMITS.footerText)]],
		footerIconUrl: ['', [Validators.pattern(/^https?:\/\/\S+$/)]],
		showTimestamp: [false],
		fields: this.formBuilder.array<
			ReturnType<EmbedsPage['createFieldGroup']>
		>([]),
	});

	/**
	 * Etat du formulaire en signal.
	 *
	 * `valueChanges` vit hors du graphe de signaux : sans cette passerelle,
	 * l'apercu ne se redessinerait jamais en `OnPush`.
	 */
	private readonly formValue = toSignal(this.form.valueChanges, {
		initialValue: this.form.getRawValue(),
	});

	readonly preview = computed(() => {
		// Lu pour la dependance : la valeur utile est celle du formulaire brut,
		// qui inclut les controles desactives.
		this.formValue();
		const raw = this.form.getRawValue();

		return {
			content: raw.content,
			title: raw.title,
			description: raw.description,
			color: raw.color,
			url: raw.url,
			authorName: raw.authorName,
			authorIconUrl: raw.authorIconUrl,
			thumbnailUrl: raw.thumbnailUrl,
			imageUrl: raw.imageUrl,
			footerText: raw.footerText,
			footerIconUrl: raw.footerIconUrl,
			showTimestamp: raw.showTimestamp,
			fields: (raw.fields ?? []) as EmbedFieldDto[],
		};
	});

	readonly characterCount = computed(() => embedCharacterCount(this.preview()));

	readonly overLimit = computed(() => this.characterCount() > EMBED_TOTAL_LIMIT);

	/** Un embed sans contenu visible et sans texte hors embed n'a rien a montrer. */
	readonly isEmpty = computed(() => {
		const preview = this.preview();
		return !hasEmbedContent(preview) && !preview.content;
	});

	readonly editing = computed(
		() => this.messages().find((message) => message.id === this.editingId()) ?? null,
	);

	get fields(): FormArray {
		return this.form.controls.fields as unknown as FormArray;
	}

	constructor() {
		this.load();
	}

	private createFieldGroup(field?: EmbedFieldDto) {
		return this.formBuilder.nonNullable.group({
			name: [
				field?.name ?? '',
				[Validators.required, Validators.maxLength(EMBED_LIMITS.fieldName)],
			],
			value: [
				field?.value ?? '',
				[Validators.required, Validators.maxLength(EMBED_LIMITS.fieldValue)],
			],
			inline: [field?.inline ?? false],
		});
	}

	addField(): void {
		if (this.fields.length >= EMBED_LIMITS.fields) {
			this.notifications.info(
				`Discord n'accepte pas plus de ${EMBED_LIMITS.fields} champs.`,
			);
			return;
		}
		this.fields.push(this.createFieldGroup());
	}

	removeField(index: number): void {
		this.fields.removeAt(index);
	}

	filterBy(status: EmbedMessageStatus | null): void {
		this.statusFilter.set(status);
		this.load();
	}

	edit(message: EmbedMessageDto): void {
		this.editingId.set(message.id);

		this.fields.clear();
		for (const field of message.fields) this.fields.push(this.createFieldGroup(field));

		this.form.patchValue({
			channelId: message.channelId,
			name: message.name,
			content: message.content ?? '',
			title: message.title ?? '',
			description: message.description ?? '',
			color: intToHex(message.color),
			url: message.url ?? '',
			authorName: message.authorName ?? '',
			authorIconUrl: message.authorIconUrl ?? '',
			thumbnailUrl: message.thumbnailUrl ?? '',
			imageUrl: message.imageUrl ?? '',
			footerText: message.footerText ?? '',
			footerIconUrl: message.footerIconUrl ?? '',
			showTimestamp: message.showTimestamp,
		});

		// Le salon ne se change plus une fois le message publie : le deplacer
		// supposerait de supprimer l'original et d'en poster un autre ailleurs,
		// en perdant réactions et épinglages.
		if (message.messageId) this.form.controls.channelId.disable();
		else this.form.controls.channelId.enable();
	}

	cancelEdit(): void {
		this.editingId.set(null);
		this.form.controls.channelId.enable();
		this.fields.clear();
		this.form.reset({
			channelId: '',
			name: '',
			content: '',
			title: '',
			description: '',
			color: intToHex(DEFAULT_EMBED_COLOR),
			url: '',
			authorName: '',
			authorIconUrl: '',
			thumbnailUrl: '',
			imageUrl: '',
			footerText: '',
			footerIconUrl: '',
			showTimestamp: false,
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
		// vide : `""` passerait la validation d'URL cote API et Discord
		// afficherait un emplacement d'image cassé.
		const payload = {
			name: raw.name,
			content: raw.content || null,
			title: raw.title || null,
			description: raw.description || null,
			color: hexToInt(raw.color),
			url: raw.url || null,
			authorName: raw.authorName || null,
			authorIconUrl: raw.authorIconUrl || null,
			thumbnailUrl: raw.thumbnailUrl || null,
			imageUrl: raw.imageUrl || null,
			footerText: raw.footerText || null,
			footerIconUrl: raw.footerIconUrl || null,
			showTimestamp: raw.showTimestamp,
			fields: (raw.fields ?? []) as EmbedFieldDto[],
		};

		const request$ = id
			? this.embedsApi.update(id, payload)
			: this.embedsApi.create({ ...payload, channelId: raw.channelId });

		request$.subscribe({
			next: () => {
				this.saving.set(false);
				this.notifications.success(
					id ? 'Message mis à jour.' : 'Brouillon enregistré.',
				);
				this.cancelEdit();
				this.load();
			},
			error: () => this.saving.set(false),
		});
	}

	send(message: EmbedMessageDto): void {
		const alreadySent = message.messageId !== null;

		const data: ConfirmDialogData = {
			title: alreadySent ? 'Republier le message' : 'Envoyer le message',
			message: alreadySent
				? `Le message déjà publié sera corrigé sur Discord. S'il a été supprimé, il sera publié à nouveau.`
				: `« ${message.name} » sera publié dans le salon ${message.channelId}, signé du bot. Ce que lit le serveur ne se reprend pas.`,
			confirmLabel: alreadySent ? 'Republier' : 'Envoyer',
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.embedsApi.send(message.id).subscribe({
					next: () => {
						this.notifications.success(
							'Message mis en file — le bot le publiera dans quelques secondes.',
						);
						this.load();
					},
				});
			});
	}

	remove(message: EmbedMessageDto): void {
		const data: ConfirmDialogData = {
			title: 'Supprimer le message',
			message: message.messageId
				? `« ${message.name} » disparaît de cette liste. Le message publié sur Discord, lui, reste en place : retirez-le depuis Discord si besoin.`
				: `« ${message.name} » sera définitivement supprimé.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.embedsApi.remove(message.id).subscribe({
					next: () => {
						this.notifications.success('Message supprimé.');
						if (this.editingId() === message.id) this.cancelEdit();
						this.load();
					},
				});
			});
	}

	private load(): void {
		this.loading.set(true);

		this.embedsApi
			.list({ page: 1, pageSize: 50, status: this.statusFilter() ?? undefined })
			.subscribe({
				next: (page) => {
					this.messages.set(page.items);
					this.loading.set(false);
				},
				error: () => this.loading.set(false),
			});
	}
}
