import {
	ActionRowBuilder,
	ButtonBuilder,
	ButtonStyle,
	ChannelType,
	EmbedBuilder,
	OverwriteType,
	PermissionFlagsBits,
	PermissionsBitField,
	type Guild,
	type GuildBasedChannel,
	type GuildMember,
	type Message,
} from "discord.js";
import * as colors from "../utils/constantes";

/**
 * Apercu des liens de messages Discord.
 *
 * Un membre colle `https://discord.com/channels/<serveur>/<salon>/<message>` :
 * le bot repond avec un embed qui reprend le message cite. Rien n'est stocke —
 * le message est relu a la demande, puis oublie, comme le reste du contenu des
 * messages hors tickets.
 *
 * Le point sensible est la **fuite de salons prives**. Le bot voit les salons
 * du staff et les tickets ; citer n'importe quel lien reviendrait a laisser
 * quiconque lire ces salons en y collant un lien. Deux verifications, et il les
 * faut toutes les deux :
 *
 * - `auteurPeutVoir` : l'auteur du lien voit lui-meme le salon cite.
 * - `audienceIncluse` : tous ceux qui verront l'apercu le voient aussi. Sans
 *   elle, un moderateur qui colle dans #general le lien d'un message du salon
 *   staff publierait ce message pour tout le serveur — lui a le droit de le
 *   lire, son public non. Meme chose d'un ticket a l'autre : l'ouvreur du
 *   second lirait le premier.
 */

/** Au-dela, le message est ignore : un apercu n'est pas un outil de copie. */
export const MAX_LIENS_PAR_MESSAGE = 3;

/** Limite Discord d'une description d'embed. */
const MAX_DESCRIPTION = 4096;

export interface LienDeMessage {
	guildId: string;
	channelId: string;
	messageId: string;
}

/**
 * `discord.com`, `discordapp.com`, et les clients `ptb.` / `canary.`. Le
 * serveur est un identifiant : un lien `@me` (message prive) ne correspond
 * jamais, il n'y a rien a citer.
 *
 * `(?<!<)` ecarte un lien ecrit `<https://…>` : c'est la syntaxe par laquelle
 * Discord laisse un membre refuser l'apercu d'un lien, la respecter va de soi.
 */
const LIEN_DE_MESSAGE =
	/(?<!<)https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})(?!\d)/g;

/**
 * Passages dont le contenu n'est pas « dit » par le membre : blocs de code,
 * code en ligne, spoilers. Un lien colle dans un bloc de code sert d'exemple,
 * un lien sous spoiler a ete cache expres — l'apercu le devoilerait.
 */
const PASSAGES_IGNORES = /```[\s\S]*?```|`[^`\n]*`|\|\|[\s\S]*?\|\|/g;

/**
 * Liens de messages d'un texte, dans l'ordre, sans doublon, plafonnes a
 * `max`. Fonction pure : c'est elle que les tests verrouillent.
 */
export function extraireLiensDeMessages(
	contenu: string,
	max = MAX_LIENS_PAR_MESSAGE,
): LienDeMessage[] {
	const texte = contenu.replace(PASSAGES_IGNORES, " ");
	const vus = new Set<string>();
	const liens: LienDeMessage[] = [];

	for (const [, guildId, channelId, messageId] of texte.matchAll(LIEN_DE_MESSAGE)) {
		if (!guildId || !channelId || !messageId) continue;
		const cle = `${channelId}/${messageId}`;
		if (vus.has(cle)) continue;
		vus.add(cle);
		liens.push({ guildId, channelId, messageId });
		if (liens.length >= max) break;
	}

	return liens;
}

// ---------------------------------------------------------------------------
// Qui peut voir quoi
// ---------------------------------------------------------------------------

const LECTURE = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory;
const ADMINISTRATEUR = PermissionFlagsBits.Administrator;

/** Une surcharge de permission, telle que la porte le salon. */
export interface Surcharge {
	id: string;
	type: OverwriteType;
	allow: bigint;
	deny: bigint;
}

/**
 * Ce qui decide de la visibilite d'un salon. Pour un fil, ce sont les
 * surcharges du **parent** : Discord n'en pose aucune sur un fil.
 */
export interface Visibilite {
	/** Salon porteur des permissions (le parent pour un fil). */
	salonId: string;
	surcharges: Surcharge[];
	/**
	 * Fil prive : seuls ses membres le voient, quelles que soient les
	 * permissions du parent. Son public ne se deduit donc pas des roles.
	 */
	filPriveId: string | null;
}

export interface RoleDuServeur {
	id: string;
	permissions: bigint;
}

/**
 * Permissions d'un role **seul** sur un salon, en partant de celles de
 * `@everyone`, que tout membre porte.
 *
 * `GuildChannel.permissionsFor(role)` de discord.js ne convient pas : il part
 * des seules permissions du role, sans celles de `@everyone`. Or la plupart
 * des roles n'ont aucune permission propre — `ViewChannel` leur vient de
 * `@everyone`. Un salon public aurait alors paru invisible au role staff, et
 * le moindre lien vers #general colle dans un salon staff aurait ete refuse.
 */
export function permissionsDuRole(
	visibilite: Visibilite,
	everyone: RoleDuServeur,
	role: RoleDuServeur,
): bigint {
	let permissions = everyone.permissions | role.permissions;
	if (permissions & ADMINISTRATEUR) return PermissionsBitField.All;

	const surchargeEveryone = visibilite.surcharges.find((s) => s.id === everyone.id);
	if (surchargeEveryone) {
		permissions = (permissions & ~surchargeEveryone.deny) | surchargeEveryone.allow;
	}
	if (role.id !== everyone.id) {
		const surchargeRole = visibilite.surcharges.find(
			(s) => s.id === role.id && s.type === OverwriteType.Role,
		);
		if (surchargeRole) {
			permissions = (permissions & ~surchargeRole.deny) | surchargeRole.allow;
		}
	}
	return permissions;
}

function lit(permissions: bigint | null): boolean {
	return permissions !== null && (permissions & LECTURE) === LECTURE;
}

function voit(permissions: bigint | null): boolean {
	return (
		permissions !== null &&
		(permissions & PermissionFlagsBits.ViewChannel) === PermissionFlagsBits.ViewChannel
	);
}

/**
 * Vrai si tous ceux qui voient la destination peuvent aussi lire la source :
 * l'apercu ne leur apprend alors rien qu'ils n'auraient pu lire eux-memes.
 *
 * Le public se compte par role, puis par membre pour les surcharges
 * nominatives — c'est ainsi qu'un ticket ouvre son salon a son ouvreur.
 * `permissionsDuMembre` rend `null` pour un membre introuvable : faute de
 * pouvoir le verifier, on refuse.
 *
 * L'approximation penche du cote du refus. Un membre qui ne voit la
 * destination que par la **combinaison** de deux roles peut passer entre les
 * mailles, mais pas l'inverse : on ne cite jamais en se fiant a un role qui ne
 * voit pas la source.
 */
export function audienceIncluse(
	destination: Visibilite,
	source: Visibilite,
	roles: RoleDuServeur[],
	everyone: RoleDuServeur,
	permissionsDuMembre: (membreId: string, visibilite: Visibilite) => bigint | null,
): boolean {
	// Un fil prive n'a pour public que ses membres, que les roles ne disent
	// pas : on ne le cite que dans le fil lui-meme.
	if (source.filPriveId !== null) {
		return destination.filPriveId === source.filPriveId;
	}

	// Meme salon porteur (le salon lui-meme, ou l'un de ses fils publics) : le
	// public est le meme, ou plus petit pour un fil prive de destination.
	if (destination.salonId === source.salonId) return true;

	for (const role of [everyone, ...roles]) {
		if (
			voit(permissionsDuRole(destination, everyone, role)) &&
			!lit(permissionsDuRole(source, everyone, role))
		) {
			return false;
		}
	}

	for (const surcharge of destination.surcharges) {
		if (surcharge.type !== OverwriteType.Member) continue;
		const surDestination = permissionsDuMembre(surcharge.id, destination);
		// Introuvable : on ne sait pas s'il voit la destination, on refuse.
		if (surDestination === null) return false;
		if (!voit(surDestination)) continue;
		if (!lit(permissionsDuMembre(surcharge.id, source))) return false;
	}

	return true;
}

// ---------------------------------------------------------------------------
// Passage aux objets discord.js
// ---------------------------------------------------------------------------

function visibiliteDe(channel: GuildBasedChannel): Visibilite | null {
	const porteur = channel.isThread() ? channel.parent : channel;
	if (!porteur || !("permissionOverwrites" in porteur)) return null;

	return {
		salonId: porteur.id,
		surcharges: [...porteur.permissionOverwrites.cache.values()].map((s) => ({
			id: s.id,
			type: s.type,
			allow: s.allow.bitfield,
			deny: s.deny.bitfield,
		})),
		filPriveId: channel.type === ChannelType.PrivateThread ? channel.id : null,
	};
}

/**
 * Le salon cite est-il lisible par l'auteur du lien ?
 *
 * `permissionsFor` d'un fil interroge son parent ; un fil prive exige en plus
 * d'en etre membre, ou de pouvoir gerer les fils (qui donne acces a tous).
 */
export async function auteurPeutVoir(
	channel: GuildBasedChannel,
	member: GuildMember,
): Promise<boolean> {
	const permissions = channel.permissionsFor(member);
	if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
		return false;
	}

	if (channel.type === ChannelType.PrivateThread) {
		if (permissions.has(PermissionFlagsBits.ManageThreads)) return true;
		const membre =
			channel.members.cache.get(member.id) ??
			(await channel.members.fetch({ member: member.id }).catch(() => null));
		return membre !== null && membre !== undefined;
	}

	return true;
}

/**
 * Salon NSFW : son contenu ne s'affiche jamais dans un salon qui ne l'est
 * pas. Un fil herite du marqueur de son parent.
 */
function estNsfw(channel: GuildBasedChannel): boolean {
	const porteur = channel.isThread() ? channel.parent : channel;
	return Boolean(porteur && "nsfw" in porteur && porteur.nsfw);
}

function audienceDuServeurIncluse(
	guild: Guild,
	destination: GuildBasedChannel,
	source: GuildBasedChannel,
): boolean {
	const visDestination = visibiliteDe(destination);
	const visSource = visibiliteDe(source);
	if (!visDestination || !visSource) return false;

	const everyone = {
		id: guild.roles.everyone.id,
		permissions: guild.roles.everyone.permissions.bitfield,
	};
	// Les roles d'integration d'un bot n'ont pour public que ce bot : les
	// compter ferait refuser un apercu parce qu'un bot de musique voit un salon
	// que le salon cite lui cache.
	const roles = [...guild.roles.cache.values()]
		.filter((role) => role.id !== everyone.id && !role.tags?.botId)
		.map((role) => ({ id: role.id, permissions: role.permissions.bitfield }));

	const salons = new Map<string, GuildBasedChannel>([
		[visDestination.salonId, destination.isThread() ? destination.parent ?? destination : destination],
		[visSource.salonId, source.isThread() ? source.parent ?? source : source],
	]);

	return audienceIncluse(visDestination, visSource, roles, everyone, (membreId, vis) => {
		const membre = guild.members.cache.get(membreId);
		const salon = salons.get(vis.salonId);
		if (!membre || !salon) return null;
		return salon.permissionsFor(membre)?.bitfield ?? null;
	});
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function tronquer(texte: string, max: number): string {
	return texte.length <= max ? texte : `${texte.slice(0, max - 1)}…`;
}

/**
 * Premiere image affichable. Une piece jointe sous spoiler est ecartee :
 * l'afficher en grand dans l'apercu reviendrait a lever le voile.
 */
function premiereImage(cite: Message): string | null {
	const piece = cite.attachments.find(
		(a) => !a.spoiler && (a.contentType?.startsWith("image/") ?? false),
	);
	if (piece) return piece.url;

	for (const embed of cite.embeds) {
		const url = embed.image?.url ?? embed.thumbnail?.url;
		if (url) return url;
	}
	return null;
}

export function construireApercu(cite: Message<true>): EmbedBuilder {
	const auteur = cite.member?.displayName ?? cite.author.displayName;

	let texte = cite.content;
	if (!texte) {
		// Message d'un bot ou d'un webhook : souvent tout est dans l'embed.
		const embed = cite.embeds[0];
		texte = [embed?.title, embed?.description].filter(Boolean).join("\n");
	}
	if (!texte) {
		texte = cite.attachments.size
			? `*${cite.attachments.size} pièce(s) jointe(s)*`
			: "*Message sans texte*";
	}

	const apercu = new EmbedBuilder()
		.setColor(colors.info)
		.setAuthor({
			name: auteur,
			iconURL: (cite.member ?? cite.author).displayAvatarURL(),
		})
		.setDescription(tronquer(texte, MAX_DESCRIPTION))
		.setFooter({ text: `#${cite.channel.name}` })
		.setTimestamp(cite.createdAt);

	const image = premiereImage(cite);
	if (image) apercu.setImage(image);

	return apercu;
}

// ---------------------------------------------------------------------------
// Point d'entree
// ---------------------------------------------------------------------------

async function lireCite(
	message: Message<true>,
	member: GuildMember,
	lien: LienDeMessage,
): Promise<Message<true> | null> {
	// Meme serveur seulement : un autre serveur n'a pas a etre lu d'ici, et le
	// bot n'y est peut-etre meme pas.
	if (lien.guildId !== message.guild.id) return null;

	// `guild.channels.fetch` refuse un salon d'un autre serveur, fils compris :
	// un lien qui annoncerait ce serveur mais viserait un salon d'ailleurs
	// echoue ici.
	const source = await message.guild.channels.fetch(lien.channelId).catch(() => null);
	if (!source || source.guildId !== message.guild.id || !source.isTextBased()) return null;

	if (!(await auteurPeutVoir(source, member))) return null;
	if (estNsfw(source) && !estNsfw(message.channel)) return null;
	if (!audienceDuServeurIncluse(message.guild, message.channel, source)) return null;

	const cite = await source.messages.fetch(lien.messageId).catch(() => null);
	return cite && cite.inGuild() ? cite : null;
}

/**
 * Repond au message avec l'apercu des messages qu'il cite. Ne leve jamais :
 * un lien qu'on ne peut pas citer est simplement ignore, sans expliquer
 * pourquoi — dire « tu n'as pas acces » confirmerait que le salon existe.
 */
export async function repondreAvecApercus(message: Message<true>): Promise<void> {
	if (message.author.bot || message.webhookId) return;

	const liens = extraireLiensDeMessages(message.content);
	if (!liens.length) return;

	const member =
		message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
	if (!member) return;

	const cites: Message<true>[] = [];
	for (const lien of liens) {
		const cite = await lireCite(message, member, lien).catch(() => null);
		if (cite) cites.push(cite);
	}
	if (!cites.length) return;

	const boutons = new ActionRowBuilder<ButtonBuilder>().addComponents(
		cites.map((cite, index) =>
			new ButtonBuilder()
				.setStyle(ButtonStyle.Link)
				.setURL(cite.url)
				.setLabel(cites.length > 1 ? `Message ${index + 1}` : "Aller au message"),
		),
	);

	await message
		.reply({
			embeds: cites.map(construireApercu),
			components: [boutons],
			// Ni le contenu cite ni la reponse ne doivent faire sonner qui que ce
			// soit : l'apercu reprend des mentions ecrites pour un autre contexte.
			allowedMentions: { parse: [], repliedUser: false },
		})
		.catch((err: unknown) => {
			console.error("[Apercu] Réponse impossible :", err);
		});
}
