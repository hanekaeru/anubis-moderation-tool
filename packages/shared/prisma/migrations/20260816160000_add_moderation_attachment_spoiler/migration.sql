-- AlterTable
ALTER TABLE "moderation_attachments" ADD COLUMN     "spoiler" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "uploaded_by_discord_id" VARCHAR(20);

-- AddForeignKey
ALTER TABLE "moderation_attachments" ADD CONSTRAINT "moderation_attachments_uploaded_by_discord_id_fkey" FOREIGN KEY ("uploaded_by_discord_id") REFERENCES "discord_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
