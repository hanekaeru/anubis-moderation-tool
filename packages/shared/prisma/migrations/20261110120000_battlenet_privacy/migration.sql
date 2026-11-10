-- Verification Battle.net : mise en conformite (conditions Blizzard, Discord,
-- RGPD).
--
-- 1. La cle devient une **empreinte** du `sub` Blizzard (HMAC-SHA256 sous
--    `BATTLENET_ID_SECRET`). La colonne est renommee, pas recalculee : le
--    secret vit dans l'environnement de l'API, que SQL ne voit pas. L'API
--    remplace les identifiants encore en clair a son demarrage
--    (`BattlenetHashMigration`) ; tant qu'elle ne l'a pas fait, ils restent
--    comparables, simplement pas encore masques.
-- 2. Une ligne peut devenir une **trace** de deliaison : `user_id` cesse donc
--    d'etre unique — un membre porte un lien actif et les traces de comptes
--    qu'il a delies.
-- 3. Le BattleTag devient facultatif : il est efface 30 jours apres la
--    verification, et des la deliaison.
-- 4. Role « BattleTag verifie », regle par serveur.
-- 5. Les copies du `sub` en clair sont retirees des signalements et du
--    journal d'audit, ou elles n'avaient rien a faire : l'alerte de doublon
--    les recopiait meme dans le salon de logs.

ALTER TABLE "battlenet_accounts" RENAME COLUMN "battlenet_id" TO "battlenet_hash";

DROP INDEX "battlenet_accounts_user_id_key";
CREATE INDEX "battlenet_accounts_user_id_idx" ON "battlenet_accounts"("user_id");

ALTER TABLE "battlenet_accounts"
  ALTER COLUMN "battletag" DROP NOT NULL,
  ADD COLUMN "unlinked_at" TIMESTAMP(3),
  ADD COLUMN "unlinked_by_id" UUID,
  ADD COLUMN "unlinked_by_discord_id" VARCHAR(20);

ALTER TABLE "battlenet_accounts"
  ADD CONSTRAINT "battlenet_accounts_unlinked_by_id_fkey"
  FOREIGN KEY ("unlinked_by_id") REFERENCES "app_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "battlenet_accounts"
  ADD CONSTRAINT "battlenet_accounts_unlinked_by_discord_id_fkey"
  FOREIGN KEY ("unlinked_by_discord_id") REFERENCES "discord_users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- BattleTags deja plus vieux que la duree de conservation.
UPDATE "battlenet_accounts"
  SET "battletag" = NULL
  WHERE "verified_at" < NOW() - INTERVAL '30 days';

ALTER TABLE "quarantine_config" ADD COLUMN "battlenet_role_id" VARCHAR(20);

UPDATE "account_flags"
  SET "details" = "details" - 'battlenetId'
  WHERE "details" ? 'battlenetId';

UPDATE "audit_log"
  SET "after" = "after" - 'battlenetId'
  WHERE "entity_type" = 'battlenet_account' AND "after" ? 'battlenetId';
