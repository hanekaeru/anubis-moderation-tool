import { GuildRoleKey } from "../mentions";
import { Snowflake } from "./common";

export interface GuildConfigDto {
	id: string;
	guildId: Snowflake;
	configName: string;
	configValue: string;
	configDescription: string;
}

export interface CreateGuildConfigRequest {
	configName: string;
	configValue: string;
	configDescription: string;
}

export interface UpdateGuildConfigRequest {
	configValue?: string;
	configDescription?: string;
}

/**
 * Reglages de mention, vue typee de quelques cles de `config_guild`.
 *
 * Ces cles pourraient se modifier une a une depuis la page Configurations, qui
 * expose la table telle quelle. Elles passent malgre tout par un contrat dedie
 * parce que leurs valeurs se verifient entre elles : mentionner un role suppose
 * que ce role soit renseigne, et l'API est seule a faire foi la-dessus.
 */
export interface MentionSettingsDto {
	/** Identifiant de role par cle. `null` quand la cle n'est pas renseignee. */
	roles: Record<GuildRoleKey, Snowflake | null>;
	/** Role interpelle quand le staff doit venir, `null` pour n'en appeler aucun. */
	alertRoleKey: GuildRoleKey | null;
	/** Mentionner les membres dans les journaux, ou ecrire « pseudo | identifiant ». */
	mentionMembers: boolean;
}

/**
 * Les listes sont **remplacees en bloc**, jamais fusionnees : envoyer une cle a
 * `null` est le seul moyen de retirer un role declare.
 */
export interface UpdateMentionSettingsRequest {
	roles: Record<GuildRoleKey, Snowflake | null>;
	alertRoleKey: GuildRoleKey | null;
	mentionMembers: boolean;
}
