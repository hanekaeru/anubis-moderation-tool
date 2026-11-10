import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
	BATTLENET_BATTLETAG_RETENTION_DAYS,
	BATTLENET_LINK_RETENTION_DAYS,
	Permission,
	type BattlenetLinkDto,
} from '@anubis/shared';
import { BattlenetApi } from '../../../core/api/battlenet.api';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { FrDatePipe } from '../../../shared/pipes/format.pipes';

/**
 * Lien Battle.net du membre, sur sa fiche.
 *
 * Composant a part plutot qu'un bloc de plus dans la fiche : il charge et
 * modifie ses propres donnees, et la fiche n'a pas a savoir qu'elles existent.
 *
 * Les deux boutons sont reserves a `battlenet:write` (administrateurs) — la
 * directive masque, l'API refuse. « Delier » laisse la trace qui bloque le
 * compte Blizzard pour les autres membres ; « Liberer » la supprime aussi. La
 * difference est dite dans la confirmation : c'est elle qui decide si un
 * compte secondaire pourra reprendre ce compte Blizzard.
 */
@Component({
	selector: 'app-battlenet-card',
	imports: [FrDatePipe, HasPermissionDirective, MatButtonModule, MatCardModule, MatIconModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		@if (link(); as link) {
			<mat-card appearance="outlined" class="battlenet">
				<mat-card-content>
					<div class="head">
						<mat-icon aria-hidden="true">sports_esports</mat-icon>
						<div class="text">
							<p class="label">Battle.net</p>
							@switch (link.state) {
								@case ('LINKED') {
									<p class="value">
										Compte lié
										@if (link.battletag) {
											— <strong>{{ link.battletag }}</strong>
										}
									</p>
									<p class="hint">
										Vérifié le {{ link.verifiedAt | frDate }}.
										@if (!link.battletag) {
											BattleTag non affiché : réservé aux administrateurs, et effacé
											{{ battletagDays }} jours après la vérification.
										}
									</p>
								}
								@case ('UNLINKED') {
									<p class="value">Compte délié</p>
									<p class="hint">
										Délié le {{ link.unlinkedAt | frDate
										}}{{ link.unlinkedBy ? ' par ' + link.unlinkedBy : '' }}. Le compte
										Blizzard reste bloqué pour les autres membres pendant {{ linkMonths }} mois.
									</p>
								}
								@default {
									<p class="value">Aucun compte lié</p>
								}
							}
						</div>
					</div>

					@if (link.state !== 'NONE') {
						<div class="actions" *appHasPermission="Permission.BATTLENET_WRITE">
							@if (link.state === 'LINKED') {
								<button matButton="outlined" [disabled]="busy()" (click)="unlink(false)">
									Délier
								</button>
							}
							<button matButton [disabled]="busy()" (click)="unlink(true)">
								Délier et libérer
							</button>
						</div>
					}
				</mat-card-content>
			</mat-card>
		}
	`,
	styles: `
		.head {
			display: flex;
			gap: var(--space-3);
			align-items: flex-start;
		}

		.head mat-icon {
			color: var(--mat-sys-on-surface-variant);
		}

		.label {
			margin: 0;
			font-size: 0.8rem;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--mat-sys-on-surface-variant);
		}

		.value {
			margin: var(--space-1) 0 0;
		}

		.hint {
			margin: var(--space-1) 0 0;
			max-width: var(--measure);
			font-size: 0.85rem;
			color: var(--mat-sys-on-surface-variant);
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			gap: var(--space-2);
			margin-top: var(--space-4);
		}
	`,
})
export class BattlenetCard {
	private readonly api = inject(BattlenetApi);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);

	readonly userId = input.required<string>();

	readonly Permission = Permission;
	readonly battletagDays = BATTLENET_BATTLETAG_RETENTION_DAYS;
	readonly linkMonths = Math.round(BATTLENET_LINK_RETENTION_DAYS / 30);

	readonly link = signal<BattlenetLinkDto | null>(null);
	readonly busy = signal(false);

	constructor() {
		effect(() => {
			const userId = this.userId();
			this.link.set(null);
			this.api.getLink(userId).subscribe({ next: (link) => this.link.set(link) });
		});
	}

	unlink(release: boolean): void {
		const data: ConfirmDialogData = release
			? {
					title: 'Délier et libérer le compte Battle.net',
					message:
						"Le lien et la trace sont supprimés : ce compte Blizzard pourra être lié à n'importe " +
						"quel autre compte Discord, y compris un compte secondaire. À réserver aux cas " +
						"légitimes (quelqu'un qui s'est vérifié avec le compte d'un proche, par exemple).",
					confirmLabel: 'Délier et libérer',
					destructive: true,
				}
			: {
					title: 'Délier le compte Battle.net',
					message:
						'Le membre garde son accès au serveur, mais perd le rôle « BattleTag vérifié ». ' +
						`Une trace empêche de lier ce compte Blizzard à un autre compte Discord pendant ${this.linkMonths} mois. ` +
						'Le membre est prévenu par message privé.',
					confirmLabel: 'Délier',
					destructive: true,
				};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (!confirmed) return;

				this.busy.set(true);
				this.api.unlink(this.userId(), { release }).subscribe({
					next: (link) => {
						this.busy.set(false);
						this.link.set(link);
						this.notifications.success(
							release ? 'Compte Battle.net délié et libéré.' : 'Compte Battle.net délié.',
						);
					},
					error: () => this.busy.set(false),
				});
			});
	}
}
