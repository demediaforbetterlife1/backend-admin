-- Migration: Add settings field to User table
-- This adds a JSON field to store user settings (notifications, privacy, etc.)

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settings" JSONB;

-- Add a comment to document the field
COMMENT ON COLUMN "User"."settings" IS 'User settings including notifications, privacy, and preferences';
