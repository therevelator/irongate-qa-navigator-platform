import React, { useState } from 'react';
import { ArrowLeft, FileText, Download, Calendar, TrendingUp, CheckCircle, AlertTriangle, Clock } from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface PDFReportGeneratorProps {
  onBack: () => void;
}

type TimePeriod = '2weeks' | '1month' | '3months' | '6months';

const PDFReportGenerator: React.FC<PDFReportGeneratorProps> = ({ onBack }) => {
  const [selectedPeriod, setSelectedPeriod] = useState<TimePeriod>('1month');
  const [isGenerating, setIsGenerating] = useState(false);

  const periods = [
    { id: '2weeks' as TimePeriod, label: '2 Weeks', days: 14 },
    { id: '1month' as TimePeriod, label: '1 Month', days: 30 },
    { id: '3months' as TimePeriod, label: '3 Months', days: 90 },
    { id: '6months' as TimePeriod, label: '6 Months', days: 180 },
  ];

  const getMockData = (days: number) => {
    // Mock data - in production, this would come from your API
    return {
      summary: {
        totalTests: Math.floor(1200 + days * 10),
        passRate: 94.5 + Math.random() * 2,
        failRate: 3.2 + Math.random(),
        avgExecutionTime: 245 + Math.random() * 50,
        testsExecuted: Math.floor(800 + days * 8),
        bugsFound: Math.floor(45 + days * 0.5),
        bugsFixed: Math.floor(40 + days * 0.4),
        codeCoverage: 78.5 + Math.random() * 5,
      },
      trends: {
        testGrowth: '+' + (5 + Math.random() * 10).toFixed(1) + '%',
        qualityImprovement: '+' + (3 + Math.random() * 5).toFixed(1) + '%',
        velocityIncrease: '+' + (8 + Math.random() * 7).toFixed(1) + '%',
      },
      teams: [
        { name: 'Nebula', tests: 450, passRate: 96.2, coverage: 82 },
        { name: 'Atlas', tests: 380, passRate: 93.5, coverage: 76 },
        { name: 'Sentinels', tests: 290, passRate: 95.1, coverage: 80 },
        { name: 'Voyagers', tests: 220, passRate: 92.8, coverage: 74 },
      ],
      topIssues: [
        { type: 'API Timeout', count: 12, severity: 'High' },
        { type: 'UI Rendering', count: 8, severity: 'Medium' },
        { type: 'Data Validation', count: 15, severity: 'High' },
        { type: 'Performance', count: 6, severity: 'Low' },
      ],
      roi: {
        timesSaved: Math.floor(120 + days * 2) + ' hours',
        costSavings: '$' + (15000 + days * 100).toLocaleString(),
        defectsPrevented: Math.floor(80 + days),
        productivityGain: (12 + Math.random() * 8).toFixed(1) + '%',
      },
    };
  };

  const generatePDF = async () => {
    setIsGenerating(true);

    try {
      const period = periods.find(p => p.id === selectedPeriod)!;
      const data = getMockData(period.days);
      const doc = new jsPDF();

      // Page dimensions
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPos = 20;

      // Helper function to add new page if needed
      const checkPageBreak = (requiredSpace: number) => {
        if (yPos + requiredSpace > pageHeight - 20) {
          doc.addPage();
          yPos = 20;
          return true;
        }
        return false;
      };

      // ==================== COVER PAGE ====================
      // Header with gradient effect (simulated with rectangles)
      doc.setFillColor(59, 130, 246); // Blue
      doc.rect(0, 0, pageWidth, 60, 'F');
      
      doc.setFillColor(37, 99, 235); // Darker blue
      doc.rect(0, 40, pageWidth, 20, 'F');

      // Logo/Company Name
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(28);
      doc.setFont('helvetica', 'bold');
      doc.text('IronGate QA Navigator', pageWidth / 2, 30, { align: 'center' });

      doc.setFontSize(14);
      doc.setFont('helvetica', 'normal');
      doc.text('Comprehensive Quality Assurance Report', pageWidth / 2, 45, { align: 'center' });

      // Report Period
      yPos = 80;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(`${period.label} Report`, pageWidth / 2, yPos, { align: 'center' });

      yPos += 10;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100, 100, 100);
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - period.days);
      doc.text(
        `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
        pageWidth / 2,
        yPos,
        { align: 'center' }
      );

      // Executive Summary Box
      yPos = 110;
      doc.setFillColor(249, 250, 251);
      doc.roundedRect(15, yPos, pageWidth - 30, 80, 3, 3, 'F');
      
      doc.setDrawColor(229, 231, 235);
      doc.roundedRect(15, yPos, pageWidth - 30, 80, 3, 3, 'S');

      yPos += 15;
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('Executive Summary', 25, yPos);

      yPos += 12;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(60, 60, 60);
      
      const summaryText = [
        `• Total Tests: ${data.summary.totalTests.toLocaleString()} (${data.trends.testGrowth} growth)`,
        `• Pass Rate: ${data.summary.passRate.toFixed(1)}% (${data.trends.qualityImprovement} improvement)`,
        `• Code Coverage: ${data.summary.codeCoverage.toFixed(1)}%`,
        `• Bugs Found & Fixed: ${data.summary.bugsFound} found, ${data.summary.bugsFixed} resolved`,
        `• ROI: ${data.roi.costSavings} saved, ${data.roi.timesSaved} time saved`,
      ];

      summaryText.forEach(text => {
        doc.text(text, 25, yPos);
        yPos += 8;
      });

      // Generated timestamp
      yPos = pageHeight - 30;
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(`Generated on: ${new Date().toLocaleString()}`, pageWidth / 2, yPos, { align: 'center' });
      doc.text('Confidential - For Internal Use Only', pageWidth / 2, yPos + 5, { align: 'center' });

      // ==================== PAGE 2: KEY METRICS ====================
      doc.addPage();
      yPos = 20;

      // Page Header
      doc.setFillColor(59, 130, 246);
      doc.rect(0, 0, pageWidth, 15, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Key Performance Metrics', 15, 10);

      yPos = 30;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.text('📊 Testing Metrics Overview', 15, yPos);

      // Metrics Cards
      yPos += 10;
      const metrics = [
        { label: 'Total Tests Executed', value: data.summary.testsExecuted.toLocaleString(), icon: '✓', color: [34, 197, 94] },
        { label: 'Pass Rate', value: data.summary.passRate.toFixed(1) + '%', icon: '✓', color: [34, 197, 94] },
        { label: 'Fail Rate', value: data.summary.failRate.toFixed(1) + '%', icon: '✗', color: [239, 68, 68] },
        { label: 'Avg Execution Time', value: data.summary.avgExecutionTime.toFixed(0) + 'ms', icon: '⏱', color: [59, 130, 246] },
        { label: 'Code Coverage', value: data.summary.codeCoverage.toFixed(1) + '%', icon: '📈', color: [168, 85, 247] },
        { label: 'Bugs Found', value: data.summary.bugsFound.toString(), icon: '🐛', color: [249, 115, 22] },
      ];

      const cardWidth = (pageWidth - 40) / 2;
      const cardHeight = 25;
      let xPos = 15;

      metrics.forEach((metric, index) => {
        if (index % 2 === 0 && index > 0) {
          yPos += cardHeight + 5;
          xPos = 15;
        }

        // Card background
        doc.setFillColor(249, 250, 251);
        doc.roundedRect(xPos, yPos, cardWidth, cardHeight, 2, 2, 'F');
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(xPos, yPos, cardWidth, cardHeight, 2, 2, 'S');

        // Icon circle
        doc.setFillColor(metric.color[0], metric.color[1], metric.color[2]);
        doc.circle(xPos + 10, yPos + 12, 5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text(metric.icon, xPos + 10, yPos + 14, { align: 'center' });

        // Metric text
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(metric.label, xPos + 20, yPos + 10);

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.text(metric.value, xPos + 20, yPos + 20);

        xPos += cardWidth + 10;
      });

      // ==================== TEAM PERFORMANCE TABLE ====================
      yPos += cardHeight + 20;
      checkPageBreak(60);

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('👥 Team Performance', 15, yPos);

      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Team', 'Tests', 'Pass Rate', 'Coverage']],
        body: data.teams.map(team => [
          team.name,
          team.tests.toString(),
          team.passRate.toFixed(1) + '%',
          team.coverage + '%',
        ]),
        theme: 'grid',
        headStyles: {
          fillColor: [59, 130, 246],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
        },
        bodyStyles: {
          halign: 'center',
        },
        alternateRowStyles: {
          fillColor: [249, 250, 251],
        },
      });

      yPos = (doc as any).lastAutoTable.finalY + 15;

      // ==================== TOP ISSUES TABLE ====================
      checkPageBreak(60);

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('⚠️ Top Issues', 15, yPos);

      yPos += 5;

      autoTable(doc, {
        startY: yPos,
        head: [['Issue Type', 'Count', 'Severity']],
        body: data.topIssues.map(issue => [
          issue.type,
          issue.count.toString(),
          issue.severity,
        ]),
        theme: 'grid',
        headStyles: {
          fillColor: [239, 68, 68],
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          halign: 'center',
        },
        bodyStyles: {
          halign: 'center',
        },
        alternateRowStyles: {
          fillColor: [254, 242, 242],
        },
        didParseCell: (data) => {
          if (data.column.index === 2 && data.section === 'body') {
            const severity = data.cell.text[0];
            if (severity === 'High') {
              data.cell.styles.textColor = [239, 68, 68];
              data.cell.styles.fontStyle = 'bold';
            } else if (severity === 'Medium') {
              data.cell.styles.textColor = [249, 115, 22];
            }
          }
        },
      });

      // ==================== PAGE 3: ROI & BUSINESS IMPACT ====================
      doc.addPage();
      yPos = 20;

      // Page Header
      doc.setFillColor(34, 197, 94);
      doc.rect(0, 0, pageWidth, 15, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Return on Investment & Business Impact', 15, 10);

      yPos = 30;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.text('💰 ROI Analysis', 15, yPos);

      yPos += 15;

      // ROI Cards
      const roiMetrics = [
        { label: 'Time Saved', value: data.roi.timesSaved, desc: 'Engineering hours saved through automation', color: [59, 130, 246] },
        { label: 'Cost Savings', value: data.roi.costSavings, desc: 'Direct cost reduction from efficiency gains', color: [34, 197, 94] },
        { label: 'Defects Prevented', value: data.roi.defectsPrevented.toString(), desc: 'Production bugs caught before release', color: [168, 85, 247] },
        { label: 'Productivity Gain', value: data.roi.productivityGain, desc: 'Overall team velocity improvement', color: [249, 115, 22] },
      ];

      roiMetrics.forEach((metric, index) => {
        if (index > 0 && index % 2 === 0) {
          yPos += 45;
        }

        const cardX = index % 2 === 0 ? 15 : pageWidth / 2 + 5;
        const cardW = (pageWidth - 40) / 2;

        // Card
        doc.setFillColor(249, 250, 251);
        doc.roundedRect(cardX, yPos, cardW, 40, 3, 3, 'F');
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(cardX, yPos, cardW, 40, 3, 3, 'S');

        // Color bar
        doc.setFillColor(metric.color[0], metric.color[1], metric.color[2]);
        doc.rect(cardX, yPos, 4, 40, 'F');

        // Content
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text(metric.label, cardX + 10, yPos + 10);

        doc.setTextColor(0, 0, 0);
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.text(metric.value, cardX + 10, yPos + 22);

        doc.setTextColor(120, 120, 120);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        const descLines = doc.splitTextToSize(metric.desc, cardW - 20);
        doc.text(descLines, cardX + 10, yPos + 30);
      });

      yPos += 60;

      // ==================== TRENDS & INSIGHTS ====================
      checkPageBreak(80);

      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);
      doc.text('📈 Trends & Insights', 15, yPos);

      yPos += 10;

      const insights = [
        {
          title: 'Quality Improvement',
          value: data.trends.qualityImprovement,
          desc: 'Overall test pass rate has improved, indicating better code quality and more stable releases.',
          icon: '✓',
          color: [34, 197, 94],
        },
        {
          title: 'Test Coverage Growth',
          value: data.trends.testGrowth,
          desc: 'Test suite expansion shows commitment to comprehensive quality assurance.',
          icon: '📊',
          color: [59, 130, 246],
        },
        {
          title: 'Velocity Increase',
          value: data.trends.velocityIncrease,
          desc: 'Team productivity has increased through better testing practices and automation.',
          icon: '⚡',
          color: [249, 115, 22],
        },
      ];

      insights.forEach(insight => {
        checkPageBreak(35);

        doc.setFillColor(249, 250, 251);
        doc.roundedRect(15, yPos, pageWidth - 30, 30, 3, 3, 'F');
        doc.setDrawColor(229, 231, 235);
        doc.roundedRect(15, yPos, pageWidth - 30, 30, 3, 3, 'S');

        // Icon
        doc.setFillColor(insight.color[0], insight.color[1], insight.color[2]);
        doc.circle(25, yPos + 15, 6, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text(insight.icon, 25, yPos + 17, { align: 'center' });

        // Title and value
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text(insight.title, 38, yPos + 12);

        doc.setFontSize(14);
        doc.setTextColor(insight.color[0], insight.color[1], insight.color[2]);
        doc.text(insight.value, pageWidth - 25, yPos + 12, { align: 'right' });

        // Description
        doc.setTextColor(100, 100, 100);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(insight.desc, pageWidth - 70);
        doc.text(lines, 38, yPos + 20);

        yPos += 35;
      });

      // ==================== FOOTER ON LAST PAGE ====================
      yPos = pageHeight - 30;
      doc.setFillColor(249, 250, 251);
      doc.rect(0, yPos - 5, pageWidth, 40, 'F');

      doc.setTextColor(100, 100, 100);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('IronGate QA Navigator', pageWidth / 2, yPos + 5, { align: 'center' });

      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text('Enterprise Quality Assurance Intelligence Platform', pageWidth / 2, yPos + 12, { align: 'center' });
      doc.text('© 2025 IronGate Software LTD. All rights reserved.', pageWidth / 2, yPos + 18, { align: 'center' });

      // Save PDF
      const fileName = `QA_Report_${period.label.replace(' ', '_')}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);

      setIsGenerating(false);
    } catch (error) {
      console.error('Error generating PDF:', error);
      setIsGenerating(false);
      alert('Failed to generate PDF report');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="px-8 py-6">
          <button
            onClick={onBack}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft size={20} />
            <span className="font-medium">Back to Features</span>
          </button>

          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <FileText className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">PDF Report Generator</h1>
              <p className="text-gray-500 mt-1">Generate comprehensive quality assurance reports</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="px-8 py-8 max-w-4xl mx-auto">
        {/* Report Configuration Card */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Report Configuration</h2>

          {/* Time Period Selection */}
          <div className="mb-8">
            <label className="block text-sm font-medium text-gray-700 mb-3">
              <Calendar className="inline mr-2" size={16} />
              Select Time Period
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {periods.map(period => (
                <button
                  key={period.id}
                  onClick={() => setSelectedPeriod(period.id)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedPeriod === period.id
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300 text-gray-700'
                  }`}
                >
                  <div className="font-semibold">{period.label}</div>
                  <div className="text-sm opacity-75">{period.days} days</div>
                </button>
              ))}
            </div>
          </div>

          {/* Report Contents Preview */}
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Report Contents</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
                <CheckCircle className="text-green-500 flex-shrink-0" size={20} />
                <div>
                  <div className="font-medium text-gray-900">Executive Summary</div>
                  <div className="text-sm text-gray-600">High-level overview of key metrics and trends</div>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
                <TrendingUp className="text-blue-500 flex-shrink-0" size={20} />
                <div>
                  <div className="font-medium text-gray-900">Performance Metrics</div>
                  <div className="text-sm text-gray-600">Test execution, pass rates, and coverage</div>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
                <AlertTriangle className="text-orange-500 flex-shrink-0" size={20} />
                <div>
                  <div className="font-medium text-gray-900">Issue Analysis</div>
                  <div className="text-sm text-gray-600">Top issues, bugs, and quality concerns</div>
                </div>
              </div>

              <div className="flex items-start space-x-3 p-4 bg-gray-50 rounded-lg">
                <Clock className="text-purple-500 flex-shrink-0" size={20} />
                <div>
                  <div className="font-medium text-gray-900">ROI & Business Impact</div>
                  <div className="text-sm text-gray-600">Cost savings, time saved, and productivity gains</div>
                </div>
              </div>
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={generatePDF}
            disabled={isGenerating}
            className={`w-full py-4 rounded-lg font-semibold text-white transition-all flex items-center justify-center space-x-2 ${
              isGenerating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-500 to-purple-600 hover:from-blue-600 hover:to-purple-700 shadow-lg hover:shadow-xl'
            }`}
          >
            {isGenerating ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Generating Report...</span>
              </>
            ) : (
              <>
                <Download size={20} />
                <span>Generate & Download PDF Report</span>
              </>
            )}
          </button>

          {/* Info Note */}
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-800">
              <strong>Note:</strong> The generated report includes comprehensive analytics, team performance data,
              issue tracking, ROI calculations, and trend analysis. Perfect for stakeholder presentations and
              executive reviews.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PDFReportGenerator;
