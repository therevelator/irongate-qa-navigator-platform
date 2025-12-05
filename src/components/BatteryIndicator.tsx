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
    // Slightly thicker stroke for a bolder QA score ring
    sm: { width: 'w-16', height: 'h-16', text: 'text-xs', stroke: '6' },
    md: { width: 'w-20', height: 'h-20', text: 'text-sm', stroke: '8' },
    lg: { width: 'w-24', height: 'h-24', text: 'text-base', stroke: '10' }
  };

  const sizeConfig = sizeClasses[size];

  // Determine circle color based on current display percentage
  const getCircleColors = (pct: number) => {
    const isDark = document.documentElement.classList.contains('dark');

    if (pct >= 80) {
      return isDark
        ? { fill: '#10b981', stroke: '#34d399', glow: '#10b981' } // green
        : { fill: '#22c55e', stroke: '#4ade80', glow: '#22c55e' }; // brighter green
    }
    if (pct >= 60) {
      return isDark
        ? { fill: '#eab308', stroke: '#facc15', glow: '#eab308' } // yellow
        : { fill: '#facc15', stroke: '#fde047', glow: '#facc15' }; // brighter yellow
    }
    if (pct >= 40) {
      return isDark
        ? { fill: '#f97316', stroke: '#fb923c', glow: '#f97316' } // orange
        : { fill: '#fb923c', stroke: '#fdba74', glow: '#fb923c' }; // brighter orange
    }
    return isDark
      ? { fill: '#ef4444', stroke: '#f87171', glow: '#ef4444' } // red
      : { fill: '#f87171', stroke: '#fca5a5', glow: '#f87171' }; // brighter red
  };

  const colors = getCircleColors(displayPercentage);
  const radius = 40; // SVG coordinate radius
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (displayPercentage / 100) * circumference;

  if (mode === '3d') {
    // 3D Circular Progress with gradients and depth effects
    return (
      <div className={`relative ${sizeConfig.width} ${sizeConfig.height} ${animate ? 'animate-pulse' : ''} ${className}`}>
        {/* Outer shadow ring */}
        <div className="absolute inset-0 rounded-full bg-gray-300 dark:bg-slate-600 opacity-20 blur-sm"></div>

        {/* Main circle with 3D depth */}
        <svg
          className="w-full h-full transform -rotate-90"
          viewBox="0 0 100 100"
        >
          {/* Background circle with 3D depth */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke="#e5e7eb"
            strokeWidth={sizeConfig.stroke}
            fill="none"
            className="dark:stroke-slate-700"
            style={{
              filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.1))'
            }}
          />

          {/* Progress circle with 3D gradient */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            stroke={colors.stroke}
            strokeWidth={sizeConfig.stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className="transition-all duration-1000 ease-out"
            style={{
              filter: `drop-shadow(0 0 8px ${colors.glow}40)`,
              background: `conic-gradient(from 0deg, ${colors.fill} 0%, ${colors.stroke} 100%)`,
              WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 6px), black calc(100% - 6px))',
              mask: 'radial-gradient(farthest-side, transparent calc(100% - 6px), black calc(100% - 6px))'
            }}
          />

          {/* Inner highlight for 3D effect */}
          <circle
            cx="50"
            cy="50"
            r={radius - 3}
            fill="none"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="2"
            strokeDasharray={`${circumference * 0.7} ${circumference * 0.3}`}
            strokeDashoffset={circumference * 0.2}
          />

          {/* Outer rim highlight */}
          <circle
            cx="50"
            cy="50"
            r={radius + 1}
            fill="none"
            stroke="rgba(255,255,255,0.4)"
            strokeWidth="1"
            className="dark:stroke-slate-300"
          />
        </svg>

        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`font-bold text-gray-900 dark:text-white ${sizeConfig.text}`}>
            {displayPercentage}%
          </span>
        </div>
      </div>
    );
  }

  // Flat Circular Progress
  return (
    <div className={`relative ${sizeConfig.width} ${sizeConfig.height} ${animate ? 'animate-pulse' : ''} ${className}`}>
      <svg
        className="w-full h-full transform -rotate-90"
        viewBox="0 0 100 100"
      >
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke="#e5e7eb"
          strokeWidth={sizeConfig.stroke}
          fill="none"
          className="dark:stroke-slate-700"
        />

        {/* Progress circle */}
        <circle
          cx="50"
          cy="50"
          r={radius}
          stroke={colors.fill}
          strokeWidth={sizeConfig.stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-all duration-1000 ease-out"
          style={{
            filter: `drop-shadow(0 0 4px ${colors.glow}30)`
          }}
        />
      </svg>

      {/* Center content */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-bold text-gray-900 dark:text-white ${sizeConfig.text}`}>
          {displayPercentage}%
        </span>
      </div>
    </div>
  );
};

export default BatteryIndicator;
