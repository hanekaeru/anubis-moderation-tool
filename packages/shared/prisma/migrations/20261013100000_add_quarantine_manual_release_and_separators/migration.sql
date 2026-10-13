-- Trois retours de la moderation sur la quarantaine et la fiche membre.
--
-- `quarantine_status.released_at` devient ce qui fait foi pour une levee
-- manuelle. Jusqu'ici c'etait `released_by_id`, qui passe a `null` quand le
-- compte du dashboard est supprime (`ON DELETE SET NULL`) : la levee
-- s'annulait alors toute seule. Les levees existantes sont reprises avec la
-- date d'acceptation, que `release` posait en meme temps.
--
-- `released_by_discord_id` couvre la levee faite dans le client Discord, en
-- retirant le role de quarantaine a la main.
--
-- `roles.is_separator` et `member_role_requests` portent l'ajout des roles
-- separateurs depuis la fiche membre.

ALTER TABLE "quarantine_status"
  ADD COLUMN "released_at"            TIMESTAMP(3),
  ADD COLUMN "released_by_discord_id" VARCHAR(20);

UPDATE "quarantine_status"
  SET "released_at" = COALESCE("accepted_at", "quarantined_at")
  WHERE "released_by_id" IS NOT NULL;

ALTER TABLE "quarantine_status"
  ADD CONSTRAINT "quarantine_status_released_by_discord_id_fkey"
  FOREIGN KEY ("released_by_discord_id") REFERENCES "discord_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "roles"
  ADD COLUMN "is_separator" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "member_role_requests" (
  "id"                UUID         NOT NULL,
  "guild_id"          VARCHAR(20)  NOT NULL,
  "user_id"           VARCHAR(20)  NOT NULL,
  "role_ids"          TEXT[],
  "requested_by_id"   UUID,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "discord_synced_at" TIMESTAMP(3),
  "last_error"        TEXT,

  CONSTRAINT "member_role_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "member_role_requests_discord_synced_at_idx"
  ON "member_role_requests"("discord_synced_at");

ALTER TABLE "member_role_requests"
  ADD CONSTRAINT "member_role_requests_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "member_role_requests"
  ADD CONSTRAINT "member_role_requests_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "member_role_requests"
  ADD CONSTRAINT "member_role_requests_requested_by_id_fkey"
  FOREIGN KEY ("requested_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
