-- Good Buddy Database Schema
-- Run this in Supabase SQL Editor after creating your project

-- Enable PostGIS for geospatial queries
CREATE EXTENSION IF NOT EXISTS postgis;

-- Users table: stores call signs, location, and presence
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_sign TEXT NOT NULL UNIQUE,
  location GEOGRAPHY(POINT, 4326),  -- lat/lng point
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  last_seen TIMESTAMPTZ DEFAULT now(),
  discoverable BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast geospatial queries
CREATE INDEX users_location_idx ON users USING GIST (location);

-- Function to update location from lat/lng
CREATE OR REPLACE FUNCTION update_user_location(
  p_id UUID,
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_discoverable BOOLEAN DEFAULT true
) RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET
    lat = p_lat,
    lng = p_lng,
    location = ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
    last_seen = now(),
    discoverable = p_discoverable
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql;

-- Function to find users within range (miles)
CREATE OR REPLACE FUNCTION find_nearby_users(
  p_lat DOUBLE PRECISION,
  p_lng DOUBLE PRECISION,
  p_range_miles DOUBLE PRECISION
) RETURNS TABLE (
  id UUID,
  call_sign TEXT,
  distance_miles DOUBLE PRECISION
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    u.id,
    u.call_sign,
    ST_Distance(
      u.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY
    ) / 1609.344 AS distance_miles
  FROM users u
  WHERE
    u.discoverable = true
    AND u.id != (SELECT id FROM users WHERE call_sign = current_setting('app.current_call_sign', true))
    AND ST_DWithin(
      u.location,
      ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::GEOGRAPHY,
      p_range_miles * 1609.344  -- convert miles to meters
    )
  ORDER BY distance_miles;
END;
$$ LANGUAGE plpgsql;

-- Enable Realtime on users table (for presence updates)
ALTER PUBLICATION supabase_realtime ADD TABLE users;

-- Row Level Security: allow public read/write for MVP
-- (Tighten this later with proper auth)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read" ON users
  FOR SELECT USING (true);

CREATE POLICY "Allow public insert" ON users
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow public update own row" ON users
  FOR UPDATE USING (true);
