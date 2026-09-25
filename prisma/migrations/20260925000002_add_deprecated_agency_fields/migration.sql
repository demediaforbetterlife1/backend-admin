-- Add deprecated agency fields for backward compatibility during migration
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "offeredServices" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "teamSize" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settings" JSONB;
