import React, { useState, useEffect } from 'react';
import { ArrowLeft, Wrench, AlertCircle, Clock, DollarSign, TrendingUp, Filter, Loader2, Users, Headphones, Zap, Calendar, FileText, ChevronDown } from 'lucide-react';
import type { TechnicalDebt } from '../data/advancedFeatures';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ScatterChart, Scatter, ZAxis } from 'recharts';
import { API_URL } from '../config/api';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const formatPayback = (payback?: number) => {
  if (payback === undefined || payback === null) return 'N/A';
  if (payback > 0 && payback < 0.1) return 'Instant';
  return `${payback}mo`;
};

interface TechnicalDebtTrackerProps {
  onBack: () => void;
}

const TechnicalDebtTracker: React.FC<TechnicalDebtTrackerProps> = ({ onBack }) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'priority' | 'effort' | 'cost' | 'roi'>('roi');
  const [debtItems, setDebtItems] = useState<TechnicalDebt[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDebt = async () => {
    try {
      const response = await fetch(`${API_URL}/analytics/technical-debt`, {
        credentials: 'include'
      });
      if (response.ok) {
        const data = await response.json();
        setDebtItems(data.debts || []);
      }
    } catch (error) {
      console.error('Error fetching technical debt:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDebt();
  }, []);

  // Listen for updates from ManualMetricsInput
  useEffect(() => {
    const handleDebtUpdate = () => {
      fetchDebt();
    };
    
    window.addEventListener('technical-debt-updated', handleDebtUpdate);
    return () => window.removeEventListener('technical-debt-updated', handleDebtUpdate);
  }, []);

  const filteredDebt = debtItems.filter(item => {
    const categoryMatch = selectedCategory === 'all' || item.category === selectedCategory;
    const severityMatch = selectedSeverity === 'all' || item.severity === selectedSeverity;
    return categoryMatch && severityMatch && item.status !== 'resolved';
  });

  const sortedDebt = [...filteredDebt].sort((a, b) => {
    if (sortBy === 'priority') return b.priority_score - a.priority_score;
    if (sortBy === 'effort') return a.estimated_effort_hours - b.estimated_effort_hours;
    if (sortBy === 'roi') return (b.roi_percentage || 0) - (a.roi_percentage || 0);
    return b.cost_of_delay - a.cost_of_delay;
  });

  const totalDebt = debtItems.filter(d => d.status !== 'resolved').length;
  const totalEffort = debtItems.reduce((acc, d) => d.status !== 'resolved' ? acc + d.estimated_effort_hours : acc, 0);
  const totalCost = debtItems.reduce((acc, d) => d.status !== 'resolved' ? acc + d.cost_of_delay : acc, 0);
  const inProgress = debtItems.filter(d => d.status === 'in_progress').length;

  const categories = [
    { id: 'all', name: 'All Categories', icon: '📋', color: 'gray' },
    { id: 'code_quality', name: 'Code Quality', icon: '🔧', color: 'blue' },
    { id: 'testing', name: 'Testing', icon: '🧪', color: 'green' },
    { id: 'documentation', name: 'Documentation', icon: '📚', color: 'yellow' },
    { id: 'infrastructure', name: 'Infrastructure', icon: '🏗️', color: 'purple' },
    { id: 'security', name: 'Security', icon: '🔒', color: 'red' },
    { id: 'performance', name: 'Performance', icon: '⚡', color: 'orange' }
  ];

  const severities = [
    { id: 'all', name: 'All Severities' },
    { id: 'critical', name: 'Critical' },
    { id: 'high', name: 'High' },
    { id: 'medium', name: 'Medium' },
    { id: 'low', name: 'Low' }
  ];

  // Prepare data for priority matrix
  const matrixData = filteredDebt.map(item => ({
    name: item.title,
    effort: item.estimated_effort_hours,
    impact: item.cost_of_delay / 1000,
    priority: item.priority_score,
    severity: item.severity
  }));

  // Calculate totals for report
  const totalInvestment = sortedDebt.reduce((acc, d) => acc + (d.investment_cost || d.estimated_effort_hours * 75), 0);
  const totalAnnualSavings = sortedDebt.reduce((acc, d) => acc + (d.annual_savings || d.cost_of_delay * 12), 0);
  const avgROI = sortedDebt.length > 0 
    ? Math.round(sortedDebt.reduce((acc, d) => acc + (d.roi_percentage || 0), 0) / sortedDebt.length)
    : 0;

  // PDF Export
  const handleExportPdf = async () => {
    if (!sortedDebt.length) return;

    // Load logo
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

    // Main table data
    const severityOrder: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3
    };

    const pdfDebts = selectedSeverity === 'all'
      ? [...sortedDebt].sort((a, b) => (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99))
      : sortedDebt;

    const tableBody = pdfDebts.map(d => [
      d.title.substring(0, 30) + (d.title.length > 30 ? '...' : ''),
      d.severity.toUpperCase(),
      d.category.replace('_', ' '),
      `${d.estimated_effort_hours}h`,
      `$${(d.investment_cost || d.estimated_effort_hours * 75).toLocaleString()}`,
      `$${(d.monthly_cost_of_delay || d.cost_of_delay).toLocaleString()}`,
      `$${((d.annual_savings || d.cost_of_delay * 12) / 1000).toFixed(1)}K`,
      `${d.roi_percentage || 0}%`,
      formatPayback(d.payback_months)
    ]);

    autoTable(doc, {
      startY: 55,
      margin: { top: 55 },
      head: [[
        'Title',
        'Severity',
        'Category',
        'Effort',
        'Investment',
        'Monthly Loss',
        'Annual Save',
        'ROI',
        'Payback'
      ]],
      body: tableBody,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [234, 88, 12], textColor: 255, fontSize: 7 },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: {
        0: { cellWidth: 35 },
        1: { cellWidth: 18 },
        2: { cellWidth: 22 },
        3: { cellWidth: 15 },
        4: { cellWidth: 22 },
        5: { cellWidth: 22 },
        6: { cellWidth: 20 },
        7: { cellWidth: 15 },
        8: { cellWidth: 18 }
      },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const severity = pdfDebts[data.row.index]?.severity;
          const severityColors: Record<string, [number, number, number]> = {
            critical: [254, 226, 226], // light red
            high: [255, 237, 213],     // light orange
            medium: [254, 249, 195],   // light yellow
            low: [220, 252, 231]       // light green
          };
          const fill = severityColors[severity as keyof typeof severityColors];
          if (fill) {
            data.cell.styles.fillColor = fill;
          }
        }
      },
      didDrawPage: (data) => {
        // Header line
        doc.setDrawColor(229, 231, 235);
        doc.setLineWidth(0.5);
        doc.line(10, 25, pageWidth - 10, 25);

        // Logo
        if (logoDataUrl) {
          try { doc.addImage(logoDataUrl, 'PNG', 10, 5, 12, 12); } catch {}
        }

        // Brand
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text('IronGate QA Navigator', 26, 12);

        // Title
        doc.setFontSize(14);
        doc.text('Technical Debt ROI Report', pageWidth / 2, 10, { align: 'center' });

        // Filters
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(
          `Category: ${selectedCategory === 'all' ? 'All' : selectedCategory} | Severity: ${selectedSeverity === 'all' ? 'All' : selectedSeverity} | Sort: ${sortBy}`,
          pageWidth / 2, 16, { align: 'center' }
        );

        // Summary on first page
        if (data.pageNumber === 1) {
          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.text('Summary:', 10, 32);
          doc.setFont('helvetica', 'normal');
          doc.text([
            `Total Items: ${sortedDebt.length}`,
            `Total Effort: ${totalEffort} hours`,
            `Total Investment: $${totalInvestment.toLocaleString()}`,
            `Annual Savings Potential: $${totalAnnualSavings.toLocaleString()}`,
            `Average ROI: ${avgROI}%`
          ].join('  |  '), 10, 38);

          // Critical items highlight
          const criticalCount = sortedDebt.filter(d => d.severity === 'critical').length;
          const highROICount = sortedDebt.filter(d => (d.roi_percentage || 0) > 200).length;
          doc.setTextColor(180, 0, 0);
          doc.text(`⚠ Critical Items: ${criticalCount}  |  High-ROI Items (>200%): ${highROICount}`, 10, 46);
          doc.setTextColor(0, 0, 0);
        }

        // Footer
        const pageHeight = doc.internal.pageSize.getHeight();
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Generated: ${generatedAt} | Page ${data.pageNumber}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
      }
    });

    // Add Impact Details page if we have items with impact data
    const itemsWithImpact = sortedDebt.filter(d => d.affected_users || d.support_tickets_monthly || d.downtime_minutes_monthly);
    if (itemsWithImpact.length > 0) {
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Business Impact Details', 10, 15);

      const impactBody = itemsWithImpact.map(d => [
        d.title.substring(0, 25) + (d.title.length > 25 ? '...' : ''),
        d.affected_users || 0,
        d.support_tickets_monthly || 0,
        d.downtime_minutes_monthly || 0,
        `${d.revenue_impact_percent || 0}%`,
        d.sla_breaches_monthly || 0
      ]);

      autoTable(doc, {
        startY: 22,
        head: [['Title', 'Affected Users', 'Tickets/mo', 'Downtime min/mo', 'Revenue Impact', 'SLA Breaches/mo']],
        body: impactBody,
        styles: { fontSize: 8, cellPadding: 2 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255 }
      });
    }

    doc.save('technical-debt-roi-report.pdf');
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800 sticky top-0 z-10">
        <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
            <button 
              onClick={onBack}
              className="flex items-center space-x-2 text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              <ArrowLeft size={20} />
              <span className="font-medium">Back to Features</span>
            </button>
            
            <button
              onClick={handleExportPdf}
              disabled={sortedDebt.length === 0}
              className="flex items-center justify-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <FileText size={16} />
              <span>Export PDF</span>
            </button>
          </div>
          
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white flex items-center">
                <Wrench className="mr-2 sm:mr-3 text-orange-500" size={24} />
                Technical Debt Tracker
              </h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Prioritize and manage technical debt across your codebase</p>
            </div>
            
            {/* Stats Cards - Responsive Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
              <div className="text-center bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Total Items</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-gray-900 dark:text-white">{totalDebt}</div>
              </div>
              <div className="text-center bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Total Effort</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-blue-600 dark:text-blue-400">{totalEffort}h</div>
              </div>
              <div className="text-center bg-red-50 dark:bg-red-900/20 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Cost of Delay</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-red-600 dark:text-red-400">${(totalCost / 1000).toFixed(0)}K</div>
              </div>
              <div className="text-center bg-green-50 dark:bg-green-900/20 rounded-lg p-2 sm:p-3">
                <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">In Progress</p>
                <div className="text-xl sm:text-2xl lg:text-3xl font-bold text-green-600 dark:text-green-400">{inProgress}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        {/* Category Filter - Scrollable on mobile */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-4">
          <div className="flex items-center space-x-2 flex-shrink-0">
            <Filter size={18} className="text-gray-500 dark:text-slate-400" />
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">Category:</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-hide">
            {categories.map(cat => (
              <button
                key={cat.id}
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap flex-shrink-0 ${
                  selectedCategory === cat.id
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
              >
                <span className="mr-1 sm:mr-2">{cat.icon}</span>
                <span className="hidden sm:inline">{cat.name}</span>
                <span className="sm:hidden">{cat.name.split(' ')[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Severity & Sort Row */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          {/* Severity Filter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">Severity:</span>
            {severities.map(sev => (
              <button
                key={sev.id}
                onClick={() => setSelectedSeverity(sev.id)}
                className={`px-2.5 py-1 sm:px-3 sm:py-1 rounded-full text-xs font-semibold transition-all ${
                  selectedSeverity === sev.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700'
                }`}
              >
                {sev.name}
              </button>
            ))}
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center space-x-2 sm:space-x-4">
            <span className="text-sm font-semibold text-gray-700 dark:text-slate-300">Sort:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-900 dark:text-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="roi">ROI (Best Value)</option>
              <option value="priority">Priority Score</option>
              <option value="effort">Effort (Low to High)</option>
              <option value="cost">Cost of Delay</option>
            </select>
          </div>
        </div>
      </div>

      {/* Priority Matrix */}
      <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 lg:py-8">
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 p-4 sm:p-6 mb-6 sm:mb-8">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white mb-4">Priority Matrix (Effort vs Impact)</h2>
          <div className="h-64 sm:h-80 lg:h-96">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 40, left: 40 }}>
                <XAxis 
                  type="number" 
                  dataKey="effort" 
                  name="Effort (hours)" 
                  tick={{ fontSize: 10, fill: 'currentColor' }}
                  label={{ value: 'Effort (hours)', position: 'bottom', offset: 25, fontSize: 11 }}
                />
                <YAxis 
                  type="number" 
                  dataKey="impact" 
                  name="Impact ($K)" 
                  tick={{ fontSize: 10, fill: 'currentColor' }}
                  label={{ value: 'Impact ($K)', angle: -90, position: 'left', offset: 25, fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="priority" range={[60, 400]} />
                <Tooltip 
                  cursor={{ strokeDasharray: '3 3' }}
                  content={({ payload }) => {
                    if (payload && payload.length) {
                      const data = payload[0].payload;
                      return (
                        <div className="bg-gray-900 dark:bg-slate-800 text-white px-3 py-2 rounded-lg shadow-lg text-sm">
                          <p className="font-bold mb-1">{data.name}</p>
                          <p>Effort: {data.effort}h</p>
                          <p>Impact: ${data.impact}K</p>
                          <p>Priority: {data.priority.toFixed(1)}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Scatter data={matrixData} fill="#3b82f6">
                  {matrixData.map((entry, index) => (
                    <Cell 
                      key={`cell-${index}`} 
                      fill={
                        entry.severity === 'critical' ? '#ef4444' :
                        entry.severity === 'high' ? '#f59e0b' :
                        entry.severity === 'medium' ? '#3b82f6' :
                        '#10b981'
                      }
                    />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-6 mt-4 text-xs sm:text-sm text-gray-700 dark:text-slate-300">
            <div className="flex items-center">
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-red-500 mr-1.5 sm:mr-2"></div>
              <span>Critical</span>
            </div>
            <div className="flex items-center">
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-yellow-500 mr-1.5 sm:mr-2"></div>
              <span>High</span>
            </div>
            <div className="flex items-center">
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-blue-500 mr-1.5 sm:mr-2"></div>
              <span>Medium</span>
            </div>
            <div className="flex items-center">
              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-green-500 mr-1.5 sm:mr-2"></div>
              <span>Low</span>
            </div>
          </div>
        </div>

        {/* Debt Items List */}
        <div className="space-y-3 sm:space-y-4">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900 dark:text-white">Debt Items ({sortedDebt.length})</h2>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
          ) : sortedDebt.length === 0 ? (
            <div className="text-center py-12 bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800">
              <Wrench className="w-12 h-12 text-gray-400 dark:text-slate-600 mx-auto mb-3" />
              <p className="text-gray-500 dark:text-slate-400">No technical debt items match your filters</p>
            </div>
          ) : (
            sortedDebt.map(item => (
              <DebtCard key={item.id} debt={item} />
            ))
          )}
        </div>
      </div>
    </div>
  );
};

interface DebtCardProps {
  debt: TechnicalDebt;
}

const DebtCard: React.FC<DebtCardProps> = ({ debt }) => {
  const [expanded, setExpanded] = useState(false);

  const getSeverityColor = (severity: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-300 dark:border-red-700',
      high: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 border-orange-300 dark:border-orange-700',
      medium: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-300 dark:border-yellow-700',
      low: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-300 dark:border-green-700'
    };
    return colors[severity] || 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700';
  };

  const getCategoryIcon = (category: string) => {
    const icons: Record<string, string> = {
      code_quality: '🔧',
      architecture: '🏗️',
      testing: '🧪',
      documentation: '📚',
      security: '🔒',
      infrastructure: '🏗️',
      performance: '⚡'
    };
    return icons[category] || '📋';
  };

  const daysSinceCreated = Math.floor((Date.now() - new Date(debt.created_date).getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 overflow-hidden hover:shadow-md transition-shadow">
      <div className="p-4 sm:p-6">
        {/* Header Row */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-xl sm:text-2xl">{getCategoryIcon(debt.category)}</span>
              <h3 className="text-base sm:text-lg font-bold text-gray-900 dark:text-white truncate">{debt.title}</h3>
              <span className={`px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs font-semibold border ${getSeverityColor(debt.severity)}`}>
                {debt.severity.toUpperCase()}
              </span>
              {debt.status === 'in_progress' && (
                <span className="px-2 py-0.5 sm:px-3 sm:py-1 rounded-full text-xs font-semibold bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  IN PROGRESS
                </span>
              )}
            </div>
            <p className="text-sm text-gray-600 dark:text-slate-400 line-clamp-2">{debt.description}</p>
          </div>
          
          <div className="text-left sm:text-right flex-shrink-0">
            <div className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">{debt.priority_score.toFixed(1)}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">Priority Score</div>
          </div>
        </div>

        {/* Metrics Row - Responsive Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-blue-600 dark:text-blue-400 mb-1">
              <Clock size={12} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">Investment</span>
            </div>
            <div className="text-sm sm:text-lg font-bold text-blue-900 dark:text-blue-200">
              ${(debt.investment_cost || debt.estimated_effort_hours * 75).toLocaleString()}
            </div>
            <div className="text-xs text-blue-600 dark:text-blue-400 hidden sm:block">{debt.estimated_effort_hours}h × $75/hr</div>
          </div>

          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-red-600 dark:text-red-400 mb-1">
              <DollarSign size={12} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">Monthly Loss</span>
            </div>
            <div className="text-sm sm:text-lg font-bold text-red-900 dark:text-red-200">
              ${(debt.monthly_cost_of_delay || debt.cost_of_delay).toLocaleString()}
            </div>
            <div className="text-xs text-red-600 dark:text-red-400 hidden sm:block">cost of delay</div>
          </div>

          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-green-600 dark:text-green-400 mb-1">
              <TrendingUp size={12} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold truncate">Annual Savings</span>
            </div>
            <div className="text-sm sm:text-lg font-bold text-green-900 dark:text-green-200">
              ${((debt.annual_savings || debt.cost_of_delay * 12) / 1000).toFixed(1)}K
            </div>
            <div className="text-xs text-green-600 dark:text-green-400 hidden sm:block">if fixed</div>
          </div>

          <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-2 sm:p-3">
            <div className="flex items-center text-purple-600 dark:text-purple-400 mb-1">
              <TrendingUp size={12} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold">ROI</span>
            </div>
            <div className={`text-sm sm:text-lg font-bold ${(debt.roi_percentage || 0) > 100 ? 'text-green-600 dark:text-green-400' : 'text-purple-900 dark:text-purple-200'}`}>
              {debt.roi_percentage !== undefined ? `${debt.roi_percentage}%` : 'N/A'}
            </div>
            <div className="text-xs text-purple-600 dark:text-purple-400 hidden sm:block">
              {debt.payback_months !== undefined ? `${formatPayback(debt.payback_months)} payback` : ''}
            </div>
          </div>

          <div className="bg-gray-50 dark:bg-slate-800 rounded-lg p-2 sm:p-3 col-span-2 sm:col-span-1">
            <div className="flex items-center text-gray-600 dark:text-slate-400 mb-1">
              <Calendar size={12} className="mr-1 flex-shrink-0" />
              <span className="text-xs font-semibold">Age</span>
            </div>
            <div className="text-sm sm:text-lg font-bold text-gray-900 dark:text-white">{daysSinceCreated}d</div>
            <div className="text-xs text-gray-500 dark:text-slate-500 hidden sm:block">since created</div>
          </div>
        </div>

        {/* Action Buttons - Responsive */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-medium"
          >
            <ChevronDown size={16} className={`mr-1 transition-transform ${expanded ? 'rotate-180' : ''}`} />
            {expanded ? 'Show Less' : 'Show Details'}
          </button>
          <button className="px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-600 text-white rounded-lg text-xs sm:text-sm font-medium hover:bg-blue-700 transition-colors">
            Start Working
          </button>
          <button className="px-3 py-1.5 sm:px-4 sm:py-2 bg-gray-100 dark:bg-slate-800 text-gray-700 dark:text-slate-300 rounded-lg text-xs sm:text-sm font-medium hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors">
            Mark Resolved
          </button>
        </div>

        {/* Expanded Details */}
        {expanded && (
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
            {/* Impact Metrics Grid - Responsive */}
            <h4 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-3">📊 Business Impact Breakdown</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
              <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-2 sm:p-3 text-center">
                <Users size={16} className="mx-auto text-orange-600 dark:text-orange-400 mb-1" />
                <div className="text-base sm:text-lg font-bold text-orange-900 dark:text-orange-200">{debt.affected_users || 0}</div>
                <div className="text-xs text-orange-600 dark:text-orange-400">Affected Users</div>
              </div>
              <div className="bg-pink-50 dark:bg-pink-900/20 rounded-lg p-2 sm:p-3 text-center">
                <Headphones size={16} className="mx-auto text-pink-600 dark:text-pink-400 mb-1" />
                <div className="text-base sm:text-lg font-bold text-pink-900 dark:text-pink-200">{debt.support_tickets_monthly || 0}</div>
                <div className="text-xs text-pink-600 dark:text-pink-400">Tickets/Month</div>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2 sm:p-3 text-center">
                <Zap size={16} className="mx-auto text-red-600 dark:text-red-400 mb-1" />
                <div className="text-base sm:text-lg font-bold text-red-900 dark:text-red-200">{debt.downtime_minutes_monthly || 0}</div>
                <div className="text-xs text-red-600 dark:text-red-400">Downtime min/mo</div>
              </div>
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-2 sm:p-3 text-center">
                <DollarSign size={16} className="mx-auto text-amber-600 dark:text-amber-400 mb-1" />
                <div className="text-base sm:text-lg font-bold text-amber-900 dark:text-amber-200">{debt.revenue_impact_percent || 0}%</div>
                <div className="text-xs text-amber-600 dark:text-amber-400">Revenue Impact</div>
              </div>
              <div className="bg-rose-50 dark:bg-rose-900/20 rounded-lg p-2 sm:p-3 text-center col-span-2 sm:col-span-1">
                <AlertCircle size={16} className="mx-auto text-rose-600 dark:text-rose-400 mb-1" />
                <div className="text-base sm:text-lg font-bold text-rose-900 dark:text-rose-200">{debt.sla_breaches_monthly || 0}</div>
                <div className="text-xs text-rose-600 dark:text-rose-400">SLA Breaches/mo</div>
              </div>
            </div>

            {/* ROI Analysis - Responsive */}
            <div className="bg-gradient-to-r from-green-50 to-blue-50 dark:from-green-900/20 dark:to-blue-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 sm:p-4 mb-4">
              <h4 className="text-sm font-semibold text-green-900 dark:text-green-200 mb-2">💰 ROI Analysis</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 text-sm">
                <div className="flex justify-between sm:block">
                  <span className="text-gray-600 dark:text-slate-400">Fix Investment:</span>
                  <span className="sm:ml-2 font-bold text-gray-900 dark:text-white">
                    ${(debt.investment_cost || debt.estimated_effort_hours * 75).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between sm:block">
                  <span className="text-gray-600 dark:text-slate-400">Annual Savings:</span>
                  <span className="sm:ml-2 font-bold text-green-600 dark:text-green-400">
                    ${(debt.annual_savings || debt.cost_of_delay * 12).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between sm:block">
                  <span className="text-gray-600 dark:text-slate-400">Net Benefit:</span>
                  <span className={`sm:ml-2 font-bold ${((debt.annual_savings || debt.cost_of_delay * 12) - (debt.investment_cost || debt.estimated_effort_hours * 75)) > 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    ${(((debt.annual_savings || debt.cost_of_delay * 12) - (debt.investment_cost || debt.estimated_effort_hours * 75))).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 sm:p-4">
              <h4 className="text-sm font-semibold text-yellow-900 dark:text-yellow-200 mb-2">⚠️ Priority Justification</h4>
              <p className="text-xs sm:text-sm text-yellow-800 dark:text-yellow-300">
                {(debt.roi_percentage || 0) > 200 
                  ? `High-value fix: ${debt.roi_percentage}% ROI with ${formatPayback(debt.payback_months)} payback. Immediate action recommended.`
                  : (debt.roi_percentage || 0) > 100
                    ? `Positive ROI: ${debt.roi_percentage}% return. Schedule within current quarter (payback ${formatPayback(debt.payback_months)}).`
                    : `Consider deferring: ROI of ${debt.roi_percentage || 0}% may not justify immediate investment (payback ${formatPayback(debt.payback_months)}).`
                }
                {debt.sla_breaches_monthly && debt.sla_breaches_monthly > 0 
                  ? ` ⚡ Note: This item causes ${debt.sla_breaches_monthly} SLA breaches/month.` 
                  : ''
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TechnicalDebtTracker;
