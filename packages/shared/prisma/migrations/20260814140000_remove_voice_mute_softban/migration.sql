-- Retire VOICE_MUTE et SOFTBAN de l'enum SanctionType : ni l'un ni l'autre
-- n'est relie a une commande du bot ni a un effet Discord, ce sont des types
-- inertes depuis leur creation.
--
-- Postgres ne sait pas retirer une valeur d'un enum existant : on recree le
-- type avec les seules valeurs conservees, puis on bascule la colonne dessus.

-- Toute sanction posee avec l'un de ces deux types n'a jamais eu d'effet
-- Discord reel (aucune commande ne les applique) : elle est supprimee plutot
-- que reassignee a un type qui ne correspondrait pas a ce qui a ete fait.
DELETE FROM "sanctions" WHERE "type" IN ('VOICE_MUTE', 'SOFTBAN');

ALTER TYPE "SanctionType" RENAME TO "SanctionType_old";

CREATE TYPE "SanctionType" AS ENUM ('TIMEOUT', 'KICK', 'BAN', 'SHADOWBAN');

ALTER TABLE "sanctions"
    ALTER COLUMN "type" TYPE "SanctionType" USING ("type"::text::"SanctionType");

DROP TYPE "SanctionType_old";
