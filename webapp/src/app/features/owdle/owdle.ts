import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
	FormArray,
	FormBuilder,
	FormControl,
	ReactiveFormsModule,
	Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
	MAX_OWDLE_XP_PER_WIN,
	MAX_OWDLE_XP_STEPS,
	OWDLE_REGION_LABELS,
	OWDLE_ROLE_LABELS,
	OWDLE_ROLES,
	OWDLE_SPECIES_LABELS,
	OWDLE_SUB_ROLE_LABELS,
	Permission,
	findOwdleTwins,
	normalizeOwdleName,
	type OwdleAffiliationDto,
	type OwdleConfigDto,
	type OwdleHeroDto,
	type OwdleRole,
} from '@anubis/shared';
import { OwdleApi } from '../../core/api/owdle.api';
import { NotificationService } from '../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../shared/directives/has-permission.directive';
import { OwdleAffiliationDialog, type AffiliationDialogData } from './affiliation-dialog';
import { OwdleHeroDialog, type HeroDialogData } from './hero-dialog';

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Heros de l'OWdle et experience gagnee a la victoire.
 *
 * **Le heros du jour n'apparait nulle part** : le staff joue aussi. La page ne
 * montre que la liste et le bareme, que tout joueur finit par connaitre.
 */
@Component({
	selector: 'app-owdle',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatButtonToggleModule,
		MatCardModule,
		MatFormFieldModule,
		MatIconModule,
		MatInputModule,
		MatProgressBarModule,
		MatSlideToggleModule,
		MatTableModule,
		MatTooltipModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './owdle.html',
	styleUrl: './owdle.scss',
})
export class OwdlePage {
	private readonly api = inject(OwdleApi);
	private readonly formBuilder = inject(FormBuilder);
	private readonly notifications = inject(NotificationService);
	private readonly dialog = inject(MatDialog);

	readonly Permission = Permission;
	readonly roles = OWDLE_ROLES;
	readonly maxSteps = MAX_OWDLE_XP_STEPS;
	readonly maxXp = MAX_OWDLE_XP_PER_WIN;
	// Indexes depuis le template sur des lignes `any` : `Record<string, string>`.
	readonly roleLabels: Record<string, string> = OWDLE_ROLE_LABELS;
	readonly subRoleLabels: Record<string, string> = OWDLE_SUB_ROLE_LABELS;
	readonly speciesLabels: Record<string, string> = OWDLE_SPECIES_LABELS;
	readonly regionLabels: Record<string, string> = OWDLE_REGION_LABELS;
	readonly columns = ['name', 'role', 'subRole', 'species', 'origin', 'affiliation', 'releaseYear', 'actions'];

	readonly loading = signal(true);
	readonly savingConfig = signal(false);
	readonly heroes = signal<OwdleHeroDto[]>([]);
	readonly affiliations = signal<OwdleAffiliationDto[]>([]);
	readonly roleFilter = signal<OwdleRole | 'ALL'>('ALL');
	readonly search = signal('');
	readonly showDisabled = signal(true);

	readonly visibleHeroes = computed(() => {
		const role = this.roleFilter();
		const cherche = normalizeOwdleName(this.search());
		return this.heroes().filter(
			(hero) =>
				(role === 'ALL' || hero.role === role) &&
				(this.showDisabled() || hero.enabled) &&
				(!cherche || normalizeOwdleName(hero.name).includes(cherche)),
		);
	});

	readonly activeCount = computed(() => this.heroes().filter((hero) => hero.enabled).length);

	/**
	 * Heros que la grille ne peut pas departager. Calcule sur les actifs seuls :
	 * un heros desactive n'est plus proposable, il ne gene donc personne.
	 */
	readonly twins = computed(() => {
		const actifs = this.heroes().filter((hero) => hero.enabled);
		const noms = new Map(actifs.map((hero) => [hero.key, hero.name]));
		return findOwdleTwins(actifs).map((keys) => keys.map((key) => noms.get(key) ?? key).join(', '));
	});

	readonly xpSteps = new FormArray<FormControl<number>>([]);
	readonly configForm = this.formBuilder.nonNullable.group({
		channelId: ['', [Validators.pattern(SNOWFLAKE)]],
		xpByGuesses: this.xpSteps,
	});

	constructor() {
		this.load(true);
	}

	/** « 1 essai », « 2 essais »… et « N essais et plus » pour la derniere ligne. */
	stepLabel(index: number): string {
		const n = index + 1;
		const essais = `${n} essai${n > 1 ? 's' : ''}`;
		return index === this.xpSteps.length - 1 ? `${essais} et plus` : essais;
	}

	addStep(): void {
		if (this.xpSteps.length >= MAX_OWDLE_XP_STEPS) return;
		// La nouvelle ligne reprend la derniere valeur : ajouter une ligne ne doit
		// rien changer aux gains tant qu'on ne l'a pas modifiee.
		const last = this.xpSteps.at(this.xpSteps.length - 1)?.value ?? 0;
		this.xpSteps.push(this.stepControl(last));
		this.xpSteps.markAsDirty();
	}

	removeStep(): void {
		if (this.xpSteps.length <= 1) return;
		this.xpSteps.removeAt(this.xpSteps.length - 1);
		this.xpSteps.markAsDirty();
	}

	saveConfig(): void {
		if (this.configForm.invalid) {
			this.configForm.markAllAsTouched();
			return;
		}

		const raw = this.configForm.getRawValue();
		this.savingConfig.set(true);
		this.api
			.updateConfig({
				channelId: raw.channelId.trim() || null,
				xpByGuesses: raw.xpByGuesses.map((value) => Math.round(value)),
			})
			.subscribe({
				next: (config) => {
					this.savingConfig.set(false);
					this.applyConfig(config);
					this.notifications.success('Réglage de l’OWdle enregistré.');
				},
				error: () => this.savingConfig.set(false),
			});
	}

	setRoleFilter(value: OwdleRole | 'ALL'): void {
		this.roleFilter.set(value);
	}

	onSearch(event: Event): void {
		this.search.set((event.target as HTMLInputElement).value);
	}

	openHero(hero: OwdleHeroDto | null): void {
		this.dialog
			.open<OwdleHeroDialog, HeroDialogData, OwdleHeroDto>(OwdleHeroDialog, {
				data: { hero, affiliations: this.affiliations() },
				autoFocus: 'first-tabbable',
			})
			.afterClosed()
			.subscribe((saved) => {
				if (!saved) return;
				this.notifications.success(
					hero
						? `${saved.name} mis à jour — le bot le relira d'ici 30 secondes.`
						: `${saved.name} ajouté — proposable d'ici 30 secondes.`,
				);
				// Relu plutot que patche sur place : le compte de heros de chaque
				// affiliation a pu changer, et c'est lui qui autorise la suppression.
				this.load(false);
			});
	}

	openAffiliation(affiliation: OwdleAffiliationDto | null): void {
		this.dialog
			.open<OwdleAffiliationDialog, AffiliationDialogData, OwdleAffiliationDto>(
				OwdleAffiliationDialog,
				{ data: affiliation },
			)
			.afterClosed()
			.subscribe((saved) => {
				if (!saved) return;
				this.notifications.success(
					affiliation
						? `Affiliation renommée en « ${saved.label} ».`
						: `Affiliation « ${saved.label} » ajoutée.`,
				);
				// Un renommage change le libelle affiche sur tous ses heros.
				this.load(false);
			});
	}

	deleteTooltip(affiliation: OwdleAffiliationDto): string {
		return affiliation.heroCount > 0
			? `Portée par ${affiliation.heroCount} héros : changez-les d'abord.`
			: 'Supprimer';
	}

	removeAffiliation(affiliation: OwdleAffiliationDto): void {
		const data: ConfirmDialogData = {
			title: "Supprimer l'affiliation",
			message: `« ${affiliation.label} » disparaîtra de la liste proposée aux héros.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;
				this.api.removeAffiliation(affiliation.key).subscribe({
					next: () => {
						this.notifications.success('Affiliation supprimée.');
						this.load(false);
					},
				});
			});
	}

	private stepControl(value: number): FormControl<number> {
		return this.formBuilder.nonNullable.control(value, [
			Validators.required,
			Validators.min(0),
			Validators.max(MAX_OWDLE_XP_PER_WIN),
		]);
	}

	private applyConfig(config: OwdleConfigDto): void {
		this.xpSteps.clear();
		for (const value of config.xpByGuesses) this.xpSteps.push(this.stepControl(value));
		this.configForm.controls.channelId.setValue(config.channelId ?? '');
		this.configForm.markAsPristine();
	}

	/**
	 * Le bareme n'est reapplique qu'au premier chargement : relire apres une
	 * modification de heros ecraserait une saisie en cours dans l'autre carte.
	 */
	private load(withConfig: boolean): void {
		this.loading.set(true);
		this.api.overview().subscribe({
			next: (overview) => {
				this.heroes.set(overview.heroes);
				this.affiliations.set(overview.affiliations);
				if (withConfig) this.applyConfig(overview.config);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
