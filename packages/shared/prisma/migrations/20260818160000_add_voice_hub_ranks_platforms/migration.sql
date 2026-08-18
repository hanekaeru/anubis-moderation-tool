-- Rangs et plateformes proposes dans les options de personnalisation d'un
-- salon vocal temporaire.
--
-- Seul le rang range le salon : il porte la categorie Discord ou le salon est
-- deplace. La plateforme est descriptive. Les deux se lisent dans le *sujet*
-- du salon (« voice status »), jamais dans son nom — Discord n'autorise que
-- deux renommages par dix minutes et par salon.

CREATE TABLE "voice_hub_ranks" (
  "id"          UUID         NOT NULL,
  "hub_id"      UUID         NOT NULL,
  "label"       TEXT         NOT NULL,
  "emoji"       TEXT,
  "category_id" VARCHAR(20)  NOT NULL,
  "position"    INTEGER      NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL,

  CONSTRAINT "voice_hub_ranks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "voice_hub_ranks_hub_id_idx" ON "voice_hub_ranks" ("hub_id");

ALTER TABLE "voice_hub_ranks"
  ADD CONSTRAINT "voice_hub_ranks_hub_id_fkey"
  FOREIGN KEY ("hub_id") REFERENCES "voice_hubs" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "voice_hub_platforms" (
  "id"         UUID         NOT NULL,
  "hub_id"     UUID         NOT NULL,
  "label"      TEXT         NOT NULL,
  "emoji"      TEXT,
  "position"   INTEGER      NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "voice_hub_platforms_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "voice_hub_platforms_hub_id_idx" ON "voice_hub_platforms" ("hub_id");

ALTER TABLE "voice_hub_platforms"
  ADD CONSTRAINT "voice_hub_platforms_hub_id_fkey"
  FOREIGN KEY ("hub_id") REFERENCES "voice_hubs" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Gabarit du sujet, cote salon de creation.
ALTER TABLE "voice_hubs"
  ADD COLUMN "status_pattern" TEXT NOT NULL DEFAULT '{rang} {plateforme} · {sujet}';

-- Choix courants du salon temporaire. `ON DELETE SET NULL` : retirer un rang
-- depuis le dashboard ne doit pas effacer la ligne d'audit des salons qui
-- l'ont porte.
ALTER TABLE "temporary_voice_channels"
  ADD COLUMN "rank_id"     UUID,
  ADD COLUMN "platform_id" UUID,
  ADD COLUMN "topic"       TEXT;

ALTER TABLE "temporary_voice_channels"
  ADD CONSTRAINT "temporary_voice_channels_rank_id_fkey"
  FOREIGN KEY ("rank_id") REFERENCES "voice_hub_ranks" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "temporary_voice_channels"
  ADD CONSTRAINT "temporary_voice_channels_platform_id_fkey"
  FOREIGN KEY ("platform_id") REFERENCES "voice_hub_platforms" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
