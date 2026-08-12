import type { Prisma } from "@anubis/shared/prisma";
import prisma from "../prisma";

/**
 * Casier d'un membre : sanctions, avertissements et notes reunis.
 *
 * Les trois sources vivent dans des tables differentes, sans cle commune. Elles
 * sont donc lues separement puis fusionnees en memoire et triees par date —
 * comme le fait `MembersService.timeline` cote API, et pour la meme raison : un
 * UNION SQL couterait ici en lisibilite ce qu'il ferait gagner.
 */

/**
 * Plafond par source. Un casier reel depasse rarement quelques dizaines
 * d'entrees ; la borne evite qu'un cas pathologique ne fasse remonter des
 * milliers de lignes pour n'en afficher que dix.
 */
const LIMITE_PAR_SOURCE = 200;

const SANCTION_INCLUDE = {
	moderator: true,
	createdBy: true,
	revokedBy: true,
} satisfies Prisma.SanctionInclude;

const WARNING_INCLUDE = {
	moderator: true,
	createdBy: true,
	revokedBy: true,
} satisfies Prisma.WarningInclude;

const NOTE_INCLUDE = { author: true } satisfies Prisma.MemberNoteInclude;

export type SanctionRow = Prisma.SanctionGetPayload<{
	include: typeof SANCTION_INCLUDE;
}>;
export type WarningRow = Prisma.WarningGetPayload<{
	include: typeof WARNING_INCLUDE;
}>;
export type NoteRow = Prisma.MemberNoteGetPayload<{
	include: typeof NOTE_INCLUDE;
}>;

/** Une entree du casier, discriminee par `kind` pour l'affichage. */
export type CasierEntry =
	| { kind: "SANCTION"; occurredAt: Date; data: SanctionRow }
	| { kind: "WARNING"; occurredAt: Date; data: WarningRow }
	| { kind: "NOTE"; occurredAt: Date; data: NoteRow };

export interface Casier {
	entries: CasierEntry[];
	counts: { sanctions: number; warnings: number; notes: number };
	/** Vrai si une source a atteint le plafond : l'affichage est incomplet. */
	truncated: boolean;
}

export async function fetchCasier(
	guildId: string,
	userId: string,
): Promise<Casier> {
	const [sanctions, warnings, notes] = await Promise.all([
		prisma.sanction.findMany({
			where: { guildId, userId },
			orderBy: { createdAt: "desc" },
			take: LIMITE_PAR_SOURCE,
			include: SANCTION_INCLUDE,
		}),
		prisma.warning.findMany({
			where: { guildId, userId },
			orderBy: { createdAt: "desc" },
			take: LIMITE_PAR_SOURCE,
			include: WARNING_INCLUDE,
		}),
		// Une note supprimee depuis le dashboard ne doit plus apparaitre :
		// la suppression y est logique, pas physique.
		prisma.memberNote.findMany({
			where: { guildId, userId, deletedAt: null },
			orderBy: { createdAt: "desc" },
			take: LIMITE_PAR_SOURCE,
			include: NOTE_INCLUDE,
		}),
	]);

	const entries: CasierEntry[] = [
		...sanctions.map((data): CasierEntry => ({
			kind: "SANCTION",
			occurredAt: data.createdAt,
			data,
		})),
		...warnings.map((data): CasierEntry => ({
			kind: "WARNING",
			occurredAt: data.createdAt,
			data,
		})),
		...notes.map((data): CasierEntry => ({
			kind: "NOTE",
			occurredAt: data.createdAt,
			data,
		})),
	];

	// Du plus recent au plus ancien : un moderateur ouvre un casier pour savoir
	// ce qui vient de se passer, pas pour relire le premier avertissement.
	entries.sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());

	return {
		entries,
		counts: {
			sanctions: sanctions.length,
			warnings: warnings.length,
			notes: notes.length,
		},
		truncated: [sanctions, warnings, notes].some(
			(source) => source.length === LIMITE_PAR_SOURCE,
		),
	};
}
