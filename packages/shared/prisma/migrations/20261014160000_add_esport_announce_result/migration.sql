-- Annonce de resultat facultative : par defaut, le score ne vit que dans le
-- recapitulatif de la semaine.

-- AlterTable
ALTER TABLE "esport_matches" ADD COLUMN     "announce_result" BOOLEAN NOT NULL DEFAULT false;

-- Un resultat deja annonce l'a ete volontairement : la case reste cochee.
UPDATE "esport_matches" SET "announce_result" = true WHERE "result_message_id" IS NOT NULL;
