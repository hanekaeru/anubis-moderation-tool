import {
	BadRequestException,
	Injectable,
	NotFoundException,
	PayloadTooLargeException,
} from "@nestjs/common";
import {
	MAX_MODERATION_ATTACHMENTS,
	MAX_MODERATION_ATTACHMENT_BYTES,
	MODERATION_ATTACHMENT_CONTENT_TYPES,
	type ModerationAttachmentRef,
} from "@anubis/shared";
import { AuditService } from "../audit/audit.service";
import { GuildContextService } from "../common/guild-context.service";
import { toAttachmentRef } from "../common/mappers";
import type { AuthenticatedUser } from "../common/types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Pieces jointes des decisions de moderation.
 *
 * Un seul service pour les avertissements et les sanctions : le stockage est
 * identique, seule change la colonne qui porte le rattachement. `Cible`
 * materialise ce choix et garantit qu'exactement une des deux est renseignee —
 * la contrainte n'existe pas en base, c'est ici qu'elle est tenue.
 *
 * Les octets vivent en base (`bytea`), comme les pieces jointes de tickets :
 * une preuve doit survivre a la disparition du message qu'elle documente.
 */

export type Cible = "sanction" | "warning";

const UPLOAD_INCLUDE = { uploadedBy: true, uploadedByDiscord: true } as const;

/**
 * Types acceptes, partages avec le dashboard et la commande `/preuve` du bot.
 *
 * L'API reste la seule a faire foi : les deux autres ne s'en servent que pour
 * eviter a l'utilisateur un aller-retour perdu.
 */
const ALLOWED_CONTENT_TYPES: readonly string[] =
	MODERATION_ATTACHMENT_CONTENT_TYPES;

@Injectable()
export class ModerationAttachmentsService {
	constructor(
		private readonly prisma: PrismaService,
		private readonly guild: GuildContextService,
		private readonly audit: AuditService,
	) {}

	/** Verifie que la decision existe bien sur ce serveur avant tout acces. */
	private async garantirCible(cible: Cible, id: string): Promise<void> {
		const guildId = this.guild.guildId;

		const existe =
			cible === "sanction"
				? await this.prisma.sanction.findFirst({ where: { id, guildId } })
				: await this.prisma.warning.findFirst({ where: { id, guildId } });

		if (!existe) {
			throw new NotFoundException(
				cible === "sanction"
					? "Sanction introuvable."
					: "Avertissement introuvable.",
			);
		}
	}

	private lien(cible: Cible, id: string) {
		return cible === "sanction" ? { sanctionId: id } : { warningId: id };
	}

	async list(cible: Cible, id: string): Promise<ModerationAttachmentRef[]> {
		await this.garantirCible(cible, id);

		const rows = await this.prisma.moderationAttachment.findMany({
			where: this.lien(cible, id),
			orderBy: { createdAt: "asc" },
			include: UPLOAD_INCLUDE,
		});

		return rows.map((row) => toAttachmentRef(row));
	}

	async upload(
		cible: Cible,
		id: string,
		file: Express.Multer.File | undefined,
		actor: AuthenticatedUser,
		spoiler = false,
	): Promise<ModerationAttachmentRef> {
		if (!file) throw new BadRequestException("Aucun fichier reçu.");

		await this.garantirCible(cible, id);

		// Multer coupe deja au-dela de la limite, mais il la signale par une
		// exception generique : ce controle redit la meme regle avec un message
		// utilisable, et protege si l'intercepteur venait a etre mal configure.
		if (file.size > MAX_MODERATION_ATTACHMENT_BYTES) {
			throw new PayloadTooLargeException(
				`Fichier trop volumineux (max ${Math.floor(MAX_MODERATION_ATTACHMENT_BYTES / 1024 / 1024)} Mo).`,
			);
		}

		if (!ALLOWED_CONTENT_TYPES.includes(file.mimetype)) {
			throw new BadRequestException(
				`Type de fichier non accepte (${file.mimetype}).`,
			);
		}

		const deja = await this.prisma.moderationAttachment.count({
			where: this.lien(cible, id),
		});

		if (deja >= MAX_MODERATION_ATTACHMENTS) {
			throw new BadRequestException(
				`Maximum ${MAX_MODERATION_ATTACHMENTS} pièces jointes par décision.`,
			);
		}

		const created = await this.prisma.moderationAttachment.create({
			data: {
				...this.lien(cible, id),
				// `originalname` vient du client : il ne sert qu'a l'affichage et au
				// nom de telechargement, jamais a un chemin sur disque.
				fileName: file.originalname.slice(0, 255),
				contentType: file.mimetype,
				size: file.size,
				// `Buffer` de Node porte un `ArrayBufferLike` que Prisma refuse
				// depuis qu'il attend un `Uint8Array<ArrayBuffer>` : cette copie
				// fixe le type sans changer les octets.
				data: new Uint8Array(file.buffer),
				spoiler,
				uploadedById: actor.id,
			},
			include: UPLOAD_INCLUDE,
		});

		await this.audit.record({
			appUserId: actor.id,
			action: `${cible}.attachment.add`,
			entityType: cible,
			entityId: id,
			after: {
				attachmentId: created.id,
				fileName: created.fileName,
				size: created.size,
				spoiler: created.spoiler,
			},
		});

		return toAttachmentRef(created);
	}

	/** Renvoie les octets, pour la route de telechargement. */
	async download(cible: Cible, id: string, attachmentId: string) {
		await this.garantirCible(cible, id);

		const attachment = await this.prisma.moderationAttachment.findFirst({
			where: { id: attachmentId, ...this.lien(cible, id) },
		});

		if (!attachment) throw new NotFoundException("Pièce jointe introuvable.");

		return attachment;
	}

	async remove(
		cible: Cible,
		id: string,
		attachmentId: string,
		actor: AuthenticatedUser,
	): Promise<void> {
		const attachment = await this.download(cible, id, attachmentId);

		await this.prisma.moderationAttachment.delete({
			where: { id: attachment.id },
		});

		await this.audit.record({
			appUserId: actor.id,
			action: `${cible}.attachment.remove`,
			entityType: cible,
			entityId: id,
			before: {
				attachmentId: attachment.id,
				fileName: attachment.fileName,
				size: attachment.size,
			},
		});
	}
}
