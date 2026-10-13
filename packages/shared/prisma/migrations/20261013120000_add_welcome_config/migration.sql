-- Messages automatiques d'arrivee, de depart et de boost.
--
-- Tout est coupe par defaut et rien n'est pre-rempli : un serveur qui n'ouvre
-- jamais la page ne voit aucun message apparaitre.

CREATE TABLE "welcome_config" (
  "guild_id"         VARCHAR(20)  NOT NULL,
  "channel_id"       VARCHAR(20),
  "join_enabled"     BOOLEAN      NOT NULL DEFAULT false,
  "join_message"     TEXT,
  "leave_enabled"    BOOLEAN      NOT NULL DEFAULT false,
  "leave_message"    TEXT,
  "boost_enabled"    BOOLEAN      NOT NULL DEFAULT false,
  "boost_channel_id" VARCHAR(20),
  "boost_message"    TEXT,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "welcome_config_pkey" PRIMARY KEY ("guild_id")
);

ALTER TABLE "welcome_config"
  ADD CONSTRAINT "welcome_config_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
