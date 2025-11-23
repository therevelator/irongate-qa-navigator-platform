import React from 'react';
import { ArrowLeft, BarChart3, TestTube, Zap, TrendingUp, Code, Wrench, GitBranch, DollarSign, Trophy, FileText } from 'lucide-react';
import { advancedFeatures } from '../data/features';
import type { FeatureModule } from '../data/features';

interface FeaturesMenuProps {
  onBack: () => void;
  onSelectFeature: (featureId: string) => void;
}

const FeaturesMenu: React.FC<FeaturesMenuProps> = ({ onBack, onSelectFeature }) => {
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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900">
      {/* Header */}
      <div className="bg-white dark:bg-slate-800 border-b dark:border-slate-700">
        <div className="px-8 py-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Explore powerful analytics and intelligence tools</p>
        </div>
      </div>

      {/* Features Grid */}
      <div className="px-8 py-8">
        {categories.map(category => {
          const categoryFeatures = advancedFeatures.filter(f => f.category === category.id && f.enabled);
          
          if (categoryFeatures.length === 0) return null;
          
          return (
            <div key={category.id} className="mb-12">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex items-center">
                <span className="text-2xl mr-2">{category.emoji}</span>
                {category.name}
              </h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categoryFeatures.map(feature => (
                  <FeatureCard 
                    key={feature.id} 
                    feature={feature} 
                    getIcon={getIcon}
                    getCategoryColor={getCategoryColor}
                    onSelect={() => onSelectFeature(feature.id)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface FeatureCardProps {
  feature: FeatureModule;
  getIcon: (iconName: string) => React.ReactNode;
  getCategoryColor: (category: string) => string;
  onSelect: () => void;
}

const FeatureCard: React.FC<FeatureCardProps> = ({ feature, getIcon, getCategoryColor, onSelect }) => {
  return (
    <button
      onClick={onSelect}
      className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 hover:shadow-lg transition-all duration-200 text-left group"
    >
      <div className={`w-14 h-14 rounded-xl bg-gradient-to-br ${getCategoryColor(feature.category)} flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform`}>
        {getIcon(feature.icon)}
      </div>
      
      <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2 transition-colors">
        {feature.name}
      </h3>
      
      <p className="text-sm text-gray-600 dark:text-slate-400 leading-relaxed">
        {feature.description}
      </p>
      
      <div className="mt-4 flex items-center text-gray-600 dark:text-slate-400 text-sm font-medium group-hover:translate-x-1 transition-transform">
        <span>Explore</span>
        <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </button>
  );
};

export default FeaturesMenu;
