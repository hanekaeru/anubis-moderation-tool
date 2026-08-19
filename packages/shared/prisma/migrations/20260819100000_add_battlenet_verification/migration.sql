-- Verification Battle.net a l'arrivee, en seconde etape de la quarantaine.
--
-- `ALTER TYPE ... ADD VALUE` tient dans la transaction de migration parce que
-- la valeur ajoutee n'est utilisee par aucune instruction de ce fichier :
-- PostgreSQL ne l'interdit que dans le cas contraire.
ALTER TYPE "AccountFlagType" ADD VALUE 'BATTLENET_DUPLICATE';

-- Jeux de roles par etape franchie. NOT NULL avec un tableau vide par defaut,
-- meme raison que `release_add_role_ids` : le client Prisma refuse NULL sur
-- une liste scalaire, et les lignes deja en base doivent lire `{}`.
--
-- `battlenet_required` a `false` par defaut : un serveur qui n'ouvre jamais la
-- page de reglage ne doit voir aucun changement de comportement.
ALTER TABLE "quarantine_config"
  ADD COLUMN "accept_add_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "accept_remove_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "verify_add_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "verify_remove_role_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "battlenet_required" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "battlenet_button_label" TEXT NOT NULL DEFAULT 'Verifier mon compte Battle.net',
  ADD COLUMN "battlenet_message" TEXT;

-- Les quarantaines deja en cours restent a NULL : aucune n'a ete verifiee, et
-- la colonne ne bloque personne tant que `battlenet_required` vaut `false`.
ALTER TABLE "quarantine_status"
  ADD COLUMN "battlenet_verified_at" TIMESTAMP(3);

-- Un compte Blizzard par membre Discord, et un membre Discord par compte
-- Blizzard : c'est la double unicite qui fait la valeur anti-multicompte du
-- dispositif. La cle primaire porte sur `battlenet_id` (le `sub` OAuth, stable
-- meme apres un changement de BattleTag), l'unicite de `user_id` sur l'autre
-- sens.
CREATE TABLE "battlenet_accounts" (
    "battlenet_id" TEXT NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "battletag" TEXT NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "battlenet_accounts_pkey" PRIMARY KEY ("battlenet_id")
);

CREATE UNIQUE INDEX "battlenet_accounts_user_id_key" ON "battlenet_accounts"("user_id");

ALTER TABLE "battlenet_accounts"
  ADD CONSTRAINT "battlenet_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "battlenet_accounts"
  ADD CONSTRAINT "battlenet_accounts_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Le `state` OAuth, tire cote serveur et consomme une seule fois. En base et
-- non en memoire : le bot le pose, l'API le consomme, et ce sont deux
-- conteneurs distincts.
CREATE TABLE "battlenet_verification_states" (
    "state" TEXT NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "battlenet_verification_states_pkey" PRIMARY KEY ("state")
);

CREATE INDEX "battlenet_verification_states_expires_at_idx" ON "battlenet_verification_states"("expires_at");

ALTER TABLE "battlenet_verification_states"
  ADD CONSTRAINT "battlenet_verification_states_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "battlenet_verification_states"
  ADD CONSTRAINT "battlenet_verification_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Alerte au staff deja envoyee, pour les signalements que le bot n'a pas poses
-- lui-meme. Les lignes existantes sont retro-remplies avec leur `created_at` :
-- sans cela, le premier passage de la tache d'alerte reposterait au salon de
-- logs tous les comptes signales depuis la mise en service.
ALTER TABLE "account_flags"
  ADD COLUMN "discord_synced_at" TIMESTAMP(3);

UPDATE "account_flags" SET "discord_synced_at" = "created_at";
