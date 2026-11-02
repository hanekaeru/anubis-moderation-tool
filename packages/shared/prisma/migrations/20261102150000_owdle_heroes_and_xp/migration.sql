-- OWdle : heros modifiables depuis le dashboard, sous-role a la place du type
-- d'arme, et experience gagnee a la victoire.
--
-- Les heros vivaient dans le code (`OWDLE_HEROES`) : ils passent en base pour
-- que le staff puisse les corriger sans redeploiement. La table est pre-remplie
-- avec la liste d'avant, sous-roles compris (wiki Overwatch, novembre 2026).
-- Le type d'arme n'a jamais ete stocke : il disparait sans conversion.
--
-- Les affiliations deviennent une table geree depuis le dashboard, reprise des
-- huit valeurs codees jusque-la : leur cle est l'ancienne valeur en minuscules.

CREATE TYPE "OwdleRole" AS ENUM ('TANK', 'DAMAGE', 'SUPPORT');
CREATE TYPE "OwdleSubRole" AS ENUM ('BRUISER', 'INITIATOR', 'STALWART', 'FLANKER', 'RECON', 'SHARPSHOOTER', 'SPECIALIST', 'MEDIC', 'SURVIVOR', 'TACTICIAN');
CREATE TYPE "OwdleSpecies" AS ENUM ('HUMAN', 'OMNIC', 'ANIMAL');
CREATE TYPE "OwdleRegion" AS ENUM ('EUROPE', 'AMERICAS', 'ASIA', 'AFRICA', 'OCEANIA', 'SPACE', 'UNKNOWN');

CREATE TABLE "owdle_affiliations" (
  "key"        VARCHAR(40)  NOT NULL,
  "label"      VARCHAR(60)  NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "owdle_affiliations_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "owdle_affiliations_label_key" ON "owdle_affiliations"("label");

INSERT INTO "owdle_affiliations" ("key", "label") VALUES
  ('overwatch', 'Overwatch'),
  ('talon', 'La Griffe'),
  ('junkers', 'Junkers'),
  ('vishkar', 'Vishkar'),
  ('none', 'Aucune'),
  ('other', 'Autre'),
  ('meka', 'Escouade MEKA'),
  ('yokai', 'Yokai');

ALTER TABLE "owdle_affiliations" ALTER COLUMN "updated_at" DROP DEFAULT;

CREATE TABLE "owdle_heroes" (
  "key"          VARCHAR(40)        NOT NULL,
  "name"         VARCHAR(60)        NOT NULL,
  "role"         "OwdleRole"        NOT NULL,
  "sub_role"     "OwdleSubRole"     NOT NULL,
  "species"      "OwdleSpecies"     NOT NULL,
  "origin"       VARCHAR(60)        NOT NULL,
  "region"       "OwdleRegion"      NOT NULL,
  "affiliation_key" VARCHAR(40)     NOT NULL,
  "release_year" INTEGER            NOT NULL,
  "enabled"      BOOLEAN            NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "owdle_heroes_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "owdle_heroes_name_key" ON "owdle_heroes"("name");

ALTER TABLE "owdle_heroes"
  ADD CONSTRAINT "owdle_heroes_affiliation_key_fkey"
  FOREIGN KEY ("affiliation_key") REFERENCES "owdle_affiliations"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "owdle_heroes" ("key", "name", "role", "sub_role", "species", "origin", "region", "affiliation_key", "release_year") VALUES
  ('dmon', 'D.Mon', 'TANK', 'STALWART', 'HUMAN', 'Corée du Sud', 'ASIA', 'other', 2026),
  ('domina', 'Domina', 'TANK', 'STALWART', 'HUMAN', 'Inde', 'ASIA', 'vishkar', 2026),
  ('dva', 'D.Va', 'TANK', 'INITIATOR', 'HUMAN', 'Corée du Sud', 'ASIA', 'overwatch', 2016),
  ('doomfist', 'Doomfist', 'TANK', 'INITIATOR', 'HUMAN', 'Nigeria', 'AFRICA', 'talon', 2017),
  ('hazard', 'Danger', 'TANK', 'INITIATOR', 'HUMAN', 'Royaume-Uni', 'EUROPE', 'other', 2024),
  ('junker-queen', 'Reine des Junkers', 'TANK', 'STALWART', 'HUMAN', 'Australie', 'OCEANIA', 'junkers', 2022),
  ('mauga', 'Mauga', 'TANK', 'BRUISER', 'HUMAN', 'Samoa', 'OCEANIA', 'talon', 2023),
  ('orisa', 'Orisa', 'TANK', 'BRUISER', 'OMNIC', 'Numbani', 'AFRICA', 'overwatch', 2017),
  ('ramattra', 'Ramattra', 'TANK', 'STALWART', 'OMNIC', 'Népal', 'ASIA', 'other', 2022),
  ('reinhardt', 'Reinhardt', 'TANK', 'STALWART', 'HUMAN', 'Allemagne', 'EUROPE', 'overwatch', 2016),
  ('roadhog', 'Chopper', 'TANK', 'BRUISER', 'HUMAN', 'Australie', 'OCEANIA', 'junkers', 2016),
  ('sigma', 'Sigma', 'TANK', 'STALWART', 'HUMAN', 'Pays-Bas', 'EUROPE', 'talon', 2019),
  ('winston', 'Winston', 'TANK', 'INITIATOR', 'ANIMAL', 'Lune', 'SPACE', 'overwatch', 2016),
  ('wrecking-ball', 'Bouldozer', 'TANK', 'INITIATOR', 'ANIMAL', 'Lune', 'SPACE', 'junkers', 2018),
  ('zarya', 'Zarya', 'TANK', 'BRUISER', 'HUMAN', 'Russie', 'EUROPE', 'overwatch', 2016),
  ('anran', 'Anran', 'DAMAGE', 'FLANKER', 'HUMAN', 'Chine', 'ASIA', 'overwatch', 2026),
  ('ashe', 'Ashe', 'DAMAGE', 'SHARPSHOOTER', 'HUMAN', 'États-Unis', 'AMERICAS', 'other', 2018),
  ('bastion', 'Bastion', 'DAMAGE', 'SPECIALIST', 'OMNIC', 'Inconnue', 'UNKNOWN', 'none', 2016),
  ('cassidy', 'Cassidy', 'DAMAGE', 'SHARPSHOOTER', 'HUMAN', 'États-Unis', 'AMERICAS', 'overwatch', 2016),
  ('echo', 'Écho', 'DAMAGE', 'RECON', 'OMNIC', 'Singapour', 'ASIA', 'overwatch', 2020),
  ('emre', 'Emre', 'DAMAGE', 'SPECIALIST', 'HUMAN', 'Turquie', 'EUROPE', 'talon', 2026),
  ('freja', 'Freja', 'DAMAGE', 'RECON', 'HUMAN', 'Danemark', 'EUROPE', 'none', 2025),
  ('genji', 'Genji', 'DAMAGE', 'FLANKER', 'HUMAN', 'Japon', 'ASIA', 'yokai', 2016),
  ('hanzo', 'Hanzo', 'DAMAGE', 'SHARPSHOOTER', 'HUMAN', 'Japon', 'ASIA', 'yokai', 2016),
  ('junkrat', 'Chacal', 'DAMAGE', 'SPECIALIST', 'HUMAN', 'Australie', 'OCEANIA', 'junkers', 2016),
  ('mei', 'Mei', 'DAMAGE', 'SPECIALIST', 'HUMAN', 'Chine', 'ASIA', 'overwatch', 2016),
  ('pharah', 'Pharah', 'DAMAGE', 'RECON', 'HUMAN', 'Égypte', 'AFRICA', 'overwatch', 2016),
  ('reaper', 'Faucheur', 'DAMAGE', 'FLANKER', 'HUMAN', 'États-Unis', 'AMERICAS', 'talon', 2016),
  ('shion', 'Shion', 'DAMAGE', 'FLANKER', 'OMNIC', 'Japon', 'ASIA', 'other', 2026),
  ('sierra', 'Sierra', 'DAMAGE', 'RECON', 'HUMAN', 'États-Unis', 'AMERICAS', 'overwatch', 2026),
  ('sojourn', 'Sojourn', 'DAMAGE', 'SHARPSHOOTER', 'HUMAN', 'Canada', 'AMERICAS', 'overwatch', 2022),
  ('soldier-76', 'Soldat : 76', 'DAMAGE', 'SPECIALIST', 'HUMAN', 'États-Unis', 'AMERICAS', 'none', 2016),
  ('symmetra', 'Symmetra', 'DAMAGE', 'SPECIALIST', 'HUMAN', 'Inde', 'ASIA', 'vishkar', 2016),
  ('torbjorn', 'Torbjörn', 'DAMAGE', 'SPECIALIST', 'HUMAN', 'Suède', 'EUROPE', 'overwatch', 2016),
  ('tracer', 'Tracer', 'DAMAGE', 'FLANKER', 'HUMAN', 'Angleterre', 'EUROPE', 'overwatch', 2016),
  ('vendetta', 'Vendetta', 'DAMAGE', 'FLANKER', 'HUMAN', 'Italie', 'EUROPE', 'talon', 2025),
  ('venture', 'Venture', 'DAMAGE', 'FLANKER', 'HUMAN', 'Canada', 'AMERICAS', 'none', 2024),
  ('widowmaker', 'Fatale', 'DAMAGE', 'SHARPSHOOTER', 'HUMAN', 'France', 'EUROPE', 'talon', 2016),
  ('ana', 'Ana', 'SUPPORT', 'TACTICIAN', 'HUMAN', 'Égypte', 'AFRICA', 'overwatch', 2016),
  ('baptiste', 'Baptiste', 'SUPPORT', 'TACTICIAN', 'HUMAN', 'Haïti', 'AMERICAS', 'overwatch', 2019),
  ('brigitte', 'Brigitte', 'SUPPORT', 'SURVIVOR', 'HUMAN', 'Suède', 'EUROPE', 'overwatch', 2018),
  ('doctrine', 'Doctrine', 'SUPPORT', 'SURVIVOR', 'HUMAN', 'Zimbabwe', 'AFRICA', 'talon', 2026),
  ('illari', 'Illari', 'SUPPORT', 'SURVIVOR', 'HUMAN', 'Pérou', 'AMERICAS', 'other', 2023),
  ('jetpack-cat', 'Jetpack Cat', 'SUPPORT', 'TACTICIAN', 'ANIMAL', 'Inconnue', 'UNKNOWN', 'overwatch', 2026),
  ('juno', 'Juno', 'SUPPORT', 'SURVIVOR', 'HUMAN', 'Mars', 'SPACE', 'overwatch', 2024),
  ('kiriko', 'Kiriko', 'SUPPORT', 'MEDIC', 'HUMAN', 'Japon', 'ASIA', 'yokai', 2022),
  ('lifeweaver', 'Vital', 'SUPPORT', 'MEDIC', 'HUMAN', 'Thaïlande', 'ASIA', 'other', 2023),
  ('lucio', 'Lúcio', 'SUPPORT', 'TACTICIAN', 'HUMAN', 'Brésil', 'AMERICAS', 'overwatch', 2016),
  ('mercy', 'Ange', 'SUPPORT', 'MEDIC', 'HUMAN', 'Suisse', 'EUROPE', 'overwatch', 2016),
  ('mizuki', 'Mizuki', 'SUPPORT', 'SURVIVOR', 'HUMAN', 'Japon', 'ASIA', 'overwatch', 2026),
  ('moira', 'Moira', 'SUPPORT', 'MEDIC', 'HUMAN', 'Irlande', 'EUROPE', 'talon', 2017),
  ('sombra', 'Sombra', 'SUPPORT', 'TACTICIAN', 'HUMAN', 'Mexique', 'AMERICAS', 'talon', 2016),
  ('wuyang', 'Wuyang', 'SUPPORT', 'SURVIVOR', 'HUMAN', 'Chine', 'ASIA', 'overwatch', 2025),
  ('zenyatta', 'Zenyatta', 'SUPPORT', 'TACTICIAN', 'OMNIC', 'Népal', 'ASIA', 'other', 2016);

-- Le defaut n'a servi qu'au pre-remplissage : Prisma pose `updated_at`
-- lui-meme, et le schema n'en declare pas.
ALTER TABLE "owdle_heroes" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Les lignes existantes recoivent le bareme par defaut : le proprietaire a
-- demande que trouver l'OWdle rapporte de l'experience, y compris sur un
-- serveur qui n'ouvrira jamais la page.
ALTER TABLE "owdle_config"
  ADD COLUMN "xp_by_guesses" INTEGER[] DEFAULT ARRAY[100, 80, 60, 50, 40, 30]::INTEGER[];
