-- Couleur de l'embed de chaque region dans le recapitulatif esport. Vide :
-- toutes les regions gardent leur couleur par defaut (`ESPORT_REGIONS`).

-- AlterTable
ALTER TABLE "esport_config" ADD COLUMN     "region_colors" JSONB NOT NULL DEFAULT '{}';
