-- CreateEnum
CREATE TYPE "XpAnnouncementMode" AS ENUM ('CURRENT_CHANNEL', 'DEDICATED_CHANNEL', 'DIRECT_MESSAGE', 'DISABLED');

-- CreateTable
--
-- Aucune ligne n est creee ici : un serveur sans reglage doit continuer a se
-- comporter comme avant, et les defauts de la table (CURRENT_CHANNEL, message
-- nul, mention active) sont precisement ce comportement. Pre-remplir la table
-- ne changerait rien, sinon presenter comme un choix ce qui n en est pas un.
CREATE TABLE "xp_config" (
    "guild_id" VARCHAR(20) NOT NULL,
    "mode" "XpAnnouncementMode" NOT NULL DEFAULT 'CURRENT_CHANNEL',
    "channel_id" VARCHAR(20),
    "message" TEXT,
    "ping_member" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xp_config_pkey" PRIMARY KEY ("guild_id")
);

-- AddForeignKey
ALTER TABLE "xp_config" ADD CONSTRAINT "xp_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
