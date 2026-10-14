-- Region des matchs esport : intertitres du recapitulatif (EMEA, NA, Coree...).

-- AlterTable
ALTER TABLE "esport_matches" ADD COLUMN     "region" VARCHAR(10);

-- Les matchs deja saisis prennent la region que nomme leur competition
-- (« OWCS EMEA », « OWCS North America Stage 3 »...), avec les memes mots-cles
-- et dans le meme ordre que `ESPORT_REGIONS`. Le reste demeure sans region.
UPDATE "esport_matches" SET "region" = CASE
    WHEN "competition" ILIKE '%emea%' OR "competition" ILIKE '%europe%' THEN 'EMEA'
    WHEN "competition" ILIKE '%north america%' OR "competition" ILIKE '%americas%' THEN 'NA'
    WHEN "competition" ILIKE '%korea%' THEN 'KR'
    WHEN "competition" ILIKE '%china%' THEN 'CN'
    WHEN "competition" ILIKE '%japan%' THEN 'JP'
    WHEN "competition" ILIKE '%pacific%' OR "competition" ILIKE '%asia%' OR "competition" ILIKE '%oceania%' THEN 'PAC'
    WHEN "competition" ILIKE '%world%' OR "competition" ILIKE '%midseason%' OR "competition" ILIKE '%international%'
      OR "competition" ILIKE '%finals%' OR "competition" ILIKE '%clash%' OR "competition" ILIKE '%ewc%' THEN 'INTL'
END
WHERE "competition" IS NOT NULL;
