-- Widen kpi_snapshots.system_availability so 100.000 % fits.
-- numeric(5,3) holds at most 99.999; numeric(6,3) holds up to 999.999 (values are
-- still validated to 0..100 by the ingestion API). Widening keeps every existing value.
-- Idempotent: only alters the column while it is still narrower than (6,3).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'kpi_snapshots'
      AND column_name = 'system_availability'
      AND (numeric_precision < 6 OR numeric_precision IS NULL)
  ) THEN
    ALTER TABLE public.kpi_snapshots ALTER COLUMN system_availability TYPE numeric(6,3);
  END IF;
END $$;
