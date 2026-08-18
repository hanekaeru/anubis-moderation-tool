-- Categorie d'accueil des salons temporaires, et creation automatique des
-- categories de rang.
--
-- Deux placements possibles pour un salon de creation :
--   FIXED_CATEGORY - le salon reste dans la categorie d'accueil (« Partie
--     Rapide »), et sa personnalisation se limite au sujet et aux places ;
--   RANK_CATEGORY  - le salon atterrit dans la categorie d'accueil (« En
--     attente »), puis le rang choisi par son proprietaire le range ailleurs.
--
-- Les identifiants de categorie deviennent facultatifs : le bot cree la
-- categorie manquante d'apres son nom, puis retient son identifiant. Vider
-- l'identifiant suffit donc a la faire retrouver, ou recreer.

CREATE TYPE "VoicePlacementMode" AS ENUM ('FIXED_CATEGORY', 'RANK_CATEGORY');

ALTER TABLE "voice_hubs"
  ADD COLUMN "placement_mode" "VoicePlacementMode" NOT NULL DEFAULT 'RANK_CATEGORY',
  ADD COLUMN "landing_category_name" TEXT NOT NULL DEFAULT 'En attente',
  ADD COLUMN "landing_category_id" VARCHAR(20);

ALTER TABLE "voice_hub_ranks"
  ALTER COLUMN "category_id" DROP NOT NULL;
