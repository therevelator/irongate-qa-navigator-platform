-- =============================================================================
-- Migration: Add sizing_accuracy metric to kpi_snapshots
-- Date: 2025-11-30
-- Description: Adds sprint estimation accuracy metric (e.g., 0.94 = 94% accurate)
-- =============================================================================

-- Add sizing_accuracy column to kpi_snapshots
ALTER TABLE kpi_snapshots ADD COLUMN sizing_accuracy DECIMAL(4,2) DEFAULT NULL;
