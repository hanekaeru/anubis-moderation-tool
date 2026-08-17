-- CreateEnum
CREATE TYPE "AutomodRuleType" AS ENUM ('SPAM_RATE', 'MASS_MENTIONS', 'LINKS_INVITES', 'WORD_FILTER', 'EXCESSIVE_CAPS', 'REPETITION');

-- CreateEnum
CREATE TYPE "AutomodAction" AS ENUM ('LOG_ONLY', 'DELETE', 'DELETE_AND_TIMEOUT');

-- CreateEnum
CREATE TYPE "AccountFlagType" AS ENUM ('NEW_ACCOUNT', 'DEFAULT_AVATAR', 'STAFF_IMPERSONATION', 'QUICK_REJOIN', 'JOINED_AFTER_BAN');

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "discord_synced_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "automod_rules" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "type" "AutomodRuleType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "action" "AutomodAction" NOT NULL DEFAULT 'LOG_ONLY',
    "timeout_seconds" INTEGER,
    "settings" JSONB NOT NULL,
    "exempt_role_ids" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by_id" UUID,

    CONSTRAINT "automod_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automod_incidents" (
    "id" BIGSERIAL NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "rule_type" "AutomodRuleType" NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20),
    "action" "AutomodAction" NOT NULL,
    "message_content" TEXT,
    "message_attachments" JSONB,
    "details" JSONB,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automod_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raid_config" (
    "guild_id" VARCHAR(20) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "join_threshold" INTEGER NOT NULL DEFAULT 10,
    "window_seconds" INTEGER NOT NULL DEFAULT 30,
    "lockdown_minutes" INTEGER NOT NULL DEFAULT 15,
    "alert_role_id" VARCHAR(20),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "raid_config_pkey" PRIMARY KEY ("guild_id")
);

-- CreateTable
CREATE TABLE "raid_incidents" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "join_count" INTEGER NOT NULL,
    "window_seconds" INTEGER NOT NULL,
    "member_ids" TEXT[],
    "locked_channel_ids" TEXT[],
    "previous_verification_level" INTEGER,
    "resolved_at" TIMESTAMP(3),
    "resolved_by_id" UUID,
    "discord_synced_at" TIMESTAMP(3),

    CONSTRAINT "raid_incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_flags" (
    "id" BIGSERIAL NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "type" "AccountFlagType" NOT NULL,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" UUID,

    CONSTRAINT "account_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automod_rules_guild_id_type_key" ON "automod_rules"("guild_id", "type");

-- CreateIndex
CREATE INDEX "automod_incidents_guild_id_occurred_at_idx" ON "automod_incidents"("guild_id", "occurred_at");

-- CreateIndex
CREATE INDEX "automod_incidents_guild_id_user_id_occurred_at_idx" ON "automod_incidents"("guild_id", "user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "raid_incidents_guild_id_triggered_at_idx" ON "raid_incidents"("guild_id", "triggered_at");

-- CreateIndex
CREATE INDEX "account_flags_guild_id_created_at_idx" ON "account_flags"("guild_id", "created_at");

-- CreateIndex
CREATE INDEX "account_flags_guild_id_user_id_idx" ON "account_flags"("guild_id", "user_id");

-- AddForeignKey
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automod_rules" ADD CONSTRAINT "automod_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automod_incidents" ADD CONSTRAINT "automod_incidents_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automod_incidents" ADD CONSTRAINT "automod_incidents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raid_config" ADD CONSTRAINT "raid_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raid_incidents" ADD CONSTRAINT "raid_incidents_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "raid_incidents" ADD CONSTRAINT "raid_incidents_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_flags" ADD CONSTRAINT "account_flags_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
