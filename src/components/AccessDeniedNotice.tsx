import React, { useEffect, useRef } from 'react';
import { Lock, X } from 'lucide-react';

/**
 * Shown on the overview after the app was sent to a page this role may not open (a typed address,
 * an old link, or rights that changed while the page was open). One consistent message for every
 * guarded page (src/App.tsx hasPermission); it takes the focus so screen readers announce it.
 */
const AccessDeniedNotice: React.FC<{ page: string; onDismiss: () => void }> = ({ page, onDismiss }) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, [page]);
  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-8 pt-6 sm:pt-8 -mb-2 sm:-mb-4">
      <div
        ref={ref} tabIndex={-1} role="alert" data-testid="access-denied"
        className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
      >
        <Lock size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">
          <span className="font-medium">You don&apos;t have access to {page}.</span>{' '}
          Your role cannot open that page, so the overview is shown instead. Ask an administrator if you need it.
        </p>
        <button
          type="button" onClick={onDismiss} aria-label="Dismiss"
          className="-m-1 rounded p-1 text-amber-800 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default AccessDeniedNotice;
