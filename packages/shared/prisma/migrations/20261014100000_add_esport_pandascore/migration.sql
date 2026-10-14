-- Import des matchs esport depuis PandaScore.
--
-- Les matchs et equipes existants restent saisis a la main : aucun
-- identifiant PandaScore n'est deduit, et tous les formats restent des BO.

-- CreateEnum
CREATE TYPE "EsportMatchFormat" AS ENUM ('BEST_OF', 'FIRST_TO');

-- AlterTable
ALTER TABLE "esport_config" ADD COLUMN     "pandascore_league_ids" INTEGER[] DEFAULT ARRAY[5223]::INTEGER[],
ADD COLUMN     "pandascore_series" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "esport_matches" ADD COLUMN     "format" "EsportMatchFormat" NOT NULL DEFAULT 'BEST_OF',
ADD COLUMN     "pandascore_id" INTEGER;

-- AlterTable
ALTER TABLE "esport_teams" ADD COLUMN     "pandascore_id" INTEGER;

-- CreateTable
CREATE TABLE "pandascore_matches" (
    "id" INTEGER NOT NULL,
    "league_id" INTEGER NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pandascore_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pandascore_fetches" (
    "week_start" DATE NOT NULL,
    "league_ids" INTEGER[],
    "match_count" INTEGER NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pandascore_fetches_pkey" PRIMARY KEY ("week_start")
);

-- CreateIndex
CREATE INDEX "pandascore_matches_league_id_scheduled_at_idx" ON "pandascore_matches"("league_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "esport_matches_week_id_pandascore_id_key" ON "esport_matches"("week_id", "pandascore_id");

-- CreateIndex
CREATE UNIQUE INDEX "esport_teams_guild_id_pandascore_id_key" ON "esport_teams"("guild_id", "pandascore_id");
