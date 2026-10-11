-- Deux reglages nes de la campagne de test.
--
-- `voice_config` porte ce qui vaut pour tout le serveur, la ou `voice_hubs` ne
-- decrit qu'un salon de creation : les roles qu'un proprietaire de salon
-- temporaire ne peut pas expulser se reglent une fois, pas par hub.
--
-- `xp_config.blocked_channel_ids` retire l'experience des salons ou elle n'a
-- pas de sens — commandes du bot, tickets. Vide par defaut : un serveur qui
-- n'ouvre jamais la page ne voit aucun changement.

CREATE TABLE "voice_config" (
  "guild_id"          VARCHAR(20)  NOT NULL,
  "protected_role_ids" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "voice_config_pkey" PRIMARY KEY ("guild_id")
);

ALTER TABLE "voice_config"
  ADD CONSTRAINT "voice_config_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "xp_config"
  ADD COLUMN "blocked_channel_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
