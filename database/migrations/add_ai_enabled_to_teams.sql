-- Migration: Add ai_enabled column to teams table
-- This enables/disables AI suggestions per team

ALTER TABLE teams ADD COLUMN ai_enabled BOOLEAN DEFAULT FALSE;

-- Create index for faster lookups
CREATE INDEX idx_teams_ai_enabled ON teams(ai_enabled);
