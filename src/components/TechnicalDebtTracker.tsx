import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, CartesianGrid } from 'recharts';
import { API_URL } from '../config/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useTheme } from '../contexts/ThemeContext';
import { Page, PageIntro, Card, CardHeader, Badge, StatTile, EmptyState, SegmentedControl, buttonClass, inputClass, cx } from './ui';
import type { Tone } from './ui';

interface TechnicalDebtTrackerProps {
  onBack?: () => void;
}

/** Row from GET /analytics/technical-debt. Calculated fields are null when inputs are missing. */
interface DebtItem {
  id: string;
  title: string;
  description: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  estimated_effort_hours: number | null;
  status: 'open' | 'in_progress' | 'resolved';
  created_date: string;
  assigned_to?: string | null;
  affected_users: number | null;
  support_tickets_monthly: number | null;
  downtime_minutes_monthly: number | null;
  revenue_impact_percent: number | null;
  sla_breaches_monthly: number | null;
  investment_cost: number | null;
  monthly_cost_of_delay: number | null;
  annual_savings: number | null;
  roi_percentage: number | null;
  payback_months: number | null;
}

type FinancialKey = 'developer_hourly_rate' | 'support_ticket_cost' | 'revenue_per_user_monthly' | 'downtime_cost_per_minute' | 'sla_breach_penalty';
interface FinancialInfo {
  config: Partial<Record<FinancialKey, number>> | null;
  defaultsUsed: string[];
}

const num = (v: unknown): number | null => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const money = (v: number | null) => (v == null ? '—' : `$${Math.round(v).toLocaleString()}`);
const moneyK = (v: number | null) => (v == null ? '—' : Math.abs(v) >= 10000 ? `$${(v / 1000).toFixed(1)}K` : money(v));
const formatPayback = (payback: number | null) => {
  if (payback == null) return '—';
  if (payback > 0 && payback < 0.1) return '< 0.1 mo';
  return `${payback} mo`;
};
const sumNonNull = (vals: Array<number | null>) => {
  const xs = vals.filter((v): v is number => v != null);
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
};

const SEVERITY_TONE: Record<string, Tone> = { critical: 'bad', high: 'warn', medium: 'neutral', low: 'neutral' };
const CATEGORIES = [
  { id: 'all', name: 'All categories' },
  { id: 'code_quality', name: 'Code quality' },
  { id: 'architecture', name: 'Architecture' },
  { id: 'testing', name: 'Testing' },
  { id: 'documentation', name: 'Documentation' },
  { id: 'infrastructure', name: 'Infrastructure' },
  { id: 'security', name: 'Security' },
  { id: 'performance', name: 'Performance' },
];
type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';
type SortKey = 'roi' | 'effort' | 'cost';

/** Null-last comparator. */
const cmp = (a: number | null, b: number | null, dir: 1 | -1) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
};

const TechnicalDebtTracker: React.FC<TechnicalDebtTrackerProps> = () => {
  const { isDark } = useTheme();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<SeverityFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('roi');
  const [debtItems, setDebtItems] = useState<DebtItem[]>([]);
  const [financial, setFinancial] = useState<FinancialInfo>({ config: null, defaultsUsed: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDebt = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/analytics/technical-debt`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        setDebtItems(data.debts || []);
        setFinancial({
          config: data.financial_config ?? null,
          defaultsUsed: Array.isArray(data.financial_config_defaults_used) ? data.financial_config_defaults_used : [],
        });
        setError(null);
      } else {
        setError('Could not load technical debt.');
      }
    } catch (err) {
      console.error('Error fetching technical debt:', err);
      setError('Could not load technical debt.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchDebt(); }, [fetchDebt]);

  // Listen for updates from ManualMetricsInput
  useEffect(() => {
    const handleDebtUpdate = () => { fetchDebt(); };
    window.addEventListener('technical-debt-updated', handleDebtUpdate);
    return () => window.removeEventListener('technical-debt-updated', handleDebtUpdate);
  }, [fetchDebt]);

  const openItems = debtItems.filter(d => d.status !== 'resolved');
  const filteredDebt = openItems.filter(item =>
    (selectedCategory === 'all' || item.category === selectedCategory) &&
    (selectedSeverity === 'all' || item.severity === selectedSeverity));

  const sortedDebt = [...filteredDebt].sort((a, b) => {
    if (sortBy === 'effort') return cmp(num(a.estimated_effort_hours), num(b.estimated_effort_hours), 1);
    if (sortBy === 'cost') return cmp(num(a.monthly_cost_of_delay), num(b.monthly_cost_of_delay), -1);
    return cmp(num(a.roi_percentage), num(b.roi_percentage), -1);
  });

  // Header figures over all open items.
  const totalEffort = sumNonNull(openItems.map(d => num(d.estimated_effort_hours)));
  const monthlyCostTotal = sumNonNull(openItems.map(d => num(d.monthly_cost_of_delay)));
  const itemsWithCost = openItems.filter(d => num(d.monthly_cost_of_delay) != null).length;
  const inProgress = debtItems.filter(d => d.status === 'in_progress').length;

  // Portfolio figures over the filtered list: only items with both investment and savings.
  const portfolio = (items: DebtItem[]) => {
    const both = items.filter(d => num(d.investment_cost) != null && num(d.annual_savings) != null);
    const inv = both.reduce((a, d) => a + (num(d.investment_cost) as number), 0);
    const sav = both.reduce((a, d) => a + (num(d.annual_savings) as number), 0);
    return { count: both.length, investment: both.length ? inv : null, savings: both.length ? sav : null, roi: inv > 0 ? ((sav - inv) / inv) * 100 : null };
  };
  const pf = portfolio(sortedDebt);

  const matrixData = filteredDebt
    .filter(d => num(d.estimated_effort_hours) != null && num(d.monthly_cost_of_delay) != null)
    .map(item => ({
      name: item.title,
      effort: num(item.estimated_effort_hours) as number,
      monthly: num(item.monthly_cost_of_delay) as number,
      severity: item.severity,
    }));

  const c = {
    grid: isDark ? '#1e293b' : '#e2e8f0',
    axis: isDark ? '#94a3b8' : '#64748b',
    sev: {
      critical: isDark ? '#f87171' : '#dc2626',
      high: isDark ? '#fbbf24' : '#d97706',
      medium: isDark ? '#79a4dc' : '#3567a5',
      low: isDark ? '#64748b' : '#94a3b8',
    } as Record<string, string>,
  };

  const rate = (key: FinancialKey) => financial.config?.[key] ?? null;
  const isDefault = (key: FinancialKey) => financial.defaultsUsed.includes(key);
  const rateLabel = (key: FinancialKey, unit: string) => {
    const v = rate(key);
    if (v == null) return null;
    return `$${v.toLocaleString()}${unit}${isDefault(key) ? ' (default)' : ''}`;
  };

  const handleExportPdf = async () => {
    if (!sortedDebt.length) return;
    let logoDataUrl: string | null = null;
    try {
      const res = await fetch('/irongate-logo.png');
      if (res.ok) {
        const blob = await res.blob();
        logoDataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      }
    } catch {
      logoDataUrl = null;
    }

    const doc = new jsPDF();
    const generatedAt = new Date().toLocaleString();
    const pageWidth = doc.internal.pageSize.getWidth();
    const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const pdfDebts = selectedSeverity === 'all'
      ? [...sortedDebt].sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99))
      : sortedDebt;

    const tableBody = pdfDebts.map(d => [
      d.title.substring(0, 30) + (d.title.length > 30 ? '...' : ''),
      d.severity.toUpperCase(),
      d.category.replace('_', ' '),
      d.estimated_effort_hours != null ? `${d.estimated_effort_hours}h` : '—',
      money(num(d.investment_cost)),
      money(num(d.monthly_cost_of_delay)),
      moneyK(num(d.annual_savings)),
      d.roi_percentage != null ? `${d.roi_percentage}%` : '—',
      formatPayback(num(d.payback_months)),
    ]);

    autoTable(doc, {
      startY: 55,
      margin: { top: 55 },
      head: [['Title', 'Severity', 'Category', 'Effort', 'Investment', 'Cost of delay / mo', 'Annual savings', 'ROI', 'Payback']],
      body: tableBody,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [38, 83, 138], textColor: 255, fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 35 }, 1: { cellWidth: 18 }, 2: { cellWidth: 22 }, 3: { cellWidth: 15 }, 4: { cellWidth: 22 },
        5: { cellWidth: 22 }, 6: { cellWidth: 20 }, 7: { cellWidth: 15 }, 8: { cellWidth: 18 },
      },
      didDrawPage: (data) => {
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(10, 25, pageWidth - 10, 25);
        if (logoDataUrl) { try { doc.addImage(logoDataUrl, 'PNG', 10, 5, 12, 12); } catch { /* ignore */ } }
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text('IronGate QA Navigator', 26, 12);
        doc.setFontSize(14);
        doc.text('Technical Debt ROI Report', pageWidth / 2, 10, { align: 'center' });
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(
          `Category: ${selectedCategory === 'all' ? 'All' : selectedCategory} | Severity: ${selectedSeverity === 'all' ? 'All' : selectedSeverity} | Sort: ${sortBy}`,
          pageWidth / 2, 16, { align: 'center' },
        );
        if (data.pageNumber === 1) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.text('Summary:', 10, 32);
          doc.setFont('helvetica', 'normal');
          doc.text([
            `Items: ${sortedDebt.length}`,
            `Effort: ${sumNonNull(sortedDebt.map(d => num(d.estimated_effort_hours))) ?? '—'} h`,
            `Cost of delay: ${money(sumNonNull(sortedDebt.map(d => num(d.monthly_cost_of_delay))))} / month`,
          ].join('  |  '), 10, 38);
          doc.text([
            `Portfolio (${pf.count} items with estimates) - Investment: ${money(pf.investment)}`,
            `Annual savings: ${money(pf.savings)}`,
            `ROI: ${pf.roi != null ? `${Math.round(pf.roi)}%` : '—'}`,
          ].join('  |  '), 10, 44);
          doc.setFontSize(7);
          doc.setTextColor(100, 100, 100);
          doc.text('Portfolio ROI = (total annual savings - total investment) / total investment. Estimates based on entered impact data and financial rates.', 10, 50);
          doc.setTextColor(0, 0, 0);
        }
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated: ${generatedAt} | Page ${data.pageNumber}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      },
    });

    const itemsWithImpact = sortedDebt.filter(d => d.affected_users != null || d.support_tickets_monthly != null || d.downtime_minutes_monthly != null);
    if (itemsWithImpact.length > 0) {
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Business Impact Details (as entered)', 10, 15);
      const dash = (v: number | null) => (v == null ? '—' : String(v));
      autoTable(doc, {
        startY: 22,
        head: [['Title', 'Affected users', 'Tickets/mo', 'Downtime min/mo', 'Revenue impact', 'SLA breaches/mo']],
        body: itemsWithImpact.map(d => [
          d.title.substring(0, 25) + (d.title.length > 25 ? '...' : ''),
          dash(d.affected_users),
          dash(d.support_tickets_monthly),
          dash(d.downtime_minutes_monthly),
          d.revenue_impact_percent != null ? `${d.revenue_impact_percent}%` : '—',
          dash(d.sla_breaches_monthly),
        ]),
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [38, 83, 138], textColor: 255 },
      });
    }

    doc.save('technical-debt-roi-report.pdf');
  };

  const rateRows: Array<{ key: FinancialKey; title: string; formula: string; unit: string }> = [
    { key: 'support_ticket_cost', title: 'Support cost', formula: 'Tickets per month × cost per ticket', unit: '/ticket' },
    { key: 'downtime_cost_per_minute', title: 'Downtime cost', formula: 'Downtime minutes per month × cost per minute', unit: '/minute' },
    { key: 'revenue_per_user_monthly', title: 'Revenue loss', formula: 'Affected users × monthly revenue per user × revenue impact %', unit: '/user/month' },
    { key: 'sla_breach_penalty', title: 'SLA penalties', formula: 'SLA breaches per month × penalty per breach', unit: '/breach' },
  ];

  return (
    <Page>
      <PageIntro
        title="Technical debt"
        description="Open debt items with effort, monthly cost of delay and ROI estimates calculated from entered impact data."
        actions={
          <button onClick={handleExportPdf} disabled={sortedDebt.length === 0} className={cx(buttonClass.secondary, 'disabled:cursor-not-allowed disabled:opacity-50')}>
            <FileText className="h-4 w-4" /> Export PDF
          </button>
        }
      />

      {loading ? (
        <Card>
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading technical debt…
          </div>
        </Card>
      ) : error ? (
        <Card><EmptyState title={error} description="Try reloading the page." /></Card>
      ) : debtItems.length === 0 ? (
        <Card><EmptyState title="No technical debt recorded" description="Debt items appear here once they are added." /></Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile label="Open items" value={openItems.length} />
            <StatTile label="Estimated effort" value={totalEffort != null ? totalEffort.toLocaleString() : '—'} unit={totalEffort != null ? 'h' : undefined} />
            <StatTile
              label="Cost of delay"
              value={monthlyCostTotal != null ? money(monthlyCostTotal) : '—'}
              unit={monthlyCostTotal != null ? '/month' : undefined}
              caption={`${itemsWithCost} of ${openItems.length} open items have impact data`}
            />
            <StatTile label="In progress" value={inProgress} />
          </div>

          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <select aria-label="Category" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className={inputClass}>
                {CATEGORIES.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
              </select>
              <SegmentedControl
                value={selectedSeverity}
                onChange={setSelectedSeverity}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'critical', label: 'Critical' },
                  { value: 'high', label: 'High' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'low', label: 'Low' },
                ]}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              Sort
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)} className={inputClass}>
                <option value="roi">ROI (highest first)</option>
                <option value="cost">Cost of delay / month (highest first)</option>
                <option value="effort">Effort (lowest first)</option>
              </select>
            </label>
          </div>

          <Card className="mb-6">
            <CardHeader
              title="Effort vs monthly cost of delay"
              subtitle={`${matrixData.length} of ${filteredDebt.length} items have both an effort estimate and impact data`}
              action={
                <div className="hidden items-center gap-3 text-xs text-slate-600 sm:flex dark:text-slate-300">
                  {(['critical', 'high', 'medium', 'low'] as const).map(s => (
                    <span key={s} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.sev[s] }} />
                      <span className="capitalize">{s}</span>
                    </span>
                  ))}
                </div>
              }
            />
            {matrixData.length === 0 ? (
              <EmptyState title="Not enough data to plot" description="Enter effort and impact data for debt items in Admin Panel > Manual Metrics Input." />
            ) : (
              <div className="h-72 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 16, bottom: 30, left: 30 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                    <XAxis type="number" dataKey="effort" name="Effort" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid}
                      label={{ value: 'Effort (hours)', position: 'bottom', offset: 12, fontSize: 11, fill: c.axis }} />
                    <YAxis type="number" dataKey="monthly" name="Cost of delay" tick={{ fontSize: 11, fill: c.axis }} stroke={c.grid}
                      tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                      label={{ value: 'Cost of delay ($ / month)', angle: -90, position: 'left', offset: 18, fontSize: 11, fill: c.axis }} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3', stroke: c.grid }}
                      content={({ payload }) => {
                        if (payload && payload.length) {
                          const d = payload[0].payload as { name: string; effort: number; monthly: number; severity: string };
                          return (
                            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                              <p className="mb-1 font-medium">{d.name}</p>
                              <p>Effort: {d.effort} h</p>
                              <p>Cost of delay: {money(d.monthly)} / month</p>
                              <p className="capitalize">Severity: {d.severity}</p>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Scatter data={matrixData} isAnimationActive={false}>
                      {matrixData.map((entry, index) => <Cell key={`cell-${index}`} fill={c.sev[entry.severity] ?? c.sev.medium} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Debt items ({sortedDebt.length})</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Portfolio ROI: <span className="font-medium text-slate-900 dark:text-white">{pf.roi != null ? `${Math.round(pf.roi).toLocaleString()}%` : '—'}</span>
              {' '}= (Σ annual savings {money(pf.savings)} − Σ investment {money(pf.investment)}) ÷ Σ investment, over {pf.count} items with both estimates
            </p>
          </div>
          {sortedDebt.length === 0 ? (
            <Card><EmptyState title="No items match these filters" /></Card>
          ) : (
            <div className="space-y-3">
              {sortedDebt.map(item => <DebtCard key={item.id} debt={item} hourlyRate={rateLabel('developer_hourly_rate', '/h')} />)}
            </div>
          )}

          <Card className="mt-8">
            <CardHeader title="How cost of delay and ROI are calculated" />
            <div className="space-y-5 text-sm">
              <p className="text-slate-600 dark:text-slate-300">
                <span className="font-medium text-slate-900 dark:text-white">Monthly cost of delay</span> = support cost + downtime cost + revenue loss + SLA penalties.
                It is only calculated for items with impact data entered; items without it show “—”.
              </p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {rateRows.map(r => (
                  <div key={r.key} className="rounded-md border border-slate-200 p-3 dark:border-slate-800">
                    <p className="font-medium text-slate-900 dark:text-white">{r.title}</p>
                    <p className="mt-1 font-mono text-xs text-slate-600 dark:text-slate-300">{r.formula}</p>
                    {rateLabel(r.key, r.unit) && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Rate in use: {rateLabel(r.key, r.unit)}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 text-xs text-slate-600 sm:grid-cols-2 dark:text-slate-300">
                <p><span className="font-medium text-slate-900 dark:text-white">Investment</span> = effort hours × developer hourly rate{rateLabel('developer_hourly_rate', '/h') ? ` (${rateLabel('developer_hourly_rate', '/h')})` : ''}</p>
                <p><span className="font-medium text-slate-900 dark:text-white">Annual savings</span> = monthly cost of delay × 12</p>
                <p><span className="font-medium text-slate-900 dark:text-white">Item ROI</span> = (annual savings − investment) ÷ investment × 100</p>
                <p><span className="font-medium text-slate-900 dark:text-white">Payback</span> = investment ÷ monthly cost of delay</p>
              </div>
              {financial.defaultsUsed.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Rates marked “(default)” are built-in defaults because no value has been configured for your company or team.
                </p>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Impact data (affected users, tickets, downtime, revenue impact, SLA breaches, effort) is entered in Admin Panel &gt; Manual Metrics Input &gt; Technical Debt Impact.
                All figures are estimates derived from those inputs.
              </p>
            </div>
          </Card>
        </>
      )}
    </Page>
  );
};

const DebtCard: React.FC<{ debt: DebtItem; hourlyRate: string | null }> = ({ debt, hourlyRate }) => {
  const [expanded, setExpanded] = useState(false);
  const daysSinceCreated = debt.created_date ? Math.floor((Date.now() - new Date(debt.created_date).getTime()) / 86400000) : null;
  const investment = num(debt.investment_cost);
  const monthly = num(debt.monthly_cost_of_delay);
  const annual = num(debt.annual_savings);
  const roi = num(debt.roi_percentage);
  const net = investment != null && annual != null ? annual - investment : null;
  const dash = (v: number | null, suffix = '') => (v == null ? '—' : `${v.toLocaleString()}${suffix}`);

  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{debt.title}</h4>
            <Badge tone={SEVERITY_TONE[debt.severity] ?? 'neutral'}>{debt.severity}</Badge>
            <Badge>{debt.category.replace(/_/g, ' ')}</Badge>
            {debt.status === 'in_progress' && <Badge tone="brand">In progress</Badge>}
          </div>
          {debt.description && <p className="line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{debt.description}</p>}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Investment</dt>
          <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{money(investment)}</dd>
          <dd className="text-xs text-slate-500 dark:text-slate-400">{debt.estimated_effort_hours != null ? `${debt.estimated_effort_hours} h${hourlyRate ? ` × ${hourlyRate}` : ''}` : 'No effort estimate'}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Cost of delay</dt>
          <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{monthly != null ? `${money(monthly)} / mo` : '—'}</dd>
          {monthly == null && <dd className="text-xs text-slate-500 dark:text-slate-400">No impact data</dd>}
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Annual savings if fixed</dt>
          <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{moneyK(annual)}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">ROI</dt>
          <dd className={cx('font-medium tabular-nums', roi == null ? 'text-slate-900 dark:text-white' : roi >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
            {roi != null ? `${roi.toLocaleString()}%` : '—'}
          </dd>
          <dd className="text-xs text-slate-500 dark:text-slate-400">Payback {formatPayback(num(debt.payback_months))}</dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Age</dt>
          <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{daysSinceCreated != null ? `${daysSinceCreated} days` : '—'}</dd>
        </div>
      </dl>

      <button
        onClick={() => setExpanded(!expanded)}
        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800 dark:text-brand-300 dark:hover:text-brand-200"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {expanded ? 'Hide impact inputs' : 'Impact inputs'}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-800">
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {[
              ['Affected users', dash(debt.affected_users)],
              ['Tickets / month', dash(debt.support_tickets_monthly)],
              ['Downtime min / month', dash(debt.downtime_minutes_monthly)],
              ['Revenue impact', dash(debt.revenue_impact_percent, '%')],
              ['SLA breaches / month', dash(debt.sla_breaches_monthly)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500 dark:text-slate-400">{k}</dt>
                <dd className="font-medium tabular-nums text-slate-900 dark:text-white">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Net first-year benefit: <span className={cx('font-medium', net == null ? 'text-slate-900 dark:text-white' : net >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>{money(net)}</span>
            {' '}(annual savings − investment)
          </p>
        </div>
      )}
    </Card>
  );
};

export default TechnicalDebtTracker;
