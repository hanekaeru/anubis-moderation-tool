import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccountFlagType } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import {
	BattlenetError,
	buildAuthorizeUrl,
	exchangeCodeForUserInfo,
} from "./battlenet.client";
import type { VerificationOutcome } from "./verification.page";

/**
 * Verification Battle.net, seconde etape de la quarantaine.
 *
 * Deux routes publiques, et une seule chose a garantir : que le retour de
 * Blizzard corresponde bien a une demande que **nous** avons emise, pour le
 * membre Discord que nous y avons associe. Tout le reste en decoule.
 */
@Injectable()
export class VerificationService {
	private readonly logger = new Logger(VerificationService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly config: ConfigService<{ app: AppConfig }, true>,
		private readonly audit: AuditService,
	) {}

	private get battlenet(): AppConfig["battlenet"] {
		return this.config.get("app", { infer: true }).battlenet;
	}

	get available(): boolean {
		return this.battlenet.available;
	}

	/**
	 * Depart du parcours : le membre arrive ici depuis le bouton Discord.
	 *
	 * Le `state` n'est **pas** consomme a cette etape — seulement verifie. Le
	 * consommer ici casserait le parcours de quelqu'un qui ouvre le lien, hesite
	 * et recharge la page avant de se connecter.
	 */
	async authorizeUrlFor(
		state: string,
	): Promise<{ url: string } | { erreur: VerificationOutcome }> {
		if (!this.available) return { erreur: "indisponible" };

		const demande = await this.prisma.battlenetVerificationState.findUnique({
			where: { state },
		});

		if (!demande || demande.consumedAt) return { erreur: "lien-invalide" };
		if (demande.expiresAt.getTime() <= Date.now()) {
			return { erreur: "lien-expire" };
		}

		return {
			url: buildAuthorizeUrl({
				clientId: this.battlenet.clientId,
				redirectUri: this.battlenet.redirectUri,
				state,
			}),
		};
	}

	/**
	 * Retour de Blizzard.
	 *
	 * Le `state` est consomme **avant** l'echange du code, en une seule requete
	 * (`updateMany` filtre sur `consumedAt: null`, lu a son `count`) : deux
	 * appels simultanes ne peuvent donc pas franchir la porte ensemble. La
	 * consequence assumee est qu'un echec reseau cote Blizzard oblige a
	 * recliquer depuis Discord — c'est le bon sens de l'erreur, un `state`
	 * rejouable ouvrirait la porte a la relecture d'un retour intercepte.
	 */
	async handleCallback(
		code: string | undefined,
		state: string | undefined,
	): Promise<VerificationOutcome> {
		if (!this.available) return "indisponible";
		if (!state) return "lien-invalide";
		// Blizzard renvoie sans `code` quand la personne refuse l'autorisation.
		if (!code) return "refus-blizzard";

		const demande = await this.prisma.battlenetVerificationState.findUnique({
			where: { state },
		});

		if (!demande) return "lien-invalide";
		if (demande.expiresAt.getTime() <= Date.now()) return "lien-expire";

		const consommee = await this.prisma.battlenetVerificationState.updateMany({
			where: { state, consumedAt: null },
			data: { consumedAt: new Date() },
		});

		if (consommee.count !== 1) return "lien-invalide";

		let info;
		try {
			info = await exchangeCodeForUserInfo({
				clientId: this.battlenet.clientId,
				clientSecret: this.battlenet.clientSecret,
				redirectUri: this.battlenet.redirectUri,
				code,
			});
		} catch (err) {
			this.logger.error(
				err instanceof BattlenetError
					? err.message
					: "Échec inattendu de la vérification Battle.net.",
				err instanceof Error ? err.stack : String(err),
			);
			return "refus-blizzard";
		}

		const existant = await this.prisma.battlenetAccount.findUnique({
			where: { battlenetId: info.sub },
		});

		// Deja lie a quelqu'un d'autre : c'est exactement le cas que l'unicite
		// existe pour attraper. On refuse, et le staff est prevenu — la tentative
		// en dit plus long que le refus lui-meme.
		if (existant && existant.userId !== demande.userId) {
			await this.signalerDoublon(demande, info.sub, existant.userId);
			return "deja-lie";
		}

		await this.enregistrerLien(demande, info.sub, info.battletag);
		return "succes";
	}

	private async signalerDoublon(
		demande: { guildId: string; userId: string },
		battlenetId: string,
		proprietaireId: string,
	): Promise<void> {
		await this.prisma.accountFlag.create({
			data: {
				guildId: demande.guildId,
				userId: demande.userId,
				type: AccountFlagType.BATTLENET_DUPLICATE,
				details: {
					battlenetId,
					dejaLieA: proprietaireId,
				},
				// `null` : c'est le bot qui alertera le salon de logs au prochain
				// passage. L'API n'a aucun acces a Discord.
				discordSyncedAt: null,
			},
		});

		await this.audit.record({
			action: "battlenet.verification.refusee",
			entityType: "battlenet_account",
			entityId: demande.userId,
			after: { motif: "compte-deja-lie", dejaLieA: proprietaireId },
		});
	}

	/**
	 * Ecrit le lien et marque l'etape franchie.
	 *
	 * `discordSyncedAt` repasse a `null` sur le statut de quarantaine : c'est ce
	 * qui fait reprendre la main au bot, seul a pouvoir toucher aux roles.
	 *
	 * Le `upsert` du lien couvre le cas d'une reverification par la meme
	 * personne — un BattleTag change, par exemple. La cle ne bouge pas, seul
	 * l'affichage se met a jour.
	 */
	private async enregistrerLien(
		demande: { guildId: string; userId: string },
		battlenetId: string,
		battletag: string,
	): Promise<void> {
		const maintenant = new Date();

		await this.prisma.$transaction([
			this.prisma.battlenetAccount.upsert({
				where: { battlenetId },
				update: { battletag, guildId: demande.guildId, verifiedAt: maintenant },
				create: {
					battlenetId,
					userId: demande.userId,
					battletag,
					guildId: demande.guildId,
					verifiedAt: maintenant,
				},
			}),
			// `updateMany` et non `update` : un membre peut se verifier sans etre
			// en quarantaine (verification rejouee apres coup), et l'absence de
			// ligne ne doit pas faire echouer l'enregistrement du lien.
			this.prisma.quarantineStatus.updateMany({
				where: { guildId: demande.guildId, userId: demande.userId },
				data: { battlenetVerifiedAt: maintenant, discordSyncedAt: null },
			}),
		]);

		await this.audit.record({
			action: "battlenet.verification.reussie",
			entityType: "battlenet_account",
			entityId: demande.userId,
			after: { battlenetId },
		});
	}
}
