import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
	FormBuilder,
	ReactiveFormsModule,
	Validators,
	type AbstractControl,
	type ValidationErrors,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import {
	AUTOMOD_ACTION_LABELS,
	AUTOMOD_RULE_TYPE_DESCRIPTIONS,
	AUTOMOD_RULE_TYPE_LABELS,
	AutomodAction,
	AutomodRuleType,
	DEFAULT_SPAM_TIMEOUT_SECONDS,
	MAX_WORD_FILTER_PATTERNS,
	Permission,
	validateWordFilterPatterns,
	type AttachmentSpamSettings,
	type AutomodIncidentDto,
	type AutomodRuleDto,
	type AutomodRuleSettings,
	type ExcessiveCapsSettings,
	type LinksInvitesSettings,
	type MassMentionsSettings,
	type PatternIssue,
	type RepetitionSettings,
	type SpamRateSettings,
	type WordFilterSettings,
} from '@anubis/shared';
import { AutomodApi } from '../../../core/api/automod.api';
import { NotificationService } from '../../../core/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { RelativeTimePipe } from '../../../shared/pipes/format.pipes';

const SNOWFLAKE = /^\d{17,20}$/;

/** Une saisie multiligne, nettoyee de ses lignes vides. */
function parLigne(valeur: unknown): string[] {
	return String(valeur ?? '')
		.split('\n')
		.map((ligne) => ligne.trim())
		.filter(Boolean);
}

/**
 * Refuse les expressions que l'API refuserait, avant l'aller-retour.
 *
 * La regle qui compte reste celle de l'API : ceci n'evite qu'un formulaire
 * renvoye en erreur, et surtout affiche *quelle* expression pose probleme —
 * un message d'erreur global sur vingt-cinq lignes n'aiderait personne.
 */
function patternsValidator(control: AbstractControl): ValidationErrors | null {
	const patterns = parLigne(control.value);

	if (patterns.length > MAX_WORD_FILTER_PATTERNS) {
		return { tropDExpressions: MAX_WORD_FILTER_PATTERNS };
	}

	const issues = validateWordFilterPatterns(patterns);
	return issues.length ? { expressions: issues } : null;
}

/** Une carte par regle, avec un formulaire dont les champs de `settings` dependent du type. */
interface RuleEntry {
	type: AutomodRuleType;
	form: ReturnType<AutomodPage['buildForm']>;
}

@Component({
	selector: 'app-automod',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatCheckboxModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSelectModule,
		MatSlideToggleModule,
		MatTableModule,
		ReactiveFormsModule,
		RelativeTimePipe,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './automod.html',
	styleUrl: './automod.scss',
})
export class AutomodPage {
	private readonly automodApi = inject(AutomodApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	// Index en `string` : les lignes de `mat-table` arrivent typees `any` dans les
	// templates, un `Record` sur l'enum serait refuse a la compilation.
	readonly ruleTypeLabels: Record<string, string> = AUTOMOD_RULE_TYPE_LABELS;
	readonly ruleTypeDescriptions: Record<string, string> = AUTOMOD_RULE_TYPE_DESCRIPTIONS;
	readonly actionLabels: Record<string, string> = AUTOMOD_ACTION_LABELS;
	readonly actions = Object.values(AutomodAction);
	readonly RuleType = AutomodRuleType;

	readonly loading = signal(true);
	readonly savingType = signal<AutomodRuleType | null>(null);
	readonly entries = signal<RuleEntry[]>([]);

	readonly incidents = signal<AutomodIncidentDto[]>([]);
	readonly incidentsLoading = signal(false);
	readonly incidentsColumns = ['occurredAt', 'ruleType', 'member', 'action', 'message'];

	constructor() {
		this.load();
		this.loadIncidents();
	}

	save(entry: RuleEntry): void {
		if (entry.form.invalid) {
			entry.form.markAllAsTouched();
			return;
		}

		this.savingType.set(entry.type);
		const raw = entry.form.getRawValue();

		this.automodApi
			.upsertRule(entry.type, {
				enabled: raw.enabled,
				action: raw.action,
				timeoutSeconds: raw.action === AutomodAction.DELETE_AND_TIMEOUT ? raw.timeoutSeconds : null,
				settings: this.settingsFromForm(entry.type, raw.settings),
				exemptRoleIds: this.splitIds(raw.exemptRoleIds),
			})
			.subscribe({
				next: () => {
					this.savingType.set(null);
					this.notifications.success('Règle mise à jour.');
				},
				error: () => this.savingType.set(null),
			});
	}

	/**
	 * Expressions refusees de la regle, ou `null` si tout passe.
	 *
	 * Renvoyer `null` plutot qu'un tableau vide permet au template de
	 * distinguer « rien a signaler » (on affiche l'aide) de « des refus »
	 * (on affiche lesquels) avec un simple `@if`.
	 */
	patternIssues(entry: RuleEntry): PatternIssue[] | null {
		if (entry.type !== AutomodRuleType.WORD_FILTER) return null;
		const control = entry.form.controls.settings.get('patterns');
		if (!control?.touched) return null;
		const issues = control.errors?.['expressions'] as PatternIssue[] | undefined;
		return issues?.length ? issues : null;
	}

	private splitIds(value: string): string[] {
		return value
			.split(',')
			.map((id) => id.trim())
			.filter((id) => SNOWFLAKE.test(id));
	}

	private settingsFromForm(type: AutomodRuleType, raw: Record<string, unknown>): AutomodRuleSettings {
		switch (type) {
			case AutomodRuleType.SPAM_RATE:
				return {
					messageThreshold: Number(raw['messageThreshold']),
					windowSeconds: Number(raw['windowSeconds']),
				} satisfies SpamRateSettings;
			case AutomodRuleType.ATTACHMENT_SPAM:
				return {
					attachmentThreshold: Number(raw['attachmentThreshold']),
					windowSeconds: Number(raw['windowSeconds']),
					imagesOnly: Boolean(raw['imagesOnly']),
				} satisfies AttachmentSpamSettings;
			case AutomodRuleType.MASS_MENTIONS:
				return { mentionThreshold: Number(raw['mentionThreshold']) } satisfies MassMentionsSettings;
			case AutomodRuleType.LINKS_INVITES:
				return {
					blockLinks: Boolean(raw['blockLinks']),
					blockInvites: Boolean(raw['blockInvites']),
					allowedDomains: String(raw['allowedDomains'] ?? '')
						.split(',')
						.map((domain) => domain.trim())
						.filter(Boolean),
				} satisfies LinksInvitesSettings;
			case AutomodRuleType.WORD_FILTER:
				return {
					words: parLigne(raw['words']),
					patterns: parLigne(raw['patterns']),
				} satisfies WordFilterSettings;
			case AutomodRuleType.EXCESSIVE_CAPS:
				return {
					minLength: Number(raw['minLength']),
					capsRatio: Number(raw['capsRatio']),
				} satisfies ExcessiveCapsSettings;
			case AutomodRuleType.REPETITION:
				return {
					maxRepeatedChars: Number(raw['maxRepeatedChars']),
					maxDuplicateMessages: Number(raw['maxDuplicateMessages']),
				} satisfies RepetitionSettings;
		}
	}

	private buildSettingsGroup(type: AutomodRuleType, settings: AutomodRuleSettings) {
		switch (type) {
			case AutomodRuleType.SPAM_RATE: {
				const s = settings as SpamRateSettings;
				return this.formBuilder.nonNullable.group({
					messageThreshold: [s.messageThreshold, [Validators.required, Validators.min(1)]],
					windowSeconds: [s.windowSeconds, [Validators.required, Validators.min(1)]],
				});
			}
			case AutomodRuleType.ATTACHMENT_SPAM: {
				const s = settings as AttachmentSpamSettings;
				return this.formBuilder.nonNullable.group({
					attachmentThreshold: [s.attachmentThreshold, [Validators.required, Validators.min(1)]],
					windowSeconds: [s.windowSeconds, [Validators.required, Validators.min(1)]],
					imagesOnly: [s.imagesOnly],
				});
			}
			case AutomodRuleType.MASS_MENTIONS: {
				const s = settings as MassMentionsSettings;
				return this.formBuilder.nonNullable.group({
					mentionThreshold: [s.mentionThreshold, [Validators.required, Validators.min(1)]],
				});
			}
			case AutomodRuleType.LINKS_INVITES: {
				const s = settings as LinksInvitesSettings;
				return this.formBuilder.nonNullable.group({
					blockLinks: [s.blockLinks],
					blockInvites: [s.blockInvites],
					allowedDomains: [s.allowedDomains.join(', ')],
				});
			}
			case AutomodRuleType.WORD_FILTER: {
				const s = settings as WordFilterSettings;
				return this.formBuilder.nonNullable.group({
					words: [s.words.join('\n')],
					patterns: [(s.patterns ?? []).join('\n'), [patternsValidator]],
				});
			}
			case AutomodRuleType.EXCESSIVE_CAPS: {
				const s = settings as ExcessiveCapsSettings;
				return this.formBuilder.nonNullable.group({
					minLength: [s.minLength, [Validators.required, Validators.min(1)]],
					capsRatio: [s.capsRatio, [Validators.required, Validators.min(0.1), Validators.max(1)]],
				});
			}
			case AutomodRuleType.REPETITION: {
				const s = settings as RepetitionSettings;
				return this.formBuilder.nonNullable.group({
					maxRepeatedChars: [s.maxRepeatedChars, [Validators.required, Validators.min(2)]],
					maxDuplicateMessages: [s.maxDuplicateMessages, [Validators.required, Validators.min(2)]],
				});
			}
		}
	}

	buildForm(rule: AutomodRuleDto) {
		return this.formBuilder.nonNullable.group({
			enabled: [rule.enabled],
			action: [rule.action],
			// Cinq minutes quand la regle n'en porte pas encore : c'est la duree
			// que le champ propose des qu'on bascule sur l'exclusion temporaire.
			timeoutSeconds: [rule.timeoutSeconds ?? DEFAULT_SPAM_TIMEOUT_SECONDS, [Validators.min(1)]],
			exemptRoleIds: [rule.exemptRoleIds.join(', ')],
			settings: this.buildSettingsGroup(rule.type, rule.settings),
		});
	}

	private load(): void {
		this.loading.set(true);

		this.automodApi.listRules().subscribe({
			next: (rules) => {
				this.entries.set(rules.map((rule) => ({ type: rule.type, form: this.buildForm(rule) })));
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	private loadIncidents(): void {
		this.incidentsLoading.set(true);

		this.automodApi.listIncidents({ page: 1, pageSize: 25 }).subscribe({
			next: (page) => {
				this.incidents.set(page.items);
				this.incidentsLoading.set(false);
			},
			error: () => this.incidentsLoading.set(false),
		});
	}
}
