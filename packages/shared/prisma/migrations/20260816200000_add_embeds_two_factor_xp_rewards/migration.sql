-- CreateEnum
CREATE TYPE "EmbedMessageStatus" AS ENUM ('DRAFT', 'QUEUED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "app_users" ADD COLUMN "totp_secret" TEXT,
ADD COLUMN "totp_enabled_at" TIMESTAMP(3),
ADD COLUMN "totp_last_counter" INTEGER;

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "app_user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xp_reward_roles" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "role_id" VARCHAR(20) NOT NULL,
    "level" INTEGER NOT NULL,
    "replace_previous" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xp_reward_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "embed_messages" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "message_id" VARCHAR(20),
    "name" VARCHAR(120) NOT NULL,
    "content" TEXT,
    "title" VARCHAR(256),
    "description" TEXT,
    "color" INTEGER NOT NULL DEFAULT 5793266,
    "url" TEXT,
    "author_name" VARCHAR(256),
    "author_icon_url" TEXT,
    "thumbnail_url" TEXT,
    "image_url" TEXT,
    "footer_text" VARCHAR(2048),
    "footer_icon_url" TEXT,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "show_timestamp" BOOLEAN NOT NULL DEFAULT false,
    "status" "EmbedMessageStatus" NOT NULL DEFAULT 'DRAFT',
    "last_error" TEXT,
    "created_by_id" UUID,
    "discord_synced_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "embed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "two_factor_recovery_codes_app_user_id_idx" ON "two_factor_recovery_codes"("app_user_id");

-- CreateIndex
CREATE INDEX "xp_reward_roles_guild_id_idx" ON "xp_reward_roles"("guild_id");

-- CreateIndex
CREATE UNIQUE INDEX "xp_reward_roles_guild_id_level_key" ON "xp_reward_roles"("guild_id", "level");

-- CreateIndex
CREATE INDEX "embed_messages_guild_id_status_idx" ON "embed_messages"("guild_id", "status");

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xp_reward_roles" ADD CONSTRAINT "xp_reward_roles_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_messages" ADD CONSTRAINT "embed_messages_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "embed_messages" ADD CONSTRAINT "embed_messages_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
