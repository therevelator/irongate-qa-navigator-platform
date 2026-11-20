import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'prose' | 'lg' | 'xl';
  /** Small line under the title. */
  subtitle?: React.ReactNode;
  /** Content shown next to the title (e.g. a badge). */
  titleAside?: React.ReactNode;
  /** Keep the header fixed and scroll the body inside a viewport-high dialog. */
  scrollBody?: boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: role="dialog", aria-modal, labelled by its title, closes on Esc
 * and on a backdrop click, keeps Tab focus inside, and returns focus to the element that
 * opened it.
 */
const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size = 'md', subtitle, titleAside, scrollBody }) => {
  const titleId = useId();
  const subtitleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const dialog = dialogRef.current;
    // Focus the first control in the body, else the dialog itself (close button last resort).
    const first = dialog?.querySelector<HTMLElement>('[data-autofocus]') ?? dialog;
    first?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !dialog) return;
      const items = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || active === dialog)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && active === lastItem) {
        e.preventDefault();
        firstItem.focus();
      } else if (!dialog.contains(active)) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = previousOverflow === 'hidden' ? '' : previousOverflow;
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-2xl',
    prose: 'max-w-[640px]',
    lg: 'max-w-4xl',
    xl: 'max-w-6xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-slate-900/50 transition-opacity dark:bg-black/60" onClick={onClose} aria-hidden="true" />

      <div className="flex min-h-full items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          tabIndex={-1}
          // The dialog itself only takes focus as a fallback; no ring around the whole panel.
          style={{ outline: 'none' }}
          className={`relative w-full ${sizeClasses[size]} rounded-lg border border-slate-200 bg-white shadow-xl outline-none dark:border-slate-700 dark:bg-slate-900 ${scrollBody ? 'flex max-h-[min(85vh,820px)] flex-col' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className={`flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-700 ${scrollBody ? 'shrink-0 px-5 py-4' : 'px-6 py-4'}`}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id={titleId} className={scrollBody ? 'text-base font-semibold text-slate-900 dark:text-white' : 'text-xl font-semibold text-slate-900 dark:text-white'}>
                  {title}
                </h2>
                {titleAside}
              </div>
              {subtitle && <p id={subtitleId} className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200 transition-colors"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {/* Content */}
          {/* A scrolling body is focusable, so it can be scrolled with the keyboard (WCAG 2.1.1). */}
          <div className={scrollBody ? 'min-h-0 flex-1 overflow-y-auto px-5 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500' : 'px-6 py-4'} {...(scrollBody ? { tabIndex: 0, role: 'region', 'aria-label': typeof title === 'string' ? title : 'Dialog content' } : {})}>{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
