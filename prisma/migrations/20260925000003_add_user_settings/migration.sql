-- Add settings column for user preferences
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settings" JSONB;
