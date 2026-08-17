-- Le bot ecrit desormais l'URL d'avatar complete (via displayAvatarURL de
-- discord.js) plutot qu'un hash a reconstruire cote API.
ALTER TABLE "discord_users"
RENAME COLUMN "avatar_hash" TO "avatar_url";