import React, { useEffect, useState } from 'react';

interface BatteryIndicatorProps {
  percentage: number;
  size?: 'sm' | 'md' | 'lg';
  mode?: 'flat' | '3d';
  className?: string;
  animationDelay?: number; // Delay before animation starts (ms)
}

const BatteryIndicator: React.FC<BatteryIndicatorProps> = ({
  percentage,
  size = 'md',
  mode = 'flat',
  className = '',
  animationDelay = 0
}) => {
  const [displayPercentage, setDisplayPercentage] = useState(0);
  const [animate, setAnimate] = useState(false);

  useEffect(() => {
    // Trigger initial charge animation
    const timer = setTimeout(() => {
      setAnimate(true);
      setTimeout(() => setAnimate(false), 600);
    }, animationDelay);

    return () => clearTimeout(timer);
  }, [animationDelay]);

  useEffect(() => {
    // Progressive loading animation from 0 to target percentage
    const duration = 1200; // 1.2 seconds total animation
    const steps = 60; // 60 fps for smooth animation
    const increment = percentage / steps;
    const stepDuration = duration / steps;

    const timer = setTimeout(() => {
      let currentStep = 0;
      const interval = setInterval(() => {
        currentStep++;
        const newPercentage = Math.min(percentage, increment * currentStep);
        setDisplayPercentage(Math.round(newPercentage));

        if (currentStep >= steps) {
          clearInterval(interval);
          setDisplayPercentage(percentage); // Ensure exact final value
        }
      }, stepDuration);

      return () => clearInterval(interval);
    }, animationDelay + 300); // Start after initial charge animation

    return () => clearTimeout(timer);
  }, [percentage, animationDelay]);

  const sizeClasses = {
    sm: { width: 'w-20', height: 'h-7', text: 'text-xs' },
    md: { width: 'w-28', height: 'h-10', text: 'text-sm' },
    lg: { width: 'w-32', height: 'h-12', text: 'text-base' }
  };

  const sizeConfig = sizeClasses[size];

  // Determine battery color based on current display percentage
  const getBatteryColors = (pct: number) => {
    const isDark = document.documentElement.classList.contains('dark');

    if (pct >= 80) {
      return isDark
        ? { fill: '#10b981', dark: '#34d399' } // green
        : { fill: '#22c55e', dark: '#4ade80' }; // brighter green
    }
    if (pct >= 60) {
      return isDark
        ? { fill: '#eab308', dark: '#facc15' } // yellow
        : { fill: '#facc15', dark: '#fde047' }; // brighter yellow
    }
    if (pct >= 40) {
      return isDark
        ? { fill: '#f97316', dark: '#fb923c' } // orange
        : { fill: '#fb923c', dark: '#fdba74' }; // brighter orange
    }
    return isDark
      ? { fill: '#ef4444', dark: '#f87171' } // red
      : { fill: '#f87171', dark: '#fca5a5' }; // brighter red
  };

  const colors = getBatteryColors(displayPercentage);
  const fillWidth = Math.max(5, Math.min(85, displayPercentage)); // Clamp between 5% and 85%

  if (mode === '3d') {
    // 3D Battery with gradients and effects
    return (
      <div className={`relative ${sizeConfig.width} ${sizeConfig.height} ${animate ? 'animate-battery-charge' : ''} ${className}`}>
        <div
          className="absolute inset-0 rounded border-2 border-gray-300 dark:border-slate-600 bg-gradient-to-r from-gray-200 to-gray-100 dark:from-slate-700 dark:to-slate-600"
          style={{
            borderRadius: '4px 6px 6px 4px',
            backgroundImage: `
              linear-gradient(to right, transparent 5%, ${colors.fill} 5%, ${colors.fill} 7%, ${colors.fill} 8%, ${colors.fill} 10%, ${colors.fill} 11%, ${colors.fill} ${fillWidth}%, ${colors.dark} ${fillWidth + 1}%, ${colors.dark} ${fillWidth + 3}%, ${colors.fill} ${fillWidth + 3}%, black ${fillWidth + 8}%, black 95%, transparent 95%),
              linear-gradient(to bottom, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.4) 4%, rgba(255,255,255,0.2) 7%, rgba(255,255,255,0.2) 14%, rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.2) 40%, rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%)
            `
          }}
        >
          {/* Battery nib */}
          <div
            className="absolute right-0 top-1/2 transform -translate-y-1/2 w-1 h-3 rounded-r bg-gray-300 dark:bg-slate-600"
            style={{
              backgroundImage: '-webkit-linear-gradient(rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 14%, rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.3) 40%, rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%)'
            }}
          />
          {/* Inner shadow/highlight */}
          <div
            className="absolute inset-1 rounded"
            style={{
              backgroundImage: `
                -webkit-linear-gradient(rgba(255,255,255,0.3) 4%, rgba(255,255,255,0.2) 5%, transparent 5%, transparent 14%, rgba(255,255,255,0.3) 14%, rgba(255,255,255,0.12) 40%, rgba(0,0,0,0.05) 42%, rgba(0,0,0,0.05) 48%, transparent 60%, transparent 80%, rgba(255,255,255,0.3) 87%, rgba(255,255,255,0.3) 92%, transparent 92%, transparent 97%, rgba(255,255,255,0.4) 97%),
                linear-gradient(to left, rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.2) 2%, black 2%, black 6%, transparent 6%),
                linear-gradient(rgba(255,255,255,0) 0%, rgba(255,255,255,0) 35%, rgba(255,255,255,0.3) 90%, rgba(255,255,255,0) 90%)
              `,
              borderRadius: '2px 4px 4px 2px'
            }}
          />
        </div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`font-bold text-gray-900 dark:text-white ${sizeConfig.text}`}>
            {displayPercentage}
          </span>
        </div>
      </div>
    );
  }

  // Flat Battery
  return (
    <div className={`relative ${sizeConfig.width} ${sizeConfig.height} ${animate ? 'animate-battery-charge' : ''} ${className}`}>
      <div className="absolute inset-0 bg-gray-200 dark:bg-slate-700 rounded border border-gray-300 dark:border-slate-600 flex items-center">
        {/* Battery fill */}
        <div
          className="h-full rounded-l transition-all duration-1000"
          style={{
            width: `${fillWidth}%`,
            backgroundColor: colors.fill
          }}
        />
        {/* Battery nib */}
        <div className="w-1 h-2 bg-gray-300 dark:bg-slate-600 rounded-r ml-0.5" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`font-bold text-gray-900 dark:text-white ${sizeConfig.text}`}>
          {displayPercentage}
        </span>
      </div>
    </div>
  );
};

export default BatteryIndicator;
