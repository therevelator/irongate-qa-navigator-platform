export interface KPIMetric {
  id: string;
  name: string;
  value: number | string;
  unit?: string;
  change: number;
  trend: 'up' | 'down' | 'neutral';
  status: 'good' | 'warning' | 'critical';
  history: { date: string; value: number }[];
}

export interface Team {
  id: string;
  name: string;
  department: string;
  qaScore: number;
  status: 'good' | 'warning' | 'critical';
  velocity: { sprint: string; committed: number; delivered: number }[];
  metrics: KPIMetric[];
  technicalDebtScore?: number;  // Lower is better (0-100 scale)
  taskSizingAccuracy?: number;  // 1.0 is perfect, <1 overestimated, >1 underestimated
}

export const generateMockData = (): Team[] => {
  const generateHistory = (base: number, variance: number) => {
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (13 - i));
      return d.toISOString().split('T')[0];
    });
    return dates.map(date => ({
      date,
      value: Number((base + (Math.random() * variance * 2 - variance)).toFixed(2))
    }));
  };

  const teams = [
    { name: 'Checkout Service', dept: 'E-Commerce', baseScore: 92 },
    { name: 'User Auth', dept: 'Platform', baseScore: 78 },
    { name: 'Inventory Core', dept: 'Logistics', baseScore: 85 },
    { name: 'Payment Gateway', dept: 'FinTech', baseScore: 65 },
    { name: 'Mobile App', dept: 'Frontend', baseScore: 88 },
  ];

  return teams.map((t, index) => ({
    id: `team-${index}`,
    name: t.name,
    department: t.dept,
    qaScore: t.baseScore,
    status: t.baseScore > 90 ? 'good' : t.baseScore > 75 ? 'warning' : 'critical',
    // Mock: Random 15-85. PROD: Use calculateTechnicalDebtScore() from metricsAggregator
    technicalDebtScore: Number((15 + Math.random() * 70).toFixed(1)),
    // Mock: Random 0.7-1.3. PROD: Use calculateTaskSizingAccuracy() from metricsAggregator
    taskSizingAccuracy: Number((0.7 + Math.random() * 0.6).toFixed(2)),
    velocity: Array.from({ length: 5 }, (_, i) => ({
      sprint: `S${10 + i}`,
      committed: Math.floor(40 + Math.random() * 20),
      delivered: Math.floor(35 + Math.random() * 20)
    })),
    metrics: [
      {
        id: 'flakiness',
        name: 'Flakiness',
        value: Number((Math.random() * 5).toFixed(1)),
        unit: '%',
        change: Number((Math.random() * 2 - 1).toFixed(1)),
        trend: Math.random() > 0.5 ? 'down' : 'up',
        status: Math.random() > 0.7 ? 'warning' : 'good',
        history: generateHistory(3, 1)
      },
      {
        id: 'coverage',
        name: 'Coverage',
        value: Math.floor(60 + Math.random() * 35),
        unit: '%',
        change: Number((Math.random() * 5 - 2).toFixed(1)),
        trend: 'up',
        status: 'good',
        history: generateHistory(80, 5)
      },
      {
        id: 'defect-density',
        name: 'Defect Density',
        value: Number((Math.random() * 1.5).toFixed(2)),
        unit: '/1k',
        change: -0.1,
        trend: 'down',
        status: 'good',
        history: generateHistory(0.8, 0.2)
      },
      {
        id: 'mttr',
        name: 'MTTR',
        value: Math.floor(2 + Math.random() * 10),
        unit: 'h',
        change: 1,
        trend: 'down',
        status: 'warning',
        history: generateHistory(5, 2)
      }
    ]
  }));
};
