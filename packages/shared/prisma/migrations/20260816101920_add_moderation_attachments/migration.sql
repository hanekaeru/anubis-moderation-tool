-- CreateTable
CREATE TABLE "moderation_attachments" (
    "id" UUID NOT NULL,
    "sanction_id" UUID,
    "warning_id" UUID,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "moderation_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "moderation_attachments_sanction_id_idx" ON "moderation_attachments"("sanction_id");

-- CreateIndex
CREATE INDEX "moderation_attachments_warning_id_idx" ON "moderation_attachments"("warning_id");

-- AddForeignKey
ALTER TABLE "moderation_attachments" ADD CONSTRAINT "moderation_attachments_sanction_id_fkey" FOREIGN KEY ("sanction_id") REFERENCES "sanctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_attachments" ADD CONSTRAINT "moderation_attachments_warning_id_fkey" FOREIGN KEY ("warning_id") REFERENCES "warnings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "moderation_attachments" ADD CONSTRAINT "moderation_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
