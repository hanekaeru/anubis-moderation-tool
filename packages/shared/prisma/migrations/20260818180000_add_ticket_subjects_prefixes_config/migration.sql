-- Sujets configurables, prefixes de moderateur, limite de tickets ouverts et
-- prise en charge depuis Discord.

CREATE TABLE "ticket_subjects" (
  "id"               UUID             NOT NULL,
  "guild_id"         VARCHAR(20)      NOT NULL,
  "label"            TEXT             NOT NULL,
  "description"      TEXT,
  "emoji"            TEXT,
  "category"         "TicketCategory" NOT NULL DEFAULT 'OTHER',
  "default_priority" "TicketPriority" NOT NULL DEFAULT 'NORMAL',
  "position"         INTEGER          NOT NULL DEFAULT 0,
  "enabled"          BOOLEAN          NOT NULL DEFAULT true,
  "created_at"       TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3)     NOT NULL,

  CONSTRAINT "ticket_subjects_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_subjects_guild_id_idx" ON "ticket_subjects" ("guild_id");

ALTER TABLE "ticket_subjects"
  ADD CONSTRAINT "ticket_subjects_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ticket_moderator_prefixes" (
  "guild_id"   VARCHAR(20)  NOT NULL,
  "user_id"    VARCHAR(20)  NOT NULL,
  "prefix"     TEXT         NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ticket_moderator_prefixes_pkey" PRIMARY KEY ("guild_id", "user_id")
);

ALTER TABLE "ticket_moderator_prefixes"
  ADD CONSTRAINT "ticket_moderator_prefixes_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_moderator_prefixes"
  ADD CONSTRAINT "ticket_moderator_prefixes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "discord_users" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- La limite par defaut vaut 1 : le comportement d'avant le reglage, ou
-- `hasOpenTicket` refusait tout second ticket.
CREATE TABLE "ticket_config" (
  "guild_id"         VARCHAR(20)  NOT NULL,
  "max_open_tickets" INTEGER      NOT NULL DEFAULT 1,
  "updated_at"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ticket_config_pkey" PRIMARY KEY ("guild_id")
);

ALTER TABLE "ticket_config"
  ADD CONSTRAINT "ticket_config_guild_id_fkey"
  FOREIGN KEY ("guild_id") REFERENCES "guilds" ("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Prise en charge depuis Discord, et sujet configure du ticket.
ALTER TABLE "tickets"
  ADD COLUMN "claimed_by_discord_id" VARCHAR(20),
  ADD COLUMN "claimed_at"            TIMESTAMP(3),
  ADD COLUMN "subject_id"            UUID;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_claimed_by_discord_id_fkey"
  FOREIGN KEY ("claimed_by_discord_id") REFERENCES "discord_users" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "tickets"
  ADD CONSTRAINT "tickets_subject_id_fkey"
  FOREIGN KEY ("subject_id") REFERENCES "ticket_subjects" ("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
