import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkCheck, Check, ChevronDown, Loader2, Plus, Save, Share2, Trash2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import API_URL from '../config/api';
import { buttonClass, cx, inputClass } from './ui';

/**
 * Saved views quick switcher (GET/POST/PUT/DELETE /api/saved-views, server/routes/savedViews.ts).
 * Shown on the dashboard, every analytics module and the team comparison. A view stores the
 * page's choices (filters, scope, sort, grid density, compared teams); applying one hands that
 * state back to the page, which re-runs its normal, scope-checked requests.
 *
 * Your views can be overwritten with the current choices and deleted; administrators can share
 * their views with the company and stop sharing any shared view. Shared views of others are
 * read-only.
 */

export type SavedViewKind = 'dashboard' | 'analytics' | 'compare';

export interface SavedView {
  id: string;
  name: string;
  kind: SavedViewKind;
  module: string | null;
  state: Record<string, unknown>;
  shared: boolean;
  owner: { id: string; name: string };
  isOwner: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canUnshare: boolean;
}

/** Order-insensitive deep equality of two JSON states (which view is active). */
export function sameState(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameState(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a as object).filter((k) => (a as any)[k] !== undefined);
    const kb = Object.keys(b as object).filter((k) => (b as any)[k] !== undefined);
    return ka.length === kb.length && ka.every((k) => sameState((a as any)[k], (b as any)[k]));
  }
  return false;
}

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${API_URL}/saved-views${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
  return body;
}

export const SavedViewsMenu: React.FC<{
  kind: SavedViewKind;
  module?: string;
  /** The page's current choices (what "Save" stores). */
  state: Record<string, unknown>;
  onApply: (state: Record<string, unknown>, view: SavedView) => void;
  /** Saving disabled (e.g. a comparison with fewer than 2 teams), with the reason. */
  saveDisabledReason?: string | null;
  className?: string;
}> = ({ kind, module, state, onApply, saveDisabledReason, className }) => {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState<SavedView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const nameId = useId();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ kind, ...(module ? { module } : {}) });
      const body = await api(`?${q.toString()}`);
      setViews(body.views ?? []);
    } catch (e: any) {
      setViews([]);
      toast.error(e?.message || 'Could not load saved views');
    } finally {
      setLoading(false);
    }
  }, [kind, module]);

  useEffect(() => { load(); }, [load]);

  // Close on Escape and on a click outside.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => { if (!open) { setNaming(false); setName(''); } }, [open]);

  const active = useMemo(() => views?.find((v) => sameState(v.state, state)) ?? null, [views, state]);
  const mine = (views ?? []).filter((v) => v.isOwner);
  const shared = (views ?? []).filter((v) => !v.isOwner);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy('new');
    try {
      const body = await api('', { method: 'POST', body: JSON.stringify({ kind, module: module ?? null, name, state }) });
      toast.success(`Saved view "${body.view.name}"`);
      setNaming(false);
      setName('');
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not save the view');
    } finally {
      setBusy(null);
    }
  };

  const act = async (v: SavedView, what: 'update' | 'share' | 'unshare' | 'delete') => {
    if (what === 'delete' && !window.confirm(`Delete the view "${v.name}"${v.shared ? ' for everyone in the company' : ''}?`)) return;
    setBusy(v.id);
    try {
      if (what === 'update') await api(`/${encodeURIComponent(v.id)}`, { method: 'PUT', body: JSON.stringify({ state }) });
      if (what === 'share' || what === 'unshare') await api(`/${encodeURIComponent(v.id)}/share`, { method: 'POST', body: JSON.stringify({ shared: what === 'share' }) });
      if (what === 'delete') await api(`/${encodeURIComponent(v.id)}`, { method: 'DELETE' });
      toast.success({ update: `Updated "${v.name}"`, share: `Shared "${v.name}" with the company`, unshare: `Stopped sharing "${v.name}"`, delete: `Deleted "${v.name}"` }[what]);
      await load();
    } catch (err: any) {
      toast.error(err?.message || 'Could not change the view');
    } finally {
      setBusy(null);
    }
  };

  const iconBtn = 'inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded text-slate-500 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white';

  const row = (v: SavedView) => {
    const isActive = active?.id === v.id;
    return (
      <li key={v.id} className="group flex items-center gap-1 rounded-md px-1 hover:bg-slate-50 dark:hover:bg-slate-800/60" data-testid="saved-view-item">
        <button
          type="button"
          onClick={() => { onApply(v.state, v); setOpen(false); toast.success(`Opened view "${v.name}"`); }}
          className="flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200"
          aria-current={isActive ? 'true' : undefined}
          data-testid="saved-view-apply"
        >
          {isActive ? <Check size={14} className="flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden /> : <span className="w-[14px] flex-shrink-0" aria-hidden />}
          <span className="min-w-0 flex-1">
            <span className={cx('block truncate', isActive && 'font-medium text-slate-900 dark:text-white')}>{v.name}</span>
            {(!v.isOwner || v.shared) && (
              <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                {v.isOwner ? 'Shared with the company' : `Shared by ${v.owner.name}`}
              </span>
            )}
          </span>
        </button>
        {busy === v.id ? (
          <Loader2 size={14} className="mx-2 animate-spin text-slate-400" aria-label="Working" />
        ) : (
          <span className="flex items-center">
            {v.canEdit && (
              <button type="button" className={iconBtn} onClick={() => act(v, 'update')} disabled={!!saveDisabledReason || isActive}
                title={isActive ? 'Matches the current choices' : 'Replace with the current choices'} aria-label={`Update "${v.name}" with the current choices`}>
                <Save size={14} />
              </button>
            )}
            {v.canShare && (
              <button type="button" className={iconBtn} onClick={() => act(v, 'share')} title="Share with the company" aria-label={`Share "${v.name}" with the company`} data-testid="saved-view-share">
                <Share2 size={14} />
              </button>
            )}
            {v.canUnshare && (
              <button type="button" className={iconBtn} onClick={() => act(v, 'unshare')} title="Stop sharing" aria-label={`Stop sharing "${v.name}"`} data-testid="saved-view-unshare">
                <Users size={14} />
              </button>
            )}
            {v.canDelete && (
              <button type="button" className={cx(iconBtn, 'hover:text-red-700 dark:hover:text-red-400')} onClick={() => act(v, 'delete')} title="Delete" aria-label={`Delete "${v.name}"`} data-testid="saved-view-delete">
                <Trash2 size={14} />
              </button>
            )}
          </span>
        )}
      </li>
    );
  };

  return (
    <div ref={rootRef} className={cx('relative', className)} data-testid="saved-views">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cx(buttonClass.secondary, 'max-w-[16rem] whitespace-nowrap')}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        data-testid="saved-views-toggle"
      >
        {active ? <BookmarkCheck size={15} className="flex-shrink-0 text-brand-700 dark:text-brand-300" aria-hidden /> : <Bookmark size={15} className="flex-shrink-0" aria-hidden />}
        <span className="truncate">{active ? active.name : 'Views'}</span>
        <ChevronDown size={14} className="flex-shrink-0 text-slate-400" aria-hidden />
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Saved views"
          className="absolute left-0 z-30 mt-1.5 w-[min(22rem,calc(100vw-2rem))] sm:left-auto sm:right-0 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900"
          data-testid="saved-views-panel"
        >
          {loading && !views ? (
            <p className="flex items-center gap-2 px-2 py-3 text-sm text-slate-500 dark:text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading views…</p>
          ) : (
            <>
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Your views</p>
              {mine.length ? <ul className="space-y-0.5">{mine.map(row)}</ul> : <p className="px-2 pb-2 text-sm text-slate-500 dark:text-slate-400">No saved views yet.</p>}
              {shared.length > 0 && (
                <>
                  <p className="mt-2 border-t border-slate-100 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:border-slate-800 dark:text-slate-500">Shared with the company</p>
                  <ul className="space-y-0.5">{shared.map(row)}</ul>
                </>
              )}
              <div className="mt-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                {naming ? (
                  <form onSubmit={save} className="flex flex-col gap-2 px-1">
                    <label htmlFor={nameId} className="text-xs font-medium text-slate-500 dark:text-slate-400">Name of the view</label>
                    <div className="flex gap-2">
                      <input
                        id={nameId}
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={80}
                        autoFocus
                        placeholder="e.g. Payments teams needing attention"
                        className={cx(inputClass, 'min-w-0 flex-1')}
                        data-testid="saved-view-name"
                      />
                      <button type="submit" className={buttonClass.primary} disabled={!name.trim() || busy === 'new'} data-testid="saved-view-save">
                        {busy === 'new' ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNaming(true)}
                    disabled={!!saveDisabledReason}
                    title={saveDisabledReason ?? undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-300 dark:hover:bg-slate-800"
                    data-testid="saved-view-new"
                  >
                    <Plus size={15} aria-hidden /> Save current view…
                  </button>
                )}
                {saveDisabledReason && !naming && <p className="px-2 pt-1 text-xs text-slate-500 dark:text-slate-400">{saveDisabledReason}</p>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default SavedViewsMenu;
