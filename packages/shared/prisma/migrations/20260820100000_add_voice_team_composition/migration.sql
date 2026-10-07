-- Composition d'equipe des salons vocaux temporaires.
--
-- Le texte libre du sujet laisse la place a trois nombres : les places deja
-- prises en tank, DPS et support. Le « sur combien » vient du salon de
-- creation, parce qu'il ne depend pas du salon mais du mode de jeu — un 5v5
-- ne porte qu'un tank la ou un 6v6 en porte deux.

ALTER TABLE "voice_hubs"
  ADD COLUMN "tank_slots"    INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "dps_slots"     INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "support_slots" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "tank_emoji"    TEXT,
  ADD COLUMN "dps_emoji"     TEXT,
  ADD COLUMN "support_emoji" TEXT;

ALTER TABLE "voice_hubs"
  ALTER COLUMN "status_pattern" SET DEFAULT '{rang} {plateforme} · {roles}';

-- Les gabarits deja enregistres portent `{sujet}`, un jeton qui ne sera plus
-- jamais rempli : sans cette reecriture, les salons existants perdraient la
-- ligne des roles sans que personne ne comprenne pourquoi.
UPDATE "voice_hubs"
   SET "status_pattern" = replace("status_pattern", '{sujet}', '{roles}')
 WHERE "status_pattern" LIKE '%{sujet}%';

ALTER TABLE "temporary_voice_channels"
  ADD COLUMN "tank_taken"    INTEGER,
  ADD COLUMN "dps_taken"     INTEGER,
  ADD COLUMN "support_taken" INTEGER;

-- Le texte libre disparait avec le champ qui le saisissait. Les salons
-- temporaires sont ephemeres par construction : rien d'historique ne s'y
-- perd, contrairement aux suppressions logiques du reste du schema.
ALTER TABLE "temporary_voice_channels"
  DROP COLUMN "topic";
