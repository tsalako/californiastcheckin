/*
  Warnings:

  - You are about to drop the column `deviceLibraryId` on the `Device` table. All the data in the column will be lost.
  - You are about to drop the column `objectId` on the `Device` table. All the data in the column will be lost.
  - You are about to drop the column `platform` on the `Device` table. All the data in the column will be lost.
  - You are about to drop the column `appleAuthToken` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `appleSerial` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `googleClassId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `googleObjectId` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `levelCached` on the `User` table. All the data in the column will be lost.
  - The `role` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `meta` on the `Visit` table. All the data in the column will be lost.
  - You are about to drop the column `platform` on the `Visit` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[deviceLibraryIdentifier]` on the table `Device` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[serialNumber]` on the table `User` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `deviceLibraryIdentifier` to the `Device` table without a default value. This is not possible if the table is not empty.
  - Made the column `pushToken` on table `Device` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `updatedAt` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Role" AS ENUM ('user', 'house');

-- DropForeignKey
ALTER TABLE "Visit" DROP CONSTRAINT "Visit_userId_fkey";

-- DropIndex
DROP INDEX "Device_deviceLibraryId_key";

-- DropIndex
DROP INDEX "Device_pushToken_key";

-- DropIndex
DROP INDEX "User_appleSerial_key";

-- DropIndex
DROP INDEX "User_googleObjectId_key";

-- AlterTable
ALTER TABLE "Device" DROP COLUMN "deviceLibraryId",
DROP COLUMN "objectId",
DROP COLUMN "platform",
ADD COLUMN     "deviceLibraryIdentifier" TEXT NOT NULL,
ALTER COLUMN "pushToken" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "appleAuthToken",
DROP COLUMN "appleSerial",
DROP COLUMN "googleClassId",
DROP COLUMN "googleObjectId",
DROP COLUMN "levelCached",
ADD COLUMN     "authenticationToken" TEXT,
ADD COLUMN     "passTypeIdentifier" TEXT,
ADD COLUMN     "serialNumber" TEXT,
ADD COLUMN     "teamIdentifier" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ALTER COLUMN "email" SET DATA TYPE TEXT,
DROP COLUMN "role",
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'user';

-- AlterTable
ALTER TABLE "Visit" DROP COLUMN "meta",
DROP COLUMN "platform";

-- DropEnum
DROP TYPE "Platform";

-- DropEnum
DROP TYPE "UserRole";

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceLibraryIdentifier_key" ON "Device"("deviceLibraryIdentifier");

-- CreateIndex
CREATE INDEX "Device_userId_idx" ON "Device"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_serialNumber_key" ON "User"("serialNumber");

-- CreateIndex
CREATE INDEX "Visit_userId_occurredAt_idx" ON "Visit"("userId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
