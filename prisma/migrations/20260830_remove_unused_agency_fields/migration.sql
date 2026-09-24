-- Remove unused fields from User table that are only needed in AgencyRequest
-- These fields are duplicated in AgencyRequest for agency registration workflow
-- After approval, they serve no purpose in the User table

-- Remove teamSize column (only used in AgencyRequest)
ALTER TABLE "User" DROP COLUMN IF EXISTS "teamSize";

-- Remove offeredServices column (only used in AgencyRequest)
ALTER TABLE "User" DROP COLUMN IF EXISTS "offeredServices";

-- ✅ SAFE: These fields are:
-- 1. NOT used by any queries after agency approval
-- 2. NOT displayed in any UI after approval
-- 3. Already stored in AgencyRequest table for admin review
-- 4. Confirmed unused via comprehensive codebase audit
