-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add_room_likes
-- Adds: RoomLike table for liking voice rooms
-- ─────────────────────────────────────────────────────────────────────────────

-- RoomLike table
CREATE TABLE IF NOT EXISTS "room_likes" (
  "id"        TEXT NOT NULL PRIMARY KEY,
  "roomId"    TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "room_likes_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE,
  CONSTRAINT "room_likes_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "room_likes_roomId_userId_key" ON "room_likes"("roomId", "userId");
CREATE INDEX IF NOT EXISTS "room_likes_roomId_idx"        ON "room_likes"("roomId");
CREATE INDEX IF NOT EXISTS "room_likes_userId_idx"        ON "room_likes"("userId");
CREATE INDEX IF NOT EXISTS "room_likes_createdAt_idx"     ON "room_likes"("createdAt");