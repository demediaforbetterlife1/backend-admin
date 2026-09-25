-- Add loyaltyLevel column to User table
-- This field was added to schema.prisma but never migrated to production

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "loyaltyLevel" INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN "User"."loyaltyLevel" IS 'XP-based loyalty level (1-15) - Official VIP progression';
