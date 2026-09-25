-- Add loyaltyLevel column to users table
-- This field was added to schema.prisma but never migrated to production

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "loyaltyLevel" INTEGER;

-- Add comment for documentation
COMMENT ON COLUMN "users"."loyaltyLevel" IS 'XP-based loyalty level (1-15) - Official VIP progression';
