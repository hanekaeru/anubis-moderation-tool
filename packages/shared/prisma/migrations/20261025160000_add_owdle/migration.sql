-- OWdle : heros du jour, parties des membres et salon d'annonce.
--
-- Rien n'est pre-rempli : le premier joueur du jour declenche le tirage.

CREATE TABLE "owdle_config" (
  "guild_id"   VARCHAR(20)  NOT NULL,
  "channel_id" VARCHAR(20),
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owdle_config_pkey" PRIMARY KEY ("guild_id")
);

CREATE TABLE "owdle_days" (
  "guild_id"   VARCHAR(20)  NOT NULL,
  "day"        DATE         NOT NULL,
  "hero_key"   VARCHAR(40)  NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "owdle_days_pkey" PRIMARY KEY ("guild_id", "day")
);

CREATE TABLE "owdle_games" (
  "guild_id"   VARCHAR(20)  NOT NULL,
  "user_id"    VARCHAR(20)  NOT NULL,
  "day"        DATE         NOT NULL,
  "guesses"    TEXT[]       DEFAULT ARRAY[]::TEXT[],
  "solved_at"  TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "owdle_games_pkey" PRIMARY KEY ("guild_id", "user_id", "day")
);

CREATE INDEX "owdle_games_guild_id_day_idx" ON "owdle_games"("guild_id", "day");

ALTER TABLE "owdle_config"
  ADD CONSTRAINT "owdle_config_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owdle_days"
  ADD CONSTRAINT "owdle_days_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owdle_games"
  ADD CONSTRAINT "owdle_games_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owdle_games"
  ADD CONSTRAINT "owdle_games_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
