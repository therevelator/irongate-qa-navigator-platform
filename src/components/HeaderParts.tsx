import React, { useEffect, useId, useRef, useState } from 'react';
import { HelpCircle, LogOut, MonitorSmartphone, X, Check, Minus, Palette, BatteryMedium, Gauge } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { SCORE_DISPLAY_OPTIONS, THEME_OPTIONS, type ThemePreference } from '../lib/appearance';

import type { AccessSummary } from '../lib/accessSummary';

/** Initials of a name ("Meridian Financial Technologies" -> "MF", "NovaTech" -> "NT", "Acme" -> "A"). */
export const initialsOf = (name: string | null | undefined, max = 2): string => {
  const words = (name ?? '').split(/\s+/).filter((w) => /^[A-Za-z0-9]/.test(w));
  if (words.length === 1) {
    const caps = words[0].match(/[A-Z0-9]/g) ?? [];
    return (caps.length >= 2 ? caps.slice(0, max).join('') : words[0][0].toUpperCase());
  }
  return words.slice(0, max).map((w) => w[0]!.toUpperCase()).join('') || '?';
};

/** Closes a popover on Escape (focus back to its button) and on a click outside it. */
function useDismiss(open: boolean, close: () => void, refs: Array<React.RefObject<HTMLElement | null>>, buttonRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); buttonRef.current?.focus(); }
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (refs.some((r) => r.current?.contains(t))) return;
      close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [open, close]);
}

const iconButton =
  'h-9 w-9 flex flex-shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-800 ' +
  'dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';

/**
 * "What you can do here": the signed-in person's roles, scope and permissions in plain English
 * (src/lib/accessSummary.ts, generated from server/lib/userPolicy.ts). A non-modal dialog: focus
 * moves into it, Escape or a click outside closes it and focus returns to the button.
 */
export const AccessHelp: React.FC<{ summary: AccessSummary }> = ({ summary }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, close, [panelRef, buttonRef], buttonRef);
  useEffect(() => { if (open) requestAnimationFrame(() => panelRef.current?.focus()); }, [open]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        className={iconButton}
        aria-label="What you can do here"
        title="What you can do here"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="access-help-button"
      >
        <HelpCircle size={16} aria-hidden />
      </button>
      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          tabIndex={-1}
          className="fixed inset-x-3 top-16 z-50 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl outline-none dark:border-slate-700 dark:bg-slate-900 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[26rem]"
          data-testid="access-help"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold text-slate-900 dark:text-white">What you can do here</h2>
            <button type="button" onClick={() => { close(); buttonRef.current?.focus(); }} className="-mr-1 -mt-1 rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:hover:bg-slate-800 dark:hover:text-white" aria-label="Close">
              <X size={16} aria-hidden />
            </button>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Your roles" data-testid="access-help-roles">
            {summary.roles.map((r) => (
              <li key={r} className="rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800 dark:bg-slate-800 dark:text-brand-200">{r}</li>
            ))}
          </ul>
          <p className="mt-3 text-slate-700 dark:text-slate-300" data-testid="access-help-scope">{summary.scope}</p>
          {summary.can.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">You can</h3>
              <ul className="mt-1.5 space-y-1.5" data-testid="access-help-can">
                {summary.can.map((t) => (
                  <li key={t} className="flex gap-2 text-slate-700 dark:text-slate-300"><Check size={15} className="mt-0.5 flex-shrink-0 text-green-700 dark:text-green-400" aria-hidden />{t}</li>
                ))}
              </ul>
            </>
          )}
          {summary.cannot.length > 0 && (
            <>
              <h3 className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">You cannot</h3>
              <ul className="mt-1.5 space-y-1.5" data-testid="access-help-cannot">
                {summary.cannot.map((t) => (
                  <li key={t} className="flex gap-2 text-slate-600 dark:text-slate-400"><Minus size={15} className="mt-0.5 flex-shrink-0 text-slate-400" aria-hidden />{t}</li>
                ))}
              </ul>
            </>
          )}
          <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
            Your access comes from your role assignments. An administrator of your organisation can change them.
          </p>
        </div>
      )}
    </div>
  );
};

/** The person's avatar with a menu: name and title (always, so phones see them too), sign-out actions. */
export const AccountMenu: React.FC<{
  name: string;
  title: string;
  companyName?: string | null;
  onSignOutOthers: () => void;
  onSignOut: () => void;
}> = ({ name, title, companyName, onSignOutOthers, onSignOut }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, close, [menuRef, buttonRef], buttonRef);
  useEffect(() => { if (open) requestAnimationFrame(() => menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()); }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
  };
  const item = 'flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800';
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}, ${title}`}
        title={`${name} · ${title}`}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700 hover:ring-2 hover:ring-slate-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:bg-slate-800 dark:text-slate-200 dark:hover:ring-slate-600"
        data-testid="account-menu-button"
      >
        {initialsOf(name)}
      </button>
      {open && (
        <div ref={menuRef} role="menu" aria-label="Account" onKeyDown={onMenuKey} className="absolute right-0 top-11 z-50 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900" data-testid="account-menu">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{name}</p>
            <p className="truncate text-xs text-slate-500 dark:text-slate-400" data-testid="account-menu-title">{title}</p>
            {companyName && <p className="truncate text-xs text-slate-500 dark:text-slate-400">{companyName}</p>}
          </div>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <button type="button" role="menuitem" className={item} onClick={() => { close(); onSignOutOthers(); }} data-testid="account-sign-out-others">
            <MonitorSmartphone size={15} aria-hidden /> Sign out my other devices
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => { close(); onSignOut(); }} data-testid="account-sign-out">
            <LogOut size={15} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
};

/** The signed-in company as a rounded badge: initials avatar and name (initials only on phones). */
export const CompanyBadge: React.FC<{ name: string }> = ({ name }) => (
  <span
    className="inline-flex min-w-0 max-w-[16rem] xl:max-w-[22rem] items-center gap-2 rounded-full border border-slate-200 bg-slate-50 py-1 pl-1 pr-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200 md:pr-3"
    title={name}
    data-testid="company-badge"
  >
    <span className="ig-company-avatar flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-brand-700 text-[11px] font-semibold text-white dark:bg-brand-600" aria-hidden>
      {initialsOf(name)}
    </span>
    <span className="hidden truncate font-medium md:inline">{name}</span>
    <span className="sr-only md:hidden">{name}</span>
  </span>
);


/** Little preview of each theme in the Appearance menu (decorative). */
const THEME_SWATCH: Record<ThemePreference, string> = {
  light: 'linear-gradient(135deg, #ffffff 0 50%, #e2e8f0 50%)',
  dark: 'linear-gradient(135deg, #1e293b 0 50%, #0f172a 50%)',
  graphite: 'linear-gradient(135deg, #4a4d54 0%, #22242a 55%, #141518 100%)',
  porcelain: 'linear-gradient(135deg, #ffffff 0%, #f4ece2 55%, #e9e2ef 100%)',
  system: 'linear-gradient(135deg, #ffffff 0 50%, #0f172a 50%)',
};

/**
 * "Appearance" in the top bar: the colour theme (Light, Dark, Graphite, Porcelain, Match system)
 * and the score display (Battery or Gauge). A menu of two radio groups: arrow keys move, Home/End
 * jump, Enter/Space choose (the menu stays open to compare), Escape or Tab closes it and focus
 * returns to the button. The choice is kept in this browser (src/contexts/ThemeContext.tsx).
 */
export const AppearanceMenu: React.FC = () => {
  const { preference, setTheme, scoreDisplay, setScoreDisplay } = useTheme();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  useDismiss(open, close, [menuRef, buttonRef], buttonRef);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => (menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus());
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Tab') { close(); return; }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  };
  const item = 'flex w-full items-center gap-2.5 rounded px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100 focus:bg-slate-100 focus:outline-none dark:text-slate-200 dark:hover:bg-slate-800 dark:focus:bg-slate-800';
  const groupLabel = 'px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400';
  return (
    <div className="relative flex min-w-0">
      <button
        ref={buttonRef}
        type="button"
        // Like the old theme switch, this button may give up a few pixels on narrow phones.
        className={iconButton.replace('flex-shrink-0 ', '')}
        aria-label="Appearance"
        title="Appearance"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'appearance-menu' : undefined}
        onClick={() => setOpen((o) => !o)}
        data-testid="appearance-button"
      >
        <Palette size={16} aria-hidden />
      </button>
      {open && (
        <div
          ref={menuRef}
          id="appearance-menu"
          role="menu"
          aria-label="Appearance"
          onKeyDown={onMenuKey}
          className="absolute right-0 top-11 z-50 w-64 rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          data-testid="appearance-menu"
        >
          <div role="group" aria-labelledby="appearance-theme-label">
            <p id="appearance-theme-label" className={groupLabel}>Theme</p>
            {THEME_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={preference === o.id}
                className={item}
                onClick={() => setTheme(o.id)}
                data-testid={`theme-option-${o.id}`}
              >
                <span className="h-4 w-4 flex-shrink-0 rounded-full border border-slate-300 dark:border-slate-600" style={{ background: THEME_SWATCH[o.id] }} aria-hidden />
                <span className="flex-1">
                  {o.label}
                  <span className="block text-[11px] leading-tight text-slate-500 dark:text-slate-400">{o.hint}</span>
                </span>
                {preference === o.id && <Check size={15} className="flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden />}
              </button>
            ))}
          </div>
          <div className="my-1 h-px bg-slate-100 dark:bg-slate-800" />
          <div role="group" aria-labelledby="appearance-score-label">
            <p id="appearance-score-label" className={groupLabel}>Score display</p>
            {SCORE_DISPLAY_OPTIONS.map((o) => (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={scoreDisplay === o.id}
                className={item}
                onClick={() => setScoreDisplay(o.id)}
                data-testid={`score-display-option-${o.id}`}
              >
                {o.id === 'battery' ? <BatteryMedium size={16} className="flex-shrink-0 -rotate-90 text-slate-500 dark:text-slate-400" aria-hidden /> : <Gauge size={16} className="flex-shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />}
                <span className="flex-1">{o.label}</span>
                {scoreDisplay === o.id && <Check size={15} className="flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
