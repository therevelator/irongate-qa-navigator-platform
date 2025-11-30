-- =============================================================================
-- Migration: Add manually_edited flag to prevent seeder overwrites
-- Date: 2025-11-30
-- Description: Tracks which records have been manually edited via the UI
-- MySQL 8.0 compatible
-- =============================================================================

-- Add manually_edited flag to pipeline_stages
-- This column tracks entries set via ManualMetricsInput so seeders don't overwrite them
ALTER TABLE pipeline_stages ADD COLUMN manually_edited BOOLEAN DEFAULT FALSE;

-- Add manually_edited flag to kpi_snapshots (for quality metrics from ManualMetricsInput)
ALTER TABLE kpi_snapshots ADD COLUMN manually_edited BOOLEAN DEFAULT FALSE;

-- Add manually_edited flag to technical_debt
ALTER TABLE technical_debt ADD COLUMN manually_edited BOOLEAN DEFAULT FALSE;
