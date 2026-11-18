import React, { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { showError } from '../utils/alerts';
import { API_URL } from '../config/api';
import { Page, PageIntro, Card, CardHeader, StatTile, EmptyState, buttonClass, cx } from './ui';

interface PDFReportGeneratorProps {
  onBack?: () => void;
  /** Team the report is generated for (analytics scope). */
  teamId: string;
}

/** Subset of GET /api/teams/:id used by the report (latest KPI snapshot of the team). */
interface TeamDetail {
  id: string;
  name: string;
  department_name?: string | null;
  qaScore: number | string | null;
  snapshotDate?: string | null;
  technicalDebtScore?: number | null;
  kpiData?: Record<string, number | string | null> | null;
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

/** KPI rows of the report: label, kpiData key (or 'qaScore'), digits, suffix. */
const KPI_ROWS: Array<{ label: string; key: string; digits: number; suffix: string }> = [
  { label: 'QA score', key: 'qaScore', digits: 0, suffix: '/100' },
  { label: 'Test coverage', key: 'testCoverage', digits: 1, suffix: '%' },
  { label: 'Automation coverage', key: 'automationCoverage', digits: 1, suffix: '%' },
  { label: 'Defect escape rate', key: 'defectEscapeRate', digits: 2, suffix: '%' },
  { label: 'Defect density', key: 'defectDensity', digits: 3, suffix: ' /KLOC' },
  { label: 'Change failure rate', key: 'changeFailureRate', digits: 2, suffix: '%' },
  { label: 'Test flakiness rate', key: 'testFlakinessRate', digits: 2, suffix: '%' },
  { label: 'Code quality score', key: 'codeQualityScore', digits: 0, suffix: '/100' },
  { label: 'Deployments per week', key: 'deploymentFrequencyPerWeek', digits: 1, suffix: '' },
  { label: 'Lead time for changes', key: 'leadTimeDays', digits: 1, suffix: ' days' },
  { label: 'Mean time to recovery', key: 'mttrHours', digits: 2, suffix: ' h' },
  { label: 'Average build time', key: 'avgBuildTimeMinutes', digits: 1, suffix: ' min' },
  { label: 'First-time pass rate', key: 'firstTimePassRate', digits: 1, suffix: '%' },
  { label: 'Sprint commitment rate', key: 'sprintCommitmentRate', digits: 1, suffix: '%' },
  { label: 'System availability', key: 'systemAvailability', digits: 3, suffix: '%' },
];
const kpiValue = (t: TeamDetail, key: string) => (key === 'qaScore' ? t.qaScore : t.kpiData?.[key] ?? null);

const PDFReportGenerator: React.FC<PDFReportGeneratorProps> = ({ teamId }) => {
  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [flakyCount, setFlakyCount] = useState<number | null>(null);
  const [openDebt, setOpenDebt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const q = `teamId=${encodeURIComponent(teamId)}`;
        const [teamRes, flakyRes, debtRes] = await Promise.all([
          fetch(`${API_URL}/teams/${encodeURIComponent(teamId)}`, { credentials: 'include' }),
          fetch(`${API_URL}/analytics/flaky-tests?${q}`, { credentials: 'include' }),
          fetch(`${API_URL}/analytics/technical-debt?${q}`, { credentials: 'include' }),
        ]);
        if (!teamRes.ok) throw new Error(`team ${teamRes.status}`);
        const teamData = await teamRes.json();
        const flaky = flakyRes.ok ? (await flakyRes.json()).flakyTests || [] : null;
        const debts = debtRes.ok ? (await debtRes.json()).debts || [] : null;
        if (cancelled) return;
        setTeam(teamData.team || null);
        setFlakyCount(flaky ? flaky.filter((t: any) => !String(t.id).startsWith('sample-')).length : null);
        setOpenDebt(debts ? debts.filter((d: any) => d.status === 'open' || d.status === 'in_progress').length : null);
      } catch (err) {
        console.error('Error loading report data:', err);
        if (!cancelled) setError('Could not load report data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [teamId]);

  const asOf = dayKey(team?.snapshotDate ?? (team?.kpiData?.snapshotDate as string | undefined) ?? null);
  const summaryRows: Array<[string, string]> = useMemo(() => [
    ['QA score', fmt(team?.qaScore, 0)],
    ['Test coverage', fmt(team?.kpiData?.testCoverage, 1, '%')],
    ['Defect escape rate', fmt(team?.kpiData?.defectEscapeRate, 2, '%')],
    ['Technical debt score', fmt(team?.technicalDebtScore, 0)],
    ['Flaky tests tracked', flakyCount == null ? '—' : String(flakyCount)],
    ['Open debt items', openDebt == null ? '—' : String(openDebt)],
  ], [team, flakyCount, openDebt]);

  const generatePDF = async () => {
    if (!team) return;
    setIsGenerating(true);
    try {
      const doc = new jsPDF();
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
      doc.text(`Team quality report: ${team.name}`, logoDataUrl ? 30 : 14, 18);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 116, 139);
      doc.text(`IronGate QA Navigator${team.department_name ? `  |  ${team.department_name}` : ''}`, logoDataUrl ? 30 : 14, 24);
      doc.text(`Data as of ${fmtDate(asOf)}  |  Generated ${generatedAt.toLocaleString()}`, pageWidth - 14, 24, { align: 'right' });
      doc.setDrawColor(226, 232, 240);
      doc.line(14, 28, pageWidth - 14, 28);

      doc.setTextColor(15, 23, 42);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Summary', 14, 37);
      autoTable(doc, {
        startY: 40,
        margin: { left: 14 },
        tableWidth: 110,
        body: summaryRows,
        theme: 'plain',
        styles: { fontSize: 9, cellPadding: 1.5, textColor: [15, 23, 42] },
        columnStyles: { 0: { textColor: [100, 116, 139] }, 1: { fontStyle: 'bold', halign: 'right' } },
      });

      const afterSummary = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 80;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text('Latest KPI snapshot', 14, afterSummary + 10);
      autoTable(doc, {
        startY: afterSummary + 13,
        margin: { left: 14, right: 14 },
        head: [['Metric', 'Value']],
        body: KPI_ROWS.map(r => [r.label, fmt(kpiValue(team, r.key), r.digits, r.suffix)]),
        styles: { fontSize: 9, cellPadding: 2 },
        columnStyles: { 1: { halign: 'right' } },
        headStyles: { fillColor: [38, 83, 138], textColor: 255 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        didDrawPage: (data) => {
          doc.setFontSize(8);
          doc.setTextColor(148, 163, 184);
          doc.text(`Page ${data.pageNumber}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
          doc.text('"—" = not recorded. Team-level figures only; the report contains no individual developer data.', 14, pageHeight - 8);
        },
      });

      const safeName = team.name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'Team';
      doc.save(`QA_Report_${safeName}_${asOf ?? generatedAt.toISOString().slice(0, 10)}.pdf`);
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
          team
            ? `PDF quality report for ${team.name}${asOf ? `, from its latest KPI snapshot (${fmtDate(asOf)})` : ''}.`
            : 'PDF quality report for the selected team.'
        }
        actions={
          <button
            onClick={generatePDF}
            disabled={isGenerating || loading || !team}
            className={cx(buttonClass.primary, 'disabled:cursor-not-allowed')}
            data-testid="download-team-report"
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
      ) : error || !team ? (
        <Card><EmptyState title={error || 'Team not found'} description="Try reloading the page." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            {summaryRows.map(([label, value]) => <StatTile key={label} label={label} value={value} />)}
          </div>

          <Card padded={false}>
            <div className="px-5 pt-5">
              <CardHeader
                title="Report preview"
                subtitle={`${team.name}: latest KPI snapshot${asOf ? ` (${fmtDate(asOf)})` : ''}. "—" means not recorded.`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                    <th className="px-5 py-2 text-left font-medium">Metric</th>
                    <th className="px-5 py-2 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {KPI_ROWS.map(r => (
                    <tr key={r.key}>
                      <td className="px-5 py-2 text-slate-900 dark:text-white">{r.label}</td>
                      <td className="px-5 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{fmt(kpiValue(team, r.key), r.digits, r.suffix)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Values come from the team's latest KPI snapshot; flaky tests and open debt items are the team's current records. The report contains no cost, ROI or individual developer figures.
          </p>
        </>
      )}
    </Page>
  );
};

export default PDFReportGenerator;
