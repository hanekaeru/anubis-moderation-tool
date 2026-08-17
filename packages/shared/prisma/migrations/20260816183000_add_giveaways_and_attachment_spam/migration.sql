-- AlterEnum
ALTER TYPE "AutomodRuleType" ADD VALUE 'ATTACHMENT_SPAM';

-- CreateEnum
CREATE TYPE "GiveawayStatus" AS ENUM ('SCHEDULED', 'RUNNING', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "giveaways" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "message_id" VARCHAR(20),
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT,
    "prize" VARCHAR(200) NOT NULL,
    "image_url" TEXT,
    "reaction_emoji" VARCHAR(100) NOT NULL DEFAULT '🎉',
    "winner_count" INTEGER NOT NULL DEFAULT 1,
    "announce_channel_id" VARCHAR(20),
    "status" "GiveawayStatus" NOT NULL DEFAULT 'SCHEDULED',
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_by_id" UUID,
    "created_by_discord_id" VARCHAR(20),
    "discord_synced_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "giveaways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "giveaway_entries" (
    "giveaway_id" UUID NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "is_winner" BOOLEAN NOT NULL DEFAULT false,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "giveaway_entries_pkey" PRIMARY KEY ("giveaway_id","user_id")
);

-- CreateIndex
CREATE INDEX "giveaways_guild_id_status_ends_at_idx" ON "giveaways"("guild_id", "status", "ends_at");

-- CreateIndex
CREATE INDEX "giveaway_entries_giveaway_id_is_winner_idx" ON "giveaway_entries"("giveaway_id", "is_winner");

-- AddForeignKey
ALTER TABLE "giveaways" ADD CONSTRAINT "giveaways_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giveaways" ADD CONSTRAINT "giveaways_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_giveaway_id_fkey" FOREIGN KEY ("giveaway_id") REFERENCES "giveaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "giveaway_entries" ADD CONSTRAINT "giveaway_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
