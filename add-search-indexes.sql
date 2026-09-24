-- Add search optimization indexes for User and Room models
-- These indexes improve search performance for partial, case-insensitive queries

-- User search indexes
CREATE INDEX IF NOT EXISTS "User_username_idx" ON "User"("username");
CREATE INDEX IF NOT EXISTS "User_displayName_idx" ON "User"("displayName");
CREATE INDEX IF NOT EXISTS "User_username_displayName_idx" ON "User"("username", "displayName");
CREATE INDEX IF NOT EXISTS "User_isBanned_status_idx" ON "User"("isBanned", "status");

-- Room search indexes
CREATE INDEX IF NOT EXISTS "rooms_name_idx" ON "rooms"("name");
CREATE INDEX IF NOT EXISTS "rooms_topic_idx" ON "rooms"("topic");
CREATE INDEX IF NOT EXISTS "rooms_isActive_name_idx" ON "rooms"("isActive", "name");
CREATE INDEX IF NOT EXISTS "rooms_isActive_topic_idx" ON "rooms"("isActive", "topic");

-- Verify indexes were created
SELECT 
    tablename, 
    indexname, 
    indexdef
FROM pg_indexes 
WHERE schemaname = 'public' 
  AND (tablename = 'User' OR tablename = 'rooms')
  AND indexname LIKE '%username%' 
   OR indexname LIKE '%displayName%'
   OR indexname LIKE '%name%' 
   OR indexname LIKE '%topic%'
ORDER BY tablename, indexname;
