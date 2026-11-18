import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { csvFileName, toCsv, type CsvColumn } from '../lib/csv';
import { buttonClass, cx } from './ui';

/**
 * "Export CSV" for a table or list view (src/lib/csv.ts: formula-injection safe, values as shown
 * plus raw numbers). Client exports contain exactly the rows the screen received from the API,
 * so scope and privacy rules carry over; `href` downloads a server-built CSV instead
 * (e.g. GET /api/compare/teams.csv), sent with the session cookie.
 */

/** Save text as a file (UTF-8 with a byte order mark, so spreadsheet apps read ≥, ≤ and accents). */
export function saveCsv(fileName: string, csv: string) {
  const blob = new Blob(['﻿' + csv.replace(/^﻿/, '')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Props<T> = {
  /** What is exported, for the file name (irongate-<what>-<date>.csv) and the toast. */
  what: string;
  label?: string;
  className?: string;
  testId?: string;
  compact?: boolean;
} & (
  | { columns: CsvColumn<T>[]; rows: T[]; href?: never }
  | { href: string; columns?: never; rows?: never }
);

export function ExportCsvButton<T>(props: Props<T>) {
  const { what, label = 'Export CSV', className, testId = 'export-csv', compact } = props;
  const [busy, setBusy] = useState(false);
  const empty = !props.href && (props.rows?.length ?? 0) === 0;

  const run = async () => {
    if (busy) return;
    const fileName = csvFileName(what);
    if (props.href) {
      setBusy(true);
      try {
        const res = await fetch(props.href, { credentials: 'include' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Export failed (${res.status})`);
        }
        saveCsv(fileName, await res.text());
        toast.success(`Exported ${what.toLowerCase()}`);
      } catch (e: any) {
        toast.error(e?.message || 'Export failed');
      } finally {
        setBusy(false);
      }
      return;
    }
    saveCsv(fileName, toCsv(props.columns!, props.rows!));
    toast.success(`Exported ${props.rows!.length} row${props.rows!.length === 1 ? '' : 's'}`);
  };

  return (
    <button
      type="button"
      onClick={run}
      disabled={empty || busy}
      className={cx(buttonClass.secondary, 'whitespace-nowrap disabled:cursor-not-allowed', className)}
      title={empty ? 'Nothing to export' : `Download ${what.toLowerCase()} as CSV (values as shown plus raw numbers)`}
      aria-label={compact ? label : undefined}
      data-testid={testId}
    >
      {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
      <span className={compact ? 'sr-only sm:not-sr-only' : undefined}>{label}</span>
    </button>
  );
}

export default ExportCsvButton;
