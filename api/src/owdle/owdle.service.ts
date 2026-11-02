import {
	BadRequestException,
	ConflictException,
	Injectable,
	NotFoundException,
} from "@nestjs/common";
import type { OwdleConfig, Prisma } from "@anubis/shared/prisma";
import {
	MAX_OWDLE_HERO_KEY_LENGTH,
	OWDLE_DEFAULT_XP_BY_GUESSES,
	OWDLE_ROLE_LABELS,
	OWDLE_SUB_ROLE_LABELS,
	OWDLE_SUB_ROLE_ROLE,
	normalizeOwdleName,
	slugifyChannelPart,
	type OwdleAffiliationDto,
	type OwdleConfigDto,
	type OwdleHeroDto,
	type OwdleOverviewDto,
	type OwdleRole,
	type OwdleSubRole,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";
import type {
	CreateOwdleHeroDto,
	SaveOwdleAffiliationDto,
	UpdateOwdleConfigDto,
	UpdateOwdleHeroDto,
} from "./dto/owdle.dto";

type HeroRow = Prisma.OwdleHeroGetPayload<{ include: { affiliation: true } }>;

/**
 * Heros, affiliations et bareme de l'OWdle.
 *
 * Le bot relit les heros toutes les 30 secondes et le bareme a chaque
 * victoire : rien ici n'a de `discordSyncedAt`, il n'y a rien a rejouer sur
 * Discord. **Le heros du jour n'est jamais expose** — le staff joue aussi.
 */
@Injectable()
export class OwdleService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	async overview(): Promise<OwdleOverviewDto> {
		const [heroes, affiliations, config] = await Promise.all([
			this.prisma.owdleHero.findMany({
				include: { affiliation: true },
				orderBy: [{ role: "asc" }, { name: "asc" }],
			}),
			this.listAffiliations(),
			this.getConfig(),
		]);
		return { heroes: heroes.map(toHeroDto), affiliations, config };
	}

	private async getConfig(): Promise<OwdleConfigDto> {
		const guildId = this.guild.guildId;
		const row = await this.prisma.owdleConfig.findUnique({ where: { guildId } });
		return toConfigDto(guildId, row);
	}

	async updateConfig(
		dto: UpdateOwdleConfigDto,
		actor: AuthenticatedUser,
	): Promise<OwdleConfigDto> {
		const guildId = this.guild.guildId;
		const existing = await this.prisma.owdleConfig.findUnique({ where: { guildId } });

		const saved = await this.prisma.owdleConfig.upsert({
			where: { guildId },
			update: {
				...(dto.channelId !== undefined ? { channelId: dto.channelId } : {}),
				...(dto.xpByGuesses !== undefined ? { xpByGuesses: dto.xpByGuesses } : {}),
			},
			create: {
				guildId,
				channelId: dto.channelId ?? null,
				xpByGuesses: dto.xpByGuesses ?? [...OWDLE_DEFAULT_XP_BY_GUESSES],
			},
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "owdle.config.update",
			entityType: "owdle_config",
			entityId: guildId,
			before: existing
				? { channelId: existing.channelId, xpByGuesses: existing.xpByGuesses }
				: undefined,
			after: { ...dto },
		});

		return toConfigDto(guildId, saved);
	}

	async createHero(dto: CreateOwdleHeroDto, actor: AuthenticatedUser): Promise<OwdleHeroDto> {
		const data = { ...dto, name: dto.name.trim(), origin: dto.origin.trim() };
		assertSubRole(data.role, data.subRole);
		await this.assertAffiliationExists(data.affiliationKey);

		if (await this.prisma.owdleHero.findUnique({ where: { key: data.key } })) {
			throw new ConflictException(`La clé « ${data.key} » est déjà prise.`);
		}
		await this.assertNameFree(data.name, null);

		const saved = await this.prisma.owdleHero.create({
			data: { ...data, enabled: data.enabled ?? true },
			include: { affiliation: true },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "owdle.hero.create",
			entityType: "owdle_hero",
			entityId: saved.key,
			after: snapshot(saved),
		});

		return toHeroDto(saved);
	}

	/**
	 * Modifie un heros. La cle ne bouge jamais : elle vit dans les parties
	 * enregistrees, et la changer ferait disparaitre les essais qui la portent.
	 *
	 * Une correction s'applique aussi aux parties en cours : la grille est
	 * recalculee a chaque essai a partir de la fiche du moment. C'est voulu — une
	 * erreur corrigee doit cesser de tromper les joueurs tout de suite.
	 */
	async updateHero(
		key: string,
		dto: UpdateOwdleHeroDto,
		actor: AuthenticatedUser,
	): Promise<OwdleHeroDto> {
		const existing = await this.prisma.owdleHero.findUnique({
			where: { key },
			include: { affiliation: true },
		});
		if (!existing) throw new NotFoundException("Héros introuvable.");

		const data = {
			...dto,
			...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
			...(dto.origin !== undefined ? { origin: dto.origin.trim() } : {}),
		};

		// Sur la fiche complete : changer le role sans le sous-role doit etre
		// refuse aussi bien que l'inverse.
		assertSubRole(data.role ?? existing.role, data.subRole ?? existing.subRole);

		if (data.affiliationKey !== undefined && data.affiliationKey !== existing.affiliationKey) {
			await this.assertAffiliationExists(data.affiliationKey);
		}

		if (data.name !== undefined && data.name !== existing.name) {
			await this.assertNameFree(data.name, key);
		}

		// Sans heros actif, le tirage du lendemain echouerait et le jeu
		// tomberait pour tout le serveur.
		if (data.enabled === false && existing.enabled) {
			const actifs = await this.prisma.owdleHero.count({ where: { enabled: true } });
			if (actifs <= 1) {
				throw new BadRequestException("Il faut garder au moins un héros actif.");
			}
		}

		const saved = await this.prisma.owdleHero.update({
			where: { key },
			data,
			include: { affiliation: true },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "owdle.hero.update",
			entityType: "owdle_hero",
			entityId: key,
			before: snapshot(existing),
			after: snapshot(saved),
		});

		return toHeroDto(saved);
	}

	/** Affiliations par libelle, avec le nombre de heros qui les portent. */
	private async listAffiliations(): Promise<OwdleAffiliationDto[]> {
		const rows = await this.prisma.owdleAffiliation.findMany({
			include: { _count: { select: { heroes: true } } },
		});
		return rows
			.map((row) => ({ key: row.key, label: row.label, heroCount: row._count.heroes }))
			.sort((a, b) => a.label.localeCompare(b.label, "fr"));
	}

	private async findAffiliation(key: string): Promise<OwdleAffiliationDto> {
		const found = (await this.listAffiliations()).find((a) => a.key === key);
		if (!found) throw new NotFoundException("Affiliation introuvable.");
		return found;
	}

	/**
	 * Cree une affiliation. La cle se tire du libelle et ne bougera plus ; un
	 * suffixe la departage si un libelle renomme entre-temps l'a deja prise.
	 */
	async createAffiliation(
		dto: SaveOwdleAffiliationDto,
		actor: AuthenticatedUser,
	): Promise<OwdleAffiliationDto> {
		const label = dto.label.trim();
		await this.assertAffiliationLabelFree(label, null);

		const base =
			slugifyChannelPart(label).slice(0, MAX_OWDLE_HERO_KEY_LENGTH - 3).replace(/-+$/, "") ||
			"affiliation";
		const prises = new Set(
			(await this.prisma.owdleAffiliation.findMany({ select: { key: true } })).map((a) => a.key),
		);
		let key = base;
		for (let n = 2; prises.has(key); n++) key = `${base}-${n}`;

		await this.prisma.owdleAffiliation.create({ data: { key, label } });

		await this.audit.record({
			appUserId: actor.id,
			action: "owdle.affiliation.create",
			entityType: "owdle_affiliation",
			entityId: key,
			after: { label },
		});

		return { key, label, heroCount: 0 };
	}

	/** Renomme pour tous les heros d'un coup : seule la cle est comparee. */
	async renameAffiliation(
		key: string,
		dto: SaveOwdleAffiliationDto,
		actor: AuthenticatedUser,
	): Promise<OwdleAffiliationDto> {
		const existing = await this.findAffiliation(key);
		const label = dto.label.trim();
		if (label !== existing.label) await this.assertAffiliationLabelFree(label, key);

		await this.prisma.owdleAffiliation.update({ where: { key }, data: { label } });

		await this.audit.record({
			appUserId: actor.id,
			action: "owdle.affiliation.update",
			entityType: "owdle_affiliation",
			entityId: key,
			before: { label: existing.label },
			after: { label },
		});

		return { ...existing, label };
	}

	/**
	 * Supprime une affiliation que plus aucun heros ne porte. La contrainte
	 * `ON DELETE RESTRICT` le garantit en base ; le dire ici donne un message
	 * lisible plutot qu'une erreur de cle etrangere.
	 */
	async removeAffiliation(key: string, actor: AuthenticatedUser): Promise<void> {
		const existing = await this.findAffiliation(key);
		if (existing.heroCount > 0) {
			throw new ConflictException(
				`« ${existing.label} » est portée par ${existing.heroCount} héros : changez-les d'abord.`,
			);
		}

		await this.prisma.owdleAffiliation.delete({ where: { key } });

		await this.audit.record({
			appUserId: actor.id,
			action: "owdle.affiliation.delete",
			entityType: "owdle_affiliation",
			entityId: key,
			before: { label: existing.label },
		});
	}

	private async assertAffiliationExists(key: string): Promise<void> {
		const found = await this.prisma.owdleAffiliation.findUnique({ where: { key } });
		if (!found) throw new BadRequestException("Affiliation inconnue : choisissez-en une de la liste.");
	}

	/**
	 * Deux libelles qui ne different que par la casse ou les accents sont
	 * refuses : « Overwatch » et « overwatch » dans le menu, c'est exactement
	 * l'erreur que la liste existe pour empecher.
	 */
	private async assertAffiliationLabelFree(label: string, exceptKey: string | null): Promise<void> {
		const cherche = normalizeOwdleName(label);
		if (!cherche) throw new BadRequestException("Le libellé doit contenir au moins une lettre ou un chiffre.");

		const rows = await this.prisma.owdleAffiliation.findMany({ select: { key: true, label: true } });
		const clash = rows.find((row) => row.key !== exceptKey && normalizeOwdleName(row.label) === cherche);
		if (clash) throw new ConflictException(`Le libellé se confond avec « ${clash.label} ».`);
	}

	/**
	 * Deux noms que la saisie du joueur confondrait sont refuses : « Lucio » et
	 * « Lúcio » se resolvent pareil, et le second ne serait jamais trouvable.
	 */
	private async assertNameFree(name: string, exceptKey: string | null): Promise<void> {
		const cherche = normalizeOwdleName(name);
		if (!cherche) throw new BadRequestException("Le nom doit contenir au moins une lettre ou un chiffre.");

		const heroes = await this.prisma.owdleHero.findMany({ select: { key: true, name: true } });
		const clash = heroes.find(
			(hero) => hero.key !== exceptKey && normalizeOwdleName(hero.name) === cherche,
		);
		if (clash) throw new ConflictException(`Le nom se confond avec « ${clash.name} ».`);
	}
}

function assertSubRole(role: OwdleRole, subRole: OwdleSubRole): void {
	if (OWDLE_SUB_ROLE_ROLE[subRole] !== role) {
		throw new BadRequestException(
			`« ${OWDLE_SUB_ROLE_LABELS[subRole]} » n'est pas un sous-rôle ${OWDLE_ROLE_LABELS[role]}.`,
		);
	}
}

function snapshot(hero: HeroRow) {
	return {
		name: hero.name,
		role: hero.role,
		subRole: hero.subRole,
		species: hero.species,
		origin: hero.origin,
		region: hero.region,
		affiliationKey: hero.affiliationKey,
		releaseYear: hero.releaseYear,
		enabled: hero.enabled,
	};
}

function toHeroDto(hero: HeroRow): OwdleHeroDto {
	return {
		key: hero.key,
		name: hero.name,
		role: hero.role,
		subRole: hero.subRole,
		species: hero.species,
		origin: hero.origin,
		region: hero.region,
		affiliation: { key: hero.affiliation.key, label: hero.affiliation.label },
		releaseYear: hero.releaseYear,
		enabled: hero.enabled,
		updatedAt: hero.updatedAt.toISOString(),
	};
}

function toConfigDto(guildId: string, row: OwdleConfig | null): OwdleConfigDto {
	if (!row) {
		return {
			guildId,
			channelId: null,
			xpByGuesses: [...OWDLE_DEFAULT_XP_BY_GUESSES],
			// Aucune ligne : rien n'a jamais ete regle. Meme convention que l'XP.
			updatedAt: new Date(0).toISOString(),
		};
	}
	return {
		guildId: row.guildId,
		channelId: row.channelId,
		xpByGuesses: row.xpByGuesses,
		updatedAt: row.updatedAt.toISOString(),
	};
}
