-- Good Buddy: background push notification support
--
-- Real design decision: the relay server (server.js) is a stateless
-- in-memory WebSocket process -- it has no visibility into who's
-- currently backgrounded/disconnected. Supabase is the only durable
-- store both the app and the server can reach, so push tokens live
-- here. The anon key (already used everywhere else in this app) is
-- deliberately kept as the ONLY credential the server needs -- no new
-- service_role secret to manage -- by exposing push-token lookup only
-- through a narrow RPC (get_push_tokens_for_users) that returns
-- exactly {id, push_token} for a given id list, never a raw table
-- read. RLS on the users table already blocks reading push_token via
-- a plain SELECT with the anon key; this RPC is the one sanctioned
-- path around that, and only for exactly what the relay needs.

-- Real note: 001_schema.sql's CREATE TABLE already ran against the
-- live database before push_token/push_enabled were added to that
-- file's source -- editing an already-applied migration doesn't
-- retroactively change a live table. ALTER TABLE here instead
-- (IF NOT EXISTS makes this safe to re-run).
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN DEFAULT false;

-- Function to update a user's push token + opt-in flag. Separate from
-- update_user_location so the app can register/clear a push token
-- independently of a location update (e.g. right after the user
-- toggles the notification permission, before their next GPS fix).
CREATE OR REPLACE FUNCTION update_push_token(
  p_id UUID,
  p_push_token TEXT,
  p_push_enabled BOOLEAN
) RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET
    push_token = p_push_token,
    push_enabled = p_push_enabled
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Narrow RPC for the relay server: given a list of user ids (the
-- "nearby and in range" set it already computes via haversine in
-- server.js), return only those with push notifications actually
-- enabled AND a token on file. SECURITY DEFINER so this can read
-- push_token despite RLS blocking direct table reads of that column
-- for the anon role -- the function body is the sole gate, and it only
-- ever returns tokens for ids the caller already explicitly asked
-- about (no way to enumerate/scan all users through this).
CREATE OR REPLACE FUNCTION get_push_tokens_for_users(
  p_user_ids UUID[]
) RETURNS TABLE (
  id UUID,
  push_token TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT u.id, u.push_token
  FROM users u
  WHERE u.id = ANY(p_user_ids)
    AND u.push_enabled = true
    AND u.push_token IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Explicitly block reading push_token through the RLS-governed direct
-- table path (belt-and-suspenders alongside the RPC-only design above
-- -- makes the intent unambiguous rather than relying solely on the
-- existing "Allow public read" policy's column list, which doesn't
-- restrict columns at all today).
REVOKE SELECT (push_token) ON users FROM anon, authenticated;
