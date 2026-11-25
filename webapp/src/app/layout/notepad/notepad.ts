import {
	CdkConnectedOverlay,
	CdkOverlayOrigin,
	type ConnectedPosition,
} from '@angular/cdk/overlay';
import {
	ChangeDetectionStrategy,
	Component,
	type ElementRef,
	type OnDestroy,
	computed,
	input,
	linkedSignal,
	signal,
	viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

/** Une page de notes, pas un document : au-dela, c'est le wiki qu'il faut. */
export const NOTEPAD_MAX_LENGTH = 20_000;

const SAVE_DELAY_MS = 400;

const storageKey = (userId: string) => `anubis-notes:${userId}`;

function readNotes(userId: string): string {
	try {
		return localStorage.getItem(storageKey(userId)) ?? '';
	} catch {
		return '';
	}
}

function writeNotes(userId: string, text: string): boolean {
	try {
		if (text) localStorage.setItem(storageKey(userId), text);
		else localStorage.removeItem(storageKey(userId));
		return true;
	} catch {
		return false;
	}
}

type SaveState = 'saved' | 'pending' | 'error';

/**
 * Bloc-notes personnel, ouvert depuis le bas de la barre laterale.
 *
 * Les notes vivent **dans ce navigateur**, sous une cle propre au compte :
 * deux comptes sur le meme poste ne lisent pas les notes l'un de l'autre dans
 * l'interface, et rien ne part au serveur. La contrepartie est assumee et dite
 * dans le panneau : les notes ne suivent pas le compte sur un autre appareil,
 * et ne sont pas chiffrees — quiconque ouvre les outils du navigateur les lit.
 * La deconnexion ne les efface pas : retrouver ses notes en revenant est tout
 * l'interet d'un bloc-notes.
 */
@Component({
	selector: 'app-notepad',
	imports: [CdkConnectedOverlay, CdkOverlayOrigin, MatButtonModule, MatIconModule, MatTooltipModule],
	changeDetection: ChangeDetectionStrategy.OnPush,
	templateUrl: './notepad.html',
	styleUrl: './notepad.scss',
})
export class Notepad implements OnDestroy {
	readonly userId = input.required<string>();
	/** Barre repliee ou bouton flottant : seule la pastille s'affiche. */
	readonly compact = input(false);
	/** Bouton flottant du telephone, plutot que pied de barre laterale. */
	readonly floating = input(false);

	readonly maxLength = NOTEPAD_MAX_LENGTH;
	readonly open = signal(false);
	/** Relu a chaque changement de compte, sans rechargement de la page. */
	readonly text = linkedSignal(() => readNotes(this.userId()));
	readonly state = signal<SaveState>('saved');
	readonly hasNotes = computed(() => this.text().trim().length > 0);

	private readonly origin = viewChild.required(CdkOverlayOrigin);
	private readonly area = viewChild<ElementRef<HTMLTextAreaElement>>('area');

	private timer: ReturnType<typeof setTimeout> | null = null;
	private pending: (() => void) | null = null;

	/**
	 * A droite du bouton quand la barre laterale laisse la place, au-dessus
	 * sinon (telephone, fenetre etroite).
	 */
	readonly positions: ConnectedPosition[] = [
		{ originX: 'end', originY: 'bottom', overlayX: 'start', overlayY: 'bottom', offsetX: 12 },
		{ originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -12 },
	];

	toggle(): void {
		if (this.open()) this.close();
		else this.open.set(true);
	}

	close(): void {
		this.flush();
		this.open.set(false);
	}

	onAttach(): void {
		// Le panneau vient d'etre insere : la zone de texte existe au tour suivant.
		setTimeout(() => {
			const area = this.area()?.nativeElement;
			if (!area) return;
			area.focus();
			area.setSelectionRange(area.value.length, area.value.length);
		});
	}

	/** Un clic sur le bouton lui-meme est gere par `toggle`, pas ici. */
	onOutsideClick(event: MouseEvent): void {
		const trigger = this.origin().elementRef.nativeElement as HTMLElement;
		if (event.target instanceof Node && trigger.contains(event.target)) return;
		this.close();
	}

	onKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		this.close();
		(this.origin().elementRef.nativeElement as HTMLElement).focus();
	}

	onInput(event: Event): void {
		const value = (event.target as HTMLTextAreaElement).value;
		this.text.set(value);
		this.schedule(this.userId(), value);
	}

	clear(): void {
		this.text.set('');
		this.schedule(this.userId(), '');
		this.flush();
		this.area()?.nativeElement.focus();
	}

	ngOnDestroy(): void {
		this.flush();
	}

	/**
	 * L'enregistrement attend une courte pause dans la frappe, mais retient le
	 * compte au moment de la saisie : une deconnexion dans l'intervalle ne doit
	 * pas ecrire les notes de l'un sous la cle de l'autre.
	 */
	private schedule(userId: string, value: string): void {
		this.state.set('pending');
		if (this.timer) clearTimeout(this.timer);
		this.pending = () => this.state.set(writeNotes(userId, value) ? 'saved' : 'error');
		this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
	}

	private flush(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		const pending = this.pending;
		this.pending = null;
		pending?.();
	}
}
