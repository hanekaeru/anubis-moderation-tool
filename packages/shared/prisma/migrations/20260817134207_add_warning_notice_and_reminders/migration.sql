-- AlterTable
ALTER TABLE "warnings" ADD COLUMN     "discord_synced_at" TIMESTAMP(3);

-- Rattrapage : les avertissements deja en base ont ete poses avant que la
-- notification n existe. Sans cette ligne, ils remontent tous comme "jamais
-- notifies" et le bot enverrait un message prive a chaque membre jamais
-- averti, des le premier passage de la tache.
UPDATE "warnings" SET "discord_synced_at" = "created_at" WHERE "discord_synced_at" IS NULL;

-- CreateTable
CREATE TABLE "staff_reminders" (
    "id" UUID NOT NULL,
    "guild_id" VARCHAR(20) NOT NULL,
    "user_id" VARCHAR(20) NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "message" TEXT NOT NULL,
    "target_id" VARCHAR(20),
    "remind_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_reminders_delivered_at_remind_at_idx" ON "staff_reminders"("delivered_at", "remind_at");

-- AddForeignKey
ALTER TABLE "staff_reminders" ADD CONSTRAINT "staff_reminders_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "guilds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_reminders" ADD CONSTRAINT "staff_reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "discord_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
