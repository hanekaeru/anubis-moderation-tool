import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
	FormBuilder,
	ReactiveFormsModule,
	Validators,
	type AbstractControl,
	type ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { RouterLink } from '@angular/router';
import {
	DEFAULT_WELCOME_MESSAGES,
	MAX_WELCOME_MESSAGE_LENGTH,
	Permission,
	SNOWFLAKE_PATTERN,
	WELCOME_PLACEHOLDERS,
	WelcomeEvent,
	renderWelcomeMessage,
	type UpdateWelcomeConfigRequest,
	type WelcomeConfigDto,
} from '@anubis/shared';
import { WelcomeApi } from '../../core/api/welcome.api';
import { AuthService } from '../../core/auth/auth.service';
import { NotificationService } from '../../core/notification.service';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';

/** Membre et serveur fictifs de l'apercu. */
const EXEMPLE = {
	userId: '312043100628254721',
	displayName: 'Sylune',
	guildName: 'Anubis',
	memberCount: 1204,
	boostCount: 7,
};

/**
 * Pose l'erreur sur le champ du salon, pas sur le groupe : un `mat-error` ne
 * s'affiche que si son propre controle est en erreur. Seule la cle `salon` est
 * touchee, pour ne pas effacer un `pattern` pose par le champ lui-meme.
 */
function salonRequis(group: AbstractControl): ValidationErrors | null {
	const channel = group.get('channelId')!;
	const besoin = !!group.get('joinEnabled')!.value || !!group.get('leaveEnabled')!.value;
	const boostSansSalon =
		!!group.get('boostEnabled')!.value &&
		!String(group.get('boostChannelId')!.value).trim() &&
		!String(channel.value).trim();

	const manque = (besoin && !String(channel.value).trim()) || boostSansSalon;
	const { salon: _, ...autres } = channel.errors ?? {};

	if (manque) {
		channel.setErrors({ ...autres, salon: true });
		return { salon: true };
	}
	channel.setErrors(Object.keys(autres).length ? autres : null);
	return null;
}

/**
 * Messages automatiques d'arrivee, de depart et de boost.
 *
 * L'apercu passe par `renderWelcomeMessage`, la fonction du bot : un apercu
 * rendu a part finirait par mentir. Les mentions y sont affichees comme dans
 * Discord (« @Sylune ») plutot qu'en syntaxe brute.
 */
@Component({
	selector: 'app-welcome',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatSlideToggleModule,
		ReactiveFormsModule,
		RouterLink,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './welcome.html',
	styleUrl: './welcome.scss',
})
export class WelcomePage {
	private readonly api = inject(WelcomeApi);
	private readonly auth = inject(AuthService);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly Event = WelcomeEvent;
	readonly defaults = DEFAULT_WELCOME_MESSAGES;
	readonly placeholders = WELCOME_PLACEHOLDERS;
	readonly maxLength = MAX_WELCOME_MESSAGE_LENGTH;

	/** Une carte par message, dans l'ordre de la vie d'un membre. */
	readonly sections = [
		{
			event: WelcomeEvent.JOIN,
			title: 'Arrivée',
			subtitle: 'Envoyé quand un membre rejoint le serveur. Suspendu pendant un confinement anti-raid.',
			toggle: 'joinEnabled',
			message: 'joinMessage',
		},
		{
			event: WelcomeEvent.LEAVE,
			title: 'Départ',
			subtitle:
				'Envoyé quand un membre quitte le serveur, y compris par expulsion ou bannissement. Personne n’est mentionné.',
			toggle: 'leaveEnabled',
			message: 'leaveMessage',
		},
		{
			event: WelcomeEvent.BOOST,
			title: 'Boost',
			subtitle:
				'Envoyé au premier boost d’un membre. Le rôle de boost de Discord n’ouvre rien : l’annonce prévient l’équipe qu’elle a un rôle bonus à donner.',
			toggle: 'boostEnabled',
			message: 'boostMessage',
		},
	] as const;

	readonly loading = signal(true);
	readonly saving = signal(false);
	readonly alertRoleId = signal<string | null>(null);

	readonly form = this.formBuilder.nonNullable.group(
		{
			channelId: ['', [Validators.pattern(SNOWFLAKE_PATTERN)]],
			joinEnabled: [false],
			joinMessage: ['', [Validators.maxLength(MAX_WELCOME_MESSAGE_LENGTH)]],
			leaveEnabled: [false],
			leaveMessage: ['', [Validators.maxLength(MAX_WELCOME_MESSAGE_LENGTH)]],
			boostEnabled: [false],
			boostChannelId: ['', [Validators.pattern(SNOWFLAKE_PATTERN)]],
			boostMessage: ['', [Validators.maxLength(MAX_WELCOME_MESSAGE_LENGTH)]],
		},
		{ validators: salonRequis },
	);

	/** `valueChanges` vit hors des signaux : sans lui, l'apercu resterait fige. */
	private readonly value = toSignal(this.form.valueChanges, {
		initialValue: this.form.getRawValue(),
	});

	readonly previews = computed(() => {
		this.value();
		const raw = this.form.getRawValue();
		const contexte = { ...EXEMPLE, alertRoleId: this.alertRoleId() };
		const rendre = (gabarit: string, defaut: string) =>
			afficherMentions(renderWelcomeMessage(gabarit.trim() || defaut, contexte));

		return {
			JOIN: rendre(raw.joinMessage, this.defaults.JOIN),
			LEAVE: rendre(raw.leaveMessage, this.defaults.LEAVE),
			BOOST: rendre(raw.boostMessage, this.defaults.BOOST),
		};
	});

	/** Le gabarit de boost actif n'interpelle personne : le dire avant l'envoi. */
	readonly boostSansMention = computed(() => {
		this.value();
		const raw = this.form.getRawValue();
		const gabarit = raw.boostMessage.trim() || this.defaults.BOOST;
		return raw.boostEnabled && (!this.alertRoleId() || !gabarit.includes('{moderation}'));
	});

	/** Resume place au-dessus du bouton : le `mat-error` peut etre hors de l'ecran. */
	readonly raisonDuBlocage = computed(() => {
		this.value();
		if (this.form.controls.channelId.hasError('salon')) {
			return 'Renseignez le salon des arrivées et des départs pour activer ces messages.';
		}
		if (this.form.invalid) return 'Un champ est invalide : identifiant de salon ou message trop long.';
		return null;
	});

	constructor() {
		if (!this.auth.hasPermission(Permission.LOGS_WRITE)) this.form.disable();
		this.load();
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const raw = this.form.getRawValue();
		const request: UpdateWelcomeConfigRequest = {
			channelId: raw.channelId.trim() || null,
			joinEnabled: raw.joinEnabled,
			joinMessage: raw.joinMessage.trim() || null,
			leaveEnabled: raw.leaveEnabled,
			leaveMessage: raw.leaveMessage.trim() || null,
			boostEnabled: raw.boostEnabled,
			boostChannelId: raw.boostChannelId.trim() || null,
			boostMessage: raw.boostMessage.trim() || null,
		};

		this.saving.set(true);
		this.api.updateConfig(request).subscribe({
			next: (config) => {
				this.saving.set(false);
				this.apply(config);
				this.notifications.success('Messages d’arrivée et de départ enregistrés.');
			},
			error: () => this.saving.set(false),
		});
	}

	private load(): void {
		this.api.getConfig().subscribe({
			next: (config) => {
				this.apply(config);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	private apply(config: WelcomeConfigDto): void {
		this.alertRoleId.set(config.alertRoleId);
		this.form.setValue({
			channelId: config.channelId ?? '',
			joinEnabled: config.joinEnabled,
			joinMessage: config.joinMessage ?? '',
			leaveEnabled: config.leaveEnabled,
			leaveMessage: config.leaveMessage ?? '',
			boostEnabled: config.boostEnabled,
			boostChannelId: config.boostChannelId ?? '',
			boostMessage: config.boostMessage ?? '',
		});
	}
}

/** Mentions brutes rendues comme Discord les affiche. */
function afficherMentions(texte: string): string {
	return texte
		.replace(/<@&\d+>/g, '@Modération')
		.replace(/<@!?\d+>/g, `@${EXEMPLE.displayName}`);
}
