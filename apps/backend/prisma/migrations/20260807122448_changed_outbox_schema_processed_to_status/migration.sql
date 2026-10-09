/*
  Warnings:

  - You are about to drop the column `processed` on the `Outbox` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Outbox" DROP COLUMN "processed",
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'pending';
