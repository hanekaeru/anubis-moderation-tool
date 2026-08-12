import type {
	Message,
	OmitPartialGroupDMChannel,
	PartialMessage,
} from "discord.js";
import prisma from "../prisma";
import { readInt } from "../env";

/**
 * Activite des membres.
 *
 * Aucun contenu de message n'est conserve : seulement des compteurs. Deux
 * agregats sont tenus en parallele — un par jour et par salon, qui alimente les
 * courbes, et un profil cumule par creneau (jour de semaine x heure), qui
 * alimente la carte de chaleur.
 *
 * Tout passe par un buffer memoire : un serveur actif produit des dizaines de
 * messages par minute, et une ecriture par message saturerait la base sans
 * gagner la moindre precision.
 */

const TAILLE_BUFFER_PAR_DEFAUT = 200;
const DELAI_VIDAGE_PAR_DEFAUT = 15_000;

type MessageEvenement = OmitPartialGroupDMChannel<Message | PartialMessage>;

interface StatAggregate {
	guildId: string;
	userId: string;
	channelId: string;
	jour: Date;
	messageCount: number;
	attachmentCount: number;
	editedCount: number;
	deletedCount: number;
	totalCharacters: number;
}

type StatField = Exclude<
	keyof StatAggregate,
	"guildId" | "userId" | "channelId" | "jour"
>;

interface ProfilAggregate {
	guildId: string;
	userId: string;
	weekday: number;
	hour: number;
	messageCount: number;
}

interface CollecteurActiviteOptions {
	tailleMax?: number;
	delaiVidage?: number;
}

/** Jour UTC, aligne sur la colonne `day` de type DATE. */
function jourUtc(date: Date): Date {
	return new Date(
		Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
	);
}

/** 0 = lundi, comme le schema ; `getUTCDay` compte a partir de dimanche. */
function jourDeSemaine(date: Date): number {
	return (date.getUTCDay() + 6) % 7;
}

class CollecteurActivite {
	private readonly statsBuffer = new Map<string, StatAggregate>();
	private readonly profilBuffer = new Map<string, ProfilAggregate>();
	private readonly tailleMax: number;
	private readonly delaiVidage: number;
	private timer: NodeJS.Timeout | null = null;
	private enCours = false;

	constructor(options: CollecteurActiviteOptions = {}) {
		this.tailleMax =
			options.tailleMax ??
			readInt("ACTIVITY_BUFFER_SIZE", TAILLE_BUFFER_PAR_DEFAUT);
		this.delaiVidage =
			options.delaiVidage ??
			readInt("ACTIVITY_FLUSH_DELAY", DELAI_VIDAGE_PAR_DEFAUT);
	}

	/** Cle d'agregat journalier. Le `|` ne peut pas apparaitre dans un snowflake. */
	static cleStats(
		guildId: string,
		userId: string,
		channelId: string,
		jour: Date,
	): string {
		return `${guildId}|${userId}|${channelId}|${jour.toISOString().slice(0, 10)}`;
	}

	static cleProfil(
		guildId: string,
		userId: string,
		weekday: number,
		hour: number,
	): string {
		return `${guildId}|${userId}|${weekday}|${hour}`;
	}

	incrementer(
		guildId: string,
		userId: string,
		channelId: string,
		date: Date,
		champs: Partial<Record<StatField, number>>,
	): void {
		const jour = jourUtc(date);
		const cle = CollecteurActivite.cleStats(
			guildId,
			userId,
			channelId,
			jour,
		);

		const courant = this.statsBuffer.get(cle) ?? {
			guildId,
			userId,
			channelId,
			jour,
			messageCount: 0,
			attachmentCount: 0,
			editedCount: 0,
			deletedCount: 0,
			totalCharacters: 0,
		};

		for (const [champ, valeur] of Object.entries(champs) as [
			StatField,
			number,
		][]) {
			courant[champ] += valeur;
		}

		this.statsBuffer.set(cle, courant);
		this.planifierVidage();
	}

	/** Un message poste : compteur journalier et creneau horaire. */
	enregistrerMessage(message: Message<true>): void {
		const date = message.createdAt;
		const weekday = jourDeSemaine(date);
		const hour = date.getUTCHours();

		this.incrementer(
			message.guild.id,
			message.author.id,
			message.channel.id,
			date,
			{
				messageCount: 1,
				attachmentCount: message.attachments.size,
				// `content` est vide sans l'intent privilegie MESSAGE_CONTENT. La
				// longueur moyenne affichee dans le dashboard reste donc a zero tant
				// que cet intent n'est pas active — dans les deux cas, le texte
				// lui-meme n'est jamais stocke.
				totalCharacters: message.content?.length ?? 0,
			},
		);

		const cle = CollecteurActivite.cleProfil(
			message.guild.id,
			message.author.id,
			weekday,
			hour,
		);

		const profil = this.profilBuffer.get(cle) ?? {
			guildId: message.guild.id,
			userId: message.author.id,
			weekday,
			hour,
			messageCount: 0,
		};

		profil.messageCount += 1;
		this.profilBuffer.set(cle, profil);
	}

	/**
	 * Une edition ou une suppression.
	 *
	 * Comptabilisee au jour du message d'origine, pas au jour de l'action : un
	 * message supprime trois jours plus tard appartient toujours a son jour de
	 * publication.
	 */
	enregistrerEdition(message: MessageEvenement): void {
		if (!message.guild || !message.author) return;
		this.incrementer(
			message.guild.id,
			message.author.id,
			message.channel.id,
			message.createdAt,
			{ editedCount: 1 },
		);
	}

	enregistrerSuppression(message: MessageEvenement): void {
		if (!message.guild || !message.author) return;
		this.incrementer(
			message.guild.id,
			message.author.id,
			message.channel.id,
			message.createdAt,
			{ deletedCount: 1 },
		);
	}

	private planifierVidage(): void {
		if (this.statsBuffer.size + this.profilBuffer.size >= this.tailleMax) {
			void this.vider();
			return;
		}

		if (!this.timer) {
			this.timer = setTimeout(() => this.vider(), this.delaiVidage);
		}
	}

	async vider(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}

		if (this.enCours) return;
		if (this.statsBuffer.size === 0 && this.profilBuffer.size === 0) return;

		this.enCours = true;

		const stats = Array.from(this.statsBuffer.values());
		const profils = Array.from(this.profilBuffer.values());
		this.statsBuffer.clear();
		this.profilBuffer.clear();

		try {
			await prisma.$transaction([
				...stats.map((entree) =>
					prisma.messageStat.upsert({
						where: {
							guildId_userId_channelId_day: {
								guildId: entree.guildId,
								userId: entree.userId,
								channelId: entree.channelId,
								day: entree.jour,
							},
						},
						update: {
							messageCount: { increment: entree.messageCount },
							attachmentCount: {
								increment: entree.attachmentCount,
							},
							editedCount: { increment: entree.editedCount },
							deletedCount: { increment: entree.deletedCount },
							totalCharacters: {
								increment: BigInt(entree.totalCharacters),
							},
						},
						create: {
							guildId: entree.guildId,
							userId: entree.userId,
							channelId: entree.channelId,
							day: entree.jour,
							messageCount: entree.messageCount,
							attachmentCount: entree.attachmentCount,
							editedCount: entree.editedCount,
							deletedCount: entree.deletedCount,
							totalCharacters: BigInt(entree.totalCharacters),
						},
					}),
				),
				...profils.map((entree) =>
					prisma.memberActivityProfile.upsert({
						where: {
							guildId_userId_weekday_hour: {
								guildId: entree.guildId,
								userId: entree.userId,
								weekday: entree.weekday,
								hour: entree.hour,
							},
						},
						update: {
							messageCount: { increment: entree.messageCount },
						},
						create: entree,
					}),
				),
			]);

			console.log(
				`[Activite] ${stats.length} agregat(s) et ${profils.length} creneau(x) enregistre(s).`,
			);
		} catch (err) {
			console.error("[Activite] Erreur lors de la sauvegarde BDD :", err);
			this.restaurer(stats, profils);
		} finally {
			this.enCours = false;
		}
	}

	/**
	 * Remet dans le buffer ce qui n'a pas pu etre ecrit.
	 *
	 * Des compteurs ont pu s'accumuler pendant la tentative : ils sont
	 * additionnes plutot qu'ecrases, sinon l'echec ferait perdre l'activite
	 * survenue pendant le vidage.
	 */
	private restaurer(
		stats: StatAggregate[],
		profils: ProfilAggregate[],
	): void {
		for (const entree of stats) {
			const cle = CollecteurActivite.cleStats(
				entree.guildId,
				entree.userId,
				entree.channelId,
				entree.jour,
			);
			const existant = this.statsBuffer.get(cle);

			if (!existant) {
				this.statsBuffer.set(cle, entree);
				continue;
			}

			existant.messageCount += entree.messageCount;
			existant.attachmentCount += entree.attachmentCount;
			existant.editedCount += entree.editedCount;
			existant.deletedCount += entree.deletedCount;
			existant.totalCharacters += entree.totalCharacters;
		}

		for (const entree of profils) {
			const cle = CollecteurActivite.cleProfil(
				entree.guildId,
				entree.userId,
				entree.weekday,
				entree.hour,
			);
			const existant = this.profilBuffer.get(cle);

			if (existant) {
				existant.messageCount += entree.messageCount;
			} else {
				this.profilBuffer.set(cle, entree);
			}
		}
	}
}

// Instance unique : plusieurs fichiers d'evenements alimentent le meme buffer,
// sinon chacun viderait le sien de son cote.
export default new CollecteurActivite();
