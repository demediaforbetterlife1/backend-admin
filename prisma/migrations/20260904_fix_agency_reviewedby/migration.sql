-- Fix AgencyRequest.reviewedBy FK constraint
-- 
-- ROOT CAUSE: reviewedBy was pointing to User model but should store AdminAccount.id
-- SOLUTION: Drop the FK constraint, keep reviewedBy as string field

-- Drop the foreign key constraint
ALTER TABLE "agency_requests" DROP CONSTRAINT IF EXISTS "agency_requests_reviewedBy_fkey";

-- Add comment to document the field
COMMENT ON COLUMN "agency_requests"."reviewedBy" IS 'AdminAccount.id (no FK relation) - stores which admin reviewed this request';
