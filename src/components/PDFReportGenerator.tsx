import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { showError } from '../utils/alerts';
import { API_URL } from '../config/api';
import { Page, PageIntro, Card, CardHeader, StatTile, EmptyState, buttonClass, cx } from './ui';

interface PDFReportGeneratorProps {
  onBack?: () => void;
}

/** Subset of GET /api/teams used by the report (latest KPI snapshot per team). */
interface TeamRow {
  id: string;
  name: string;
  department?: string | null;
  qaScore: number | string | null;
  snapshotDate?: string | null;
  kpiData?: Record<string, number | string | null> | null;
}

/** Subset of GET /api/analytics/company-summary used by the report. Any field may be null. */
interface CompanySummary {
  globalQaScore?: number | null;
  avgTestCoverage?: number | null;
  avgDefectEscapeRate?: number | null;
  automationCoverage?: number | null;
  avgFlakinessRate?: number | null;
  teamCount?: number | null;
  teamsWithKpiData?: number | null;
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (v: unknown, digits = 1, suffix = '') => {
  const n = num(v);
  return n == null ? '—' : `${n.toFixed(digits)}${suffix}`;
};
const dayKey = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);
const fmtDate = (key: string | null) => {
  if (!key) return '—';
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
};

/** Team table columns: label, kpiData key (or 'qaScore'), digits, suffix. */
const COLUMNS: Array<{ label: string; key: string; digits: number; suffix: string }> = [
  { label: 'QA score', key: 'qaScore', digits: 0, suffix: '' },
  { label: 'Test coverage', key: 'testCoverage', digits: 1, suffix: '%' },
  { label: 'Automation', key: 'automationCoverage', digits: 1, suffix: '%' },
  { label: 'Defect escape', key: 'defectEscapeRate', digits: 2, suffix: '%' },
  { label: 'Change failure', key: 'changeFailureRate', digits: 2, suffix: '%' },
  { label: 'Flakiness', key: 'testFlakinessRate', digits: 2, suffix: '%' },
  { label: 'Deploys / wk', key: 'deploymentFrequencyPerWeek', digits: 0, suffix: '' },
  { label: 'MTTR (h)', key: 'mttrHours', digits: 2, suffix: '' },
];
const cellValue = (t: TeamRow, key: string) => (key === 'qaScore' ? t.qaScore : t.kpiData?.[key] ?? null);

const PDFReportGenerator: React.FC<PDFReportGeneratorProps> = () => {
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [summary, setSummary] = useState<CompanySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [teamsRes, summaryRes] = await Promise.all([
          fetch(`${API_URL}/teams`, { credentials: 'include' }),
          fetch(`${API_URL}/analytics/company-summary`, { credentials: 'include' }),
        ]);
        if (!teamsRes.ok) throw new Error(`teams ${teamsRes.status}`);
        const teamsData = await teamsRes.json();
        setTeams(Array.isArray(teamsData) ? teamsData : teamsData.teams || []);
        if (summaryRes.ok) setSummary(await summaryRes.json());
      } catch (err) {
        console.error('Error loading report data:', err);
        setError('Could not load report data.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const teamsWithData = useMemo(() => teams.filter(t => dayKey(t.snapshotDate) != null || num(t.qaScore) != null), [teams]);
  const snapshotDates = teamsWithData.map(t => dayKey(t.snapshotDate)).filter((d): d is string => d != null).sort();
  const asOf = snapshotDates.length ? snapshotDates[snapshotDates.length - 1] : null;
  const oldest = snapshotDates.length ? snapshotDates[0] : null;

  const summaryRows: Array<[string, string]> = [
    ['Mean QA score', fmt(summary?.globalQaScore, 0)],
    ['Mean test coverage', fmt(summary?.avgTestCoverage, 1, '%')],
    ['Mean automation coverage', fmt(summary?.automationCoverage, 1, '%')],
    ['Mean defect escape rate', fmt(summary?.avgDefectEscapeRate, 1, '%')],
    ['Mean test flakiness rate', fmt(summary?.avgFlakinessRate, 1, '%')],
    ['Teams with KPI data', summary?.teamsWithKpiData != null && summary?.teamCount != null ? `${summary.teamsWithKpiData} of ${summary.teamCount}` : `${teamsWithData.length} of ${teams.length}`],
  ];

  const generatePDF = async () => {
    setIsGenerating(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape' });
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      const generatedAt = new Date();

      let logoDataUrl: string | null = null;
      try {
        const response = await fetch('/irongate-logo.png');
        if (response.ok) {
          const blob = await response.blob();
          logoDataUrl = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
          });
        }
      } catch {
        logoDataUrl = null;
      }

      // Header
      if (logoDataUrl) {
        try { doc.addImage(logoDataUrl, 'PNG', 14, 10, 12, 12); } catch { /* ignore */ }
      }
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('Quality Engineering Summary', logoDataUrl ? 30 : 14, 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text('IronGate QA Navigator', logoDataUrl ? 30 : 14, 24);
      doc.text(
        `Data as of ${fmtDate(asOf)}${oldest && oldest !== asOf ? ` (team snapshots range from ${fmtDate(oldest)})` : ''}  |  Generated ${generatedAt.toLocaleString()}`,
        pageWidth - 14, 24, { align: 'right' },
      );
      doc.setDrawColor(226, 232, 240);
      doc.line(14, 28, pageWidth - 14, 28);

      // Company summary
      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Company summary', 14, 37);
      autoTable(doc, {
        startY: 40,
        margin: { left: 14 },
        tableWidth: 120,
        body: summaryRows,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 1.5, textColor: [15, 23, 42] },
        columnStyles: { 0: { textColor: [100, 116, 139] }, 1: { fontStyle: 'bold', halign: 'right' } },
      });

      // Team table
      const afterSummary = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Teams (latest KPI snapshot per team)', 14, afterSummary + 10);
      autoTable(doc, {
        startY: afterSummary + 13,
        margin: { left: 14, right: 14 },
        head: [['Team', ...COLUMNS.map(c => c.label), 'Snapshot']],
        body: teams.map(t => [
          t.name,
          ...COLUMNS.map(c => fmt(cellValue(t, c.key), c.digits, c.suffix)),
          fmtDate(dayKey(t.snapshotDate)),
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [38, 83, 138], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage: (data) => {
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${data.pageNumber}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
          doc.text('"—" = not recorded. Company figures are unweighted means across teams of each team\'s latest KPI snapshot.', 14, pageHeight - 8);
        },
      });

      const fileName = `QA_Summary_${(asOf ?? generatedAt.toISOString().slice(0, 10))}.pdf`;
      doc.save(fileName);
    } catch (err) {
      console.error('Error generating PDF:', err);
      showError('Failed to generate PDF report');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <Page>
      <PageIntro
        title="Reports"
        description={
          asOf
            ? `PDF summary of each team's latest recorded KPI snapshot. Data as of ${fmtDate(asOf)}.`
            : "PDF summary of each team's latest recorded KPI snapshot."
        }
        actions={
          <button
            onClick={generatePDF}
            disabled={isGenerating || loading || teams.length === 0}
            className={cx(buttonClass.primary, 'disabled:cursor-not-allowed')}
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {isGenerating ? 'Generating…' : 'Download PDF'}
          </button>
        }
      />

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading report data…
          </div>
        </Card>
      ) : error ? (
        <Card><EmptyState title={error} description="Try reloading the page." /></Card>
      ) : teams.length === 0 ? (
        <Card><EmptyState title="No teams found" description="The report lists teams and their latest KPI snapshot." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {summaryRows.map(([label, value]) => <StatTile key={label} label={label} value={value} />)}
          </div>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                title="Report preview"
                subtitle={`Latest KPI snapshot per team${oldest && asOf && oldest !== asOf ? `; snapshots range from ${fmtDate(oldest)} to ${fmtDate(asOf)}` : ''}. "—" means not recorded.`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <th className="px-5 py-2 text-left font-medium">Team</th>
                    {COLUMNS.map(c => <th key={c.key} className="px-3 py-2 text-right font-medium">{c.label}</th>)}
                    <th className="px-5 py-2 text-right font-medium">Snapshot</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {teams.map(t => (
                    <tr key={t.id}>
                      <td className="px-5 py-2 text-slate-900 dark:text-white">{t.name}</td>
                      {COLUMNS.map(c => (
                        <td key={c.key} className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{fmt(cellValue(t, c.key), c.digits, c.suffix)}</td>
                      ))}
                      <td className="px-5 py-2 text-right text-xs text-slate-500 dark:text-slate-400">{fmtDate(dayKey(t.snapshotDate))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Company figures are unweighted means across teams with KPI data, from the platform's company summary; team values come from each team's latest KPI snapshot. The report contains no cost or ROI figures.
          </p>
        </>
      )}
    </Page>
  );
};

export default PDFReportGenerator;
