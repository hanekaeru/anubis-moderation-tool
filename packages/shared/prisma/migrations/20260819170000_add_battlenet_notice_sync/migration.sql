-- Annonce d'une verification Battle.net reussie : journal de moderation et
-- message prive au membre, portes par le bot.
--
-- Migration a part et non ajoutee a `20260819100000_add_battlenet_verification`
-- : celle-ci est deja appliquee, et modifier une migration appliquee change son
-- empreinte — `prisma migrate dev` refuse alors de tourner et propose de
-- reinitialiser la base.
ALTER TABLE "battlenet_accounts"
  ADD COLUMN "discord_synced_at" TIMESTAMP(3);

-- Les liens deja enregistres sont retro-remplis avec leur `verified_at`, meme
-- raison que pour `warnings` et `account_flags` : sans cela, le premier passage
-- de la tache annoncerait toutes les verifications faites depuis la mise en
-- service, et enverrait un message prive a chacun de leurs auteurs.
UPDATE "battlenet_accounts" SET "discord_synced_at" = "verified_at";
