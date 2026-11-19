import React from 'react';
import { formatAsOf } from '../data/advancedFeatures';

/**
 * "Last updated <date>": shown when a team's (or the company's) newest data is over a day old.
 * The screens then show the latest values as they stood at that time (server/lib/kpiEvaluation.ts
 * latestReference) instead of leaving them out as stale. Renders nothing when the data is current.
 */
export const LastUpdatedNote: React.FC<{ at: string | null | undefined; outdated: boolean | null | undefined; className?: string }> = ({ at, outdated, className }) => {
  const date = outdated ? formatAsOf(at) : null;
  if (!date) return null;
  return (
    <span
      data-testid="last-updated"
      className={className ?? 'text-amber-700 dark:text-amber-400'}
      title="No new data for over a day: the latest values are shown as they stood then."
    >
      Last updated {date}
    </span>
  );
};

export default LastUpdatedNote;
