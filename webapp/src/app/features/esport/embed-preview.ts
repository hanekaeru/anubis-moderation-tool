import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { EsportEmbed } from '@anubis/shared';
import { parseDiscordMarkdown, type DiscordSegment } from './discord-markdown';

/**
 * Apercu d'un message esport, sur le fond sombre de Discord dans les deux
 * themes du dashboard — meme choix que la page Messages : un apercu qui change
 * de couleur avec le theme mentirait sur ce que verra le serveur.
 *
 * Un message peut porter plusieurs embeds (un par region), empiles comme
 * Discord les affiche. Les spoilers se devoilent au clic, comme dans Discord.
 */
@Component({
	selector: 'app-esport-embed-preview',
	imports: [NgTemplateOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<ng-template #segments let-items>
			@for (segment of items; track $index) {
				@switch (segment.kind) {
					@case ('text') {<span class="text">{{ segment.text }}</span>}
					@case ('bold') {<strong><ng-container *ngTemplateOutlet="segments; context: { $implicit: segment.children }" /></strong>}
					@case ('italic') {<em><ng-container *ngTemplateOutlet="segments; context: { $implicit: segment.children }" /></em>}
					@case ('spoiler') {<span class="spoiler" role="button" tabindex="0" title="Spoiler : cliquer pour afficher" (click)="reveal($event)" (keydown.enter)="reveal($event)"><ng-container *ngTemplateOutlet="segments; context: { $implicit: segment.children }" /></span>}
					@case ('link') {<a [href]="segment.url" target="_blank" rel="noopener">{{ segment.text }}</a>}
					@case ('time') {<span class="time">{{ segment.text }}</span>}
					@case ('emoji') {<img class="emoji" [src]="segment.url" [alt]="':' + segment.name + ':'" />}
					@case ('mention') {<span class="mention">{{ segment.text }}</span>}
				}
			}
		</ng-template>

		<div class="discord">
			@if (content()) {
				<p class="content">
					<ng-container *ngTemplateOutlet="segments; context: { $implicit: contentSegments() }" />
				</p>
			}

			@for (embed of views(); track $index) {
				<div class="embed" [style.border-left-color]="embed.color">
					<div class="body">
						<div class="text-block">
							@if (embed.author) {
								<p class="author">{{ embed.author }}</p>
							}
							<p class="title">{{ embed.title }}</p>

							@if (embed.description.length) {
								<p class="description">
									<ng-container *ngTemplateOutlet="segments; context: { $implicit: embed.description }" />
								</p>
							}

							@for (field of embed.fields; track $index) {
								<div class="field">
									<p class="field-name">{{ field.name }}</p>
									<p class="field-value">
										<ng-container *ngTemplateOutlet="segments; context: { $implicit: field.segments }" />
									</p>
								</div>
							}
						</div>

						@if (embed.thumbnail; as thumbnail) {
							<img class="thumbnail" [src]="thumbnail" alt="" />
						}
					</div>

					@if (embed.footer; as footer) {
						<p class="footer">{{ footer }}</p>
					}
				</div>
			}
		</div>
	`,
	styles: `
		.discord {
			display: flex;
			flex-direction: column;
			gap: 8px;
			padding: 12px;
			border-radius: 12px;
			background: #313338;
			color: #dbdee1;
			font-size: 0.875rem;
			line-height: 1.45;
		}

		.content {
			margin: 0;
		}

		.embed {
			max-width: 520px;
			padding: 12px 16px 12px 12px;
			border-left: 4px solid #5865f2;
			border-radius: 4px;
			background: #2b2d31;
		}

		.body {
			display: flex;
			gap: 12px;
			align-items: flex-start;
		}

		.text-block {
			flex: 1;
			min-width: 0;
		}

		p {
			margin: 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}

		.author {
			margin-bottom: 4px;
			font-size: 0.8rem;
			font-weight: 600;
			color: #f2f3f5;
		}

		.title {
			margin-bottom: 8px;
			font-weight: 600;
			color: #f2f3f5;
		}

		.field {
			margin-top: 10px;
		}

		.field-name {
			font-size: 0.8rem;
			font-weight: 600;
			color: #f2f3f5;
		}

		.field-value {
			margin-top: 2px;
		}

		.footer {
			margin-top: 10px;
			font-size: 0.75rem;
			color: #b5bac1;
		}

		.thumbnail {
			width: 80px;
			height: 80px;
			border-radius: 8px;
			object-fit: cover;
			flex-shrink: 0;
		}

		strong {
			color: #f2f3f5;
		}

		a {
			color: #00a8fc;
			text-decoration: none;
		}

		.time {
			padding: 0 2px;
			border-radius: 3px;
			background: rgba(255, 255, 255, 0.06);
		}

		.mention {
			padding: 0 2px;
			border-radius: 3px;
			background: rgba(88, 101, 242, 0.3);
			color: #c9cdfb;
		}

		.emoji {
			width: 1.25em;
			height: 1.25em;
			vertical-align: -0.3em;
			object-fit: contain;
		}

		/* Spoiler : contenu masque jusqu'au clic, comme dans Discord. */
		.spoiler {
			border-radius: 3px;
			background: #1e1f22;
			color: transparent;
			cursor: pointer;

			* {
				color: transparent;
			}
		}

		.spoiler.revealed {
			background: rgba(255, 255, 255, 0.1);
			color: inherit;
			cursor: auto;

			* {
				color: inherit;
			}
		}
	`,
})
export class EsportEmbedPreview {
	readonly embeds = input.required<readonly EsportEmbed[]>();
	/** Texte hors embed (mention de role), tel qu'il sera envoye. */
	readonly content = input<string | null>(null);

	readonly contentSegments = computed(() => parseDiscordMarkdown(this.content() ?? ''));

	readonly views = computed(() =>
		this.embeds().map((embed) => ({
			author: embed.author?.name ?? null,
			title: embed.title,
			color: `#${embed.color.toString(16).padStart(6, '0')}`,
			description: parseDiscordMarkdown(embed.description ?? '') as DiscordSegment[],
			fields: embed.fields.map((field) => ({
				name: field.name,
				segments: parseDiscordMarkdown(field.value) as DiscordSegment[],
			})),
			thumbnail: embed.thumbnail?.url ?? null,
			footer: embed.footer?.text ?? null,
		})),
	);

	reveal(event: Event): void {
		(event.currentTarget as HTMLElement).classList.add('revealed');
	}
}
