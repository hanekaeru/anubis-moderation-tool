-- OWdle : bonus d'experience pour une semaine (presque) complete.
--
-- Le reglage arrive desactive (0 XP) : un serveur qui n'ouvre jamais la page
-- ne voit rien changer. La table des bonus verses porte la garantie d'un seul
-- versement par membre et par semaine, par sa cle primaire.

ALTER TABLE "owdle_config"
  ADD COLUMN "weekly_bonus_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "weekly_bonus_xp"   INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "owdle_weekly_bonuses" (
  "guild_id"   VARCHAR(20)  NOT NULL,
  "user_id"    VARCHAR(20)  NOT NULL,
  "week_start" DATE         NOT NULL,
  "xp"         INTEGER      NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "owdle_weekly_bonuses_pkey" PRIMARY KEY ("guild_id", "user_id", "week_start")
);

ALTER TABLE "owdle_weekly_bonuses"
  ADD CONSTRAINT "owdle_weekly_bonuses_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "owdle_weekly_bonuses"
  ADD CONSTRAINT "owdle_weekly_bonuses_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
