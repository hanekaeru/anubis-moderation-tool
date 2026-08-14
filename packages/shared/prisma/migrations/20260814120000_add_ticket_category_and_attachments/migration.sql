-- AlterEnum
ALTER TYPE "TicketEventType" ADD VALUE 'TRANSCRIPT_ARCHIVED';

-- CreateEnum
CREATE TYPE "TicketCategory" AS ENUM ('SUPPORT', 'REPORT', 'COMPLAINT', 'PARTNERSHIP', 'OTHER');

-- AlterTable
-- `category` passe d'un texte libre a un enum ferme. Aucun ticket connu en
-- production a ce jour (le bot ne sait pas encore en creer) : toute valeur
-- existante est neanmoins mappee vers OTHER plutot que castee directement,
-- pour ne jamais echouer sur une valeur imprevue.
ALTER TABLE "tickets"
    ALTER COLUMN "category" DROP DEFAULT,
    ALTER COLUMN "category" TYPE "TicketCategory" USING ('OTHER'::"TicketCategory"),
    ALTER COLUMN "category" SET DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "ticket_attachments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_attachments_ticket_id_idx" ON "ticket_attachments"("ticket_id");

-- AddForeignKey
ALTER TABLE "ticket_attachments" ADD CONSTRAINT "ticket_attachments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
