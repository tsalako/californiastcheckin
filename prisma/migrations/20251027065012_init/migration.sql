/*
  Warnings:

  - The values [manual] on the enum `VisitKind` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "VisitKind_new" AS ENUM ('self', 'retro', 'companion');
ALTER TABLE "Visit" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "Visit" ALTER COLUMN "kind" TYPE "VisitKind_new" USING ("kind"::text::"VisitKind_new");
ALTER TYPE "VisitKind" RENAME TO "VisitKind_old";
ALTER TYPE "VisitKind_new" RENAME TO "VisitKind";
DROP TYPE "VisitKind_old";
ALTER TABLE "Visit" ALTER COLUMN "kind" SET DEFAULT 'self';
COMMIT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Visit" ALTER COLUMN "occurredAt" SET DEFAULT CURRENT_TIMESTAMP;
