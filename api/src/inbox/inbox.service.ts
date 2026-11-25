import { Injectable } from "@nestjs/common";
import {
	ACCOUNT_FLAG_TYPE_LABELS,
	INBOX_ITEMS_PER_SECTION,
	InboxSectionKey,
	MINIGAME_TIME_ZONE,
	Permission,
	SANCTION_TYPE_LABELS,
	addDaysToKey,
	minigameDayKey,
	type InboxDto,
	type InboxItem,
	type InboxSection,
} from "@anubis/shared";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";

/** Une quarantaine plus courte n'est pas « bloquee » : l'arrivant lit le reglement. */
const QUARANTINE_BLOQUEE_MS = 24 * 3600_000;
/** Le bot applique une sanction web en quelques secondes ; au-dela, il ne tourne pas. */
const SANCTION_EN_RETARD_MS = 5 * 60_000;
/** Horizon du calendrier des mini-jeux a verifier. */
const JOURS_A_PLANIFIER = 7;

const N = INBOX_ITEMS_PER_SECTION;

type Pseudo = { username: string; globalName: string | null } | null | undefined;
const nom = (user: Pseudo, id: string) => user?.globalName ?? user?.username ?? id;

/**
 * Boite « A traiter ».
 *
 * Aucune permission propre : la page est ouverte a tout compte, et **chaque
 * section verifie celle de la page qu'elle resume**. Un compte d'animation n'y
 * voit donc que le calendrier des mini-jeux et l'esport, un moderateur en
 * lecture seule rien de ce qu'il ne pourrait pas ouvrir.
 *
 * Rien n'est stocke : tout se relit dans les tables qui portent deja l'etat
 * (signalement non examine, ticket sans premiere reponse…). Une ligne traitee
 * ailleurs disparait donc d'ici sans rien a synchroniser.
 */
@Injectable()
export class InboxService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
	) {}

	async forUser(actor: AuthenticatedUser, now = new Date()): Promise<InboxDto> {
		const peut = (permission: Permission) => actor.permissions.includes(permission);

		const sections = await Promise.all([
			peut(Permission.SANCTIONS_READ) ? this.sanctionsNonAppliquees(now) : null,
			peut(Permission.TICKETS_READ) ? this.tickets() : null,
			peut(Permission.ACCOUNT_FLAGS_READ) ? this.signalements() : null,
			peut(Permission.QUARANTINE_READ) ? this.quarantaines(now) : null,
			peut(Permission.ESPORT_WRITE) ? this.scoresEsport() : null,
			this.publicationsRefusees(actor),
			peut(Permission.MINIGAMES_WRITE) ? this.calendrierMiniJeux(now) : null,
		]);

		const pleines = sections.filter((s): s is InboxSection => s !== null && s.count > 0);
		return { sections: pleines, total: pleines.reduce((somme, s) => somme + s.count, 0) };
	}

	/**
	 * En tete : une sanction posee depuis le dashboard que le bot n'a pas
	 * appliquee apres plusieurs minutes dit que le bot ne tourne pas, ou qu'il
	 * lui manque une permission — le membre sanctionne, lui, ne l'est pas.
	 */
	private async sanctionsNonAppliquees(now: Date): Promise<InboxSection> {
		const where = {
			guildId: this.guild.guildId,
			isApplied: false,
			createdAt: { lt: new Date(now.getTime() - SANCTION_EN_RETARD_MS) },
		};
		const [count, rows] = await Promise.all([
			this.prisma.sanction.count({ where }),
			this.prisma.sanction.findMany({
				where,
				orderBy: { createdAt: "asc" },
				take: N,
				include: { user: { select: { username: true, globalName: true } } },
			}),
		]);
		return {
			key: InboxSectionKey.SANCTIONS_UNAPPLIED,
			title: "Sanctions pas appliquées sur Discord",
			hint: "Posées depuis le dashboard il y a plus de cinq minutes, le bot ne les a pas encore appliquées : vérifiez qu'il tourne et qu'il a les permissions nécessaires.",
			count,
			link: "/sanctions",
			items: rows.map((row) => ({
				id: row.id,
				label: `${SANCTION_TYPE_LABELS[row.type]} — ${nom(row.user, row.userId)}`,
				detail: row.reason,
				at: row.createdAt.toISOString(),
				link: `/membres/${row.userId}`,
			})),
		};
	}

	private async tickets(): Promise<InboxSection> {
		const where = {
			guildId: this.guild.guildId,
			status: "OPEN" as const,
			firstResponseAt: null,
		};
		const [count, rows] = await Promise.all([
			this.prisma.ticket.count({ where }),
			this.prisma.ticket.findMany({ where, orderBy: { openedAt: "asc" }, take: N }),
		]);
		return {
			key: InboxSectionKey.TICKETS,
			title: "Tickets sans réponse",
			hint: "Ouverts, et personne du staff n'a encore répondu ni pris le ticket en charge.",
			count,
			link: "/tickets",
			items: rows.map((row) => ({
				id: row.id,
				label: `#${row.number} — ${row.subject}`,
				detail: null,
				at: row.openedAt.toISOString(),
				link: `/tickets/${row.id}`,
			})),
		};
	}

	private async signalements(): Promise<InboxSection> {
		const where = { guildId: this.guild.guildId, reviewedAt: null };
		const [count, rows] = await Promise.all([
			this.prisma.accountFlag.count({ where }),
			this.prisma.accountFlag.findMany({
				where,
				orderBy: { createdAt: "desc" },
				take: N,
				include: { user: { select: { username: true, globalName: true } } },
			}),
		]);
		return {
			key: InboxSectionKey.ACCOUNT_FLAGS,
			title: "Comptes signalés à examiner",
			hint: "Signaux relevés à l'arrivée (compte récent, retour rapide, Battle.net déjà lié…). Rien n'a été sanctionné.",
			count,
			link: "/comptes-signales",
			items: rows.map((row) => ({
				id: row.id.toString(),
				label: nom(row.user, row.userId),
				detail: ACCOUNT_FLAG_TYPE_LABELS[row.type],
				at: row.createdAt.toISOString(),
				link: `/membres/${row.userId}`,
			})),
		};
	}

	/**
	 * Arrivants bloques depuis plus d'un jour. Meme filtre que
	 * `QuarantineService.listActive` pour « encore bloque », restreint a ceux
	 * qui attendent depuis assez longtemps pour que ce ne soit plus la lecture
	 * du reglement.
	 */
	private async quarantaines(now: Date): Promise<InboxSection> {
		const guildId = this.guild.guildId;
		const config = await this.prisma.quarantineConfig.findUnique({
			where: { guildId },
			select: { enabled: true, battlenetRequired: true },
		});
		if (!config?.enabled) return vide(InboxSectionKey.QUARANTINE);

		const where = {
			guildId,
			releasedAt: null,
			quarantinedAt: { lt: new Date(now.getTime() - QUARANTINE_BLOQUEE_MS) },
			OR: config.battlenetRequired
				? [{ acceptedAt: null }, { battlenetVerifiedAt: null }]
				: [{ acceptedAt: null }],
			user: { memberships: { none: { guildId, status: { in: ["LEFT" as const, "BANNED" as const] } } } },
		};
		const [count, rows] = await Promise.all([
			this.prisma.quarantineStatus.count({ where }),
			this.prisma.quarantineStatus.findMany({
				where,
				orderBy: { quarantinedAt: "asc" },
				take: N,
				include: { user: { select: { username: true, globalName: true } } },
			}),
		]);
		return {
			key: InboxSectionKey.QUARANTINE,
			title: "Arrivants bloqués en quarantaine",
			hint: "En quarantaine depuis plus d'un jour sans avoir franchi toutes les étapes.",
			count,
			link: "/quarantaine",
			items: rows.map((row) => ({
				id: row.userId,
				label: nom(row.user, row.userId),
				detail: !row.acceptedAt
					? "Règlement pas encore accepté"
					: "Vérification Battle.net attendue",
				at: row.quarantinedAt.toISOString(),
				link: `/membres/${row.userId}`,
			})),
		};
	}

	private async scoresEsport(): Promise<InboxSection> {
		const rows = await this.prisma.esportMatch.groupBy({
			by: ["weekId"],
			where: { suggestedAt: { not: null }, week: { guildId: this.guild.guildId } },
			_count: { _all: true },
		});
		const weeks = rows.length
			? await this.prisma.esportWeek.findMany({
					where: { id: { in: rows.map((r) => r.weekId) } },
					select: { id: true, weekStart: true },
					orderBy: { weekStart: "asc" },
				})
			: [];
		const parSemaine = new Map(rows.map((r) => [r.weekId, r._count._all]));
		return {
			key: InboxSectionKey.ESPORT_SCORES,
			title: "Scores esport à valider",
			hint: "Relevés sur Liquipedia, ils n'ont encore rien changé : chaque semaine se valide d'un coup.",
			count: rows.reduce((somme, r) => somme + r._count._all, 0),
			link: "/esport",
			items: weeks.slice(0, N).map((week) => ({
				id: week.id,
				label: `Semaine du ${week.weekStart.toISOString().slice(0, 10).split("-").reverse().join("/")}`,
				detail: `${parSemaine.get(week.id) ?? 0} score(s) proposé(s)`,
				at: null,
				link: "/esport",
			})),
		};
	}

	/**
	 * Ce que Discord a refuse : messages composes, recapitulatifs et annonces
	 * esport, mini-jeux. Chaque source suit la permission de sa page ; un echec
	 * ne se rejoue jamais tout seul (voir `embedSync.ts`), il attend quelqu'un.
	 */
	private async publicationsRefusees(actor: AuthenticatedUser): Promise<InboxSection> {
		const guildId = this.guild.guildId;
		const peut = (permission: Permission) => actor.permissions.includes(permission);

		const [embeds, semaines, resultats, miniJeux] = await Promise.all([
			peut(Permission.EMBEDS_READ)
				? this.prisma.embedMessage.findMany({
						where: { guildId, status: "FAILED" },
						select: { id: true, title: true, lastError: true, updatedAt: true },
					})
				: [],
			peut(Permission.ESPORT_READ)
				? this.prisma.esportWeek.findMany({
						where: { guildId, lastError: { not: null } },
						select: { id: true, weekStart: true, lastError: true, updatedAt: true },
					})
				: [],
			peut(Permission.ESPORT_READ)
				? this.prisma.esportMatch.findMany({
						where: { week: { guildId }, resultError: { not: null } },
						select: { id: true, resultError: true, updatedAt: true },
					})
				: [],
			peut(Permission.MINIGAMES_READ)
				? this.prisma.minigameEvent.findMany({
						where: { guildId, lastError: { not: null } },
						select: { id: true, title: true, day: true, lastError: true, updatedAt: true },
					})
				: [],
		]);

		const items: InboxItem[] = [
			...embeds.map((e) => ({
				id: `embed:${e.id}`,
				label: `Message « ${e.title ?? "sans titre"} »`,
				detail: e.lastError,
				at: e.updatedAt.toISOString(),
				link: "/messages",
			})),
			...semaines.map((w) => ({
				id: `esport-week:${w.id}`,
				label: `Récapitulatif esport du ${w.weekStart.toISOString().slice(0, 10).split("-").reverse().join("/")}`,
				detail: w.lastError,
				at: w.updatedAt.toISOString(),
				link: "/esport",
			})),
			...resultats.map((m) => ({
				id: `esport-result:${m.id}`,
				label: "Annonce de résultat esport",
				detail: m.resultError,
				at: m.updatedAt.toISOString(),
				link: "/esport",
			})),
			...miniJeux.map((m) => ({
				id: `minigame:${m.id}`,
				label: `Mini-jeu « ${m.title} » du ${m.day.toISOString().slice(0, 10).split("-").reverse().join("/")}`,
				detail: m.lastError,
				at: m.updatedAt.toISOString(),
				link: "/mini-jeux",
			})),
		].sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));

		return {
			key: InboxSectionKey.PUBLICATION_FAILURES,
			title: "Publications refusées par Discord",
			hint: "Un envoi refusé n'est jamais rejoué tout seul : corrigez la cause, puis remettez-le en file depuis sa page.",
			count: items.length,
			link: items[0]?.link ?? "/",
			items: items.slice(0, N),
		};
	}

	/**
	 * Jours sans mini-jeu dans la semaine qui vient. Seulement sur un serveur
	 * qui s'en sert (une ligne de reglage existe) : ailleurs, sept jours vides
	 * en permanence ne seraient que du bruit.
	 */
	private async calendrierMiniJeux(now: Date): Promise<InboxSection> {
		const guildId = this.guild.guildId;
		const config = await this.prisma.minigameConfig.findUnique({ where: { guildId }, select: { guildId: true } });
		if (!config) return vide(InboxSectionKey.MINIGAMES_PLANNING);

		const aujourdhui = minigameDayKey(now);
		const jours = Array.from({ length: JOURS_A_PLANIFIER }, (_, i) => addDaysToKey(aujourdhui, i));
		const prevus = await this.prisma.minigameEvent.findMany({
			where: {
				guildId,
				day: { gte: new Date(`${jours[0]}T00:00:00Z`), lte: new Date(`${jours.at(-1)}T00:00:00Z`) },
			},
			select: { day: true },
		});
		const occupes = new Set(prevus.map((e) => e.day.toISOString().slice(0, 10)));
		const libres = jours.filter((jour) => !occupes.has(jour));

		const libelle = new Intl.DateTimeFormat("fr-FR", {
			weekday: "long",
			day: "numeric",
			month: "long",
			timeZone: MINIGAME_TIME_ZONE,
		});
		return {
			key: InboxSectionKey.MINIGAMES_PLANNING,
			title: "Jours sans mini-jeu",
			hint: "Dans les sept prochains jours. Un jour se prépare jusqu'à la veille 23:59.",
			count: libres.length,
			link: "/mini-jeux",
			items: libres.slice(0, N).map((jour) => ({
				id: jour,
				// Midi : le libelle ne doit pas basculer d'un jour selon le fuseau.
				label: libelle.format(new Date(`${jour}T12:00:00Z`)),
				detail: null,
				at: null,
				link: "/mini-jeux",
			})),
		};
	}
}

function vide(key: InboxSectionKey): InboxSection {
	return { key, title: "", hint: "", count: 0, items: [], link: "/" };
}
