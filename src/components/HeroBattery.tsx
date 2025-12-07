import React, { useState, useEffect, useMemo } from 'react';

interface HeroBatteryProps {
  percentage: number; // 0-100
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const HeroBattery: React.FC<HeroBatteryProps> = ({ 
  percentage, 
  size = 'lg',
  showLabel = true,
  className = ''
}) => {
  const [animatedCharge, setAnimatedCharge] = useState(12);

  // Clamp percentage between 12 and 89 (battery visual range)
  const targetCharge = useMemo(() => {
    const clamped = Math.max(0, Math.min(100, percentage));
    // Map 0-100 to 12-89 (the visual range of the battery)
    return Math.round(12 + (clamped / 100) * 77);
  }, [percentage]);

  // Animate the charge level
  useEffect(() => {
    const step = targetCharge > animatedCharge ? 1 : -1;
    if (animatedCharge !== targetCharge) {
      const timer = setTimeout(() => {
        setAnimatedCharge(prev => {
          const next = prev + step;
          if ((step > 0 && next >= targetCharge) || (step < 0 && next <= targetCharge)) {
            return targetCharge;
          }
          return next;
        });
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [animatedCharge, targetCharge]);

  // Get color based on percentage (not animated charge)
  const getColors = (pct: number) => {
    if (pct < 30) {
      // Red - Danger!
      return ["#750900", "#c6462b", "#b74424", "#df0a00", "#590700"];
    } else if (pct < 60) {
      // Yellow - Warning
      return ["#754f00", "#f2bb00", "#dbb300", "#df8f00", "#593c00"];
    } else {
      // Green - Good!
      return ["#316d08", "#60b939", "#51aa31", "#64ce11", "#255405"];
    }
  };

  const col = getColors(percentage);

  // Size configurations (vertical orientation - width/height swapped)
  const sizeConfig = {
    sm: { width: 50, height: 100, nibWidth: 24, nibHeight: 8, borderRadius: '12px 12px 6px 6px' },
    md: { width: 70, height: 140, nibWidth: 34, nibHeight: 10, borderRadius: '16px 16px 8px 8px' },
    lg: { width: 90, height: 180, nibWidth: 44, nibHeight: 12, borderRadius: '20px 20px 10px 10px' }
  };

  const config = sizeConfig[size];

  // Generate the battery gradient based on charge (vertical - bottom to top)
  const batteryGradient = `linear-gradient(to top, transparent 5%, ${col[0]} 5%, ${col[0]} 7%, ${col[1]} 8%, ${col[1]} 10%, ${col[2]} 11%, ${col[2]} ${animatedCharge - 3}%, ${col[3]} ${animatedCharge - 2}%, ${col[3]} ${animatedCharge}%, ${col[4]} ${animatedCharge}%, black ${animatedCharge + 5}%, black 95%, transparent 95%), linear-gradient(to right, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0.4) 4%, rgba(255,255,255,0.2) 7%, rgba(255,255,255,0.2) 14%, rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.2) 40%, rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%)`;

  const nibGradient = `linear-gradient(to right, rgba(255,255,255,0.5) 0%, rgba(255,255,255,0) 14%, rgba(255,255,255,0.8) 14%, rgba(255,255,255,0.3) 40%, rgba(255,255,255,0) 41%, rgba(255,255,255,0) 80%, rgba(255,255,255,0.2) 80%, rgba(255,255,255,0.4) 86%, rgba(255,255,255,0.6) 90%, rgba(255,255,255,0.1) 92%, rgba(255,255,255,0.1) 95%, rgba(255,255,255,0.5) 98%)`;

  const overlayGradient = `linear-gradient(to right, rgba(255,255,255,0.3) 4%, rgba(255,255,255,0.2) 5%, transparent 5%, transparent 14%, rgba(255,255,255,0.3) 14%, rgba(255,255,255,0.12) 40%, rgba(0,0,0,0.05) 42%, rgba(0,0,0,0.05) 48%, transparent 60%, transparent 80%, rgba(255,255,255,0.3) 87%, rgba(255,255,255,0.3) 92%, transparent 92%, transparent 97%, rgba(255,255,255,0.4) 97%)`;

  return (
    <div className={`relative flex flex-col items-center ${className}`}>
      {/* Positive nib (top) */}
      <div
        style={{
          width: config.nibWidth,
          height: config.nibHeight,
          borderTopLeftRadius: `${config.nibHeight * 0.6}px`,
          borderTopRightRadius: `${config.nibHeight * 0.6}px`,
          backgroundImage: nibGradient,
          marginBottom: -2,
        }}
      />
      
      {/* Main battery body */}
      <div
        style={{
          position: 'relative',
          width: config.width,
          height: config.height,
          borderRadius: config.borderRadius,
          borderTop: '2px solid rgba(255,255,255,0.2)',
          borderBottom: '2px solid rgba(255,255,255,0.2)',
          backgroundImage: batteryGradient,
        }}
      >
        {/* Glass overlay effect */}
        <div
          style={{
            position: 'absolute',
            width: config.width,
            height: config.height - 20,
            top: 10,
            left: 0,
            borderRadius: `${parseInt(config.borderRadius) / 2}px`,
            borderTop: '4px solid black',
            borderBottom: '4px solid black',
            backgroundImage: overlayGradient,
            pointerEvents: 'none',
          }}
        />

        {/* Percentage label inside battery */}
        {showLabel && (
          <div 
            className="absolute inset-0 flex items-center justify-center"
            style={{ zIndex: 10 }}
          >
            <span 
              className="font-bold text-white drop-shadow-lg"
              style={{ 
                fontSize: size === 'lg' ? '2rem' : size === 'md' ? '1.5rem' : '1rem',
                textShadow: '0 2px 4px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.5)'
              }}
            >
              {Math.round(percentage)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default HeroBattery;
