-- Support helpdesk tables (platform public schema)
-- Run once against production Postgres if `npx prisma db push` isn't handy:
--   Supabase → SQL Editor → paste → Run
-- Or:  psql "$DIRECT_URL" -f scripts/sql/create-support-tables.sql
--
-- Safe to re-run: uses IF NOT EXISTS where possible.

CREATE TABLE IF NOT EXISTS "SupportTicket" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "source" TEXT NOT NULL DEFAULT 'APP',
    "requesterId" TEXT,
    "guestName" TEXT,
    "guestEmail" TEXT,
    "guestToken" TEXT,
    "assigneeId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "awaitingStaff" BOOLEAN NOT NULL DEFAULT true,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SupportNote" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_number_key" ON "SupportTicket"("number");
CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_guestToken_key" ON "SupportTicket"("guestToken");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_idx" ON "SupportTicket"("status");
CREATE INDEX IF NOT EXISTS "SupportTicket_requesterId_idx" ON "SupportTicket"("requesterId");
CREATE INDEX IF NOT EXISTS "SupportTicket_assigneeId_idx" ON "SupportTicket"("assigneeId");
CREATE INDEX IF NOT EXISTS "SupportTicket_awaitingStaff_status_idx" ON "SupportTicket"("awaitingStaff", "status");
CREATE INDEX IF NOT EXISTS "SupportTicket_lastMessageAt_idx" ON "SupportTicket"("lastMessageAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_guestEmail_idx" ON "SupportTicket"("guestEmail");
CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_createdAt_idx" ON "SupportMessage"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportNote_ticketId_createdAt_idx" ON "SupportNote"("ticketId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "SupportTicket"
    ADD CONSTRAINT "SupportTicket_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTicket"
    ADD CONSTRAINT "SupportTicket_assigneeId_fkey"
    FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportMessage"
    ADD CONSTRAINT "SupportMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportMessage"
    ADD CONSTRAINT "SupportMessage_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportNote"
    ADD CONSTRAINT "SupportNote_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "SupportNote"
    ADD CONSTRAINT "SupportNote_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
