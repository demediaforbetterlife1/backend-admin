-- ============================================================
-- Migration: 20260726000001_moments_full_rebuild
-- Adds PostView, PostBookmark, PostReport tables.
-- Renames existing tables to match new @@map annotations.
-- Adds viewsCount, isHot columns to Post / Topic.
-- Adds all missing indexes.
-- All statements are idempotent (IF NOT EXISTS / DO $$ EXCEPTION).
-- ============================================================

-- ── 1. Rename existing tables to match new @@map names ────────────────────
DO $$ BEGIN
  ALTER TABLE "Post"        RENAME TO "posts";
EXCEPTION WHEN undefined_table OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PostLike"    RENAME TO "post_likes";
EXCEPTION WHEN undefined_table OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "PostComment" RENAME TO "post_comments";
EXCEPTION WHEN undefined_table OR duplicate_table THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Topic"       RENAME TO "topics";
EXCEPTION WHEN undefined_table OR duplicate_table THEN NULL; END $$;

-- ── 2. Add viewsCount column to posts ─────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "posts" ADD COLUMN "viewsCount" INTEGER NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 3. Add isHot column to topics ─────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "topics" ADD COLUMN "isHot" BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- ── 4. New index on topics(newPostsCount) ─────────────────────────────────
CREATE INDEX IF NOT EXISTS "topics_newPostsCount_idx" ON "topics"("newPostsCount");

-- ── 5. Composite index on posts(visibility, createdAt) ────────────────────
CREATE INDEX IF NOT EXISTS "posts_visibility_createdAt_idx" ON "posts"("visibility", "createdAt");

-- ── 6. Composite index on post_comments(postId, createdAt) ────────────────
DO $$ BEGIN
  DROP INDEX IF EXISTS "PostComment_postId_idx";
EXCEPTION WHEN OTHERS THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "post_comments_postId_createdAt_idx" ON "post_comments"("postId", "createdAt");
CREATE INDEX IF NOT EXISTS "post_comments_userId_idx"           ON "post_comments"("userId");

-- ── 7. PostView ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "post_views" (
    "id"        TEXT        NOT NULL,
    "postId"    TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_views_postId_userId_key" ON "post_views"("postId", "userId");
CREATE INDEX        IF NOT EXISTS "post_views_postId_idx"        ON "post_views"("postId");
CREATE INDEX        IF NOT EXISTS "post_views_userId_idx"        ON "post_views"("userId");

DO $$ BEGIN
  ALTER TABLE "post_views"
    ADD CONSTRAINT "post_views_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_views"
    ADD CONSTRAINT "post_views_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 8. PostBookmark ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "post_bookmarks" (
    "id"        TEXT        NOT NULL,
    "postId"    TEXT        NOT NULL,
    "userId"    TEXT        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_bookmarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_bookmarks_postId_userId_key" ON "post_bookmarks"("postId", "userId");
CREATE INDEX        IF NOT EXISTS "post_bookmarks_postId_idx"        ON "post_bookmarks"("postId");
CREATE INDEX        IF NOT EXISTS "post_bookmarks_userId_idx"        ON "post_bookmarks"("userId");

DO $$ BEGIN
  ALTER TABLE "post_bookmarks"
    ADD CONSTRAINT "post_bookmarks_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_bookmarks"
    ADD CONSTRAINT "post_bookmarks_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 9. PostReport ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "post_reports" (
    "id"         TEXT        NOT NULL,
    "postId"     TEXT        NOT NULL,
    "reporterId" TEXT        NOT NULL,
    "reason"     TEXT        NOT NULL,
    "details"    TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "post_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_reports_postId_reporterId_key" ON "post_reports"("postId", "reporterId");
CREATE INDEX        IF NOT EXISTS "post_reports_postId_idx"             ON "post_reports"("postId");
CREATE INDEX        IF NOT EXISTS "post_reports_reporterId_idx"         ON "post_reports"("reporterId");

DO $$ BEGIN
  ALTER TABLE "post_reports"
    ADD CONSTRAINT "post_reports_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_reports"
    ADD CONSTRAINT "post_reports_reporterId_fkey"
    FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 10. Fix FK references on renamed post_likes table ──────────────────────
DO $$ BEGIN
  ALTER TABLE "post_likes"
    ADD CONSTRAINT "post_likes_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_likes"
    ADD CONSTRAINT "post_likes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── 11. Fix FK references on renamed post_comments table ───────────────────
DO $$ BEGIN
  ALTER TABLE "post_comments"
    ADD CONSTRAINT "post_comments_postId_fkey"
    FOREIGN KEY ("postId") REFERENCES "posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_comments"
    ADD CONSTRAINT "post_comments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── PostReport: add resolution tracking columns ────────────────────────────
DO $$ BEGIN
  ALTER TABLE "post_reports" ADD COLUMN "resolved"   BOOLEAN NOT NULL DEFAULT false;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_reports" ADD COLUMN "resolvedAt" TIMESTAMP(3);
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_reports" ADD COLUMN "resolvedBy" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "post_reports" ADD COLUMN "resolution" TEXT;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "post_reports_resolved_createdAt_idx" ON "post_reports"("resolved", "createdAt");
