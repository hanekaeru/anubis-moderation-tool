import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { InboxDto, InboxSectionKey } from '@anubis/shared';
import { InboxApi } from '../../core/api/inbox.api';
import { RelativeTimePipe } from '../../shared/pipes/format.pipes';

const ICONS: Record<InboxSectionKey, string> = {
	SANCTIONS_UNAPPLIED: 'sync_problem',
	TICKETS: 'confirmation_number',
	ACCOUNT_FLAGS: 'report',
	QUARANTINE: 'hourglass_top',
	ESPORT_SCORES: 'scoreboard',
	PUBLICATION_FAILURES: 'error',
	MINIGAMES_PLANNING: 'event_busy',
};

/**
 * « A traiter » : ce qui attend quelqu'un du staff, toutes pages confondues.
 *
 * Resume, pas liste : chaque section montre ses premiers elements et renvoie a
 * la page qui les liste tous. L'API ne renvoie que ce que le compte a le droit
 * de voir, et seulement les sections non vides.
 */
@Component({
	selector: 'app-inbox',
	imports: [MatButtonModule, MatCardModule, MatIconModule, MatProgressBarModule, RelativeTimePipe, RouterLink],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="page">
			<header class="page-header">
				<div>
					<h1>À traiter</h1>
					<p class="subtitle">
						Ce qui attend quelqu'un du staff, toutes pages confondues. Une ligne traitée depuis sa page
						disparaît d'ici.
					</p>
				</div>
				<button matButton="outlined" [disabled]="loading()" (click)="load()">
					<mat-icon>refresh</mat-icon>
					Actualiser
				</button>
			</header>

			@if (loading() && !inbox()) {
				<mat-progress-bar mode="indeterminate" />
			}

			@if (inbox(); as data) {
				@if (!data.sections.length) {
					<mat-card appearance="outlined" class="empty">
						<mat-card-content>
							<mat-icon>task_alt</mat-icon>
							<p>Rien en attente. Tout est à jour.</p>
						</mat-card-content>
					</mat-card>
				} @else {
					<div class="sections">
						@for (section of data.sections; track section.key) {
							<mat-card appearance="outlined" class="section" [attr.data-key]="section.key">
								<mat-card-content>
									<div class="section-head">
										<span class="section-icon"><mat-icon>{{ icons[section.key] }}</mat-icon></span>
										<div class="section-title">
											<h2>{{ section.title }} <span class="count">{{ section.count }}</span></h2>
											<p class="hint">{{ section.hint }}</p>
										</div>
									</div>

									<ul class="items">
										@for (item of section.items; track item.id) {
											<li>
												<a [routerLink]="item.link">
													<span class="item-label">{{ item.label }}</span>
													@if (item.detail) {
														<span class="item-detail">{{ item.detail }}</span>
													}
												</a>
												@if (item.at) {
													<span class="item-at">{{ item.at | relativeTime }}</span>
												}
											</li>
										}
									</ul>

									@if (section.count > section.items.length) {
										<a matButton [routerLink]="section.link">
											Voir les {{ section.count }}
											<mat-icon iconPositionEnd>arrow_forward</mat-icon>
										</a>
									}
								</mat-card-content>
							</mat-card>
						}
					</div>
				}
			}
		</div>
	`,
	styles: `
		.sections {
			display: grid;
			gap: var(--space-6);
			grid-template-columns: repeat(auto-fit, minmax(380px, 1fr));
			align-items: start;
		}

		.section-head {
			display: flex;
			gap: var(--space-4);
			align-items: flex-start;
			margin-bottom: var(--space-4);
		}

		.section-icon {
			flex: none;
			display: grid;
			place-items: center;
			width: 40px;
			height: 40px;
			border-radius: 12px;
			background: var(--anubis-accent-soft);
			color: var(--anubis-accent-text);
		}

		.section[data-key='SANCTIONS_UNAPPLIED'] .section-icon,
		.section[data-key='PUBLICATION_FAILURES'] .section-icon {
			background: var(--anubis-danger-soft);
			color: var(--anubis-danger-text);
		}

		h2 {
			margin: 0;
			font-size: 1rem;
			font-weight: 600;
		}

		.count {
			margin-left: var(--space-2);
			padding: 1px 10px;
			border-radius: 999px;
			font-size: 0.8rem;
			font-variant-numeric: tabular-nums;
			background: var(--anubis-surface-2);
			color: var(--anubis-text-2);
		}

		.hint {
			margin: var(--space-1) 0 0;
			font-size: 0.85rem;
			color: var(--anubis-text-3);
		}

		.items {
			list-style: none;
			margin: 0 0 var(--space-3);
			padding: 0;

			li {
				display: flex;
				align-items: baseline;
				gap: var(--space-3);
				padding: var(--space-2) 0;
				border-top: 1px solid var(--anubis-border);
			}

			a {
				flex: 1;
				min-width: 0;
				display: flex;
				flex-direction: column;
				color: inherit;
				text-decoration: none;
			}

			a:hover .item-label {
				text-decoration: underline;
			}
		}

		.item-detail {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			font-size: 0.82rem;
			color: var(--anubis-text-3);
		}

		.item-at {
			flex: none;
			font-size: 0.8rem;
			color: var(--anubis-text-3);
		}

		.empty mat-card-content {
			display: flex;
			align-items: center;
			gap: var(--space-3);
			color: var(--anubis-text-2);

			p {
				margin: 0;
			}
		}
	`,
})
export class InboxPage {
	private readonly api = inject(InboxApi);

	readonly icons = ICONS;
	readonly loading = signal(true);
	readonly inbox = signal<InboxDto | null>(null);

	constructor() {
		this.load();
	}

	load(): void {
		this.loading.set(true);
		this.api.get().subscribe({
			next: (inbox) => {
				this.inbox.set(inbox);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
