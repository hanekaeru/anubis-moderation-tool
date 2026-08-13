/*
  Warnings:

  - You are about to drop the column `isAppliedOnWebapp` on the `sanctions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sanctions" DROP COLUMN "isAppliedOnWebapp",
ADD COLUMN     "is_applied_on_webapp" BOOLEAN NOT NULL DEFAULT false;
