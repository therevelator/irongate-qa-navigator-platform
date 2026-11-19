import React from 'react';
import HeroBattery, { type HeroBatteryProps } from './HeroBattery';
import ScoreGauge from './ScoreGauge';
import { useTheme } from '../contexts/ThemeContext';
import type { ScoreDisplay } from '../lib/appearance';

/**
 * A 0–100 score drawn the way the person chose in the Appearance menu: the 3D battery
 * (HeroBattery) or the radial gauge (ScoreGauge). Same props and the same accessible text
 * ("<label>: 81 of 100" / "no data") either way. `variant` forces one (previews, tests).
 */
const ScoreVisual: React.FC<HeroBatteryProps & { variant?: ScoreDisplay }> = ({ variant, orientation, liquid, ...rest }) => {
  const { scoreDisplay } = useTheme();
  const v = variant ?? scoreDisplay;
  if (v === 'gauge') return <ScoreGauge {...rest} />;
  return <HeroBattery {...rest} orientation={orientation} liquid={liquid} />;
};

export default ScoreVisual;
