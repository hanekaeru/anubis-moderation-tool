import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import type {
	DiscordLinkCodeDto,
	DiscordLinkStatusDto,
} from "@anubis/shared";
import { DISCORD_LINK_CODE_TTL_MINUTES } from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";

/** Alphabet sans caracteres ambigus (0/O, 1/I) : le code se recopie a la main. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function generateCode(): string {
	const bytes = randomBytes(CODE_LENGTH);
	let code = "";
	for (let i = 0; i < CODE_LENGTH; i++) {
		code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
	}
	return code;
}

@Injectable()
export class AccountService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly audit: AuditService,
	) {}

	/** Remplace tout code non consomme deja genere pour ce compte. */
	async generateDiscordLinkCode(
		actor: AuthenticatedUser,
	): Promise<DiscordLinkCodeDto> {
		const expiresAt = new Date(
			Date.now() + DISCORD_LINK_CODE_TTL_MINUTES * 60_000,
		);

		const created = await this.prisma.accountLinkCode.upsert({
			where: { appUserId: actor.id },
			update: { code: generateCode(), expiresAt },
			create: { appUserId: actor.id, code: generateCode(), expiresAt },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "account.discord_link_code_generated",
		});

		return { code: created.code, expiresAt: created.expiresAt.toISOString() };
	}

	async getDiscordLink(
		actor: AuthenticatedUser,
	): Promise<DiscordLinkStatusDto> {
		const account = await this.prisma.appUser.findUnique({
			where: { id: actor.id },
			include: { discordUser: true },
		});

		return {
			discordUserId: account?.discordUserId ?? null,
			discordUsername:
				account?.discordUser?.globalName ??
				account?.discordUser?.username ??
				null,
		};
	}

	async unlinkDiscord(
		actor: AuthenticatedUser,
	): Promise<DiscordLinkStatusDto> {
		await this.prisma.appUser.update({
			where: { id: actor.id },
			data: { discordUserId: null },
		});

		// Un code non consomme n'a plus de sens une fois le lien retire.
		await this.prisma.accountLinkCode.deleteMany({
			where: { appUserId: actor.id },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: "account.discord_unlinked",
		});

		return { discordUserId: null, discordUsername: null };
	}
}
