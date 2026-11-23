-- Calendrier des mini-jeux : un jeu par jour et par serveur, publie a minuit
-- (heure de Paris), joue jusqu'a 23:59 par `/devine` ou par sondage Discord.
--
-- `minigame_maps` est commune a tous les serveurs, comme `owdle_heroes`, et
-- pre-remplie ci-dessous avec les noms du client francais (novembre 2026) :
-- le staff corrige les noms depuis le dashboard, les cles ne bougent plus.
--
-- `xp_adjustments` garde la trace de l'experience ajoutee ou retiree a la main
-- par `/xp-admin`.
--
-- `STAFF` est un role de compte du dashboard hors de la chaine VIEWER <
-- MODERATOR < ADMIN : il anime le serveur et ne lit rien de la moderation.
-- `ADD VALUE` ne peut servir dans la transaction qui l'ajoute ; rien ici ne
-- l'emploie.

-- CreateEnum
CREATE TYPE "MinigameType" AS ENUM ('CLIP', 'GUESS_HERO', 'DUEL', 'GUESS_MAP', 'TRUE_FALSE', 'GUESS_SKIN');

-- AlterEnum
ALTER TYPE "AppUserRole" ADD VALUE 'STAFF';

-- CreateTable
CREATE TABLE "minigame_config" (
    "guild_id" VARCHAR(20) NOT NULL,
    "announce_channel_id" VARCHAR(20),
    "play_channel_id" VARCHAR(20),
    "ping_role_id" VARCHAR(20),
    "ping_time" VARCHAR(5) NOT NULL DEFAULT '09:00',
    "week_template" TEXT[] DEFAULT ARRAY['CLIP', 'GUESS_HERO', 'DUEL', 'GUESS_MAP', 'TRUE_FALSE', 'GUESS_SKIN', '']::TEXT[],
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "hero_xp" INTEGER[] DEFAULT ARRAY[60, 40, 20]::INTEGER[],
    "map_xp" INTEGER[] DEFAULT ARRAY[60, 40, 20]::INTEGER[],
    "skin_xp" INTEGER[] DEFAULT ARRAY[80, 50, 30]::INTEGER[],
    "true_false_xp" INTEGER NOT NULL DEFAULT 15,
    "out_of_attempts_message" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minigame_config_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "minigame_maps" (
    "key" VARCHAR(40) NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minigame_maps_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "minigame_events" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "day" DATE NOT NULL,
    "type" "MinigameType" NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "description" TEXT,
    "color" INTEGER NOT NULL DEFAULT 5793266,
    "ping_enabled" BOOLEAN NOT NULL DEFAULT true,
    "ping_role_id" VARCHAR(20),
    "max_attempts" INTEGER,
    "out_of_attempts_message" TEXT,
    "answer_hero_key" VARCHAR(40),
    "answer_map_key" VARCHAR(40),
    "answer_skin" VARCHAR(100),
    "answer_true" BOOLEAN,
    "poll_question" VARCHAR(300),
    "poll_answers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel_id" VARCHAR(20),
    "message_id" VARCHAR(20),
    "poll_message_id" VARCHAR(20),
    "ping_message_id" VARCHAR(20),
    "end_message_id" VARCHAR(20),
    "published_at" TIMESTAMP(3),
    "discord_synced_at" TIMESTAMP(3),
    "pinged_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minigame_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minigame_images" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "minigame_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minigame_games" (
    "event_id" UUID NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "guesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "hero_found_at" TIMESTAMP(3),
    "solved_at" TIMESTAMP(3),
    "xp_awarded" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minigame_games_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "xp_adjustments" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "author_id" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "minigame_maps_name_key" ON "minigame_maps"("name");

-- CreateIndex
CREATE UNIQUE INDEX "minigame_events_guild_id_day_key" ON "minigame_events"("guild_id", "day");

-- CreateIndex
CREATE INDEX "minigame_images_event_id_idx" ON "minigame_images"("event_id");

-- CreateIndex
CREATE INDEX "xp_adjustments_guild_id_user_id_idx" ON "xp_adjustments"("guild_id", "user_id");

-- AddForeignKey
ALTER TABLE "minigame_config" ADD CONSTRAINT "minigame_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_events" ADD CONSTRAINT "minigame_events_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_events" ADD CONSTRAINT "minigame_events_answer_hero_key_fkey" FOREIGN KEY ("answer_hero_key") REFERENCES "owdle_heroes"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_events" ADD CONSTRAINT "minigame_events_answer_map_key_fkey" FOREIGN KEY ("answer_map_key") REFERENCES "minigame_maps"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_images" ADD CONSTRAINT "minigame_images_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "minigame_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_games" ADD CONSTRAINT "minigame_games_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "minigame_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "minigame_games" ADD CONSTRAINT "minigame_games_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "minigame_maps" ("key", "name", "updated_at") VALUES
  ('antarctic-peninsula', 'Péninsule antarctique', CURRENT_TIMESTAMP),
  ('busan', 'Busan', CURRENT_TIMESTAMP),
  ('ilios', 'Ilios', CURRENT_TIMESTAMP),
  ('lijiang-tower', 'Tour de Lijiang', CURRENT_TIMESTAMP),
  ('nepal', 'Népal', CURRENT_TIMESTAMP),
  ('oasis', 'Oasis', CURRENT_TIMESTAMP),
  ('samoa', 'Samoa', CURRENT_TIMESTAMP),
  ('circuit-royal', 'Circuit royal', CURRENT_TIMESTAMP),
  ('dorado', 'Dorado', CURRENT_TIMESTAMP),
  ('havana', 'Havana', CURRENT_TIMESTAMP),
  ('junkertown', 'Junkertown', CURRENT_TIMESTAMP),
  ('rialto', 'Rialto', CURRENT_TIMESTAMP),
  ('route-66', 'Route 66', CURRENT_TIMESTAMP),
  ('shambali-monastery', 'Monastère de Shambali', CURRENT_TIMESTAMP),
  ('watchpoint-gibraltar', 'Observatoire : Gibraltar', CURRENT_TIMESTAMP),
  ('blizzard-world', 'Blizzard World', CURRENT_TIMESTAMP),
  ('eichenwalde', 'Eichenwalde', CURRENT_TIMESTAMP),
  ('hollywood', 'Hollywood', CURRENT_TIMESTAMP),
  ('kings-row', 'King''s Row', CURRENT_TIMESTAMP),
  ('midtown', 'Midtown', CURRENT_TIMESTAMP),
  ('numbani', 'Numbani', CURRENT_TIMESTAMP),
  ('paraiso', 'Paraíso', CURRENT_TIMESTAMP),
  ('colosseo', 'Colosseo', CURRENT_TIMESTAMP),
  ('esperanca', 'Esperança', CURRENT_TIMESTAMP),
  ('new-queen-street', 'New Queen Street', CURRENT_TIMESTAMP),
  ('runasapi', 'Runasapi', CURRENT_TIMESTAMP),
  ('new-junk-city', 'New Junk City', CURRENT_TIMESTAMP),
  ('suravasa', 'Suravasa', CURRENT_TIMESTAMP),
  ('aatlis', 'Aatlis', CURRENT_TIMESTAMP),
  ('hanaoka', 'Hanaoka', CURRENT_TIMESTAMP),
  ('throne-of-anubis', 'Trône d''Anubis', CURRENT_TIMESTAMP),
  ('temple-of-anubis', 'Temple d''Anubis', CURRENT_TIMESTAMP),
  ('hanamura', 'Hanamura', CURRENT_TIMESTAMP),
  ('volskaya-industries', 'Volskaya Industries', CURRENT_TIMESTAMP),
  ('paris', 'Paris', CURRENT_TIMESTAMP),
  ('horizon-lunar-colony', 'Colonie lunaire Horizon', CURRENT_TIMESTAMP),
  ('chateau-guillard', 'Château Guillard', CURRENT_TIMESTAMP),
  ('kanezaka', 'Kanezaka', CURRENT_TIMESTAMP),
  ('malevento', 'Malevento', CURRENT_TIMESTAMP),
  ('petra', 'Pétra', CURRENT_TIMESTAMP),
  ('ayutthaya', 'Ayutthaya', CURRENT_TIMESTAMP),
  ('black-forest', 'Forêt noire', CURRENT_TIMESTAMP),
  ('castillo', 'Castillo', CURRENT_TIMESTAMP),
  ('ecopoint-antarctica', 'Écopoint : Antarctique', CURRENT_TIMESTAMP),
  ('necropolis', 'Nécropole', CURRENT_TIMESTAMP);
