/*
  Warnings:

  - You are about to drop the column `source` on the `Visit` table. All the data in the column will be lost.
  - You are about to drop the column `units` on the `Visit` table. All the data in the column will be lost.
  - You are about to drop the `UpdatesLog` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "UpdatesLog" DROP CONSTRAINT "UpdatesLog_userId_fkey";

-- AlterTable
ALTER TABLE "Visit" DROP COLUMN "source",
DROP COLUMN "units";

-- DropTable
DROP TABLE "UpdatesLog";
