-- Import esport : Liquipedia DB remplace PandaScore.
--
-- Les identifiants PandaScore ne correspondent a rien chez Liquipedia : ils
-- sont retires sans equivalent. Une equipe deja reliee le sera de nouveau,
-- par son nom, au premier import (elle garde son emoji et son logo) ; un match
-- deja importe redevient un match saisi a la main, que le staff peut garder ou
-- remplacer par sa version Liquipedia.

-- Reglages : les mots-cles suivis survivent au changement de source.
ALTER TABLE "esport_config" ADD COLUMN     "liquipedia_series" TEXT[] DEFAULT ARRAY['Overwatch Champions Series']::TEXT[],
ADD COLUMN     "liquipedia_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "liquipedia_first_to" BOOLEAN NOT NULL DEFAULT true;

UPDATE "esport_config" SET "liquipedia_keywords" = COALESCE("pandascore_series", ARRAY[]::TEXT[]);

ALTER TABLE "esport_config" DROP COLUMN "pandascore_league_ids",
DROP COLUMN "pandascore_series";

-- Equipes
DROP INDEX "esport_teams_guild_id_pandascore_id_key";
ALTER TABLE "esport_teams" DROP COLUMN "pandascore_id",
ADD COLUMN     "liquipedia_name" VARCHAR(120);
CREATE UNIQUE INDEX "esport_teams_guild_id_liquipedia_name_key" ON "esport_teams"("guild_id", "liquipedia_name");

-- Matchs
DROP INDEX "esport_matches_week_id_pandascore_id_key";
ALTER TABLE "esport_matches" DROP COLUMN "pandascore_id",
ADD COLUMN     "liquipedia_id" VARCHAR(100),
ADD COLUMN     "liquipedia_page" VARCHAR(255),
ADD COLUMN     "suggested_score_a" INTEGER,
ADD COLUMN     "suggested_score_b" INTEGER,
ADD COLUMN     "suggested_forfeit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suggested_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "esport_matches_week_id_liquipedia_id_key" ON "esport_matches"("week_id", "liquipedia_id");

-- Cache
DROP TABLE "pandascore_matches";
DROP TABLE "pandascore_fetches";

CREATE TABLE "liquipedia_matches" (
    "id" VARCHAR(100) NOT NULL,
    "series" VARCHAR(200) NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "finished" BOOLEAN NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liquipedia_matches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "liquipedia_fetches" (
    "week_start" DATE NOT NULL,
    "series" TEXT[],
    "match_count" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "liquipedia_fetches_pkey" PRIMARY KEY ("week_start")
);

CREATE INDEX "liquipedia_matches_series_scheduled_at_idx" ON "liquipedia_matches"("series", "scheduled_at");
