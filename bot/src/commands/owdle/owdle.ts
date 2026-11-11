import {
	type ChatInputCommandInteraction,
	EmbedBuilder,
	type GuildTextBasedChannel,
	MessageFlags,
	SlashCommandBuilder,
} from "discord.js";
import {
	OWDLE_LEGEND,
	OWDLE_SHARE_HEADER,
	type OwdleHero,
	compareOwdleGuess,
	owdleDayKey,
	renderOwdleGuess,
	renderOwdleShareGrid,
} from "@anubis/shared";
import * as owdle from "../../collectors/owdle";
import { celebrerMontee } from "../../collectors/xpLevelUp";
import type { Command } from "../../types";
import * as colors from "../../utils/constantes";

/**
 * OWdle : retrouver le heros du jour.
 *
 * Tout ce qui montre la partie est **ephemere** — les essais, leurs valeurs,
 * les statistiques — pour ne rien reveler aux autres joueurs. Seule la victoire
 * est annoncee publiquement, et avec la grille sans aucun nom.
 */

/**
 * Au-dela, l'embed depasserait la limite de 4096 caracteres de sa description
 * (un essai en vue detaillee fait une centaine de caracteres, et la grille
 * d'apercu en prend jusqu'a un millier).
 */
const ESSAIS_AFFICHES = 20;
/** Meme raison pour l'annonce publique, limitee a 2000 caracteres. */
const LIGNES_PARTAGEES = 40;

const jourAffiche = (key: string) => key.split("-").reverse().join("/");

/**
 * Grille sans nom ni valeur, en-tete compris : celle de l'annonce publique. Les
 * lignes les plus anciennes tombent au-dela de `LIGNES_PARTAGEES`.
 */
function grillePartagee(guesses: readonly OwdleHero[], target: OwdleHero): string {
	const lignes = renderOwdleShareGrid(guesses.map((g) => compareOwdleGuess(g, target)))
		.split("\n")
		.slice(-LIGNES_PARTAGEES);
	return [OWDLE_SHARE_HEADER, ...lignes].join("\n");
}

/**
 * Vue privee de la partie, en deux temps.
 *
 * En haut, **la grille de l'annonce publique** : un apercu de ce qui partira a
 * la victoire, et la forme de la partie d'un coup d'oeil. Dessous, chaque essai
 * en paires case-valeur (`renderOwdleGuess`), dans l'ordre ou il a ete propose
 * — le dernier en bas, sous la grille qu'il vient d'allonger. Au-dela de
 * `ESSAIS_AFFICHES`, ce sont les plus anciens qui disparaissent du detail ; la
 * grille, elle, les garde. La legende tient en une ligne : les cases du detail
 * disent deja leur valeur, il ne reste que les couleurs a expliquer.
 */
function grilleJoueur(guesses: readonly OwdleHero[], target: OwdleHero): EmbedBuilder {
	const n = guesses.length;
	const essais = guesses.map((g) => renderOwdleGuess(g, compareOwdleGuess(g, target)));
	const masques = essais.length - ESSAIS_AFFICHES;
	const description = essais.length
		? [
				grillePartagee(guesses, target),
				...(masques > 0 ? [`-# … ${masques} essai(s) plus ancien(s)`] : []),
				...essais.slice(-ESSAIS_AFFICHES),
			].join("\n\n")
		: "Aucun essai pour l'instant.";

	return new EmbedBuilder()
		.setColor(colors.info)
		.setTitle(`OWdle du ${jourAffiche(owdleDayKey(new Date()))} — ${n} essai${n > 1 ? "s" : ""}`)
		.setDescription(description)
		.setFooter({ text: OWDLE_LEGEND });
}

async function annoncerVictoire(
	interaction: ChatInputCommandInteraction<"cached">,
	guesses: readonly OwdleHero[],
	target: OwdleHero,
	rank: number | null,
	xp: owdle.XpGain | null,
): Promise<void> {
	const salonId = await owdle.salonAnnonce(interaction.guildId);
	const salon: GuildTextBasedChannel | null = salonId
		? (interaction.guild.channels.cache.get(salonId) as GuildTextBasedChannel | undefined) ?? null
		: interaction.channel;

	if (!salon?.isTextBased()) {
		console.error(`[OWdle] Salon d'annonce introuvable (${salonId ?? "salon de la partie"}).`);
		return;
	}

	const n = guesses.length;
	const rang = rank === 1 ? " — **premier du serveur** aujourd'hui !" : rank ? ` — ${rank}ᵉ du serveur aujourd'hui.` : "";
	const gain = xp ? `\n-# +${xp.amount} XP` : "";

	await salon.send({
		content: `🎉 ${interaction.user} a trouvé l'OWdle du jour en **${n}** essai${n > 1 ? "s" : ""}${rang}${gain}\n${grillePartagee(guesses, target)}`,
		// La mention identifie le joueur sans le notifier : il vient de jouer.
		allowedMentions: { parse: [] },
	});
}

async function essai(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	await interaction.deferReply({ flags: MessageFlags.Ephemeral });

	const saisie = interaction.options.getString("heros", true);
	const issue = await owdle.proposer(interaction.guildId, interaction.user, saisie);

	switch (issue.kind) {
		case "UNKNOWN_HERO":
			await interaction.editReply(`Aucun héros ne correspond à « ${saisie} ». Choisis-en un dans la liste proposée.`);
			return;

		case "ALREADY_SOLVED":
			await interaction.editReply({
				content: `Tu as déjà trouvé l'OWdle du jour : c'était **${issue.target.name}**. Reviens demain !`,
				embeds: [grilleJoueur(issue.guesses, issue.target)],
			});
			return;

		case "DUPLICATE":
			await interaction.editReply({
				content: `Tu as déjà proposé **${issue.hero.name}** aujourd'hui.`,
				embeds: [grilleJoueur(issue.guesses, issue.target)],
			});
			return;

		case "PLAYED": {
			const embed = grilleJoueur(issue.guesses, issue.target);
			if (!issue.solved) {
				await interaction.editReply({ embeds: [embed] });
				return;
			}

			const n = issue.guesses.length;
			embed
				.setColor(colors.success)
				.setTitle(`Trouvé ! C'était ${issue.target.name}, en ${n} essai${n > 1 ? "s" : ""}.`);
			const xp = issue.xp;
			await interaction.editReply({
				content: xp ? `Tu gagnes **${xp.amount} XP**.` : undefined,
				embeds: [embed],
			});

			// L'annonce ne doit jamais faire echouer une victoire deja enregistree.
			await annoncerVictoire(interaction, issue.guesses, issue.target, issue.rank, xp).catch((err) =>
				console.error("[OWdle] Annonce de victoire échouée :", err),
			);

			// Meme suite qu'une montee de niveau gagnee en ecrivant : roles de
			// palier puis annonce, selon le reglage du serveur. Apres l'annonce de
			// victoire, pour que « niveau 10 » ne la precede pas.
			if (xp && xp.after.level > xp.before.level && interaction.channel) {
				await celebrerMontee(interaction.member, xp.after.level, interaction.channel);
			}
			return;
		}
	}
}

async function stats(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	const membre = interaction.options.getUser("membre") ?? interaction.user;
	const s = await owdle.statistiques(interaction.guildId, membre.id);

	const embed = new EmbedBuilder()
		.setColor(colors.info)
		.setTitle(`OWdle — statistiques de ${membre.displayName}`)
		.addFields(
			{ name: "Parties", value: String(s.played), inline: true },
			{ name: "Victoires", value: String(s.wins), inline: true },
			{
				name: "Moyenne d'essais",
				value: s.averageGuesses === null ? "—" : s.averageGuesses.toFixed(1).replace(".", ","),
				inline: true,
			},
			{ name: "Série en cours", value: `${s.currentStreak} jour(s)`, inline: true },
			{ name: "Meilleure série", value: `${s.bestStreak} jour(s)`, inline: true },
			{ name: "Meilleure partie", value: s.bestGame === null ? "—" : `${s.bestGame} essai(s)`, inline: true },
		);

	await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function classement(interaction: ChatInputCommandInteraction<"cached">): Promise<void> {
	const lignes = await owdle.classementDuMois(interaction.guildId);
	const medailles = ["🥇", "🥈", "🥉"];

	const description = lignes
		.map(
			(l, i) =>
				`${medailles[i] ?? `**${i + 1}.**`} <@${l.userId}> — ${l.wins} victoire${l.wins > 1 ? "s" : ""}, ` +
				`${l.averageGuesses.toFixed(1).replace(".", ",")} essais en moyenne`,
		)
		.join("\n");

	const mois = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "Europe/Paris" }).format(new Date());
	const embed = new EmbedBuilder()
		.setColor(colors.info)
		.setTitle(`OWdle — classement de ${mois}`)
		.setDescription(description || "Personne n'a encore trouvé l'OWdle ce mois-ci.");

	// Public : le classement ne revele aucune reponse, et c'est lui qui donne
	// envie aux autres de jouer. Les mentions d'embed ne notifient personne.
	await interaction.reply({ embeds: [embed] });
}

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("owdle")
		.setDescription("Retrouve le héros Overwatch du jour.")
		.addSubcommand((sub) =>
			sub
				.setName("essai")
				.setDescription("Propose un héros pour l'OWdle du jour.")
				.addStringOption((option) =>
					option
						.setName("heros")
						.setDescription("Le héros que tu proposes.")
						.setRequired(true)
						.setAutocomplete(true),
				),
		)
		.addSubcommand((sub) =>
			sub
				.setName("stats")
				.setDescription("Tes statistiques OWdle, ou celles d'un membre.")
				.addUserOption((option) =>
					option.setName("membre").setDescription("Membre dont afficher les statistiques."),
				),
		)
		.addSubcommand((sub) =>
			sub.setName("classement").setDescription("Classement OWdle du mois en cours."),
		),
	cooldown: 2,

	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		switch (interaction.options.getSubcommand()) {
			case "essai":
				return essai(interaction);
			case "stats":
				return stats(interaction);
			case "classement":
				return classement(interaction);
		}
	},

	async autocomplete(interaction) {
		const saisie = interaction.options.getFocused();
		const heros = await owdle.suggestions(saisie);
		await interaction.respond(heros.map((h) => ({ name: h.name, value: h.key })));
	},
};

export = command;
