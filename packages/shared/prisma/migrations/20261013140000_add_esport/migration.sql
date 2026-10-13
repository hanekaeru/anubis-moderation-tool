-- Recapitulatifs esport : equipes, semaines de matchs, resultats.
--
-- Rien n'est pre-rempli : sans salon regle, rien n'est jamais publie.

CREATE TABLE "esport_config" (
    "guild_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20),
    "results_channel_id" VARCHAR(20),
    "mention_role_id" VARCHAR(20),
    "mention_on_publish" BOOLEAN NOT NULL DEFAULT true,
    "mention_on_result" BOOLEAN NOT NULL DEFAULT false,
    "spoiler_scores" BOOLEAN NOT NULL DEFAULT true,
    "color" INTEGER NOT NULL DEFAULT 5793266,
    "title" VARCHAR(200) NOT NULL DEFAULT '🎮 Matchs esport de la semaine',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esport_config_pkey" PRIMARY KEY ("guild_id")
);

CREATE TABLE "esport_teams" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "emoji" VARCHAR(100),
    "logo_url" VARCHAR(500),
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esport_teams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "esport_weeks" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "week_start" DATE NOT NULL,
    "title" VARCHAR(200),
    "description" TEXT,
    "publish_requested_at" TIMESTAMP(3),
    "channel_id" VARCHAR(20),
    "message_id" VARCHAR(20),
    "published_at" TIMESTAMP(3),
    "discord_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "removal_requested_at" TIMESTAMP(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esport_weeks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "esport_matches" (
    "id" UUID NOT NULL,
    "week_id" UUID NOT NULL,
    "team_a_id" UUID,
    "team_b_id" UUID,
    "competition" VARCHAR(120),
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "best_of" INTEGER,
    "stream_url" VARCHAR(500),
    "score_a" INTEGER,
    "score_b" INTEGER,
    "spoiler" BOOLEAN,
    "finished_at" TIMESTAMP(3),
    "result_channel_id" VARCHAR(20),
    "result_message_id" VARCHAR(20),
    "result_synced_at" TIMESTAMP(3),
    "result_error" TEXT,
    "result_removal_requested_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esport_matches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "esport_teams_guild_id_idx" ON "esport_teams"("guild_id");

CREATE UNIQUE INDEX "esport_weeks_guild_id_week_start_key" ON "esport_weeks"("guild_id", "week_start");

CREATE INDEX "esport_matches_week_id_scheduled_at_idx" ON "esport_matches"("week_id", "scheduled_at");

CREATE INDEX "esport_matches_finished_at_result_synced_at_idx" ON "esport_matches"("finished_at", "result_synced_at");

ALTER TABLE "esport_config" ADD CONSTRAINT "esport_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "esport_teams" ADD CONSTRAINT "esport_teams_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "esport_weeks" ADD CONSTRAINT "esport_weeks_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "esport_weeks" ADD CONSTRAINT "esport_weeks_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "esport_matches" ADD CONSTRAINT "esport_matches_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "esport_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "esport_matches" ADD CONSTRAINT "esport_matches_team_a_id_fkey" FOREIGN KEY ("team_a_id") REFERENCES "esport_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "esport_matches" ADD CONSTRAINT "esport_matches_team_b_id_fkey" FOREIGN KEY ("team_b_id") REFERENCES "esport_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
