-- AlterTable
ALTER TABLE "sanctions" ADD COLUMN     "points" INTEGER NOT NULL DEFAULT 3;

-- CreateTable
CREATE TABLE "moderation_points_config" (
    "guild_id" VARCHAR(20) NOT NULL,
    "warning_low_points" INTEGER NOT NULL DEFAULT 1,
    "warning_medium_points" INTEGER NOT NULL DEFAULT 3,
    "warning_high_points" INTEGER NOT NULL DEFAULT 5,
    "timeout_points" INTEGER NOT NULL DEFAULT 3,
    "kick_points" INTEGER NOT NULL DEFAULT 5,
    "ban_points" INTEGER NOT NULL DEFAULT 10,
    "shadowban_points" INTEGER NOT NULL DEFAULT 5,
    "warn_threshold" INTEGER NOT NULL DEFAULT 6,
    "critical_threshold" INTEGER NOT NULL DEFAULT 12,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "moderation_points_config_pkey" PRIMARY KEY ("guild_id")
);

-- AddForeignKey
ALTER TABLE "moderation_points_config" ADD CONSTRAINT "moderation_points_config_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;
