import type { IsoDateString } from "./common";

/**
 * Boite « A traiter » : tout ce qui attend quelqu'un du staff, reuni sur une
 * page. Chaque section n'est calculee que si le compte a la permission de la
 * page qu'elle resume — sinon elle apprendrait l'existence de ce qu'il ne peut
 * pas voir, comme un intertitre de barre laterale sans entree dessous.
 */
export const InboxSectionKey = {
	ACCOUNT_FLAGS: "ACCOUNT_FLAGS",
	TICKETS: "TICKETS",
	QUARANTINE: "QUARANTINE",
	SANCTIONS_UNAPPLIED: "SANCTIONS_UNAPPLIED",
	ESPORT_SCORES: "ESPORT_SCORES",
	PUBLICATION_FAILURES: "PUBLICATION_FAILURES",
	MINIGAMES_PLANNING: "MINIGAMES_PLANNING",
} as const;
export type InboxSectionKey = (typeof InboxSectionKey)[keyof typeof InboxSectionKey];

export interface InboxItem {
	id: string;
	label: string;
	detail: string | null;
	at: IsoDateString | null;
	/** Route du dashboard ou traiter l'element. */
	link: string;
}

export interface InboxSection {
	key: InboxSectionKey;
	title: string;
	/** Une phrase : pourquoi c'est ici, et ce qu'on attend. */
	hint: string;
	/** Total reel ; `items` n'en montre que les premiers. */
	count: number;
	items: InboxItem[];
	/** Page qui liste tout. */
	link: string;
}

export interface InboxDto {
	/** Sections non vides seulement, de la plus urgente a la moins urgente. */
	sections: InboxSection[];
	total: number;
}

/** Elements montres par section : la page resume, elle ne remplace pas la liste. */
export const INBOX_ITEMS_PER_SECTION = 5;
