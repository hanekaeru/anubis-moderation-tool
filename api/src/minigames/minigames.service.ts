import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	NotFoundException,
	PayloadTooLargeException,
} from "@nestjs/common";
import type { MinigameConfig, Prisma } from "@anubis/shared/prisma";
import {
	MAX_MINIGAME_IMAGES,
	MAX_MINIGAME_IMAGE_BYTES,
	MINIGAME_DEFAULT_MAX_ATTEMPTS,
	MINIGAME_DEFAULT_PING_TIME,
	MINIGAME_DEFAULT_TRUE_FALSE_XP,
	MINIGAME_DEFAULT_WEEK,
	MINIGAME_DEFAULT_XP,
	MINIGAME_IMAGE_CONTENT_TYPES,
	MinigameType,
	Permission,
	addDaysToKey,
	isDateKey,
	isMinigameDayLocked,
	isPollMinigame,
	minigameDayKey,
	minigameEventProblem,
	parseMinigameWeek,
	slugifyChannelPart,
	type MinigameCalendarDto,
	type MinigameConfigDto,
	type MinigameEventDto,
	type MinigameImageDto,
	type MinigameMapDto,
	type MinigameParticipantDto,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import { toMemberRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateMinigameEventDto,
	CreateMinigameMapDto,
	UpdateMinigameConfigDto,
	UpdateMinigameEventDto,
	UpdateMinigameMapDto,
} from "./dto/minigames.dto";

/** Une page du calendrier couvre un mois, avec les jours voisins de la grille. */
const MAX_RANGE_DAYS = 62;

const IMAGE_SELECT = {
	id: true,
	fileName: true,
	contentType: true,
	size: true,
	position: true,
} as const;

const EVENT_INCLUDE = {
	images: { select: IMAGE_SELECT, orderBy: { position: "asc" } },
	_count: {
		select: {
			games: { where: { attempts: { gt: 0 } } },
		},
	},
} satisfies Prisma.MinigameEventInclude;

type EventRow = Prisma.MinigameEventGetPayload<{ include: typeof EVENT_INCLUDE }>;

/** `@db.Date` se lit et s'ecrit en minuit UTC : la cle n'a pas de fuseau. */
const versDate = (key: string) => new Date(`${key}T00:00:00Z`);
const versCle = (date: Date) => date.toISOString().slice(0, 10);

/** Champs de reponse et de sondage, remis a `null` hors de leur type. */
const ANSWER_FIELDS = {
	answerHeroKey: [MinigameType.GUESS_HERO, MinigameType.GUESS_SKIN],
	answerMapKey: [MinigameType.GUESS_MAP],
	answerSkin: [MinigameType.GUESS_SKIN],
	answerTrue: [MinigameType.TRUE_FALSE],
	pollQuestion: [MinigameType.DUEL, MinigameType.TRUE_FALSE],
} as const;

type EventFields = {
	type: MinigameType;
	title: string;
	description: string | null;
	color: number;
	pingEnabled: boolean;
	pingRoleId: string | null;
	maxAttempts: number | null;
	outOfAttemptsMessage: string | null;
	answerHeroKey: string | null;
	answerMapKey: string | null;
	answerSkin: string | null;
	answerTrue: boolean | null;
	pollQuestion: string | null;
	pollAnswers: string[];
};

/**
 * Calendrier des mini-jeux.
 *
 * L'API ne parle jamais a Discord : elle ecrit le jeu, le bot le publie a
 * minuit et le corrige ensuite (`discordSyncedAt` remis a `null`). Deux regles
 * font tout le reste :
 *
 * - **le verrou** : a partir du jour J, le jeu du jour J ne se modifie plus
 *   qu'avec `minigames:manage`. Verifie ici, le dashboard ne fait que griser.
 * - **un jeu enregistre est toujours publiable** : `minigameEventProblem` est
 *   rejoue sur le jeu complet a chaque ecriture. Le bot n'a jamais a decouvrir
 *   a minuit qu'il manque la reponse.
 */
@Injectable()
export class MinigamesService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	// -----------------------------------------------------------------------
	// Calendrier
	// -----------------------------------------------------------------------

	async calendar(from: string, to: string, now = new Date()): Promise<MinigameCalendarDto> {
		if (!isDateKey(from) || !isDateKey(to) || from > to) {
			throw new BadRequestException("Période invalide.");
		}
		if (to > addDaysToKey(from, MAX_RANGE_DAYS)) {
			throw new BadRequestException(`La période ne peut dépasser ${MAX_RANGE_DAYS} jours.`);
		}

		const guildId = this.guild.guildId;
		const [config, rows, heroes, maps] = await Promise.all([
			this.getConfig(),
			this.prisma.minigameEvent.findMany({
				where: { guildId, day: { gte: versDate(from), lte: versDate(to) } },
				include: EVENT_INCLUDE,
				orderBy: { day: "asc" },
			}),
			this.prisma.owdleHero.findMany({
				select: { key: true, name: true, enabled: true },
				orderBy: { name: "asc" },
			}),
			this.listMaps(),
		]);

		const outcomes = await this.outcomes(rows.map((row) => row.id));
		return {
			config,
			events: rows.map((row) => this.toEventDto(row, outcomes, now)),
			today: minigameDayKey(now),
			heroes,
			maps,
		};
	}

	/**
	 * Gagnants et heros seuls, par jeu. Deux `groupBy` plutot qu'un `_count`
	 * filtre par relation : Prisma n'accepte qu'un filtre par relation comptee,
	 * et il en faut trois.
	 */
	private async outcomes(ids: string[]): Promise<Map<string, { solved: number; heroOnly: number }>> {
		const result = new Map<string, { solved: number; heroOnly: number }>();
		if (!ids.length) return result;

		const [solved, heroOnly] = await Promise.all([
			this.prisma.minigameGame.groupBy({
				by: ["eventId"],
				where: { eventId: { in: ids }, solvedAt: { not: null } },
				_count: { _all: true },
			}),
			this.prisma.minigameGame.groupBy({
				by: ["eventId"],
				where: { eventId: { in: ids }, solvedAt: null, heroFoundAt: { not: null } },
				_count: { _all: true },
			}),
		]);

		for (const id of ids) result.set(id, { solved: 0, heroOnly: 0 });
		for (const row of solved) result.get(row.eventId)!.solved = row._count._all;
		for (const row of heroOnly) result.get(row.eventId)!.heroOnly = row._count._all;
		return result;
	}

	private toEventDto(
		row: EventRow,
		outcomes: Map<string, { solved: number; heroOnly: number }>,
		now: Date,
	): MinigameEventDto {
		const day = versCle(row.day);
		const outcome = outcomes.get(row.id) ?? { solved: 0, heroOnly: 0 };
		return {
			id: row.id,
			day,
			type: row.type as MinigameType,
			title: row.title,
			description: row.description,
			color: row.color,
			pingEnabled: row.pingEnabled,
			pingRoleId: row.pingRoleId,
			maxAttempts: row.maxAttempts,
			outOfAttemptsMessage: row.outOfAttemptsMessage,
			answerHeroKey: row.answerHeroKey,
			answerMapKey: row.answerMapKey,
			answerSkin: row.answerSkin,
			answerTrue: row.answerTrue,
			pollQuestion: row.pollQuestion,
			pollAnswers: row.pollAnswers,
			images: row.images as MinigameImageDto[],
			publishedAt: row.publishedAt?.toISOString() ?? null,
			pingedAt: row.pingedAt?.toISOString() ?? null,
			closedAt: row.closedAt?.toISOString() ?? null,
			lastError: row.lastError,
			messageUrl:
				row.channelId && row.messageId
					? `https://discord.com/channels/${row.guildId}/${row.channelId}/${row.messageId}`
					: null,
			participants: row._count.games,
			solved: outcome.solved,
			heroOnly: outcome.heroOnly,
			locked: isMinigameDayLocked(day, now),
			updatedAt: row.updatedAt.toISOString(),
		};
	}

	private async loadEvent(id: string): Promise<EventRow> {
		const row = await this.prisma.minigameEvent.findFirst({
			where: { id, guildId: this.guild.guildId },
			include: EVENT_INCLUDE,
		});
		if (!row) throw new NotFoundException("Mini-jeu introuvable.");
		return row;
	}

	private async eventDto(id: string, now = new Date()): Promise<MinigameEventDto> {
		const row = await this.loadEvent(id);
		return this.toEventDto(row, await this.outcomes([id]), now);
	}

	/**
	 * Le verrou de la veille 23:59. Un jour commence se corrige encore, mais
	 * seulement avec `minigames:manage` — un administrateur rattrape une coquille
	 * le jour meme. Une permission, jamais un test sur le role.
	 */
	private assertCanEdit(day: string, actor: AuthenticatedUser, now: Date): void {
		if (isMinigameDayLocked(day, now) && !actor.permissions.includes(Permission.MINIGAMES_MANAGE)) {
			throw new ForbiddenException(
				"Ce mini-jeu est verrouillé depuis la veille à 23h59 : seul un administrateur peut encore le modifier.",
			);
		}
	}

	// -----------------------------------------------------------------------
	// Jeux
	// -----------------------------------------------------------------------

	async createEvent(
		dto: CreateMinigameEventDto,
		actor: AuthenticatedUser,
		now = new Date(),
	): Promise<MinigameEventDto> {
		if (!isDateKey(dto.day)) throw new BadRequestException("Jour invalide.");
		if (dto.day < minigameDayKey(now)) {
			throw new BadRequestException("Ce jour est passé : un mini-jeu ne se crée plus après coup.");
		}
		this.assertCanEdit(dto.day, actor, now);

		const guildId = this.guild.guildId;
		const day = versDate(dto.day);
		if (await this.prisma.minigameEvent.findUnique({ where: { guildId_day: { guildId, day } } })) {
			throw new ConflictException("Un mini-jeu est déjà prévu ce jour-là.");
		}

		const fields = await this.validate({
			type: dto.type,
			title: dto.title,
			description: dto.description ?? null,
			color: dto.color ?? 0x5865f2,
			pingEnabled: dto.pingEnabled ?? true,
			pingRoleId: dto.pingRoleId ?? null,
			maxAttempts: dto.maxAttempts ?? null,
			outOfAttemptsMessage: dto.outOfAttemptsMessage ?? null,
			answerHeroKey: dto.answerHeroKey ?? null,
			answerMapKey: dto.answerMapKey ?? null,
			answerSkin: dto.answerSkin ?? null,
			answerTrue: dto.answerTrue ?? null,
			pollQuestion: dto.pollQuestion ?? null,
			pollAnswers: dto.pollAnswers ?? [],
		});

		const saved = await this.prisma.minigameEvent.create({
			data: { guildId, day, ...fields },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.event.create",
			entityType: "minigame_event",
			entityId: saved.id,
			after: { day: dto.day, ...fields },
		});

		return this.eventDto(saved.id, now);
	}

	async updateEvent(
		id: string,
		dto: UpdateMinigameEventDto,
		actor: AuthenticatedUser,
		now = new Date(),
	): Promise<MinigameEventDto> {
		const existing = await this.loadEvent(id);
		const day = versCle(existing.day);

		if (existing.closedAt) {
			throw new ConflictException("Ce mini-jeu est terminé : il n'y a plus rien à corriger.");
		}
		this.assertCanEdit(day, actor, now);

		const merged = await this.validate({
			type: dto.type ?? (existing.type as MinigameType),
			title: dto.title ?? existing.title,
			description: dto.description !== undefined ? dto.description : existing.description,
			color: dto.color ?? existing.color,
			pingEnabled: dto.pingEnabled ?? existing.pingEnabled,
			pingRoleId: dto.pingRoleId !== undefined ? dto.pingRoleId : existing.pingRoleId,
			maxAttempts: dto.maxAttempts !== undefined ? dto.maxAttempts : existing.maxAttempts,
			outOfAttemptsMessage:
				dto.outOfAttemptsMessage !== undefined ? dto.outOfAttemptsMessage : existing.outOfAttemptsMessage,
			answerHeroKey: dto.answerHeroKey !== undefined ? dto.answerHeroKey : existing.answerHeroKey,
			answerMapKey: dto.answerMapKey !== undefined ? dto.answerMapKey : existing.answerMapKey,
			answerSkin: dto.answerSkin !== undefined ? dto.answerSkin : existing.answerSkin,
			answerTrue: dto.answerTrue !== undefined ? dto.answerTrue : existing.answerTrue,
			pollQuestion: dto.pollQuestion !== undefined ? dto.pollQuestion : existing.pollQuestion,
			pollAnswers: dto.pollAnswers ?? existing.pollAnswers,
		});

		if (existing.publishedAt) {
			// Ce qui est deja sur Discord et ne se corrige pas : le type decide des
			// messages publies, et un sondage Discord ne se modifie plus du tout.
			if (merged.type !== existing.type) {
				throw new BadRequestException("Le type d'un mini-jeu déjà publié ne peut plus changer.");
			}
			const sondageChange =
				merged.pollQuestion !== existing.pollQuestion ||
				merged.pollAnswers.join("\u0000") !== existing.pollAnswers.join("\u0000");
			if (isPollMinigame(merged.type) && sondageChange) {
				throw new BadRequestException("Un sondage Discord ne se modifie plus une fois publié.");
			}
		}

		await this.prisma.minigameEvent.update({
			where: { id },
			data: {
				...merged,
				// Publie : l'embed est a corriger. Pas encore : rien a rejouer, la
				// publication de minuit prendra la derniere version.
				...(existing.publishedAt ? { discordSyncedAt: null, lastError: null } : { lastError: null }),
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.event.update",
			entityType: "minigame_event",
			entityId: id,
			before: snapshot(existing),
			after: { ...merged },
		});

		return this.eventDto(id, now);
	}

	/**
	 * Supprime un jeu. **Ne touche pas a Discord** : ce qui a ete publie et lu
	 * par le serveur ne se reprend pas d'un clic, meme regle que les messages
	 * composes. Un jeu verrouille ne se supprime qu'avec `minigames:manage`.
	 */
	async removeEvent(id: string, actor: AuthenticatedUser, now = new Date()): Promise<void> {
		const existing = await this.loadEvent(id);
		this.assertCanEdit(versCle(existing.day), actor, now);

		await this.prisma.minigameEvent.delete({ where: { id } });

		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.event.delete",
			entityType: "minigame_event",
			entityId: id,
			before: snapshot(existing),
		});
	}

	/**
	 * Rejoue la regle partagee sur le jeu complet, puis verifie en base ce
	 * qu'elle ne peut pas voir : le heros et la map choisis existent et sont
	 * actifs. Les champs etrangers au type sont remis a vide — un jeu passe de
	 * « devine la map » a « duel » ne doit pas garder une reponse fantome.
	 */
	private async validate(fields: EventFields): Promise<EventFields> {
		const clean: EventFields = {
			...fields,
			title: fields.title.trim(),
			description: fields.description?.trim() || null,
			outOfAttemptsMessage: fields.outOfAttemptsMessage?.trim() || null,
			answerSkin: fields.answerSkin?.trim() || null,
			pollQuestion: fields.pollQuestion?.trim() || null,
			pollAnswers: fields.type === MinigameType.DUEL ? fields.pollAnswers.map((a) => a.trim()).filter(Boolean) : [],
		};

		for (const [field, types] of Object.entries(ANSWER_FIELDS) as [keyof typeof ANSWER_FIELDS, readonly MinigameType[]][]) {
			if (!types.includes(clean.type)) (clean as Record<string, unknown>)[field] = null;
		}
		// Les essais et leur message n'ont de sens que pour `/devine`.
		if (![MinigameType.GUESS_HERO, MinigameType.GUESS_MAP, MinigameType.GUESS_SKIN].includes(clean.type as never)) {
			clean.maxAttempts = null;
			clean.outOfAttemptsMessage = null;
		}

		const problem = minigameEventProblem(clean);
		if (problem) throw new BadRequestException(problem);

		if (clean.answerHeroKey) {
			const hero = await this.prisma.owdleHero.findUnique({ where: { key: clean.answerHeroKey } });
			if (!hero?.enabled) throw new BadRequestException("Ce héros n'existe pas ou est désactivé.");
		}
		if (clean.answerMapKey) {
			const map = await this.prisma.minigameMap.findUnique({ where: { key: clean.answerMapKey } });
			if (!map?.enabled) throw new BadRequestException("Cette map n'existe pas ou est désactivée.");
		}

		return clean;
	}

	// -----------------------------------------------------------------------
	// Images
	// -----------------------------------------------------------------------

	async addImage(
		id: string,
		file: Express.Multer.File | undefined,
		actor: AuthenticatedUser,
		now = new Date(),
	): Promise<MinigameEventDto> {
		if (!file) throw new BadRequestException("Aucun fichier reçu.");
		const existing = await this.loadEvent(id);
		if (existing.closedAt) throw new ConflictException("Ce mini-jeu est terminé.");
		this.assertCanEdit(versCle(existing.day), actor, now);

		// Multer coupe deja au-dela, mais par une erreur generique : la regle est
		// redite ici avec un message lisible.
		if (file.size > MAX_MINIGAME_IMAGE_BYTES) {
			throw new PayloadTooLargeException(
				`Image trop volumineuse (max ${Math.floor(MAX_MINIGAME_IMAGE_BYTES / 1024 / 1024)} Mo).`,
			);
		}
		if (!MINIGAME_IMAGE_CONTENT_TYPES.includes(file.mimetype)) {
			throw new BadRequestException(`Seules les images sont acceptées (reçu : ${file.mimetype}).`);
		}
		if (existing.images.length >= MAX_MINIGAME_IMAGES) {
			throw new BadRequestException(`Maximum ${MAX_MINIGAME_IMAGES} images par mini-jeu.`);
		}

		const position = existing.images.reduce((max, image) => Math.max(max, image.position), -1) + 1;
		const image = await this.prisma.minigameImage.create({
			data: {
				eventId: id,
				position,
				fileName: file.originalname.slice(0, 200),
				contentType: file.mimetype,
				size: file.size,
				data: new Uint8Array(file.buffer),
			},
			select: IMAGE_SELECT,
		});
		await this.markChanged(existing);

		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.image.add",
			entityType: "minigame_event",
			entityId: id,
			after: { ...image },
		});

		return this.eventDto(id, now);
	}

	async removeImage(id: string, imageId: string, actor: AuthenticatedUser, now = new Date()): Promise<MinigameEventDto> {
		const existing = await this.loadEvent(id);
		if (existing.closedAt) throw new ConflictException("Ce mini-jeu est terminé.");
		this.assertCanEdit(versCle(existing.day), actor, now);

		const image = existing.images.find((i) => i.id === imageId);
		if (!image) throw new NotFoundException("Image introuvable.");

		await this.prisma.minigameImage.delete({ where: { id: imageId } });
		await this.markChanged(existing);

		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.image.remove",
			entityType: "minigame_event",
			entityId: id,
			before: { ...image },
		});

		return this.eventDto(id, now);
	}

	async downloadImage(id: string, imageId: string): Promise<{ fileName: string; contentType: string; data: Uint8Array }> {
		const image = await this.prisma.minigameImage.findFirst({
			where: { id: imageId, eventId: id, event: { guildId: this.guild.guildId } },
			select: { fileName: true, contentType: true, data: true },
		});
		if (!image) throw new NotFoundException("Image introuvable.");
		return image;
	}

	// -----------------------------------------------------------------------
	// Participants
	// -----------------------------------------------------------------------

	/**
	 * Qui a joue, et comment. Les lignes sans essai sont ecartees : le bot en
	 * cree une des la premiere saisie, meme refusee (map inconnue, doublon), et
	 * le compteur `participants` du calendrier ne les compte pas non plus.
	 *
	 * Les gagnants d'abord, dans l'ordre ou ils ont trouve — c'est la question
	 * que le staff pose le plus souvent —, puis les heros seuls, puis le reste.
	 */
	async participants(id: string): Promise<MinigameParticipantDto[]> {
		const event = await this.loadEvent(id);
		const type = event.type as MinigameType;

		const [rows, names] = await Promise.all([
			this.prisma.minigameGame.findMany({
				where: { eventId: id, attempts: { gt: 0 } },
				include: { user: { select: { id: true, username: true, globalName: true, avatarUrl: true } } },
			}),
			this.guessNames(type),
		]);

		const rang = (row: (typeof rows)[number]) => (row.solvedAt ? 0 : row.heroFoundAt ? 1 : 2);
		const instant = (row: (typeof rows)[number]) =>
			(row.solvedAt ?? row.heroFoundAt ?? row.updatedAt).getTime();
		rows.sort((a, b) => rang(a) - rang(b) || instant(a) - instant(b));

		return rows.map((row) => ({
			member: toMemberRef(row.user),
			attempts: row.attempts,
			guesses: row.guesses.map((guess) => names.get(guess) ?? guess),
			heroFoundAt: row.heroFoundAt?.toISOString() ?? null,
			solvedAt: row.solvedAt?.toISOString() ?? null,
			xpAwarded: row.xpAwarded,
			playedAt: row.updatedAt.toISOString(),
		}));
	}

	/**
	 * Les essais stockent la cle du heros ou de la map : le staff lit le nom.
	 * Le skin est garde tel que compare, et un vote est deja un libelle.
	 */
	private async guessNames(type: MinigameType): Promise<Map<string, string>> {
		if (type === MinigameType.GUESS_HERO) {
			const heroes = await this.prisma.owdleHero.findMany({ select: { key: true, name: true } });
			return new Map(heroes.map((h) => [h.key, h.name]));
		}
		if (type === MinigameType.GUESS_MAP) {
			const maps = await this.prisma.minigameMap.findMany({ select: { key: true, name: true } });
			return new Map(maps.map((m) => [m.key, m.name]));
		}
		return new Map();
	}

	/** Une image ajoutee ou retiree apres publication : le message est a corriger. */
	private async markChanged(existing: EventRow): Promise<void> {
		if (!existing.publishedAt) return;
		await this.prisma.minigameEvent.update({
			where: { id: existing.id },
			data: { discordSyncedAt: null, lastError: null },
		});
	}

	// -----------------------------------------------------------------------
	// Reglage
	// -----------------------------------------------------------------------

	async getConfig(): Promise<MinigameConfigDto> {
		const guildId = this.guild.guildId;
		const row = await this.prisma.minigameConfig.findUnique({ where: { guildId } });
		return toConfigDto(guildId, row);
	}

	async updateConfig(dto: UpdateMinigameConfigDto, actor: AuthenticatedUser): Promise<MinigameConfigDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.minigameConfig.findUnique({ where: { guildId } });
		const current = toConfigDto(guildId, existing);

		const data = {
			announceChannelId: dto.announceChannelId !== undefined ? dto.announceChannelId : current.announceChannelId,
			playChannelId: dto.playChannelId !== undefined ? dto.playChannelId : current.playChannelId,
			pingRoleId: dto.pingRoleId !== undefined ? dto.pingRoleId : current.pingRoleId,
			pingTime: dto.pingTime ?? current.pingTime,
			weekTemplate: (dto.weekTemplate ?? current.weekTemplate).map((type) => type ?? ""),
			maxAttempts: dto.maxAttempts ?? current.maxAttempts,
			heroXp: dto.heroXp ?? current.heroXp,
			mapXp: dto.mapXp ?? current.mapXp,
			skinXp: dto.skinXp ?? current.skinXp,
			trueFalseXp: dto.trueFalseXp ?? current.trueFalseXp,
			outOfAttemptsMessage:
				dto.outOfAttemptsMessage !== undefined
					? dto.outOfAttemptsMessage?.trim() || null
					: current.outOfAttemptsMessage,
		};

		const saved = await this.prisma.minigameConfig.upsert({
			where: { guildId },
			update: data,
			create: { guildId, ...data },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.config.update",
			entityType: "minigame_config",
			entityId: guildId,
			before: existing ? { ...current } : undefined,
			after: { ...dto },
		});

		return toConfigDto(guildId, saved);
	}

	// -----------------------------------------------------------------------
	// Maps
	// -----------------------------------------------------------------------

	async listMaps(): Promise<MinigameMapDto[]> {
		const rows = await this.prisma.minigameMap.findMany({ orderBy: { name: "asc" } });
		return rows.map(toMapDto);
	}

	/** La cle se tire du nom a la creation et ne bouge plus : elle vit dans les essais. */
	async createMap(dto: CreateMinigameMapDto, actor: AuthenticatedUser): Promise<MinigameMapDto> {
		const name = dto.name.trim();
		const key = slugifyChannelPart(name).slice(0, 40).replace(/-+$/, "");
		if (!key) throw new BadRequestException("Ce nom ne donne aucune clé utilisable.");
		if (await this.prisma.minigameMap.findUnique({ where: { key } })) {
			throw new ConflictException(`Une map porte déjà la clé « ${key} ».`);
		}
		await this.assertMapNameFree(name, null);

		const saved = await this.prisma.minigameMap.create({ data: { key, name } });
		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.map.create",
			entityType: "minigame_map",
			entityId: key,
			after: { key, name },
		});
		return toMapDto(saved);
	}

	async updateMap(key: string, dto: UpdateMinigameMapDto, actor: AuthenticatedUser): Promise<MinigameMapDto> {
		const existing = await this.prisma.minigameMap.findUnique({ where: { key } });
		if (!existing) throw new NotFoundException("Map introuvable.");

		const name = dto.name?.trim();
		if (name && name !== existing.name) await this.assertMapNameFree(name, key);

		const saved = await this.prisma.minigameMap.update({
			where: { key },
			data: { ...(name ? { name } : {}), ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}) },
		});
		await this.audit.record({
			appUserId: actor.id,
			action: "minigame.map.update",
			entityType: "minigame_map",
			entityId: key,
			before: { name: existing.name, enabled: existing.enabled },
			after: { name: saved.name, enabled: saved.enabled },
		});
		return toMapDto(saved);
	}

	/** Deux noms qui ne different que par la casse ou les accents se confondraient a la saisie. */
	private async assertMapNameFree(name: string, exceptKey: string | null): Promise<void> {
		const cible = slugifyChannelPart(name);
		const maps = await this.prisma.minigameMap.findMany({ select: { key: true, name: true } });
		const doublon = maps.find((m) => m.key !== exceptKey && slugifyChannelPart(m.name) === cible);
		if (doublon) throw new ConflictException(`« ${doublon.name} » existe déjà.`);
	}
}

function toConfigDto(guildId: string, row: MinigameConfig | null): MinigameConfigDto {
	return {
		guildId,
		announceChannelId: row?.announceChannelId ?? null,
		playChannelId: row?.playChannelId ?? null,
		pingRoleId: row?.pingRoleId ?? null,
		pingTime: row?.pingTime ?? MINIGAME_DEFAULT_PING_TIME,
		weekTemplate: row ? parseMinigameWeek(row.weekTemplate) : [...MINIGAME_DEFAULT_WEEK],
		maxAttempts: row?.maxAttempts ?? MINIGAME_DEFAULT_MAX_ATTEMPTS,
		heroXp: row?.heroXp ?? [...MINIGAME_DEFAULT_XP.GUESS_HERO],
		mapXp: row?.mapXp ?? [...MINIGAME_DEFAULT_XP.GUESS_MAP],
		skinXp: row?.skinXp ?? [...MINIGAME_DEFAULT_XP.GUESS_SKIN],
		trueFalseXp: row?.trueFalseXp ?? MINIGAME_DEFAULT_TRUE_FALSE_XP,
		outOfAttemptsMessage: row?.outOfAttemptsMessage ?? null,
		updatedAt: row?.updatedAt.toISOString() ?? null,
	};
}

function toMapDto(row: { key: string; name: string; enabled: boolean; updatedAt: Date }): MinigameMapDto {
	return { key: row.key, name: row.name, enabled: row.enabled, updatedAt: row.updatedAt.toISOString() };
}

/** Ce que le journal d'audit garde d'un jeu : tout sauf les octets des images. */
function snapshot(row: EventRow) {
	return {
		day: versCle(row.day),
		type: row.type,
		title: row.title,
		description: row.description,
		answerHeroKey: row.answerHeroKey,
		answerMapKey: row.answerMapKey,
		answerSkin: row.answerSkin,
		answerTrue: row.answerTrue,
		pollQuestion: row.pollQuestion,
		pollAnswers: row.pollAnswers,
		images: row.images.length,
		publishedAt: row.publishedAt?.toISOString() ?? null,
	};
}
