import type { User } from 'discord.js';

/**
 * DM best-effort. Un membre qui a ferme ses messages prives ne doit jamais
 * faire echouer l'action de moderation elle-meme.
 */
export async function notifyMember(user: User, message: string): Promise<void> {
    try {
        await user.send(message);
    } catch {
        // DMs fermes, bot bloque, ou compte supprime : sans consequence ici.
    }
}
