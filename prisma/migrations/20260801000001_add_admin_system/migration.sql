-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_admin_system
-- Adds: AdminAccount, AdminRefreshToken, AdminAuditLog, AppSetting, Banner
-- These are NEW tables — no existing tables are modified.
-- ─────────────────────────────────────────────────────────────────────────────

-- Admin role enum
DO $$ BEGIN
  CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'SUPPORT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AdminAccount
CREATE TABLE IF NOT EXISTS "admin_accounts" (
  "id"           TEXT NOT NULL PRIMARY KEY,
  "email"        TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "role"         "AdminRole" NOT NULL DEFAULT 'ADMIN',
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "lastLoginAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"    TIMESTAMP(3)
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_accounts_email_key" ON "admin_accounts"("email");
CREATE INDEX IF NOT EXISTS "admin_accounts_email_idx"        ON "admin_accounts"("email");
CREATE INDEX IF NOT EXISTS "admin_accounts_role_idx"         ON "admin_accounts"("role");

-- AdminRefreshToken
CREATE TABLE IF NOT EXISTS "admin_refresh_tokens" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "token"     TEXT NOT NULL,
  "adminId"   TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_refresh_tokens_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_accounts"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "admin_refresh_tokens_token_key"     ON "admin_refresh_tokens"("token");
CREATE INDEX IF NOT EXISTS "admin_refresh_tokens_adminId_idx"          ON "admin_refresh_tokens"("adminId");
CREATE INDEX IF NOT EXISTS "admin_refresh_tokens_expiresAt_idx"        ON "admin_refresh_tokens"("expiresAt");

-- AdminAuditLog
CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "adminId"     TEXT NOT NULL,
  "action"      TEXT NOT NULL,
  "resource"    TEXT,
  "resourceId"  TEXT,
  "ipAddress"   TEXT,
  "userAgent"   TEXT,
  "metadata"    JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "admin_audit_logs_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "admin_accounts"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "admin_audit_logs_adminId_createdAt_idx"    ON "admin_audit_logs"("adminId", "createdAt");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_action_createdAt_idx"     ON "admin_audit_logs"("action", "createdAt");
CREATE INDEX IF NOT EXISTS "admin_audit_logs_resource_resourceId_idx"  ON "admin_audit_logs"("resource", "resourceId");

-- AppSetting (key-value store for runtime app config)
CREATE TABLE IF NOT EXISTS "app_settings" (
  "key"       TEXT NOT NULL PRIMARY KEY,
  "value"     JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Banner
CREATE TABLE IF NOT EXISTS "banners" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "title"     TEXT NOT NULL,
  "imageUrl"  TEXT NOT NULL,
  "linkUrl"   TEXT,
  "screen"    TEXT,
  "position"  INTEGER NOT NULL DEFAULT 0,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "startAt"   TIMESTAMP(3),
  "endAt"     TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "banners_enabled_position_idx" ON "banners"("enabled", "position");
