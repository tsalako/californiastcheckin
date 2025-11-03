CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('apple', 'google', 'unknown');

-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('self', 'retro', 'manual', 'companion');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('guest', 'house', 'admin');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'guest',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appleSerial" TEXT,
    "appleAuthToken" TEXT,
    "googleObjectId" TEXT,
    "googleClassId" TEXT,
    "levelCached" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "deviceLibraryId" TEXT,
    "pushToken" TEXT,
    "objectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "platform" "Platform",
    "source" TEXT DEFAULT 'nfc',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "meta" JSONB,
    "units" INTEGER NOT NULL DEFAULT 1,
    "kind" "VisitKind" NOT NULL DEFAULT 'self',
    "addedBy" TEXT,
    "parentVisitId" TEXT,
    "primaryUserId" TEXT,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdatesLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "platform" "Platform",
    "isUpdate" BOOLEAN NOT NULL DEFAULT true,
    "hasDevices" BOOLEAN,
    "loggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "UpdatesLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuestHost" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rangeType" TEXT NOT NULL,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "winnersTarget" INTEGER NOT NULL,
    "totalEntries" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleParticipant" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "entries" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaffleWinner" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "drawOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaffleWinner_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_appleSerial_key" ON "User"("appleSerial");

-- CreateIndex
CREATE UNIQUE INDEX "User_googleObjectId_key" ON "User"("googleObjectId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceLibraryId_key" ON "Device"("deviceLibraryId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_pushToken_key" ON "Device"("pushToken");

-- CreateIndex
CREATE INDEX "GuestHost_hostId_idx" ON "GuestHost"("hostId");

-- CreateIndex
CREATE INDEX "GuestHost_guestId_idx" ON "GuestHost"("guestId");

-- CreateIndex
CREATE UNIQUE INDEX "GuestHost_guestId_hostId_key" ON "GuestHost"("guestId", "hostId");

-- CreateIndex
CREATE INDEX "RaffleParticipant_raffleId_idx" ON "RaffleParticipant"("raffleId");

-- CreateIndex
CREATE INDEX "RaffleWinner_raffleId_idx" ON "RaffleWinner"("raffleId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdatesLog" ADD CONSTRAINT "UpdatesLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestHost" ADD CONSTRAINT "GuestHost_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuestHost" ADD CONSTRAINT "GuestHost_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleParticipant" ADD CONSTRAINT "RaffleParticipant_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleParticipant" ADD CONSTRAINT "RaffleParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleWinner" ADD CONSTRAINT "RaffleWinner_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaffleWinner" ADD CONSTRAINT "RaffleWinner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
