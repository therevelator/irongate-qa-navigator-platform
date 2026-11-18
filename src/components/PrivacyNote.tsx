import React from 'react';
import { EyeOff } from 'lucide-react';
import { cx } from './ui';
import { K_ANONYMITY_RULE, SUPPRESSED_TEXT } from '../../server/lib/privacy';

/** Privacy info of an aggregate, as the API returns it (server/lib/privacy.ts PrivacyInfo). */
export interface PrivacyInfo {
  suppressed: boolean;
  contributors: number | null;
  reason: string | null;
  minContributors: number;
}

/**
 * "Not shown: fewer than 3 contributors" for an aggregate the API withheld (k-anonymity).
 * The number of contributors is never shown when suppressed.
 */
export const SuppressedNote: React.FC<{ className?: string; text?: string | null; testId?: string }> = ({ className, text, testId = 'privacy-suppressed' }) => (
  <span
    className={cx('inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400', className)}
    title={K_ANONYMITY_RULE}
    data-testid={testId}
  >
    <EyeOff size={12} aria-hidden className="shrink-0" />
    {text || SUPPRESSED_TEXT}
  </span>
);

export { K_ANONYMITY_RULE, SUPPRESSED_TEXT };
