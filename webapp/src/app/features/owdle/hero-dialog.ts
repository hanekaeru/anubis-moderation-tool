import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import {
	MAX_OWDLE_HERO_KEY_LENGTH,
	MAX_OWDLE_HERO_NAME_LENGTH,
	MAX_OWDLE_ORIGIN_LENGTH,
	MAX_OWDLE_RELEASE_YEAR,
	MIN_OWDLE_RELEASE_YEAR,
	OWDLE_HERO_KEY_PATTERN,
	OWDLE_REGION_LABELS,
	OWDLE_REGIONS,
	OWDLE_ROLE_LABELS,
	OWDLE_ROLES,
	OWDLE_SPECIES,
	OWDLE_SPECIES_LABELS,
	OWDLE_SUB_ROLE_LABELS,
	OWDLE_SUB_ROLE_ROLE,
	owdleSubRolesOf,
	slugifyChannelPart,
	type OwdleAffiliationDto,
	type OwdleHeroDto,
	type OwdleRegion,
	type OwdleRole,
	type OwdleSpecies,
	type OwdleSubRole,
} from '@anubis/shared';
import { OwdleApi } from '../../core/api/owdle.api';
import { readApiError } from '../../core/error.interceptor';

export interface HeroDialogData {
	/** `null` pour une creation. */
	hero: OwdleHeroDto | null;
	/** La liste geree sur la page : seules valeurs proposees. */
	affiliations: OwdleAffiliationDto[];
}

/**
 * Creation et correction d'un heros.
 *
 * La cle ne se saisit qu'a la creation : elle vit ensuite dans les parties
 * enregistrees. Elle se deduit du nom tant qu'on n'y a pas touche, parce que
 * personne ne devrait avoir a inventer un identifiant.
 */
@Component({
	selector: 'app-owdle-hero-dialog',
	imports: [
		MatButtonModule,
		MatDialogModule,
		MatFormFieldModule,
		MatInputModule,
		MatSelectModule,
		MatSlideToggleModule,
		ReactiveFormsModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<h2 mat-dialog-title>{{ hero ? 'Modifier ' + hero.name : 'Nouveau héros' }}</h2>

		<mat-dialog-content>
			<form [formGroup]="form" class="form">
				<div class="pair">
					<mat-form-field>
						<mat-label>Nom</mat-label>
						<input matInput formControlName="name" [maxlength]="maxName" />
						<mat-hint>Celui du client français.</mat-hint>
						@if (form.controls.name.hasError('required')) {
							<mat-error>Le nom est requis.</mat-error>
						}
					</mat-form-field>

					<mat-form-field>
						<mat-label>Clé</mat-label>
						<input matInput formControlName="key" [maxlength]="maxKey" />
						<mat-hint>{{ hero ? 'Ne change jamais.' : 'Minuscules, chiffres, tirets.' }}</mat-hint>
						@if (form.controls.key.hasError('pattern')) {
							<mat-error>Minuscules, chiffres et tirets seulement.</mat-error>
						}
					</mat-form-field>
				</div>

				<div class="pair">
					<mat-form-field>
						<mat-label>Rôle</mat-label>
						<mat-select formControlName="role">
							@for (role of roles; track role) {
								<mat-option [value]="role">{{ roleLabels[role] }}</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<mat-form-field>
						<mat-label>Sous-rôle</mat-label>
						<mat-select formControlName="subRole">
							@for (subRole of subRoles(); track subRole) {
								<mat-option [value]="subRole">{{ subRoleLabels[subRole] }}</mat-option>
							}
						</mat-select>
						@if (form.controls.subRole.hasError('required')) {
							<mat-error>Choisissez un sous-rôle du rôle.</mat-error>
						}
					</mat-form-field>
				</div>

				<div class="pair">
					<mat-form-field>
						<mat-label>Espèce</mat-label>
						<mat-select formControlName="species">
							@for (species of speciesList; track species) {
								<mat-option [value]="species">{{ speciesLabels[species] }}</mat-option>
							}
						</mat-select>
					</mat-form-field>

					<mat-form-field>
						<mat-label>Affiliation</mat-label>
						<mat-select formControlName="affiliationKey">
							@for (affiliation of affiliations; track affiliation.key) {
								<mat-option [value]="affiliation.key">{{ affiliation.label }}</mat-option>
							}
						</mat-select>
						<mat-hint>La liste se gère sur la page, carte « Affiliations ».</mat-hint>
						@if (form.controls.affiliationKey.hasError('required')) {
							<mat-error>Choisissez une affiliation.</mat-error>
						}
					</mat-form-field>
				</div>

				<div class="pair">
					<mat-form-field>
						<mat-label>Origine</mat-label>
						<input matInput formControlName="origin" [maxlength]="maxOrigin" />
						<mat-hint>Comparée telle quelle : même orthographe pour un même pays.</mat-hint>
					</mat-form-field>

					<mat-form-field>
						<mat-label>Continent</mat-label>
						<mat-select formControlName="region">
							@for (region of regions; track region) {
								<mat-option [value]="region">{{ regionLabels[region] }}</mat-option>
							}
						</mat-select>
						<mat-hint>Donne le 🟨 : même continent, pays différent.</mat-hint>
					</mat-form-field>
				</div>

				<mat-form-field class="year">
					<mat-label>Année de sortie</mat-label>
					<input matInput type="number" formControlName="releaseYear" [min]="minYear" [max]="maxYear" />
					@if (form.controls.releaseYear.invalid) {
						<mat-error>Entre {{ minYear }} et {{ maxYear }}.</mat-error>
					}
				</mat-form-field>

				<mat-slide-toggle formControlName="enabled">
					Actif — peut être tiré et proposé
				</mat-slide-toggle>
			</form>

			@if (error(); as message) {
				<p class="error" role="alert">{{ message }}</p>
			}
		</mat-dialog-content>

		<mat-dialog-actions align="end">
			<button matButton mat-dialog-close>Annuler</button>
			<button matButton="filled" [disabled]="saving()" (click)="save()">Enregistrer</button>
		</mat-dialog-actions>
	`,
	styles: `
		.form {
			display: flex;
			flex-direction: column;
			gap: var(--space-3);
			min-width: 520px;
			padding-top: 4px;
		}

		.pair {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--space-4);
		}

		.year {
			max-width: 200px;
		}

		.error {
			margin: var(--space-3) 0 0;
			padding: 10px 12px;
			border-radius: 8px;
			background: var(--mat-sys-error-container);
			color: var(--mat-sys-on-error-container);
		}

		@media (max-width: 640px) {
			.form {
				min-width: 0;
			}

			.pair {
				grid-template-columns: 1fr;
			}
		}
	`,
})
export class OwdleHeroDialog {
	private readonly api = inject(OwdleApi);
	private readonly dialogRef = inject(MatDialogRef<OwdleHeroDialog, OwdleHeroDto>);
	private readonly data = inject<HeroDialogData>(MAT_DIALOG_DATA);
	readonly hero = this.data.hero;
	readonly affiliations = this.data.affiliations;

	readonly roles = OWDLE_ROLES;
	readonly speciesList = OWDLE_SPECIES;
	readonly regions = OWDLE_REGIONS;
	readonly roleLabels = OWDLE_ROLE_LABELS;
	readonly subRoleLabels = OWDLE_SUB_ROLE_LABELS;
	readonly speciesLabels = OWDLE_SPECIES_LABELS;
	readonly regionLabels = OWDLE_REGION_LABELS;
	readonly maxKey = MAX_OWDLE_HERO_KEY_LENGTH;
	readonly maxName = MAX_OWDLE_HERO_NAME_LENGTH;
	readonly maxOrigin = MAX_OWDLE_ORIGIN_LENGTH;
	readonly minYear = MIN_OWDLE_RELEASE_YEAR;
	readonly maxYear = MAX_OWDLE_RELEASE_YEAR;

	readonly saving = signal(false);
	readonly error = signal<string | null>(null);

	readonly form = inject(FormBuilder).nonNullable.group({
		key: [
			{ value: this.hero?.key ?? '', disabled: this.hero !== null },
			[
				Validators.required,
				Validators.maxLength(MAX_OWDLE_HERO_KEY_LENGTH),
				Validators.pattern(OWDLE_HERO_KEY_PATTERN),
			],
		],
		name: [this.hero?.name ?? '', [Validators.required, Validators.maxLength(MAX_OWDLE_HERO_NAME_LENGTH)]],
		role: [this.hero?.role ?? ('DAMAGE' as OwdleRole)],
		subRole: [(this.hero?.subRole ?? '') as OwdleSubRole | '', [Validators.required]],
		species: [this.hero?.species ?? ('HUMAN' as OwdleSpecies)],
		origin: [this.hero?.origin ?? '', [Validators.required, Validators.maxLength(MAX_OWDLE_ORIGIN_LENGTH)]],
		region: [this.hero?.region ?? ('EUROPE' as OwdleRegion)],
		affiliationKey: [this.hero?.affiliation.key ?? '', [Validators.required]],
		releaseYear: [
			this.hero?.releaseYear ?? new Date().getFullYear(),
			[Validators.required, Validators.min(MIN_OWDLE_RELEASE_YEAR), Validators.max(MAX_OWDLE_RELEASE_YEAR)],
		],
		enabled: [this.hero?.enabled ?? true],
	});

	private readonly role = toSignal(this.form.controls.role.valueChanges, {
		initialValue: this.form.controls.role.value,
	});

	/** Seuls les sous-roles du role choisi : un « Tank Secouriste » n'existe pas. */
	readonly subRoles = computed(() => owdleSubRolesOf(this.role()));

	constructor() {
		// Changer de role vide le sous-role s'il n'en fait plus partie, plutot
		// que de garder une valeur que la liste n'affiche plus.
		this.form.controls.role.valueChanges.pipe(takeUntilDestroyed()).subscribe((role) => {
			const subRole = this.form.controls.subRole.value;
			if (subRole && OWDLE_SUB_ROLE_ROLE[subRole] !== role) this.form.controls.subRole.setValue('');
		});

		if (!this.hero) {
			this.form.controls.name.valueChanges.pipe(takeUntilDestroyed()).subscribe((name) => {
				if (this.form.controls.key.dirty) return;
				this.form.controls.key.setValue(slugifyChannelPart(name).slice(0, MAX_OWDLE_HERO_KEY_LENGTH));
			});
		}
	}

	save(): void {
		if (this.form.invalid) {
			this.form.markAllAsTouched();
			return;
		}

		const raw = this.form.getRawValue();
		const fiche = {
			name: raw.name.trim(),
			role: raw.role,
			subRole: raw.subRole as OwdleSubRole,
			species: raw.species,
			origin: raw.origin.trim(),
			region: raw.region,
			affiliationKey: raw.affiliationKey,
			releaseYear: raw.releaseYear,
			enabled: raw.enabled,
		};

		this.saving.set(true);
		this.error.set(null);
		const appel = this.hero
			? this.api.updateHero(this.hero.key, fiche)
			: this.api.createHero({ ...fiche, key: raw.key });

		appel.subscribe({
			next: (hero) => this.dialogRef.close(hero),
			error: (err: unknown) => {
				this.saving.set(false);
				this.error.set(readApiError(err));
			},
		});
	}
}
