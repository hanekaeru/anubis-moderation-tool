/*
Warnings:

- You are about to drop the column `is_applied_on_webapp` on the `sanctions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sanctions"
DROP COLUMN "is_applied_on_webapp",
ADD COLUMN "is_applied" BOOLEAN NOT NULL DEFAULT true;