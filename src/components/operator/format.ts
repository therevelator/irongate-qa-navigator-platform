/** Formatting helpers of the platform operator panel. */

export const fmtDate = (v: unknown) => (v ? new Date(String(v)).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
export const fmtDay = (v: unknown) => (v ? String(v).slice(0, 10) : '—');
export const fmtBytes = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, x = n;
  while (x >= 1024 && i < u.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
};

