-- Roles appliques a la levee de la quarantaine (acceptation du reglement ou
-- deblocage depuis la webapp). NOT NULL avec un tableau vide par defaut : les
-- lignes deja en base doivent lire `{}` et non NULL, que le client Prisma
-- refuserait sur une liste scalaire.
ALTER TABLE "quarantine_config"
  ADD COLUMN "release_add_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "release_remove_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
