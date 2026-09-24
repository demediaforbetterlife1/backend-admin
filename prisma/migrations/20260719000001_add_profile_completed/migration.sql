-- AddColumn: profileCompleted to User table
-- Tracks whether the user has completed their profile setup after registration
-- Default false = new users must complete profile before accessing the app

ALTER TABLE "User" ADD COLUMN "profileCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Back-fill: mark existing users who have display_name or displayName as completed
-- They were registered before this migration and already have profiles
UPDATE "User" 
SET "profileCompleted" = true 
WHERE "displayName" IS NOT NULL 
   OR "gender" IS NOT NULL 
   OR "countryCode" IS NOT NULL;
