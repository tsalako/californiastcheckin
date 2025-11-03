/*
  Warnings:

  - You are about to drop the column `addedBy` on the `Visit` table. All the data in the column will be lost.
  - You are about to drop the column `parentVisitId` on the `Visit` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[userId,deviceLibraryIdentifier]` on the table `Device` will be added. If there are existing duplicate values, this will fail.

*/
-- enable citext (safe if already exists)
CREATE EXTENSION IF NOT EXISTS citext;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "email" SET DATA TYPE CITEXT;

-- AlterTable
ALTER TABLE "Visit" DROP COLUMN "addedBy",
DROP COLUMN "parentVisitId";

-- CreateIndex
CREATE UNIQUE INDEX "Device_userId_deviceLibraryIdentifier_key" ON "Device"("userId", "deviceLibraryIdentifier");
