import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	GUILD_ROLE_DESCRIPTIONS,
	GUILD_ROLE_LABELS,
	GuildRoleKey,
	Permission,
	SNOWFLAKE_PATTERN,
	renderMemberReference,
	type UpdateMentionSettingsRequest,
} from '@anubis/shared';
import { GuildConfigApi } from '../../../core/api/guild-config.api';
import { NotificationService } from '../../../core/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

/**
 * Qui le bot interpelle sur le serveur.
 *
 * Deux reglages de nature differente cohabitent parce qu'ils repondent a la
 * meme question : les roles declares une fois pour toutes, et la facon dont les
 * journaux designent un membre.
 *
 * Les identifiants de role se saisissent en texte libre, comme sur les pages
 * Sécurité et Expérience : le dashboard n'a pas de liste des roles du serveur,
 * et en inventer une pour trois champs serait une API de plus a tenir.
 */
@Component({
	selector: 'app-mentions',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTooltipModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './mentions.html',
	styleUrl: './mentions.scss',
})
export class MentionsPage {
	private readonly guildConfigApi = inject(GuildConfigApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly roleKeys = Object.values(GuildRoleKey);
	// Indexes depuis le template, ou les cles arrivent typees `string`.
	readonly roleLabels: Record<string, string> = GUILD_ROLE_LABELS;
	readonly roleDescriptions: Record<string, string> = GUILD_ROLE_DESCRIPTIONS;

	readonly loading = signal(true);
	readonly saving = signal(false);

	readonly form = this.formBuilder.nonNullable.group({
		MOD_ROLE: ['', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		ADMIN_ROLE: ['', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		STAFF_ROLE: ['', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		SUPPORT_ROLE: ['', [Validators.pattern(SNOWFLAKE_PATTERN)]],
		alertRoleKey: [''],
		mentionMembers: [false],
	});

	/**
	 * Etat du formulaire en signal.
	 *
	 * `valueChanges` vit hors du graphe de signaux : sans cette passerelle,
	 * l'apercu resterait fige en `OnPush`. Meme montage que la page Expérience.
	 */
	private readonly value = toSignal(this.form.valueChanges, {
		initialValue: this.form.getRawValue(),
	});

	/**
	 * Apercu d'une ligne de journal, rendu par la fonction que le bot emploie.
	 *
	 * Un reglage qui se decrit par « mentionner ou non » ne dit pas a quoi
	 * ressemble l'alternative : la montrer evite d'avoir a l'essayer en vrai.
	 */
	readonly preview = computed(() => {
		this.value();
		return renderMemberReference(
			'312043100628254721',
			'sylune',
			this.form.getRawValue().mentionMembers,
		);
	});

	/** Seuls les roles renseignes peuvent etre mentionnes : l'API le refuse sinon. */
	readonly mentionnables = computed(() => {
		this.value();
		const raw = this.form.getRawValue();
		return this.roleKeys.filter((cle) => raw[cle].trim().length > 0);
	});

	constructor() {
		this.load();
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const raw = this.form.getRawValue();
		const request: UpdateMentionSettingsRequest = {
			roles: Object.fromEntries(
				this.roleKeys.map((cle) => [cle, raw[cle].trim() || null]),
			) as UpdateMentionSettingsRequest['roles'],
			alertRoleKey: (raw.alertRoleKey || null) as GuildRoleKey | null,
			mentionMembers: raw.mentionMembers,
		};

		this.saving.set(true);
		this.guildConfigApi.updateMentions(request).subscribe({
			next: (settings) => {
				this.saving.set(false);
				this.apply(settings);
				this.notifications.success('Réglages de mention enregistrés.');
			},
			error: () => this.saving.set(false),
		});
	}

	/**
	 * Retire la mention de ticket quand son role vient d'etre vide.
	 *
	 * L'API refuserait l'enregistrement ; le corriger ici evite de renvoyer une
	 * erreur pour un choix que l'interface a laisse devenir impossible.
	 */
	onRoleCleared(key: GuildRoleKey): void {
		if (!this.form.controls[key].value.trim() && this.form.controls.alertRoleKey.value === key) {
			this.form.controls.alertRoleKey.setValue('');
		}
	}

	private load(): void {
		this.guildConfigApi.getMentions().subscribe({
			next: (settings) => {
				this.apply(settings);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	private apply(settings: {
		roles: Record<string, string | null>;
		alertRoleKey: string | null;
		mentionMembers: boolean;
	}): void {
		this.form.setValue({
			MOD_ROLE: settings.roles[GuildRoleKey.MODERATION] ?? '',
			ADMIN_ROLE: settings.roles[GuildRoleKey.ADMIN] ?? '',
			STAFF_ROLE: settings.roles[GuildRoleKey.STAFF] ?? '',
			SUPPORT_ROLE: settings.roles[GuildRoleKey.SUPPORT] ?? '',
			alertRoleKey: settings.alertRoleKey ?? '',
			mentionMembers: settings.mentionMembers,
		});
	}
}
