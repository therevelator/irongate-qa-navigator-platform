/**
 * Charge of the Cell battery (src/components/CellBattery.tsx), in % of the body's inside length:
 * 0–100 maps to the usable inside of the glass, from the end of the edge shading (11 %) to the dark
 * band before the nib (90 %), as in the reference design.
 */
export const CELL_CHARGE_EMPTY = 11;
export const CELL_CHARGE_FULL = 90;

export function cellCharge(value: number): number {
  const v = Math.max(0, Math.min(100, value));
  return CELL_CHARGE_EMPTY + (v / 100) * (CELL_CHARGE_FULL - CELL_CHARGE_EMPTY);
}
