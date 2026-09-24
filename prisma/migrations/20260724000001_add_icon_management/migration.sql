-- CreateEnum
CREATE TYPE "IconCategory" AS ENUM ('NAVIGATION', 'ROOM', 'VOICE', 'SOCIAL', 'WALLET', 'VIP', 'MEDIA', 'STATUS', 'SETTINGS', 'ADMIN', 'ACTIONS', 'STORE');

-- CreateEnum
CREATE TYPE "IconAction" AS ENUM ('UPLOAD', 'REPLACE', 'DELETE', 'RESTORE', 'PUBLISH', 'ROLLBACK', 'REVERT_TO_DEFAULT');

-- CreateTable
CREATE TABLE "app_icons" (
    "id"          TEXT NOT NULL,
    "key"         TEXT NOT NULL,
    "category"    "IconCategory" NOT NULL,
    "displayName" TEXT NOT NULL,
    "url"         TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType"    TEXT NOT NULL DEFAULT 'image/png',
    "width"       INTEGER,
    "height"      INTEGER,
    "size"        INTEGER,
    "version"     INTEGER NOT NULL DEFAULT 1,
    "isActive"    BOOLEAN NOT NULL DEFAULT true,
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isPending"   BOOLEAN NOT NULL DEFAULT false,
    "etag"        TEXT,
    "defaultUrl"  TEXT NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_icons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icon_versions" (
    "id"           TEXT NOT NULL,
    "iconId"       TEXT NOT NULL,
    "version"      INTEGER NOT NULL,
    "url"          TEXT NOT NULL,
    "storagePath"  TEXT NOT NULL,
    "mimeType"     TEXT NOT NULL,
    "width"        INTEGER,
    "height"       INTEGER,
    "size"         INTEGER,
    "uploadedById" TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icon_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icon_audit_logs" (
    "id"         TEXT NOT NULL,
    "iconId"     TEXT NOT NULL,
    "adminId"    TEXT,
    "action"     "IconAction" NOT NULL,
    "oldVersion" INTEGER,
    "newVersion" INTEGER,
    "oldUrl"     TEXT,
    "newUrl"     TEXT,
    "ipAddress"  TEXT,
    "userAgent"  TEXT,
    "metadata"   JSONB,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icon_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_icons_key_key" ON "app_icons"("key");
CREATE INDEX "app_icons_category_idx" ON "app_icons"("category");
CREATE INDEX "app_icons_isActive_idx" ON "app_icons"("isActive");
CREATE INDEX "app_icons_key_idx" ON "app_icons"("key");

CREATE INDEX "icon_versions_iconId_idx" ON "icon_versions"("iconId");
CREATE INDEX "icon_versions_iconId_version_idx" ON "icon_versions"("iconId", "version");

CREATE INDEX "icon_audit_logs_iconId_idx" ON "icon_audit_logs"("iconId");
CREATE INDEX "icon_audit_logs_adminId_idx" ON "icon_audit_logs"("adminId");
CREATE INDEX "icon_audit_logs_createdAt_idx" ON "icon_audit_logs"("createdAt");

-- AddForeignKey
ALTER TABLE "icon_versions"   ADD CONSTRAINT "icon_versions_iconId_fkey"   FOREIGN KEY ("iconId") REFERENCES "app_icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "icon_audit_logs" ADD CONSTRAINT "icon_audit_logs_iconId_fkey" FOREIGN KEY ("iconId") REFERENCES "app_icons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
