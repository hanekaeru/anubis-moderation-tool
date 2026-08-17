import {
	EmbedBuilder,
	MessageFlags,
	PermissionFlagsBits,
	SlashCommandBuilder,
	type Guild,
} from "discord.js";
import {
	LOG_CHANNEL_LABELS,
	LogChannelKey,
	TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY,
} from "@anubis/shared";
import prisma from "../../prisma";
import type { Command } from "../../types";
import * as guildConfig from "../../collectors/guildConfig";
import * as voiceHubs from "../../collectors/voiceHubs";
import * as colors from "../../utils/constantes";

/**
 * Checklist de mise en service, evaluee en direct.
 *
 * Volontairement plus qu'une liste figee : chaque etape est verifiee au moment
 * ou la commande est lancee. Une notice statique se serait desynchronisee du
 * code des la premiere fonctionnalite ajoutee, et n'aurait rien dit de l'etat
 * reel de *ce* serveur.
 */

interface Etape {
	titre: string;
	/** `null` = etape faite, sinon ce qu'il reste a faire. */
	action: string | null;
	/** Une etape non bloquante reste optionnelle : la signaler sans alarmer. */
	optionnelle?: boolean;
}

/** Permissions Discord dont depend le bon fonctionnement de l'ensemble. */
const PERMISSIONS_REQUISES: [bigint, string][] = [
	[PermissionFlagsBits.ManageChannels, "Gérer les salons"],
	[PermissionFlagsBits.ManageRoles, "Gérer les rôles"],
	[PermissionFlagsBits.ModerateMembers, "Exclure temporairement des membres"],
	[PermissionFlagsBits.BanMembers, "Bannir des membres"],
	[PermissionFlagsBits.KickMembers, "Expulser des membres"],
	[PermissionFlagsBits.MoveMembers, "Déplacer les membres"],
	[PermissionFlagsBits.ViewAuditLog, "Voir le journal d'audit"],
];

async function evaluerSalonsDeLogs(guild: Guild): Promise<Etape> {
	const manquants: string[] = [];

	for (const key of Object.values(LogChannelKey)) {
		const channelId = await guildConfig.getConfig(guild.id, key);
		const salon = channelId
			? await guild.channels.fetch(channelId).catch(() => null)
			: null;
		if (!salon) manquants.push(LOG_CHANNEL_LABELS[key]);
	}

	return {
		titre: "Salons de logs",
		action: manquants.length
			? `\`/create_logs\` — manquants : ${manquants.join(", ")}`
			: null,
	};
}

async function evaluerTickets(guild: Guild): Promise<Etape> {
	const transcriptId = await guildConfig.getConfig(
		guild.id,
		TICKET_TRANSCRIPT_CHANNEL_CONFIG_KEY,
	);

	return {
		titre: "Panneau de tickets",
		action: transcriptId
			? null
			: "`/create_ticket_panel salon:#support` — pose le menu d'ouverture et le salon d'archives",
	};
}

async function evaluerVocaux(guild: Guild): Promise<Etape> {
	const hubs = await prisma.voiceHub.findMany({
		where: { guildId: guild.id, enabled: true },
	});

	if (!hubs.length) {
		return {
			titre: "Salons vocaux de création",
			action: "Dashboard > Vocaux — ajoute au moins un salon de création, puis `/create_parties`",
			optionnelle: true,
		};
	}

	const aCreer = hubs.filter((hub) => !hub.channelId).length;

	return {
		titre: "Salons vocaux de création",
		action: aCreer ? `\`/create_parties\` — ${aCreer} salon(s) à créer` : null,
	};
}

async function evaluerQuarantaine(guild: Guild): Promise<Etape> {
	const config = await prisma.quarantineConfig.findUnique({
		where: { guildId: guild.id },
	});

	if (!config?.enabled) {
		return {
			titre: "Quarantaine",
			action: "Dashboard > Quarantaine — désactivée",
			optionnelle: true,
		};
	}

	if (!config.roleId || !config.channelId) {
		return {
			titre: "Quarantaine",
			action: "Dashboard > Quarantaine — rôle ou salon du règlement manquant",
		};
	}

	return {
		titre: "Quarantaine",
		action: "`/quarantaine-message` — (re)poste le règlement et son bouton",
	};
}

async function evaluerAntiRaid(guild: Guild): Promise<Etape> {
	const config = await prisma.raidConfig.findUnique({
		where: { guildId: guild.id },
	});

	return {
		titre: "Anti-raid",
		action: config?.enabled ? null : "Dashboard > Anti-raid — détection désactivée",
		optionnelle: true,
	};
}

async function evaluerAutomod(guild: Guild): Promise<Etape> {
	const actives = await prisma.automodRule.count({
		where: { guildId: guild.id, enabled: true },
	});

	return {
		titre: "Automodération",
		action: actives ? null : "Dashboard > Automodération — aucune règle active",
		optionnelle: true,
	};
}

function evaluerPermissions(guild: Guild): Etape {
	const moi = guild.members.me;
	const manquantes = PERMISSIONS_REQUISES.filter(
		([flag]) => !moi?.permissions.has(flag),
	).map(([, libelle]) => libelle);

	return {
		titre: "Permissions du bot",
		action: manquantes.length ? `À accorder : ${manquantes.join(", ")}` : null,
	};
}

async function evaluerComptesDashboard(): Promise<Etape> {
	const comptes = await prisma.appUser.count({ where: { isActive: true } });
	const provisoires = await prisma.appUser.count({
		where: { isActive: true, mustChangePassword: true },
	});

	if (comptes === 0) {
		return {
			titre: "Comptes du dashboard",
			action: "Aucun compte actif — lance le script de seed de l'API",
		};
	}

	return {
		titre: "Comptes du dashboard",
		action: provisoires
			? `${provisoires} compte(s) encore sur un mot de passe provisoire`
			: null,
	};
}

async function evaluerLienDeCompte(): Promise<Etape> {
	const lies = await prisma.appUser.count({
		where: { isActive: true, discordUserId: { not: null } },
	});

	return {
		titre: "Comptes Discord liés",
		action: lies
			? null
			: "Dashboard > Mon compte > Discord, puis `/lier-compte <code>` ici",
		optionnelle: true,
	};
}

const command: Command = {
	data: new SlashCommandBuilder()
		.setName("setup")
		.setDescription(
			"ADMIN - Liste ce qu'il reste à faire pour un serveur complet et fonctionnel.",
		)
		.setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
	async execute(interaction) {
		if (!interaction.inCachedGuild()) return;

		if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
			await interaction.reply({
				content: "Tu n'as pas la permission de configurer le serveur.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}

		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		const { guild } = interaction;

		const etapes: Etape[] = [
			evaluerPermissions(guild),
			await evaluerSalonsDeLogs(guild),
			await evaluerComptesDashboard(),
			await evaluerTickets(guild),
			await evaluerQuarantaine(guild),
			await evaluerVocaux(guild),
			await evaluerAntiRaid(guild),
			await evaluerAutomod(guild),
			await evaluerLienDeCompte(),
		];

		const restantes = etapes.filter((etape) => etape.action !== null);
		const bloquantes = restantes.filter((etape) => !etape.optionnelle);

		const lignes = etapes.map((etape) => {
			if (!etape.action) return `✅ **${etape.titre}**`;
			const marque = etape.optionnelle ? "⚪" : "❌";
			return `${marque} **${etape.titre}**\n> ${etape.action}`;
		});

		const embed = new EmbedBuilder()
			.setColor(bloquantes.length ? colors.warning : colors.success)
			.setTitle("Anubis — mise en service")
			.setDescription(
				bloquantes.length
					? `${bloquantes.length} étape(s) à traiter avant que tout soit opérationnel.`
					: "Tout l'essentiel est en place. ⚪ = optionnel, à activer selon vos besoins.",
			)
			.addFields({ name: "Étapes", value: lignes.join("\n").slice(0, 4000) })
			.setFooter({
				text: "Relance /setup à tout moment : chaque étape est vérifiée en direct.",
			})
			.setTimestamp();

		// Les intents privilegies ne se lisent pas depuis l'API : ils se
		// constatent a la connexion. Le rappel reste donc statique, mais il est
		// la cause d'echec la plus frequente a la premiere installation.
		const manquantesVocal = voiceHubs.permissionsManquantes(guild);
		if (manquantesVocal.length) {
			embed.addFields({
				name: "Salons vocaux temporaires",
				value: `Permissions manquantes : ${manquantesVocal.join(", ")}.`,
			});
		}

		embed.addFields({
			name: "Portail développeur Discord",
			value:
				"Bot > Privileged Gateway Intents : **Server Members** et **Message Content** doivent être activés. " +
				"Sans le premier, le bot ne démarre pas ; sans le second, les tickets et la quarantaine ne voient rien.",
		});

		await interaction.editReply({ embeds: [embed] });
	},
};

export = command;
