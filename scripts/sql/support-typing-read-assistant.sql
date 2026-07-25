-- Typing indicators, read receipts, voice assistant name
-- Supabase → SQL Editor → Run after deploy of support chat upgrades

ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "staffTypingAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "customerTypingAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "staffLastReadAt" TIMESTAMP(3);
ALTER TABLE "SupportTicket" ADD COLUMN IF NOT EXISTS "customerLastReadAt" TIMESTAMP(3);

ALTER TABLE "SupportMessage" ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3);

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "assistantName" TEXT;
