import type { GuildMember } from "discord.js";

export function checkIfUserGotRole(user: GuildMember, role: string): boolean {
	return user.roles.cache.some((r) => r.id === role);
}
