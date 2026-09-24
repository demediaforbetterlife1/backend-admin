-- ============================================================================
-- VIP/SVIP OPTION A MIGRATION: Loyalty XP System as Primary
-- ============================================================================
-- This migration implements Option A: Making the 15-level Loyalty XP System
-- the primary VIP progression system.
--
-- Changes:
-- 1. Add loyaltyLevel field to User table (PRIMARY VIP level 1-15)
-- 2. Preserve svipLevel for backward compatibility (now subscription tier only)
-- 3. Backfill loyaltyLevel from existing svipLevel values
-- 4. Add indexes for performance
--
-- SAFETY: This is a non-destructive migration. Existing data is preserved.
-- ============================================================================

-- Step 1: Add loyaltyLevel column if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'User' 
        AND column_name = 'loyaltyLevel'
    ) THEN
        ALTER TABLE "User" ADD COLUMN "loyaltyLevel" INTEGER;
        
        -- Add comment to clarify purpose
        COMMENT ON COLUMN "User"."loyaltyLevel" IS 'PRIMARY: XP-based loyalty level (1-15) - Official VIP progression system (Option A)';
        COMMENT ON COLUMN "User"."svipLevel" IS 'DEPRECATED: Legacy field, now only used for subscription tier level (1-5). Will be removed in future version.';
        
        RAISE NOTICE 'Added loyaltyLevel column to User table';
    ELSE
        RAISE NOTICE 'loyaltyLevel column already exists';
    END IF;
END $$;

-- Step 2: Backfill loyaltyLevel from existing svipLevel values
-- This assumes existing svipLevel values (1-15) were written by loyalty system
UPDATE "User"
SET "loyaltyLevel" = "svipLevel"
WHERE "svipLevel" IS NOT NULL 
  AND "loyaltyLevel" IS NULL
  AND "svipLevel" BETWEEN 1 AND 15;

RAISE NOTICE 'Backfilled % user loyalty levels', (SELECT COUNT(*) FROM "User" WHERE "loyaltyLevel" IS NOT NULL);

-- Step 3: Add performance indexes
CREATE INDEX IF NOT EXISTS "User_loyaltyLevel_idx" ON "User"("loyaltyLevel");
CREATE INDEX IF NOT EXISTS "User_role_loyaltyLevel_idx" ON "User"("role", "loyaltyLevel");

-- Step 4: Calculate loyalty XP for users who don't have it yet
-- This requires the loyalty service to recalculate from UserLevelEvent table
-- NOTE: This should be run as a background job, not in migration
-- Run: node scripts/recalculate-loyalty-levels.js

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these after migration to verify success:
--
-- Check loyalty level distribution:
-- SELECT "loyaltyLevel", COUNT(*) as count 
-- FROM "User" 
-- WHERE "loyaltyLevel" IS NOT NULL 
-- GROUP BY "loyaltyLevel" 
-- ORDER BY "loyaltyLevel";
--
-- Check users with VIP/SVIP role:
-- SELECT role, AVG("loyaltyLevel") as avg_level, COUNT(*) as count
-- FROM "User"
-- WHERE role IN ('VIP', 'SVIP')
-- GROUP BY role;
--
-- Check for data consistency issues:
-- SELECT COUNT(*) FROM "User" 
-- WHERE role IN ('VIP', 'SVIP') AND "loyaltyLevel" IS NULL;
-- (Should be 0 or close to 0)
-- ============================================================================
