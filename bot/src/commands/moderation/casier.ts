import {
	ComponentType,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
} from "discord.js";
import type { Command } from "../../types";
import { fetchCasier } from "../../collectors/casier";
import { nombreDePages, rendrePage } from "../../utils/casierEmbeds";

/** Duree pendant laquelle les boutons de pagination restent actifs. */
const DELAI_PAGINATION = 3 * 60_000;

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("casier")
		.setDescription(
			"Consulter les sanctions, avertissements et notes d'un membre.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
		.addUserOption((option) =>
			option
				.setName("membre")
				.setDescription("Le membre dont consulter le casier.")
				.setRequired(true),
		),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (
			!interaction.memberPermissions?.has(
				PermissionFlagsBits.ModerateMembers,
			)
		) {
			await interaction.reply({
				content: "Tu n'as pas la permission de consulter un casier.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		// Toujours ephemere : le casier contient les notes internes du staff,
		// qui n'ont pas a s'afficher dans un salon.
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const cible = interaction.options.getUser("membre", true);
		const casier = await fetchCasier(interaction.guildId, cible.id);

		if (!casier.entries.length) {
			await interaction.editReply(
				`Aucune sanction, aucun avertissement et aucune note pour ${cible.tag}.`,
			);
			return;
		}

		const totalPages = nombreDePages(casier);
		let page = 0;

		const message = await interaction.editReply(
			rendrePage(cible, casier, page, totalPages),
		);

		if (totalPages === 1) return;

		const collector = message.createMessageComponentCollector({
			componentType: ComponentType.Button,
			time: DELAI_PAGINATION,
		});

		collector.on("collect", async (bouton) => {
			// La reponse est ephemere donc deja privee, mais le filtre evite
			// qu'un autre moderateur ne fasse defiler la page a distance.
			if (bouton.user.id !== interaction.user.id) {
				await bouton.reply({
					content: "Ce casier a été ouvert par quelqu'un d'autre.",
					flags: MessageFlags.Ephemeral,
				});
				return;
			}

			switch (bouton.customId) {
				case "casier:first":
					page = 0;
					break;
				case "casier:prev":
					page = Math.max(0, page - 1);
					break;
				case "casier:next":
					page = Math.min(totalPages - 1, page + 1);
					break;
				case "casier:last":
					page = totalPages - 1;
					break;
				default:
					return;
			}

			await bouton.update(rendrePage(cible, casier, page, totalPages));
		});

		collector.on("end", () => {
			// Les boutons ne repondraient plus : les retirer evite de laisser
			// une interface morte a l'ecran.
			interaction.editReply({ components: [] }).catch(() => undefined);
		});
	},
};

export = command;
