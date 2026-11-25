import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import {
	MINIGAME_DEFAULT_POLL_QUESTIONS,
	MINIGAME_TRUE_FALSE_ANSWERS,
	MINIGAME_TYPE_EMOJIS,
	MINIGAME_TYPE_LABELS,
	MinigameType,
	isGuessMinigame,
	isPollMinigame,
} from '@anubis/shared';
import { parseDiscordMarkdown } from '../esport/discord-markdown';

export interface MinigamePreviewData {
	type: MinigameType;
	title: string;
	description: string;
	color: number;
	maxAttempts: number;
	playChannelLabel: string | null;
	pollQuestion: string;
	pollAnswers: string[];
	/** Adresses locales (blob:) des images, dans l'ordre. */
	images: string[];
}

/**
 * Apercu de la publication du jour, sur le fond sombre de Discord dans les deux
 * themes du dashboard — meme choix que la page Messages : un apercu qui change
 * de couleur avec le theme mentirait sur ce que verra le serveur.
 *
 * Reproduit ce que `minigameSync.ts` envoie : l'embed, sa galerie (jusqu'a
 * quatre images), le champ « Comment jouer », puis le sondage dans son propre
 * message.
 */
@Component({
	selector: 'app-minigame-preview',
	imports: [NgTemplateOutlet],
	changeDetection: ChangeDetectionStrategy.OnPush,
	template: `
		<ng-template #segments let-items>
			@for (segment of items; track $index) {
				@switch (segment.kind) {
					@case ('bold') {<strong><ng-container *ngTemplateOutlet="segments; context: { $implicit: segment.children }" /></strong>}
					@case ('italic') {<em><ng-container *ngTemplateOutlet="segments; context: { $implicit: segment.children }" /></em>}
					@case ('spoiler') {<span class="spoiler"><ng-container *ngTemplateOutlet="segments; context: { $implicit: segment.children }" /></span>}
					@case ('link') {<a [href]="segment.url" target="_blank" rel="noopener">{{ segment.text }}</a>}
					@case ('emoji') {<img class="emoji" [src]="segment.url" [alt]="':' + segment.name + ':'" />}
					@default {<span>{{ segment.text }}</span>}
				}
			}
		</ng-template>

		@let d = data();
		<div class="discord">
			<div class="embed" [style.border-left-color]="color()">
				<p class="title">{{ d.title || 'Titre du mini-jeu' }}</p>
				@if (d.description) {
					<p class="description">
						<ng-container *ngTemplateOutlet="segments; context: { $implicit: description() }" />
					</p>
				}
				@if (howTo(); as text) {
					<div class="field">
						<p class="field-name">Comment jouer</p>
						<p>{{ text }}</p>
					</div>
				}
				@if (d.images.length) {
					<div class="gallery" [class.single]="d.images.length === 1">
						@for (src of d.images; track src) {
							<img [src]="src" alt="" />
						}
					</div>
				}
				<p class="footer">{{ footer() }}</p>
			</div>

			@if (poll(); as p) {
				<div class="poll">
					<p class="poll-question">{{ p.question }}</p>
					@for (answer of p.answers; track $index) {
						<p class="poll-answer">{{ answer }}</p>
					}
					<p class="poll-meta">Sondage · se ferme à 23h59</p>
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

		.embed {
			max-width: 520px;
			padding: 12px 16px 12px 12px;
			border-left: 4px solid #5865f2;
			border-radius: 4px;
			background: #2b2d31;
		}

		p {
			margin: 0;
			white-space: pre-wrap;
			overflow-wrap: anywhere;
		}

		.title {
			margin-bottom: 8px;
			font-weight: 600;
			color: #00a8fc;
		}

		.field {
			margin-top: 10px;
		}

		.field-name {
			font-size: 0.8rem;
			font-weight: 600;
			color: #f2f3f5;
		}

		.gallery {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 4px;
			margin-top: 12px;

			img {
				width: 100%;
				aspect-ratio: 16 / 10;
				object-fit: cover;
				border-radius: 4px;
			}
		}

		.gallery.single {
			grid-template-columns: 1fr;

			img {
				aspect-ratio: auto;
				max-height: 300px;
				object-fit: contain;
			}
		}

		.footer {
			margin-top: 10px;
			font-size: 0.75rem;
			color: #b5bac1;
		}

		.poll {
			max-width: 520px;
			padding: 12px;
			border-radius: 8px;
			background: #2b2d31;
		}

		.poll-question {
			margin-bottom: 8px;
			font-weight: 600;
			color: #f2f3f5;
		}

		.poll-answer {
			margin-top: 6px;
			padding: 8px 10px;
			border-radius: 6px;
			background: #383a40;
		}

		.poll-meta {
			margin-top: 8px;
			font-size: 0.75rem;
			color: #b5bac1;
		}

		strong {
			color: #f2f3f5;
		}

		a {
			color: #00a8fc;
			text-decoration: none;
		}

		.spoiler {
			border-radius: 3px;
			background: #1e1f22;
			color: transparent;
		}

		.emoji {
			width: 1.25em;
			height: 1.25em;
			vertical-align: -0.3em;
		}
	`,
})
export class MinigamePreview {
	readonly data = input.required<MinigamePreviewData>();

	readonly color = computed(() => `#${this.data().color.toString(16).padStart(6, '0')}`);
	readonly description = computed(() => parseDiscordMarkdown(this.data().description));
	readonly footer = computed(() => {
		const type = this.data().type;
		return `${MINIGAME_TYPE_EMOJIS[type]} ${MINIGAME_TYPE_LABELS[type]} · jusqu'à 23h59`;
	});

	readonly howTo = computed(() => {
		const d = this.data();
		if (isGuessMinigame(d.type)) {
			const ou = d.playChannelLabel ? ` dans ${d.playChannelLabel}` : '';
			return `Propose ta réponse avec /devine${ou} — ${d.maxAttempts} essai${d.maxAttempts > 1 ? 's' : ''}.`;
		}
		if (isPollMinigame(d.type)) return 'Vote dans le sondage juste en dessous ⬇️';
		return null;
	});

	readonly poll = computed(() => {
		const d = this.data();
		if (d.type === MinigameType.TRUE_FALSE) {
			return {
				question: d.pollQuestion || MINIGAME_DEFAULT_POLL_QUESTIONS.TRUE_FALSE,
				answers: [`✅ ${MINIGAME_TRUE_FALSE_ANSWERS[0]}`, `❌ ${MINIGAME_TRUE_FALSE_ANSWERS[1]}`],
			};
		}
		if (d.type === MinigameType.DUEL) {
			return {
				question: d.pollQuestion || MINIGAME_DEFAULT_POLL_QUESTIONS.DUEL,
				answers: d.pollAnswers.length ? d.pollAnswers : ['Réponse 1', 'Réponse 2'],
			};
		}
		return null;
	});
}
