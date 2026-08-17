import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { LOG_CHANNEL_LABELS, Permission, type GuildConfigDto } from '@anubis/shared';
import { GuildConfigApi } from '../../../core/api/guild-config.api';
import { NotificationService } from '../../../core/notification.service';
import { ConfirmDialog, type ConfirmDialogData } from '../../../shared/components/confirm-dialog';
import { HasPermissionDirective } from '../../../shared/directives/has-permission.directive';
import { LogConfigDialog } from './log-config-dialog';

/** `config_name` connus : on sait qu'ils portent un identifiant de salon. */
const CHANNEL_KEYS: Record<string, string> = LOG_CHANNEL_LABELS;

@Component({
	selector: 'app-logs',
	imports: [
		HasPermissionDirective,
		MatButtonModule,
		MatCardModule,
		MatIconModule,
		MatMenuModule,
		MatProgressBarModule,
		MatTableModule,
		MatTooltipModule,
	],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './logs.html',
	styleUrl: './logs.scss',
})
export class LogsPage {
	private readonly guildConfigApi = inject(GuildConfigApi);
	private readonly dialog = inject(MatDialog);
	private readonly notifications = inject(NotificationService);

	readonly Permission = Permission;
	readonly columns = ['name', 'value', 'description', 'actions'];

	readonly loading = signal(false);
	readonly configs = signal<GuildConfigDto[]>([]);

	constructor() {
		this.load();
	}

	label(config: GuildConfigDto): string {
		return CHANNEL_KEYS[config.configName] ?? config.configName;
	}

	/** Lien direct vers le salon si `configName` est une cle de salon connue. */
	channelLink(config: GuildConfigDto): string | null {
		if (!(config.configName in CHANNEL_KEYS)) return null;
		return `https://discord.com/channels/${config.guildId}/${config.configValue}`;
	}

	openCreateDialog(): void {
		this.dialog
			.open(LogConfigDialog)
			.afterClosed()
			.subscribe((saved) => {
				if (saved) this.load();
			});
	}

	openEditDialog(config: GuildConfigDto): void {
		this.dialog
			.open(LogConfigDialog, { data: config })
			.afterClosed()
			.subscribe((saved) => {
				if (saved) this.load();
			});
	}

	remove(config: GuildConfigDto): void {
		const data: ConfirmDialogData = {
			title: 'Supprimer cette configuration',
			message: `"${this.label(config)}" sera supprimée. Si c'est un salon de logs, il ne sera plus alimenté tant qu'une nouvelle configuration n'est pas créée.`,
			confirmLabel: 'Supprimer',
			destructive: true,
		};

		this.dialog
			.open(ConfirmDialog, { data })
			.afterClosed()
			.subscribe((confirmed) => {
				if (confirmed !== true) return;

				this.guildConfigApi.delete(config.id).subscribe({
					next: () => {
						this.notifications.success('Configuration supprimée.');
						this.load();
					},
				});
			});
	}

	private load(): void {
		this.loading.set(true);

		this.guildConfigApi.list().subscribe({
			next: (configs) => {
				this.configs.set(configs);
				this.loading.set(false);
			},
			error: () => this.loading.set(false),
		});
	}
}
