import React, { useState } from 'react';
import { ArrowLeft, BarChart3, TestTube, Zap, TrendingUp, Code, Wrench, GitBranch, DollarSign, Trophy, FileText, Grid3x3, LayoutGrid } from 'lucide-react';
import { advancedFeatures } from '../data/features';
import type { FeatureModule } from '../data/features';

interface FeaturesMenuProps {
  onBack: () => void;
  onSelectFeature: (featureId: string) => void;
}

type GridColumns = 1 | 2 | 3 | 4 | 5;

const FeaturesMenu: React.FC<FeaturesMenuProps> = ({ onBack, onSelectFeature }) => {
  const [gridColumns, setGridColumns] = useState<GridColumns>(3);
  const getIcon = (iconName: string) => {
    const icons: Record<string, React.ReactNode> = {
      BarChart3: <BarChart3 size={24} />,
      TestTube: <TestTube size={24} />,
      Zap: <Zap size={24} />,
      TrendingUp: <TrendingUp size={24} />,
      Code: <Code size={24} />,
      Wrench: <Wrench size={24} />,
      GitBranch: <GitBranch size={24} />,
      DollarSign: <DollarSign size={24} />,
      Trophy: <Trophy size={24} />,
      FileText: <FileText size={24} />
    };
    return icons[iconName] || <BarChart3 size={24} />;
  };

  const getCategoryColor = (category: string) => {
    return 'from-gray-700 to-gray-800 dark:from-slate-700 dark:to-slate-800';
  };

  const categories = [
    { id: 'testing', name: 'Testing & Quality', emoji: '🧪' },
    { id: 'performance', name: 'Performance & Speed', emoji: '⚡' },
    { id: 'productivity', name: 'Developer Productivity', emoji: '💻' },
    { id: 'business', name: 'Business Intelligence', emoji: '📊' }
  ];

  const getGridClass = (cols: GridColumns) => {
    const gridClasses = {
      1: 'grid-cols-1',
      2: 'grid-cols-1 md:grid-cols-2',
      3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
      4: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
      5: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'
    };
    return gridClasses[cols];
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 border-b dark:border-slate-800">
        <div className="px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics Dashboard</h1>
              <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Explore powerful analytics and intelligence tools</p>
            </div>
            
            {/* Grid Size Selector */}
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-slate-800 p-1 rounded-lg">
              <span className="text-xs font-medium text-gray-600 dark:text-slate-400 px-2">Grid:</span>
              {([1, 2, 3, 4, 5] as GridColumns[]).map((cols) => (
                <button
                  key={cols}
                  onClick={() => setGridColumns(cols)}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    gridColumns === cols
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-gray-600 dark:text-slate-400 hover:bg-gray-200 dark:hover:bg-slate-700'
                  }`}
                  title={`${cols} column${cols > 1 ? 's' : ''}`}
                >
                  {cols}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="px-4 sm:px-6 lg:px-8 py-8">
        <div className={`grid ${getGridClass(gridColumns)} gap-6`}>
          {advancedFeatures
            .filter(f => f.enabled)
            .map(feature => (
              <FeatureCard 
                key={feature.id} 
                feature={feature} 
                getIcon={getIcon}
                getCategoryColor={getCategoryColor}
                getCategoryName={(categoryId: string) => {
                  const cat = categories.find(c => c.id === categoryId);
                  return cat ? `${cat.emoji} ${cat.name}` : '';
                }}
                onSelect={() => onSelectFeature(feature.id)}
                gridSize={gridColumns}
              />
            ))}
        </div>
      </div>
    </div>
  );
};

interface FeatureCardProps {
  feature: FeatureModule;
  getIcon: (iconName: string) => React.ReactNode;
  getCategoryColor: (category: string) => string;
  getCategoryName: (categoryId: string) => string;
  onSelect: () => void;
  gridSize: GridColumns;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ feature, getIcon, getCategoryColor, getCategoryName, onSelect, gridSize }) => {
  // Adjust card layout based on grid size
  const isCompact = gridSize >= 4;
  const isVeryCompact = gridSize === 5;
  
  return (
    <button
      onClick={onSelect}
      className={`bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-gray-200 dark:border-slate-800 hover:shadow-lg hover:border-cyan-500 dark:hover:border-cyan-500 transition-all duration-200 text-left group relative ${
        isVeryCompact ? 'p-4' : 'p-6'
      }`}
    >
      {/* Category Badge */}
      <div className={`absolute top-3 right-3 ${isVeryCompact ? 'text-xs' : 'text-xs'} px-2 py-1 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-400 font-medium`}>
        {getCategoryName(feature.category)}
      </div>
      
      <div className={`${isVeryCompact ? 'w-10 h-10' : isCompact ? 'w-12 h-12' : 'w-14 h-14'} rounded-xl bg-gradient-to-br ${getCategoryColor(feature.category)} flex items-center justify-center text-white mb-3 group-hover:scale-110 transition-transform`}>
        <div className={isVeryCompact ? 'scale-75' : isCompact ? 'scale-90' : ''}>
          {getIcon(feature.icon)}
        </div>
      </div>
      
      <h3 className={`${isVeryCompact ? 'text-sm' : 'text-base'} font-semibold text-gray-900 dark:text-white mb-2 transition-colors line-clamp-2 pr-16`}>
        {feature.name}
      </h3>
      
      <p className={`${isVeryCompact ? 'text-xs' : 'text-sm'} text-gray-600 dark:text-slate-400 leading-relaxed ${isVeryCompact ? 'line-clamp-2' : 'line-clamp-3'}`}>
        {feature.description}
      </p>
      
      <div className={`${isVeryCompact ? 'mt-2' : 'mt-4'} flex items-center text-cyan-600 dark:text-cyan-400 ${isVeryCompact ? 'text-xs' : 'text-sm'} font-medium group-hover:translate-x-1 transition-transform`}>
        <span>Explore</span>
        <svg className={`${isVeryCompact ? 'w-3 h-3' : 'w-4 h-4'} ml-1`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
};

export default FeaturesMenu;
