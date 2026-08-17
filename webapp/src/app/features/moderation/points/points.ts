import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	MAX_MODERATION_POINTS,
	MAX_MODERATION_THRESHOLD,
	MIN_MODERATION_POINTS,
	MODERATION_RISK_LABELS,
	Permission,
	SANCTION_TYPE_LABELS,
	SanctionType,
	WARNING_SEVERITY_LABELS,
	WarningSeverity,
	moderationRisk,
	type ModerationPointsConfigDto,
} from '@anubis/shared';
import { ModerationApi } from '../../../core/api/moderation.api';
import { NotificationService } from '../../../core/notification.service';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';

/**
 * Bareme de points de moderation.
 *
 * Le bareme ne vaut que pour l'avenir : chaque avertissement et chaque sanction
 * copie son poids a la creation. Le dire ici est essentiel — sans cette
 * precision, on s'attend a voir les scores du serveur bouger en enregistrant,
 * et on rejoue le reglage en croyant qu'il n'a pas pris.
 */
@Component({
	selector: 'app-moderation-points',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatTooltipModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './points.html',
	styleUrl: './points.scss',
})
export class ModerationPointsPage {
	private readonly api = inject(ModerationApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly severities = Object.values(WarningSeverity);
	readonly sanctionTypes = Object.values(SanctionType);
	readonly severityLabels: Record<string, string> = WARNING_SEVERITY_LABELS;
	readonly sanctionLabels: Record<string, string> = SANCTION_TYPE_LABELS;
	readonly riskLabels: Record<string, string> = MODERATION_RISK_LABELS;

	readonly loading = signal(true);
	readonly saving = signal(false);

	private readonly pointsValidators = [
		Validators.required,
		Validators.min(MIN_MODERATION_POINTS),
		Validators.max(MAX_MODERATION_POINTS),
	];

	readonly form = this.formBuilder.nonNullable.group({
		LOW: [1, this.pointsValidators],
		MEDIUM: [3, this.pointsValidators],
		HIGH: [5, this.pointsValidators],
		TIMEOUT: [3, this.pointsValidators],
		KICK: [5, this.pointsValidators],
		BAN: [10, this.pointsValidators],
		SHADOWBAN: [5, this.pointsValidators],
		warnThreshold: [
			6,
			[Validators.required, Validators.min(1), Validators.max(MAX_MODERATION_THRESHOLD)],
		],
		criticalThreshold: [
			12,
			[Validators.required, Validators.min(1), Validators.max(MAX_MODERATION_THRESHOLD)],
		],
	});

	/**
	 * Le formulaire vit hors du graphe de signaux : sans cette conversion,
	 * l'apercu ci-dessous resterait fige en `OnPush`.
	 */
	private readonly value = toSignal(this.form.valueChanges, {
		initialValue: this.form.getRawValue(),
	});

	/** Seuils saisis a l'envers : la fiche alertera plus, jamais moins. */
	readonly thresholdsInverted = computed(() => {
		const v = this.value();
		return (v.criticalThreshold ?? 0) < (v.warnThreshold ?? 0);
	});

	/**
	 * Combien de gestes il faut pour franchir chaque seuil, avec le bareme en
	 * cours de saisie. Un bareme se juge sur ce qu'il declenche, pas sur ses
	 * nombres.
	 */
	readonly preview = computed(() => {
		const v = this.value();
		const seuils = {
			warnThreshold: v.warnThreshold ?? 0,
			criticalThreshold: v.criticalThreshold ?? 0,
		};

		return [
			{ label: '1 avertissement léger', score: v.LOW ?? 0 },
			{ label: '3 avertissements légers', score: (v.LOW ?? 0) * 3 },
			{ label: '1 avertissement grave', score: v.HIGH ?? 0 },
			{ label: '1 exclusion temporaire', score: v.TIMEOUT ?? 0 },
			{ label: '1 expulsion', score: v.KICK ?? 0 },
			{ label: '1 bannissement', score: v.BAN ?? 0 },
		].map((ligne) => ({ ...ligne, risk: moderationRisk(ligne.score, seuils) }));
	});

	constructor() {
		this.load();
	}

	private load(): void {
		this.loading.set(true);
		this.api.getPointsConfig().subscribe({
			next: (config) => {
				this.apply(config);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}

	private apply(config: ModerationPointsConfigDto): void {
		this.form.setValue({
			LOW: config.warningPoints.LOW,
			MEDIUM: config.warningPoints.MEDIUM,
			HIGH: config.warningPoints.HIGH,
			TIMEOUT: config.sanctionPoints.TIMEOUT,
			KICK: config.sanctionPoints.KICK,
			BAN: config.sanctionPoints.BAN,
			SHADOWBAN: config.sanctionPoints.SHADOWBAN,
			warnThreshold: config.warnThreshold,
			criticalThreshold: config.criticalThreshold,
		});
		this.form.markAsPristine();
	}

	save(): void {
		if (this.form.invalid || this.saving()) return;

		const v = this.form.getRawValue();
		this.saving.set(true);

		this.api
			.updatePointsConfig({
				warningPoints: { LOW: v.LOW, MEDIUM: v.MEDIUM, HIGH: v.HIGH },
				sanctionPoints: {
					TIMEOUT: v.TIMEOUT,
					KICK: v.KICK,
					BAN: v.BAN,
					SHADOWBAN: v.SHADOWBAN,
				},
				warnThreshold: v.warnThreshold,
				criticalThreshold: v.criticalThreshold,
			})
			.subscribe({
				next: (config) => {
					this.apply(config);
					this.saving.set(false);
					this.notifications.success('Barème enregistré.');
				},
				error: () => this.saving.set(false),
			});
	}
}
