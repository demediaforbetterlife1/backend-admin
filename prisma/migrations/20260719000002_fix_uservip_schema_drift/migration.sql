-- ============================================================================
-- Migration: fix_uservip_schema_drift
--
-- ROOT CAUSE: The initial migration created UserVip with only 8 columns.
-- The Prisma schema grew to include 8 additional columns and a new enum
-- (SubscriptionStatus) that were never applied to the database.
-- This caused PrismaClientKnownRequestError P2022 on every UserVip query.
--
-- Also adds VipPlan.durationDays which existed in schema.prisma with
-- @default(30) but was absent from the initial migration SQL.
-- ============================================================================

-- Step 1: Create the SubscriptionStatus enum (used by UserVip.status)
-- Guard: only create if it doesn't already exist.
DO $$ BEGIN
  CREATE TYPE "SubscriptionStatus" AS ENUM (
    'NONE',
    'ACTIVE',
    'EXPIRED',
    'PENDING',
    'CANCELLED',
    'REFUNDED'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Step 2: Add UserVip.status
-- Default 'NONE' so existing rows get a valid value immediately.
ALTER TABLE "UserVip"
  ADD COLUMN IF NOT EXISTS "status" "SubscriptionStatus" NOT NULL DEFAULT 'NONE';

-- Step 3: Back-fill status for rows that have an active tier
-- Any row with a non-NONE tier and a future expiresAt should be ACTIVE.
UPDATE "UserVip"
SET "status" = 'ACTIVE'
WHERE "tier" <> 'NONE'
  AND ("expiresAt" IS NULL OR "expiresAt" > NOW());

-- Any row with a non-NONE tier and a past expiresAt should be EXPIRED.
UPDATE "UserVip"
SET "status" = 'EXPIRED'
WHERE "tier" <> 'NONE'
  AND "expiresAt" IS NOT NULL
  AND "expiresAt" <= NOW();

-- Step 4: Add remaining missing UserVip columns
ALTER TABLE "UserVip"
  ADD COLUMN IF NOT EXISTS "subscriptionType"   TEXT,
  ADD COLUMN IF NOT EXISTS "paymentProvider"    TEXT,
  ADD COLUMN IF NOT EXISTS "transactionId"      TEXT,
  ADD COLUMN IF NOT EXISTS "purchaseStatus"     TEXT,
  ADD COLUMN IF NOT EXISTS "isTestSubscription" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "ghostMode"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "invisibleMode"      BOOLEAN NOT NULL DEFAULT false;

-- Step 5: Add VipPlan.durationDays (missing from initial migration)
ALTER TABLE "VipPlan"
  ADD COLUMN IF NOT EXISTS "durationDays" INTEGER NOT NULL DEFAULT 30;

-- Step 6: Add missing audit_logs index on userId (if absent)
CREATE INDEX IF NOT EXISTS "audit_logs_userId_idx" ON "audit_logs"("userId");

-- Step 7: Add missing room_participants table columns that schema has but migration may lack
-- forceMuted and isModerator were added to Seat in schema.prisma
ALTER TABLE "seats"
  ADD COLUMN IF NOT EXISTS "forceMuted"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isModerator"  BOOLEAN NOT NULL DEFAULT false;

-- Step 8: Add missing rooms columns (category, tags, passwordHash)
ALTER TABLE "rooms"
  ADD COLUMN IF NOT EXISTS "category"     TEXT NOT NULL DEFAULT 'talk',
  ADD COLUMN IF NOT EXISTS "tags"         JSONB,
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

-- Step 9: Add room_participants table if not present
CREATE TABLE IF NOT EXISTS "room_participants" (
    "id"       TEXT NOT NULL,
    "roomId"   TEXT NOT NULL,
    "userId"   TEXT NOT NULL,
    "role"     TEXT NOT NULL DEFAULT 'AUDIENCE',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_participants_roomId_userId_key"
  ON "room_participants"("roomId", "userId");
CREATE INDEX IF NOT EXISTS "room_participants_roomId_idx"
  ON "room_participants"("roomId");
CREATE INDEX IF NOT EXISTS "room_participants_userId_idx"
  ON "room_participants"("userId");

-- Add FK constraints for room_participants only if not already present
DO $$ BEGIN
  ALTER TABLE "room_participants"
    ADD CONSTRAINT "room_participants_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "room_participants"
    ADD CONSTRAINT "room_participants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Step 10: Add Post model columns if Post table was added after initial migration
-- (Post is in the schema but was not in the initial migration — check for existence)
CREATE TABLE IF NOT EXISTS "Post" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "content"    TEXT,
    "mediaUrls"  JSONB NOT NULL DEFAULT '[]',
    "visibility" TEXT NOT NULL DEFAULT 'PUBLIC',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Post_userId_idx" ON "Post"("userId");
CREATE INDEX IF NOT EXISTS "Post_createdAt_idx" ON "Post"("createdAt");

DO $$ BEGIN
  ALTER TABLE "Post"
    ADD CONSTRAINT "Post_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "PostLike" (
    "id"        TEXT NOT NULL,
    "postId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PostLike_postId_userId_key" ON "PostLike"("postId", "userId");
CREATE INDEX IF NOT EXISTS "PostLike_postId_idx" ON "PostLike"("postId");
CREATE INDEX IF NOT EXISTS "PostLike_userId_idx" ON "PostLike"("userId");

DO $$ BEGIN
  ALTER TABLE "PostLike"
    ADD CONSTRAINT "PostLike_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PostLike"
    ADD CONSTRAINT "PostLike_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "PostComment" (
    "id"        TEXT NOT NULL,
    "postId"    TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    "content"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PostComment_postId_idx" ON "PostComment"("postId");
CREATE INDEX IF NOT EXISTS "PostComment_userId_idx" ON "PostComment"("userId");

DO $$ BEGIN
  ALTER TABLE "PostComment"
    ADD CONSTRAINT "PostComment_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "PostComment"
    ADD CONSTRAINT "PostComment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Step 11: Ensure PostVisibility enum exists
DO $$ BEGIN
  CREATE TYPE "PostVisibility" AS ENUM ('PUBLIC', 'FOLLOWERS', 'PRIVATE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Alter Post.visibility to use enum if column is still TEXT
-- Safe: this is a no-op if the column is already the correct type
-- We cast existing values, defaulting to PUBLIC for any invalid entries.
DO $$ BEGIN
  ALTER TABLE "Post"
    ALTER COLUMN "visibility" TYPE "PostVisibility"
    USING CASE
      WHEN "visibility" = 'FOLLOWERS' THEN 'FOLLOWERS'::"PostVisibility"
      WHEN "visibility" = 'PRIVATE'   THEN 'PRIVATE'::"PostVisibility"
      ELSE                                 'PUBLIC'::"PostVisibility"
    END;
EXCEPTION WHEN others THEN null; END $$;

-- Step 12: Topic table (in schema.prisma, may be missing)
CREATE TABLE IF NOT EXISTS "Topic" (
    "id"            TEXT NOT NULL,
    "hashtag"       TEXT NOT NULL,
    "thumbnailUrl"  TEXT,
    "isArabic"      BOOLEAN NOT NULL DEFAULT false,
    "newPostsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Topic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Topic_hashtag_key" ON "Topic"("hashtag");
