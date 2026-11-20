import React from 'react';
import HeroBattery, { type HeroBatteryProps } from './HeroBattery';
import ScoreGauge from './ScoreGauge';
import CellBattery from './CellBattery';
import { useTheme } from '../contexts/ThemeContext';
import type { BatteryStyle, ScoreDisplay } from '../lib/appearance';

/**
 * A 0–100 score drawn the way the person chose in the Appearance menu: a battery, in its chosen
 * style (Cell: CellBattery, the default; Liquid: the original HeroBattery), or the radial gauge
 * (ScoreGauge); each in 3D or flat 2D. Same props and the same accessible text
 * ("<label>: 81 of 100" / "no data") either way. `variant` / `batteryStyle` force one (previews, tests).
 */
const ScoreVisual: React.FC<HeroBatteryProps & { variant?: ScoreDisplay; batteryStyle?: BatteryStyle }> = ({ variant, batteryStyle: forcedStyle, orientation, liquid, ...rest }) => {
  const { scoreDisplay, batteryStyle } = useTheme();
  const v = variant ?? scoreDisplay;
  if (v === 'gauge') return <ScoreGauge {...rest} />;
  if ((forcedStyle ?? batteryStyle) === 'cell') return <CellBattery {...rest} orientation={orientation} />;
  return <HeroBattery {...rest} orientation={orientation} liquid={liquid} />;
};

export default ScoreVisual;
