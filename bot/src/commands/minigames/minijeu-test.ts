import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import {
	MINIGAME_TIME_ZONE,
	MINIGAME_TYPE_EMOJIS,
	MINIGAME_TYPE_LABELS,
	MinigameType,
	addDaysToKey,
	isDateKey,
	isTimeOfDay,
	minigameEventProblem,
	minigamePingInstant,
	zonedDateKey,
	zonedTimeOfDay,
	zonedWallTimeToUtc,
} from "@anubis/shared";
import type { MinigameEvent, Prisma } from "@anubis/shared/prisma";
import * as horloge from "../../collectors/minigameClock";
import * as minigames from "../../collectors/minigames";
import prisma from "../../prisma";
import { synchroniserMiniJeux } from "../../tasks/minigameSync";
import type { Command } from "../../types";
import * as colors from "../../utils/constantes";

/**
 * `/minijeu-test` : recette du calendrier des mini-jeux sans attendre minuit.
 *
 * N'existe qu'avec `MINIGAME_TEST_MODE=true` (`testOnly`) : ni chargee ni
 * publiee aupres de Discord sinon. Reservee aux administrateurs, declaree
 * **et** reverifiee comme `/xp-admin`.
 *
 * Elle ne contourne aucune regle : elle deplace l'heure vue par le bot
 * (`minigameClock.ts`) et laisse le vrai cycle de `minigameSync.ts` faire le
 * travail. Ce qui est teste est donc exactement ce qui tournera en production.
 * La recette complete est dans `docs/recette-mini-jeux.md`.
 */

const versDate = (key: string) => new Date(`${key}T00:00:00Z`);
const versCle = (date: Date) => date.toISOString().slice(0, 10);

const ETAPES: Record<horloge.EtapeMiniJeu, string> = {
	publication: "Publication (minuit)",
	ping: "Ping (heure réglée)",
	fermeture: "Fermeture (minuit le lendemain)",
};

/** Ordre de la semaine de test : les jeux a deviner d'abord, les plus longs a recetter. */
const SEMAINE_DE_TEST: readonly MinigameType[] = [
	MinigameType.GUESS_HERO,
	MinigameType.GUESS_MAP,
	MinigameType.GUESS_SKIN,
	MinigameType.TRUE_FALSE,
	MinigameType.DUEL,
	MinigameType.CLIP,
];

/** Le skin de test : six lettres, assez pour que la tolerance aux fautes joue. */
const SKIN_DE_TEST = "Anubis";

const command: Command = {
	testOnly: true,
	data: new SlashCommandBuilder()
		.setName("minijeu-test")
		.setDescription("[Recette] Teste le calendrier des mini-jeux sans attendre minuit.")
		.setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
		.addSubcommand((sub) => sub.setName("etat").setDescription("Heure simulée et état du jeu du jour."))
		.addSubcommand((sub) =>
			sub
				.setName("etape")
				.setDescription("Avance l'horloge jusqu'à une étape d'un jeu et la déclenche.")
				.addStringOption((o) =>
					o
						.setName("etape")
						.setDescription("Étape à déclencher.")
						.setRequired(true)
						.addChoices(
							...Object.entries(ETAPES).map(([value, name]) => ({ name, value })),
						),
				)
				.addStringOption((o) =>
					o.setName("date").setDescription("Jour du jeu (AAAA-MM-JJ). Défaut : jour simulé courant.").setMaxLength(10),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("horloge")
				.setDescription("Place l'horloge des mini-jeux à une date et une heure de Paris.")
				.addStringOption((o) => o.setName("date").setDescription("AAAA-MM-JJ").setRequired(true).setMaxLength(10))
				.addStringOption((o) => o.setName("heure").setDescription("HH:MM, heure de Paris").setRequired(true).setMaxLength(5)),
		)
		.addSubcommand((sub) => sub.setName("heure-reelle").setDescription("Remet l'horloge des mini-jeux à l'heure réelle."))
		.addSubcommand((sub) =>
			sub
				.setName("semaine")
				.setDescription("Crée un jeu de test de chaque type, un par jour libre.")
				.addStringOption((o) =>
					o.setName("depart").setDescription("Premier jour (AAAA-MM-JJ). Défaut : lendemain du jour simulé.").setMaxLength(10),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("rejouer")
				.setDescription("Remet un jeu à zéro : publication, ping, fermeture et parties.")
				.addStringOption((o) =>
					o.setName("date").setDescription("Jour du jeu (AAAA-MM-JJ). Défaut : jour simulé courant.").setMaxLength(10),
				)
				.addBooleanOption((o) =>
					o.setName("parties-seulement").setDescription("N'efface que les essais des joueurs, le jeu reste publié."),
				),
		),

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		// Double garde : le chargeur l'ecarte deja hors mode test, mais une
		// commande publiee pendant une recette resterait sinon cliquable apres.
		if (!horloge.modeTestActif()) {
			await interaction.reply({
				content: "Le mode test des mini-jeux n'est pas actif (`MINIGAME_TEST_MODE`).",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
			await interaction.reply({ content: "Cette commande est réservée aux administrateurs.", flags: MessageFlags.Ephemeral });
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		switch (interaction.options.getSubcommand()) {
			case "etat":
				await interaction.editReply({ embeds: [await etat(interaction.guildId)] });
				return;
			case "etape":
				return etape(interaction);
			case "horloge":
				return reglerHorloge(interaction);
			case "heure-reelle":
				horloge.revenirALHeureReelle();
				return apresSaut(interaction, "Horloge remise à l'heure réelle.");
			case "semaine":
				return semaine(interaction);
			case "rejouer":
				return rejouer(interaction);
		}
	},
};

// ---------------------------------------------------------------------------
// Horloge
// ---------------------------------------------------------------------------

function lireJour(interaction: ChatInputCommandInteraction, option: string, defaut: string): string | null {
	const saisie = interaction.options.getString(option)?.trim();
	if (!saisie) return defaut;
	return isDateKey(saisie) ? saisie : null;
}

async function etape(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	const jour = lireJour(interaction, "date", horloge.jourCourant());
	if (!jour) {
		await interaction.editReply("Date invalide : format attendu AAAA-MM-JJ.");
		return;
	}
	const quoi = interaction.options.getString("etape", true) as horloge.EtapeMiniJeu;
	const config = await minigames.reglage(interaction.guildId, true);
	horloge.regler(horloge.instantDeLEtape(jour, quoi, config.pingTime));
	await apresSaut(interaction, `Horloge placée sur l'étape **${ETAPES[quoi]}** du ${jour}.`);
}

async function reglerHorloge(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	const date = interaction.options.getString("date", true).trim();
	const heure = interaction.options.getString("heure", true).trim();
	if (!isDateKey(date) || !isTimeOfDay(heure)) {
		await interaction.editReply("Format attendu : date AAAA-MM-JJ et heure HH:MM.");
		return;
	}
	horloge.regler(zonedWallTimeToUtc(date, heure, MINIGAME_TIME_ZONE));
	await apresSaut(interaction, `Horloge placée au ${date} à ${heure} (Paris).`);
}

/**
 * Rejoue tout de suite le cycle du bot plutot que d'attendre le passage de
 * cinq secondes : la reponse peut ainsi montrer ce que le saut a declenche.
 */
async function apresSaut(interaction: ChatInputCommandInteraction<"cached">, message: string): Promise<void> {
	minigames.viderCaches();
	await synchroniserMiniJeux(interaction.client).catch((err) => console.error("[Mini-jeux][Test] Passage échoué :", err));
	await interaction.editReply({ content: message, embeds: [await etat(interaction.guildId)] });
}

// ---------------------------------------------------------------------------
// Etat
// ---------------------------------------------------------------------------

const date = (d: Date | null) =>
	d ? `${zonedDateKey(d, MINIGAME_TIME_ZONE)} ${zonedTimeOfDay(d, MINIGAME_TIME_ZONE)}` : null;
const etapeLigne = (libelle: string, quand: Date | null) => `${quand ? "✅" : "⏳"} ${libelle}${quand ? ` — ${date(quand)}` : ""}`;

async function etat(guildId: string): Promise<EmbedBuilder> {
	const now = horloge.maintenant();
	const jour = horloge.jourCourant();
	const config = await minigames.reglage(guildId, true);

	const embed = new EmbedBuilder()
		.setColor(horloge.estDecalee() ? colors.warning : colors.info)
		.setTitle("🧪 Recette des mini-jeux")
		.addFields({
			name: "Horloge",
			value: `${horloge.estDecalee() ? "**Simulée**" : "Réelle"} : ${date(now)} (Paris)\nPing réglé à ${config.pingTime}`,
		});

	const reglages = [
		config.announceChannelId ? `Annonce : <#${config.announceChannelId}>` : "⚠️ Aucun salon d'annonce : rien ne sera publié.",
		config.playChannelId ? `Jeu : <#${config.playChannelId}>` : "Jeu : partout (aucun salon réglé)",
		config.pingRoleId ? `Rôle pingé : <@&${config.pingRoleId}>` : "⚠️ Aucun rôle pingé : le ping sera sauté.",
	];
	embed.addFields({ name: "Réglage", value: reglages.join("\n") });

	// Le jeu de la veille : apres un saut a sa fermeture, c'est lui qu'on veut
	// voir, alors que le jour courant est deja le suivant.
	const veille = await prisma.minigameEvent.findFirst({
		where: { guildId, day: { lt: versDate(jour) }, publishedAt: { not: null } },
		orderBy: { day: "desc" },
	});
	if (veille) {
		embed.addFields({ name: `Dernier jeu passé (${versCle(veille.day)})`, value: await resume(veille, now, config.pingTime) });
	}

	const jeu = await prisma.minigameEvent.findUnique({ where: { guildId_day: { guildId, day: versDate(jour) } } });
	if (!jeu) {
		embed.addFields({ name: `Jeu du ${jour}`, value: "Aucun jeu ce jour-là." });
	} else {
		embed.addFields({ name: `Jeu du ${jour}`, value: await resume(jeu, now, config.pingTime) });
	}

	const prochains = await prisma.minigameEvent.findMany({
		where: { guildId, day: { gt: versDate(jour) } },
		orderBy: { day: "asc" },
		take: 7,
	});
	if (prochains.length) {
		embed.addFields({
			name: "Jours suivants",
			value: prochains
				.map((j) => `\`${versCle(j.day)}\` ${MINIGAME_TYPE_EMOJIS[j.type as MinigameType]} ${j.title}${j.publishedAt ? " (déjà publié)" : ""}`)
				.join("\n"),
		});
	}
	return embed;
}

async function resume(jeu: MinigameEvent, now: Date, pingTime: string): Promise<string> {
	const type = jeu.type as MinigameType;
	const [parties, trouves] = await Promise.all([
		prisma.minigameGame.count({ where: { eventId: jeu.id, attempts: { gt: 0 } } }),
		prisma.minigameGame.count({ where: { eventId: jeu.id, solvedAt: { not: null } } }),
	]);
	const ping = minigamePingInstant(versCle(jeu.day), pingTime);

	const lignes = [
		`${MINIGAME_TYPE_EMOJIS[type]} **${jeu.title}** — ${MINIGAME_TYPE_LABELS[type]}`,
		`Réponse : ${await reponse(jeu)}`,
		etapeLigne("Publié", jeu.publishedAt),
		etapeLigne(`Pingé${!jeu.pingedAt && now < ping ? ` (prévu à ${pingTime})` : ""}`, jeu.pingedAt),
		etapeLigne("Fermé", jeu.closedAt),
		jeu.publishedAt && !jeu.discordSyncedAt ? "🔄 Correction en attente" : null,
		`Joueurs : ${parties} · trouvé : ${trouves}`,
		jeu.lastError ? `❌ Dernière erreur : ${jeu.lastError}` : null,
	];
	return lignes.filter(Boolean).join("\n").slice(0, 1024);
}

async function reponse(jeu: MinigameEvent): Promise<string> {
	const noms = await minigames.nomsDeReponse(jeu);
	switch (jeu.type as MinigameType) {
		case MinigameType.GUESS_HERO:
			return `||${noms.hero ?? jeu.answerHeroKey}||`;
		case MinigameType.GUESS_MAP:
			return `||${noms.map ?? jeu.answerMapKey}||`;
		case MinigameType.GUESS_SKIN:
			return `||${jeu.answerSkin} (${noms.hero ?? jeu.answerHeroKey})||`;
		case MinigameType.TRUE_FALSE:
			return `||${jeu.answerTrue ? "Vrai" : "Faux"}||`;
		default:
			return "aucune (sondage ou clip)";
	}
}

// ---------------------------------------------------------------------------
// Donnees de test
// ---------------------------------------------------------------------------

function auHasard<T>(liste: readonly T[]): T | undefined {
	return liste[Math.floor(Math.random() * liste.length)];
}

async function semaine(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	const depart = lireJour(interaction, "depart", addDaysToKey(horloge.jourCourant(), 1));
	if (!depart) {
		await interaction.editReply("Date invalide : format attendu AAAA-MM-JJ.");
		return;
	}

	const [heros, maps, pris] = await Promise.all([
		prisma.owdleHero.findMany({ where: { enabled: true }, select: { key: true, name: true } }),
		prisma.minigameMap.findMany({ where: { enabled: true }, select: { key: true, name: true } }),
		prisma.minigameEvent.findMany({
			where: { guildId: interaction.guildId, day: { gte: versDate(depart), lt: versDate(addDaysToKey(depart, 60)) } },
			select: { day: true },
		}),
	]);
	const occupes = new Set(pris.map((p) => versCle(p.day)));
	const hero = auHasard(heros);
	const autre = auHasard(heros.filter((h) => h.key !== hero?.key));
	const map = auHasard(maps);
	if (!hero || !autre || !map) {
		await interaction.editReply("Il faut au moins deux héros et une map actifs pour créer la semaine de test.");
		return;
	}

	type Champs = Pick<
		Prisma.MinigameEventUncheckedCreateInput,
		"title" | "description" | "answerHeroKey" | "answerMapKey" | "answerSkin" | "answerTrue"
	> & { pollAnswers?: string[] };
	const champs: Record<MinigameType, Champs> = {
		[MinigameType.GUESS_HERO]: {
			title: "[TEST] Devine le héros",
			description: "Jeu de recette. Propose un héros avec `/devine`.",
			answerHeroKey: hero.key,
		},
		[MinigameType.GUESS_MAP]: {
			title: "[TEST] Devine la map",
			description: "Jeu de recette. Propose une map avec `/devine`.",
			answerMapKey: map.key,
		},
		[MinigameType.GUESS_SKIN]: {
			title: "[TEST] Devine le skin",
			description: "Jeu de recette. Trouve d'abord le héros, puis le nom du skin.",
			answerHeroKey: hero.key,
			answerSkin: SKIN_DE_TEST,
		},
		[MinigameType.TRUE_FALSE]: {
			title: "[TEST] Vrai ou faux",
			description: "Jeu de recette : la bonne réponse est « Vrai ».",
			answerTrue: true,
		},
		[MinigameType.DUEL]: {
			title: "[TEST] Duel",
			description: "Jeu de recette : vote pour ton préféré.",
			pollAnswers: [hero.name, autre.name],
		},
		[MinigameType.CLIP]: {
			title: "[TEST] Clip de la semaine",
			description: "Jeu de recette : rien à deviner.",
		},
	};

	const crees: string[] = [];
	let jour = depart;
	for (const type of SEMAINE_DE_TEST) {
		while (occupes.has(jour)) jour = addDaysToKey(jour, 1);
		const data = { guildId: interaction.guildId, day: versDate(jour), type, ...champs[type] };
		// Meme regle que l'API : un jeu enregistre doit etre publiable.
		const probleme = minigameEventProblem(data);
		if (probleme) throw new Error(`Jeu de test invalide (${type}) : ${probleme}`);
		await prisma.minigameEvent.create({ data });
		crees.push(`\`${jour}\` ${MINIGAME_TYPE_EMOJIS[type]} ${MINIGAME_TYPE_LABELS[type]}`);
		occupes.add(jour);
	}

	minigames.viderCaches();
	await interaction.editReply({
		embeds: [
			new EmbedBuilder()
				.setColor(colors.success)
				.setTitle("Semaine de test créée")
				.setDescription(
					[
						...crees,
						"",
						`Réponses : héros ||${hero.name}||, map ||${map.name}||, skin ||${SKIN_DE_TEST} (${hero.name})||, vrai ou faux ||Vrai||.`,
						"",
						"Suite : `/minijeu-test etape etape:Publication date:<jour>` pour publier le premier.",
					].join("\n"),
				),
		],
	});
}

async function rejouer(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	const jour = lireJour(interaction, "date", horloge.jourCourant());
	if (!jour) {
		await interaction.editReply("Date invalide : format attendu AAAA-MM-JJ.");
		return;
	}
	const jeu = await prisma.minigameEvent.findUnique({
		where: { guildId_day: { guildId: interaction.guildId, day: versDate(jour) } },
	});
	if (!jeu) {
		await interaction.editReply(`Aucun jeu le ${jour}.`);
		return;
	}

	const { count } = await prisma.minigameGame.deleteMany({ where: { eventId: jeu.id } });
	const partiesSeulement = interaction.options.getBoolean("parties-seulement") ?? false;

	if (!partiesSeulement) {
		// Les messages deja postes sont retires : rejouer la publication les
		// doublerait sinon, et la recette deviendrait illisible.
		const salon = jeu.channelId ? await interaction.guild.channels.fetch(jeu.channelId).catch(() => null) : null;
		if (salon?.isTextBased()) {
			for (const id of [jeu.messageId, jeu.pollMessageId, jeu.pingMessageId, jeu.endMessageId]) {
				if (id) await salon.messages.delete(id).catch(() => undefined);
			}
		}
		await prisma.minigameEvent.update({
			where: { id: jeu.id },
			data: {
				channelId: null,
				messageId: null,
				pollMessageId: null,
				pingMessageId: null,
				endMessageId: null,
				publishedAt: null,
				discordSyncedAt: null,
				pingedAt: null,
				closedAt: null,
				lastError: null,
			},
		});
	}

	minigames.viderCaches();
	await interaction.editReply(
		[
			partiesSeulement
				? `Essais du jeu du ${jour} effacés (${count} partie${count > 1 ? "s" : ""}).`
				: `Jeu du ${jour} remis à zéro : messages retirés, ${count} partie${count > 1 ? "s" : ""} effacée${count > 1 ? "s" : ""}.`,
			"-# L'expérience déjà gagnée n'est pas reprise : `/xp-admin retirer` si besoin.",
			partiesSeulement ? "" : "-# Pour le republier : `/minijeu-test etape etape:Publication date:" + jour + "`.",
		]
			.filter(Boolean)
			.join("\n"),
	);
}

export = command;
