-- AlterTable
ALTER TABLE "sanctions" ADD COLUMN     "revoked_by_discord_id" VARCHAR(20),
ADD COLUMN     "automod_incident_id" BIGINT;

-- Rattrapage : les levees faites depuis Discord avant cette colonne n ont
-- jamais eu d auteur sur la sanction. Il est pourtant connu — le bot ecrit une
-- ligne "sanction.revoke" dans moderation_activity avec le moderateur Discord
-- reel. Sans cette reprise, tout l historique s afficherait "auteur inconnu".
-- La jointure est exacte (target_id porte l identifiant de la sanction) : rien
-- n est devine ici. moderator_id reference deja discord_users, la clef
-- etrangere ajoutee plus bas tient donc pour ces lignes.
UPDATE "sanctions" s
SET "revoked_by_discord_id" = a."moderator_id"
FROM "moderation_activity" a
WHERE a."target_type" = 'sanction'
  AND a."action" = 'sanction.revoke'
  AND a."moderator_id" IS NOT NULL
  AND a."target_id" = s."id"::text
  AND s."revoked_at" IS NOT NULL
  AND s."revoked_by_id" IS NULL
  AND s."revoked_by_discord_id" IS NULL;

-- CreateIndex
CREATE INDEX "sanctions_automod_incident_id_idx" ON "sanctions"("automod_incident_id");

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_revoked_by_discord_id_fkey" FOREIGN KEY ("revoked_by_discord_id") REFERENCES "discord_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_automod_incident_id_fkey" FOREIGN KEY ("automod_incident_id") REFERENCES "automod_incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
