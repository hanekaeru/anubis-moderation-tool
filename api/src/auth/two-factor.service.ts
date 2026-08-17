import {
	BadRequestException,
	ForbiddenException,
	Injectable,
	Logger,
	UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import * as QRCode from "qrcode";
import {
	RECOVERY_CODE_COUNT,
	type TwoFactorRecoveryCodesResponse,
	type TwoFactorSetupResponse,
	type TwoFactorStatus,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import type { AppConfig } from "../config/configuration";
import { PrismaService } from "../prisma/prisma.service";
import type { RequestContext } from "./auth.service";
import { hashSecret, verifySecret } from "./password";
import { TokenService } from "./token.service";
import {
	buildOtpauthUri,
	generateTotpSecret,
	verifyTotp,
	verifyTotpCounter,
} from "./totp";

/**
 * Double authentification par code temporel.
 *
 * Le parcours est en deux temps volontaires : `prepare` genere le secret sans
 * rien activer, `enable` ne l'active qu'apres un premier code valide. Activer
 * des la generation fermerait definitivement un compte dont le secret a ete mal
 * recopie ou dont le QR n'a jamais ete scanne.
 */
@Injectable()
export class TwoFactorService {
	private readonly logger = new Logger(TwoFactorService.name);

	constructor(
		private readonly prisma: PrismaService,
		private readonly tokens: TokenService,
		private readonly audit: AuditService,
		private readonly config: ConfigService<{ app: AppConfig }, true>,
	) {}

	/**
	 * Nom affiche par l'application d'authentification.
	 *
	 * Fixe plutot que tire de la configuration : c'est le nom du produit, pas un
	 * reglage de deploiement, et le changer apres coup ferait apparaitre un
	 * second compte dans l'application sans invalider le premier.
	 */
	private static readonly ISSUER = "Anubis";

	/**
	 * Double authentification proposee sur ce deploiement.
	 *
	 * Lu dans l'environnement (`TWO_FACTOR_ENABLED`), pas en base : un bouton
	 * « desactiver la double authentification » dans le dashboard serait la
	 * premiere chose que chercherait un compte administrateur compromis.
	 */
	get available(): boolean {
		return this.config.get("app", { infer: true }).security.twoFactorEnabled;
	}

	/**
	 * Ferme les ecrans de configuration quand le deploiement l'a coupee.
	 *
	 * Laisser activer une protection inerte serait pire que de la refuser : le
	 * compte se croirait protege alors que sa connexion ne demande toujours que
	 * le mot de passe.
	 */
	private assertAvailable(): void {
		if (!this.available) {
			throw new ForbiddenException(
				"La double authentification est désactivée sur ce serveur.",
			);
		}
	}

	async status(appUserId: string): Promise<TwoFactorStatus> {
		const [account, remaining] = await Promise.all([
			this.prisma.appUser.findUniqueOrThrow({
				where: { id: appUserId },
				select: { totpEnabledAt: true },
			}),
			this.prisma.twoFactorRecoveryCode.count({
				where: { appUserId, usedAt: null },
			}),
		]);

		return {
			available: this.available,
			// L'etat du compte est rendu tel quel, meme quand le deploiement a
			// coupe la protection : le secret existe toujours, et le masquer
			// laisserait croire qu'il faut tout reconfigurer au retour.
			enabled: account.totpEnabledAt !== null,
			enabledAt: account.totpEnabledAt?.toISOString() ?? null,
			remainingRecoveryCodes: remaining,
		};
	}

	/**
	 * Genere un secret et le QR code correspondant.
	 *
	 * Un appel sur un compte deja protege est refuse : regenerer un secret sans
	 * verification prealable permettrait a qui trouve une session ouverte de
	 * substituer son propre telephone a celui du titulaire.
	 */
	async prepare(appUserId: string): Promise<TwoFactorSetupResponse> {
		this.assertAvailable();

		const account = await this.prisma.appUser.findUniqueOrThrow({
			where: { id: appUserId },
			select: { username: true, totpEnabledAt: true },
		});

		if (account.totpEnabledAt) {
			throw new BadRequestException(
				"La double authentification est déjà active. Désactivez-la d'abord pour changer d'appareil.",
			);
		}

		const secret = generateTotpSecret();

		// Le secret est enregistre des maintenant, mais `totpEnabledAt` reste a
		// `null` : il ne protege rien tant que le premier code n'a pas ete
		// verifie. Une preparation abandonnee est donc sans effet.
		await this.prisma.appUser.update({
			where: { id: appUserId },
			data: { totpSecret: secret },
		});

		const otpauthUri = buildOtpauthUri({
			secret,
			account: account.username,
			issuer: TwoFactorService.ISSUER,
		});

		return {
			secret,
			otpauthUri,
			qrCodeDataUri: await QRCode.toDataURL(otpauthUri, {
				errorCorrectionLevel: "M",
				margin: 1,
				width: 240,
			}),
		};
	}

	/** Active la double authentification et remet les codes de secours. */
	async enable(
		appUserId: string,
		code: string,
		context: RequestContext,
	): Promise<TwoFactorRecoveryCodesResponse> {
		this.assertAvailable();

		const account = await this.prisma.appUser.findUniqueOrThrow({
			where: { id: appUserId },
			select: { totpSecret: true, totpEnabledAt: true },
		});

		if (account.totpEnabledAt) {
			throw new BadRequestException("La double authentification est déjà active.");
		}
		if (!account.totpSecret) {
			throw new BadRequestException(
				"Aucune configuration en cours : recommencez depuis le début.",
			);
		}
		if (!verifyTotp(account.totpSecret, code)) {
			throw new UnauthorizedException("Code invalide.");
		}

		// L'activation et les codes de secours partent ensemble : un compte
		// protege sans code de secours n'aurait aucune issue en cas de telephone
		// perdu, et des codes remis sans activation ne serviraient a rien.
		const codes = await this.replaceRecoveryCodes(appUserId, { enable: true });

		await this.audit.record({
			appUserId,
			action: "auth.two_factor_enabled",
			ip: context.ip,
			userAgent: context.userAgent,
		});

		return { codes };
	}

	/**
	 * Desactive la double authentification.
	 *
	 * Mot de passe **et** code : le mot de passe seul suffirait a qui a trouve
	 * une session ouverte, et le code seul a qui a vole le telephone. Exiger les
	 * deux fait de la desactivation une operation aussi difficile que la
	 * connexion elle-meme.
	 *
	 * Volontairement **non soumise** a `assertAvailable` : un compte qui s'est
	 * protege avant que le deploiement ne coupe la double authentification doit
	 * pouvoir faire le menage, sans quoi son secret resterait en base sans aucun
	 * moyen de s'en defaire.
	 */
	async disable(
		appUserId: string,
		password: string,
		code: string,
		context: RequestContext,
	): Promise<void> {
		const account = await this.prisma.appUser.findUniqueOrThrow({
			where: { id: appUserId },
			select: { passwordHash: true, totpSecret: true, totpEnabledAt: true },
		});

		if (!account.totpEnabledAt || !account.totpSecret) {
			throw new BadRequestException("La double authentification n'est pas active.");
		}

		const passwordValid = await verifySecret(account.passwordHash, password);
		if (!passwordValid) {
			throw new UnauthorizedException("Mot de passe incorrect.");
		}

		const accepted =
			verifyTotp(account.totpSecret, code) ||
			(await this.consumeRecoveryCode(appUserId, code));
		if (!accepted) {
			throw new UnauthorizedException("Code invalide.");
		}

		await this.clear(appUserId);

		await this.audit.record({
			appUserId,
			action: "auth.two_factor_disabled",
			ip: context.ip,
			userAgent: context.userAgent,
		});
	}

	/** Regenere les codes de secours, en invalidant les precedents. */
	async regenerateRecoveryCodes(
		appUserId: string,
		code: string,
		context: RequestContext,
	): Promise<TwoFactorRecoveryCodesResponse> {
		this.assertAvailable();

		const account = await this.prisma.appUser.findUniqueOrThrow({
			where: { id: appUserId },
			select: { totpSecret: true, totpEnabledAt: true },
		});

		if (!account.totpEnabledAt || !account.totpSecret) {
			throw new BadRequestException("La double authentification n'est pas active.");
		}
		// Un code de secours ne peut pas servir a en regenerer d'autres : cela
		// donnerait a un code egare la meme portee que le telephone.
		if (!verifyTotp(account.totpSecret, code)) {
			throw new UnauthorizedException("Code invalide.");
		}

		const codes = await this.replaceRecoveryCodes(appUserId);

		await this.audit.record({
			appUserId,
			action: "auth.two_factor_recovery_codes_regenerated",
			ip: context.ip,
			userAgent: context.userAgent,
		});

		return { codes };
	}

	/**
	 * Verifie le second facteur a la connexion.
	 *
	 * Le pas de temps accepte est retenu et tout pas anterieur ou egal est
	 * ensuite refuse : sans cela, un code lu par-dessus l'epaule reste utilisable
	 * pendant la minute et demie de la fenetre de tolerance.
	 *
	 * Un code de secours consomme est **marque**, jamais supprime : le compte
	 * doit pouvoir constater combien il lui en reste, et un code deja utilise
	 * qui revient est un signal, pas un accident.
	 */
	async verifySecondFactor(appUserId: string, code: string): Promise<boolean> {
		const account = await this.prisma.appUser.findUnique({
			where: { id: appUserId },
			select: { totpSecret: true, totpEnabledAt: true, totpLastCounter: true },
		});

		if (!account?.totpEnabledAt || !account.totpSecret) return false;

		const counter = verifyTotpCounter(account.totpSecret, code);

		if (counter !== null) {
			if (
				account.totpLastCounter !== null &&
				counter <= account.totpLastCounter
			) {
				this.logger.warn(
					`Code TOTP rejoué refusé pour le compte ${appUserId} (pas ${counter}).`,
				);
				return false;
			}

			// `lt` dans la clause : deux connexions simultanees avec le meme code
			// n'en laissent passer qu'une, la seconde retombant sur le refus
			// ci-dessus au prochain passage.
			const { count } = await this.prisma.appUser.updateMany({
				where: {
					id: appUserId,
					OR: [{ totpLastCounter: null }, { totpLastCounter: { lt: counter } }],
				},
				data: { totpLastCounter: counter },
			});

			return count > 0;
		}

		return this.consumeRecoveryCode(appUserId, code);
	}

	/**
	 * Retire la double authentification d'un compte, sans rien verifier.
	 *
	 * Reserve a la reinitialisation par le proprietaire : un telephone perdu
	 * sans code de secours rendrait sinon le compte definitivement inaccessible,
	 * et il n'existe aucune route de recuperation par courriel.
	 */
	async reset(appUserId: string, actor: { id: string }): Promise<void> {
		await this.clear(appUserId);
		// Les sessions ouvertes du compte tombent avec : si la reinitialisation
		// fait suite a une compromission, les laisser vivre annulerait la mesure.
		await this.tokens.revokeAllForUser(appUserId);

		await this.audit.record({
			appUserId: actor.id,
			action: "auth.two_factor_reset",
			entityType: "app_user",
			entityId: appUserId,
		});

		this.logger.warn(
			`Double authentification du compte ${appUserId} réinitialisée par ${actor.id}.`,
		);
	}

	private async clear(appUserId: string): Promise<void> {
		await this.prisma.$transaction([
			this.prisma.twoFactorRecoveryCode.deleteMany({ where: { appUserId } }),
			this.prisma.appUser.update({
				where: { id: appUserId },
				data: { totpSecret: null, totpEnabledAt: null, totpLastCounter: null },
			}),
		]);
	}

	/**
	 * Remplace le jeu de codes de secours et renvoie les valeurs en clair.
	 *
	 * C'est le seul instant ou elles existent en clair : la base ne garde que
	 * des empreintes argon2, comme pour un mot de passe. Un code perdu ne se
	 * retrouve pas, il se regenere.
	 */
	private async replaceRecoveryCodes(
		appUserId: string,
		options: { enable?: boolean } = {},
	): Promise<string[]> {
		const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
			// 5 octets = 10 chiffres hexadecimaux, coupes en deux groupes lisibles.
			randomBytes(5).toString("hex").toUpperCase().replace(/^(.{5})/, "$1-"),
		);

		const hashes = await Promise.all(
			codes.map((code) => hashSecret(code)),
		);

		await this.prisma.$transaction(async (tx) => {
			await tx.twoFactorRecoveryCode.deleteMany({ where: { appUserId } });
			await tx.twoFactorRecoveryCode.createMany({
				data: hashes.map((codeHash) => ({ appUserId, codeHash })),
			});

			if (options.enable) {
				await tx.appUser.update({
					where: { id: appUserId },
					data: { totpEnabledAt: new Date() },
				});
			}
		});

		return codes;
	}

	/**
	 * Consomme un code de secours.
	 *
	 * Les empreintes argon2 ne se cherchent pas par index : chaque code encore
	 * valide est verifie a son tour. Ils sont dix au plus, et cette route n'est
	 * atteinte qu'apres un mot de passe correct.
	 */
	private async consumeRecoveryCode(
		appUserId: string,
		code: string,
	): Promise<boolean> {
		const normalized = code.trim().toUpperCase();
		if (!normalized) return false;

		const candidates = await this.prisma.twoFactorRecoveryCode.findMany({
			where: { appUserId, usedAt: null },
		});

		for (const candidate of candidates) {
			const matches = await verifySecret(candidate.codeHash, normalized);

			if (matches) {
				// `usedAt: null` dans la clause : deux requetes simultanees portant le
				// meme code n'en valident qu'une seule.
				const { count } = await this.prisma.twoFactorRecoveryCode.updateMany({
					where: { id: candidate.id, usedAt: null },
					data: { usedAt: new Date() },
				});

				if (count === 0) return false;

				this.logger.warn(
					`Connexion du compte ${appUserId} par code de secours.`,
				);
				return true;
			}
		}

		return false;
	}
}
