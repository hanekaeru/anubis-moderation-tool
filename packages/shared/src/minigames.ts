/**
 * Mini-jeux du calendrier : un jeu par jour et par serveur.
 *
 * Les regles vivent ici parce que trois programmes doivent s'accorder sur
 * elles : l'API verrouille la veille a 23:59 et refuse un jeu incomplet, le bot
 * publie, juge les reponses et verse l'experience, le dashboard previsualise.
 * Une regle recopiee finirait par diverger — un membre verrait sa reponse
 * acceptee par l'un et refusee par l'autre.
 */

import { MinigameType } from "./enums";
import { addDaysToKey, zonedDateKey, zonedWallTimeToUtc } from "./timezone";

/** Les journees de jeu commencent a minuit, heure de Paris, pour tout le monde. */
export const MINIGAME_TIME_ZONE = "Europe/Paris";

export const MINIGAME_TYPES = Object.values(MinigameType);

export const MINIGAME_TYPE_LABELS: Record<MinigameType, string> = {
	CLIP: "Meilleur clip",
	GUESS_HERO: "Devine le héros",
	DUEL: "Duel",
	GUESS_MAP: "Devine la map",
	TRUE_FALSE: "Vrai ou faux patch-note ?",
	GUESS_SKIN: "Devine le skin",
};

export const MINIGAME_TYPE_EMOJIS: Record<MinigameType, string> = {
	CLIP: "🎬",
	GUESS_HERO: "🦸",
	DUEL: "⚔️",
	GUESS_MAP: "🗺️",
	TRUE_FALSE: "📜",
	GUESS_SKIN: "🎭",
};

/** Jeux qui se jouent par `/devine`, avec essais et bareme. */
export const MINIGAME_GUESS_TYPES: readonly MinigameType[] = [
	MinigameType.GUESS_HERO,
	MinigameType.GUESS_MAP,
	MinigameType.GUESS_SKIN,
];

/** Jeux qui portent un sondage Discord, dans un message a part. */
export const MINIGAME_POLL_TYPES: readonly MinigameType[] = [
	MinigameType.DUEL,
	MinigameType.TRUE_FALSE,
];

export function isGuessMinigame(type: MinigameType): boolean {
	return MINIGAME_GUESS_TYPES.includes(type);
}

export function isPollMinigame(type: MinigameType): boolean {
	return MINIGAME_POLL_TYPES.includes(type);
}

// ---------------------------------------------------------------------------
// Calendrier
// ---------------------------------------------------------------------------

/** Jour de jeu auquel appartient un instant. */
export function minigameDayKey(instant: Date): string {
	return zonedDateKey(instant, MINIGAME_TIME_ZONE);
}

/** Instant d'ouverture d'un jour de jeu (minuit, heure de Paris). */
export function minigameDayStart(dayKey: string): Date {
	return zonedWallTimeToUtc(dayKey, "00:00", MINIGAME_TIME_ZONE);
}

/**
 * Instant de fermeture : minuit du lendemain. Le jeu se joue donc de 00:00 a
 * 23:59:59 ; une reponse envoyee a minuit pile compte deja pour le jour suivant.
 */
export function minigameDayEnd(dayKey: string): Date {
	return minigameDayStart(addDaysToKey(dayKey, 1));
}

/**
 * Le jeu du jour J ne se modifie plus, sauf par un administrateur, des que le
 * jour J a commence : c'est la « veille 23:59 » du proprietaire. Le jour meme
 * et le passe sont donc verrouilles.
 */
export function isMinigameDayLocked(dayKey: string, now: Date = new Date()): boolean {
	return dayKey <= minigameDayKey(now);
}

/** Instant du ping d'un jour, `pingTime` etant « HH:MM » a l'heure de Paris. */
export function minigamePingInstant(dayKey: string, pingTime: string): Date {
	return zonedWallTimeToUtc(dayKey, pingTime, MINIGAME_TIME_ZONE);
}

/**
 * Duree a donner au sondage, en heures entieres comme Discord l'exige.
 *
 * Arrondie au-dessus : le sondage ne doit jamais se fermer avant le jeu. Le bot
 * le termine lui-meme a la fermeture, l'eventuel reliquat ne joue donc pas.
 */
export function minigamePollHours(now: Date, end: Date): number {
	const heures = Math.ceil((end.getTime() - now.getTime()) / 3_600_000);
	return Math.min(768, Math.max(1, heures));
}

// ---------------------------------------------------------------------------
// Reglage par defaut
// ---------------------------------------------------------------------------

/**
 * Semaine type, lundi en premier : celle que le proprietaire a decrite. Elle ne
 * cree rien, elle pre-remplit le type d'un jour qu'on ouvre dans le calendrier.
 */
export const MINIGAME_DEFAULT_WEEK: readonly (MinigameType | null)[] = [
	MinigameType.CLIP,
	MinigameType.GUESS_HERO,
	MinigameType.DUEL,
	MinigameType.GUESS_MAP,
	MinigameType.TRUE_FALSE,
	MinigameType.GUESS_SKIN,
	null,
];

/**
 * Lit la semaine type stockee (sept chaines, vide = aucun jeu). Une valeur
 * inconnue ou une liste trop courte retombe sur « aucun » plutot que de faire
 * echouer la page.
 */
export function parseMinigameWeek(raw: readonly string[] | null | undefined): (MinigameType | null)[] {
	const source = raw ?? [];
	return Array.from({ length: 7 }, (_, i) => {
		const value = source[i];
		return value && (MINIGAME_TYPES as readonly string[]).includes(value) ? (value as MinigameType) : null;
	});
}

export const MINIGAME_DEFAULT_PING_TIME = "09:00";
export const MINIGAME_DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_MINIGAME_ATTEMPTS = 10;

/**
 * Baremes par defaut, indexes par le nombre d'essais. Un message rapporte
 * de 15 a 25 XP : trouver du premier coup vaut quelques messages, comme
 * l'OWdle. Le skin est plus dur, il paie un peu plus. Memes valeurs que les
 * defauts des colonnes de `minigame_config`.
 */
export const MINIGAME_DEFAULT_XP: Readonly<Record<"GUESS_HERO" | "GUESS_MAP" | "GUESS_SKIN", readonly number[]>> = {
	GUESS_HERO: [60, 40, 20],
	GUESS_MAP: [60, 40, 20],
	GUESS_SKIN: [80, 50, 30],
};
/** Une seule reponse a deux choix : la moitie des joueurs l'ont au hasard. */
export const MINIGAME_DEFAULT_TRUE_FALSE_XP = 15;
export const MAX_MINIGAME_XP_STEPS = 10;
export const MAX_MINIGAME_XP = 1000;

/** Part du bareme versee pour le bon heros sans le bon skin. */
export const MINIGAME_SKIN_HERO_SHARE = 0.5;

export const MINIGAME_DEFAULT_OUT_OF_ATTEMPTS_MESSAGE =
	"Tu as utilisé tous tes essais pour aujourd'hui. La réponse sera dévoilée ce soir à la fin du jeu — reviens demain pour le prochain !";

/** Couleur proposee par defaut, la meme que la page Messages. */
export const MINIGAME_DEFAULT_COLOR = 0x5865f2;

// ---------------------------------------------------------------------------
// Limites
// ---------------------------------------------------------------------------

export const MINIGAME_LIMITS = {
	title: 256,
	/** Sous les 4096 de Discord : l'embed garde de la marge pour le pied. */
	description: 4000,
	skin: 100,
	outOfAttemptsMessage: 1000,
	/** Limites des sondages Discord. */
	pollQuestion: 300,
	pollAnswer: 55,
	pollAnswersMin: 2,
	pollAnswersMax: 10,
} as const;

/**
 * Images d'un jeu. Quatre au plus : c'est ce que Discord affiche en galerie
 * sous un seul embed. Le plafond par fichier reste sous la limite d'envoi d'un
 * serveur sans boost.
 */
export const MAX_MINIGAME_IMAGES = 4;
export const MAX_MINIGAME_IMAGE_BYTES = 8 * 1024 * 1024;
export const MINIGAME_IMAGE_CONTENT_TYPES: readonly string[] = [
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
];

export const MINIGAME_TRUE_FALSE_ANSWERS = ["Vrai", "Faux"] as const;
export const MINIGAME_DEFAULT_POLL_QUESTIONS: Readonly<Record<"DUEL" | "TRUE_FALSE", string>> = {
	DUEL: "Qui l'emporte ?",
	TRUE_FALSE: "Vrai ou faux ?",
};

// ---------------------------------------------------------------------------
// Validation d'un jeu
// ---------------------------------------------------------------------------

export interface MinigameEventFields {
	type: MinigameType;
	title: string;
	description?: string | null;
	answerHeroKey?: string | null;
	answerMapKey?: string | null;
	answerSkin?: string | null;
	answerTrue?: boolean | null;
	pollQuestion?: string | null;
	pollAnswers?: readonly string[] | null;
}

/**
 * Ce qui manque pour qu'un jeu soit publiable, ou `null`.
 *
 * L'API refuse d'enregistrer un jeu incomplet : un jeu enregistre est donc
 * toujours pret, et le bot n'a jamais a decouvrir a minuit qu'il manque la
 * reponse. Le dashboard affiche le meme message avant l'envoi.
 */
export function minigameEventProblem(event: MinigameEventFields): string | null {
	if (!event.title?.trim()) return "Le titre est obligatoire.";
	if (event.title.length > MINIGAME_LIMITS.title) return `Le titre dépasse ${MINIGAME_LIMITS.title} caractères.`;
	if ((event.description?.length ?? 0) > MINIGAME_LIMITS.description) {
		return `Le texte dépasse ${MINIGAME_LIMITS.description} caractères.`;
	}

	switch (event.type) {
		case MinigameType.GUESS_HERO:
			if (!event.answerHeroKey) return "Choisis le héros à deviner.";
			break;
		case MinigameType.GUESS_MAP:
			if (!event.answerMapKey) return "Choisis la map à deviner.";
			break;
		case MinigameType.GUESS_SKIN:
			if (!event.answerSkin?.trim()) return "Indique le nom du skin.";
			if (event.answerSkin.length > MINIGAME_LIMITS.skin) return `Le nom du skin dépasse ${MINIGAME_LIMITS.skin} caractères.`;
			if (!event.answerHeroKey) return "Choisis le héros qui porte le skin.";
			break;
		case MinigameType.TRUE_FALSE:
			if (event.answerTrue === null || event.answerTrue === undefined) return "Indique si l'affirmation est vraie ou fausse.";
			break;
		case MinigameType.DUEL: {
			const answers = (event.pollAnswers ?? []).map((a) => a.trim()).filter(Boolean);
			if (answers.length < MINIGAME_LIMITS.pollAnswersMin) return "Un duel demande au moins deux réponses au sondage.";
			if (answers.length > MINIGAME_LIMITS.pollAnswersMax) return `Discord n'accepte que ${MINIGAME_LIMITS.pollAnswersMax} réponses par sondage.`;
			const longue = answers.find((a) => a.length > MINIGAME_LIMITS.pollAnswer);
			if (longue) return `« ${longue} » dépasse ${MINIGAME_LIMITS.pollAnswer} caractères, la limite de Discord.`;
			if (new Set(answers.map((a) => a.toLowerCase())).size !== answers.length) return "Deux réponses du sondage sont identiques.";
			break;
		}
		case MinigameType.CLIP:
			break;
	}

	if ((event.pollQuestion?.length ?? 0) > MINIGAME_LIMITS.pollQuestion) {
		return `La question du sondage dépasse ${MINIGAME_LIMITS.pollQuestion} caractères.`;
	}
	return null;
}

// ---------------------------------------------------------------------------
// Experience
// ---------------------------------------------------------------------------

/** Bareme d'un essai : la derniere valeur vaut pour tout essai au-dela. */
export function minigameXpForAttempt(table: readonly number[], attempt: number): number {
	if (!table.length || attempt < 1) return 0;
	return table[Math.min(attempt, table.length) - 1]!;
}

/**
 * Experience a verser pour une bonne reponse, compte tenu de ce qui l'a deja
 * ete.
 *
 * C'est la regle du **meilleur des deux** au jeu du skin : le heros seul au
 * premier essai vaut la moitie du premier palier ; trouver ensuite le skin
 * porte le total au palier de cet essai, sans jamais s'additionner au gain
 * precedent. Avec 100 / 60 / 30 : heros au 1er (50), skin au 2e (60 au total,
 * donc +10), skin au 3e (30 < 50, donc rien). Cumuler aurait permis de gagner
 * davantage en trouvant en deux temps qu'en trouvant d'emblee.
 */
export function minigameXpDelta(
	table: readonly number[],
	attempt: number,
	share: number,
	alreadyAwarded: number,
): number {
	const vise = Math.round(minigameXpForAttempt(table, attempt) * share);
	return Math.max(0, vise - alreadyAwarded);
}

// ---------------------------------------------------------------------------
// Comparaison des saisies libres
// ---------------------------------------------------------------------------

/** Minuscules sans accents, ponctuation remplacee par des espaces simples. */
export function normalizeMinigameText(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/** Distance d'edition (insertion, suppression, substitution). */
export function levenshtein(a: string, b: string): number {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;

	let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const courante = [i];
		for (let j = 1; j <= b.length; j++) {
			const cout = a[i - 1] === b[j - 1] ? 0 : 1;
			courante[j] = Math.min(precedente[j]! + 1, courante[j - 1]! + 1, precedente[j - 1]! + cout);
		}
		precedente = courante;
	}
	return precedente[b.length]!;
}

/**
 * Fautes tolerees selon la longueur de la reponse attendue.
 *
 * Aucune sur un nom court : « Ana » a une faute pres devient « Ane », « Ama »
 * ou « Ash » — tolerer reviendrait a accepter n'importe quoi de trois lettres.
 */
export function minigameTypoTolerance(length: number): number {
	if (length <= 4) return 0;
	if (length <= 8) return 1;
	if (length <= 14) return 2;
	return 3;
}

/** La saisie designe-t-elle la reponse, a quelques fautes de frappe pres ? */
export function matchesMinigameText(input: string, expected: string): boolean {
	const saisie = normalizeMinigameText(input);
	const attendu = normalizeMinigameText(expected);
	if (!saisie || !attendu) return false;

	// Sans les espaces aussi : « rat decale » et « ratdecale » valent « Rat de cale ».
	const compacteSaisie = saisie.replace(/ /g, "");
	const compacteAttendu = attendu.replace(/ /g, "");
	const tolerance = minigameTypoTolerance(compacteAttendu.length);

	return levenshtein(saisie, attendu) <= tolerance || levenshtein(compacteSaisie, compacteAttendu) <= tolerance;
}

export type SkinGuessVerdict = "SKIN" | "HERO" | "WRONG";

/**
 * Juge une proposition au jeu du skin.
 *
 * Le membre peut taper le skin seul (« rat de cale »), le skin et le heros
 * (« Rat de cale - Chacal », « chacal rat de cale ») ou le heros seul
 * (« chacal »). Le skin l'emporte des qu'il est reconnu, heros present ou non.
 * `heroNames` porte le nom affiche du heros attendu, et eventuellement d'autres
 * graphies (sa cle).
 */
export function judgeSkinGuess(input: string, skin: string, heroNames: readonly string[]): SkinGuessVerdict {
	const saisie = normalizeMinigameText(input);
	if (!saisie) return "WRONG";

	const candidats = new Set<string>([saisie]);
	// Morceaux separes par une ponctuation : « rat de cale - chacal ».
	for (const morceau of input.split(/\s[-–—/|]\s|[,;()]/)) {
		const n = normalizeMinigameText(morceau);
		if (n) candidats.add(n);
	}
	// Le nom du heros retire de la saisie : « chacal rat de cale ».
	for (const nom of heroNames) {
		const n = normalizeMinigameText(nom);
		if (!n) continue;
		const reste = ` ${saisie} `.replace(` ${n} `, " ").trim();
		if (reste && reste !== saisie) candidats.add(reste);
	}

	for (const candidat of candidats) {
		if (matchesMinigameText(candidat, skin)) return "SKIN";
	}
	for (const candidat of candidats) {
		if (heroNames.some((nom) => matchesMinigameText(candidat, nom))) return "HERO";
	}
	return "WRONG";
}

// ---------------------------------------------------------------------------
// Textes publies
// ---------------------------------------------------------------------------

/** Reponse telle qu'annoncee : « Rat de cale - Chacal », « Vrai »… */
export function minigameAnswerLabel(
	event: Pick<MinigameEventFields, "type" | "answerSkin" | "answerTrue">,
	heroName: string | null,
	mapName: string | null,
): string | null {
	switch (event.type) {
		case MinigameType.GUESS_HERO:
			return heroName;
		case MinigameType.GUESS_MAP:
			return mapName;
		case MinigameType.GUESS_SKIN:
			return event.answerSkin ? `${event.answerSkin}${heroName ? ` - ${heroName}` : ""}` : null;
		case MinigameType.TRUE_FALSE:
			return event.answerTrue === null || event.answerTrue === undefined
				? null
				: MINIGAME_TRUE_FALSE_ANSWERS[event.answerTrue ? 0 : 1];
		default:
			return null;
	}
}

export interface MinigameEndSummary {
	type: MinigameType;
	answer: string | null;
	/** Reponse complete trouvee (ou bonne reponse au vrai ou faux). */
	solved: number;
	/** Jeu du skin : heros trouve sans le skin. */
	heroOnly: number;
	/** Membres ayant joue au moins une fois. */
	participants: number;
}

/**
 * Annonce de fin, publiee sans ping a la fermeture. `null` pour les jeux qui
 * n'en ont pas : le duel a deja son resultat dans le sondage, le clip court
 * jusqu'au suivant.
 */
export function renderMinigameEndAnnouncement(summary: MinigameEndSummary): string | null {
	const titre = `${MINIGAME_TYPE_EMOJIS[summary.type]} **Fin du mini-jeu « ${MINIGAME_TYPE_LABELS[summary.type]} »**`;

	if (summary.type === MinigameType.TRUE_FALSE) {
		const bonnes =
			summary.solved === 0
				? "Personne n'a trouvé."
				: summary.solved === 1
					? "1 bonne réponse !"
					: `${summary.solved} bonnes réponses !`;
		return `${titre}\nC'était **${summary.answer ?? "?"}** ! ${bonnes}`;
	}
	if (!isGuessMinigame(summary.type)) return null;

	const heroSeul = summary.type === MinigameType.GUESS_SKIN ? summary.heroOnly : 0;
	let bilan: string;
	if (summary.solved === 0) {
		bilan = heroSeul
			? `Personne n'a trouvé le skin, mais ${heroSeul === 1 ? "1 membre a trouvé" : `${heroSeul} membres ont trouvé`} le héros.`
			: summary.participants
				? "Personne n'a trouvé."
				: "Personne n'a joué.";
	} else {
		bilan = summary.solved === 1 ? "1 membre a trouvé !" : `${summary.solved} membres ont trouvé !`;
		if (heroSeul) {
			bilan += ` ${heroSeul === 1 ? "1 autre n'a trouvé" : `${heroSeul} autres n'ont trouvé`} que le héros.`;
		}
	}
	return `${titre}\nC'était **${summary.answer ?? "?"}** ! ${bilan}`;
}
