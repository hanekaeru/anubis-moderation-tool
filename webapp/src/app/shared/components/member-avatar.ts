import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Avatar + identite d'un membre, presentation identique partout. */
@Component({
	selector: 'app-member-avatar',
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<div class="member">
			<img
				[src]="avatarUrl()"
				[alt]="'Avatar de ' + username()"
				[width]="size()"
				[height]="size()"
				loading="lazy"
			/>
			@if (showName()) {
				<span class="names">
					<span class="primary">{{ displayName() }}</span>
					@if (globalName()) {
						<span class="secondary">{{ username() }}</span>
					}
				</span>
			}
		</div>
	`,
	styles: `
		.member {
			display: flex;
			align-items: center;
			gap: 10px;
			min-width: 0;
		}

		img {
			border-radius: 50%;
			flex: none;
			background: var(--mat-sys-surface-variant);
			object-fit: cover;
		}

		.names {
			display: flex;
			flex-direction: column;
			min-width: 0;
			line-height: 1.25;
		}

		.primary,
		.secondary {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.secondary {
			font-size: 0.78rem;
			color: var(--mat-sys-on-surface-variant);
		}
	`,
})
export class MemberAvatar {
	readonly username = input.required<string>();
	readonly globalName = input<string | null>(null);
	readonly avatarUrl = input.required<string | null>();
	readonly size = input(32);
	readonly showName = input(true);

	/** Le nom global prime, comme dans le client Discord. */
	readonly displayName = computed(() => this.globalName() ?? this.username());
}
