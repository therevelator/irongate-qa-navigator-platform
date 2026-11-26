import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Archive, Check, Edit2, Minus, Plus, RotateCcw, ShieldCheck, Sparkles } from 'lucide-react';
import API_URL from '../config/api';
import Modal from './Modal';
import { Badge, Card, EmptyState, Page, PageIntro, buttonClass, cx, inputClass } from './ui';
import { loadErrorMessage, NETWORK_ERROR } from '../lib/loadError';

/**
 * Roles (Organisation → Roles). Three things on one page:
 *   - the access levels and the permissions each one comes with (our recommendation),
 *   - the company's own roles: a level plus permissions added or removed,
 *   - recommended roles (Scrum Master, Product Owner, …) to start from.
 * Super admins create, change and archive roles; everyone else who invites people reads the page.
 * The rules live in server/lib/userPolicy.ts (CAPABILITIES, LEVEL_CAPABILITIES) and server/lib/customRoles.ts.
 */

interface CapabilityInfo { key: string; group: 'See' | 'Change'; label: string; description: string; scopes?: string[] }
interface Level { key: string; label: string; scope: 'company' | 'department' | 'team'; capabilities: string[]; editable: string[]; custom: boolean }
interface Template { key: string; name: string; baseRole: string; description: string; added: string[]; removed: string[] }
interface CustomRole {
  id: string; name: string; description: string | null; baseRole: string; added: string[]; removed: string[];
  capabilities: string[]; templateKey: string | null; people: number;
}
interface RolesPayload { canManage: boolean; capabilities: CapabilityInfo[]; levels: Level[]; templates: Template[]; roles: CustomRole[] }

const SCOPE_TEXT: Record<Level['scope'], string> = {
  company: 'The whole organisation',
  department: 'One department and its teams, per assignment',
  team: 'One team, per assignment',
};

/** What the level itself decides (not a permission): who the person may invite and manage. */
const LEVEL_PEOPLE: Record<string, string> = {
  super_admin: 'Invites and manages everyone; owns departments, roles and the organisation’s settings.',
  qa_manager: 'Invites and manages the people of the department, and its teams’ settings.',
  team_lead: 'Invites engineers and viewers to the team.',
  qa_engineer: 'Does not invite or manage people.',
  viewer: 'Does not invite or manage people.',
};

interface Draft { id: string | null; name: string; description: string; baseRole: string; capabilities: string[]; templateKey: string | null }

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

async function send(method: string, url: string, body?: object) {
  const res = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const PermissionList: React.FC<{ all: CapabilityInfo[]; held: string[]; recommended?: string[] }> = ({ all, held, recommended }) => (
  <ul className="space-y-1">
    {all.map((c) => {
      const on = held.includes(c.key);
      const changed = recommended ? on !== recommended.includes(c.key) : false;
      return (
        <li key={c.key} className={cx('flex items-start gap-2 text-xs', on ? 'text-slate-700 dark:text-slate-200' : 'text-slate-500 dark:text-slate-400')}>
          {on ? <Check size={14} className="mt-0.5 flex-shrink-0 text-green-700 dark:text-green-400" aria-hidden="true" /> : <Minus size={14} className="mt-0.5 flex-shrink-0" aria-hidden="true" />}
          <span>
            <span className="sr-only">{on ? 'Yes: ' : 'No: '}</span>{c.label}
            {changed && <span className="ml-1 font-medium text-brand-700 dark:text-brand-300">({on ? 'added' : 'removed'})</span>}
          </span>
        </li>
      );
    })}
  </ul>
);

const RolesView: React.FC = () => {
  const [data, setData] = useState<RolesPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState<CustomRole | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/roles`, { credentials: 'include' });
      if (!res.ok) { setLoadError(await loadErrorMessage(res, 'the roles')); return; }
      setData(await res.json());
      setLoadError(null);
    } catch {
      setLoadError(NETWORK_ERROR);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const levelOf = useCallback((key: string) => data?.levels.find((l) => l.key === key), [data]);
  const draftLevel = draft ? levelOf(draft.baseRole) : undefined;
  const customLevels = useMemo(() => (data?.levels ?? []).filter((l) => l.custom), [data]);

  const startBlank = () => {
    const base = levelOf('qa_engineer') ?? customLevels[0];
    if (!base) return;
    setFormError(null);
    setDraft({ id: null, name: '', description: '', baseRole: base.key, capabilities: [...base.capabilities], templateKey: null });
  };
  const startFromTemplate = (t: Template) => {
    const base = levelOf(t.baseRole);
    if (!base) return;
    setFormError(null);
    setDraft({
      id: null, name: t.name, description: t.description, baseRole: t.baseRole, templateKey: t.key,
      capabilities: [...base.capabilities.filter((c) => !t.removed.includes(c)), ...t.added.filter((c) => !base.capabilities.includes(c))],
    });
  };
  const startEdit = (r: CustomRole) => {
    setFormError(null);
    setDraft({ id: r.id, name: r.name, description: r.description ?? '', baseRole: r.baseRole, capabilities: [...r.capabilities], templateKey: r.templateKey });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !draftLevel) return;
    if (draft.name.trim().length < 2) return setFormError('Give the role a name.');
    const added = draft.capabilities.filter((c) => !draftLevel.capabilities.includes(c));
    const removed = draftLevel.capabilities.filter((c) => !draft.capabilities.includes(c));
    setBusy(true); setFormError(null);
    try {
      const body = { name: draft.name.trim(), description: draft.description.trim() || null, baseRole: draft.baseRole, added, removed, templateKey: draft.templateKey };
      if (draft.id) await send('PUT', `${API_URL}/roles/${draft.id}`, body);
      else await send('POST', `${API_URL}/roles`, body);
      toast.success(draft.id ? `${body.name}: saved. It applies to everyone holding the role.` : `Role “${body.name}” created`);
      setDraft(null);
      await load();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const archive = async () => {
    if (!archiving) return;
    setBusy(true);
    try {
      await send('DELETE', `${API_URL}/roles/${archiving.id}`);
      toast.success(`Role “${archiving.name}” archived`);
      setArchiving(null);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <Page><PageIntro title="Roles" /><Card><p role="alert" className="text-sm text-red-700 dark:text-red-400">{loadError}</p></Card></Page>;
  if (!data) return <Page><PageIntro title="Roles" /><p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p></Page>;

  const taken = new Set(data.roles.map((r) => r.templateKey).filter(Boolean));

  return (
    <Page>
      <PageIntro
        title="Roles"
        description={data.canManage
          ? 'Start from a recommended role or build your own. A role is an access level plus the permissions you choose; you give it to a person on a team or a department, as many times as you need.'
          : 'What each role of your organisation can see and change. Super admins create and change roles.'}
        actions={data.canManage && <button type="button" className={buttonClass.primary} onClick={startBlank} data-testid="role-new"><Plus size={16} aria-hidden="true" /> New role</button>}
      />

      <section aria-labelledby="roles-own" className="mb-8" data-testid="roles-custom">
        <h3 id="roles-own" className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Your roles</h3>
        {data.roles.length === 0 ? (
          <Card><EmptyState title="No roles of your own yet" description={data.canManage ? 'Use a recommended role below, or “New role”. Until then people get one of the five access levels.' : 'People get one of the five access levels.'} icon={<ShieldCheck size={22} aria-hidden="true" />} /></Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {data.roles.map((r) => {
              const base = levelOf(r.baseRole);
              return (
                <Card key={r.id} data-testid="role-card" data-role-name={r.name}>
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h4 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{r.name}</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400">Level: {base?.label ?? r.baseRole} · {r.people} {r.people === 1 ? 'person' : 'people'}</p>
                    </div>
                    {sameSet(r.capabilities, base?.capabilities ?? []) ? <Badge>Recommended set</Badge> : <Badge tone="brand">Customised</Badge>}
                  </div>
                  {r.description && <p className="mb-3 text-xs text-slate-600 dark:text-slate-300">{r.description}</p>}
                  <PermissionList all={data.capabilities} held={r.capabilities} recommended={base?.capabilities} />
                  {data.canManage && (
                    <div className="mt-4 flex gap-2">
                      <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} onClick={() => startEdit(r)} aria-label={`Edit the role ${r.name}`}><Edit2 size={14} aria-hidden="true" /> Edit</button>
                      <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} onClick={() => setArchiving(r)} aria-label={`Archive the role ${r.name}`}><Archive size={14} aria-hidden="true" /> Archive</button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {data.canManage && (
        <section aria-labelledby="roles-templates" className="mb-8" data-testid="roles-templates">
          <h3 id="roles-templates" className="text-sm font-semibold text-slate-900 dark:text-white">Recommended roles</h3>
          <p className="mb-3 mt-1 text-xs text-slate-500 dark:text-slate-400">Our starting points for the roles most companies have. Using one opens it for you to adjust before it is created.</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {data.templates.map((t) => (
              <Card key={t.key} data-testid="role-template" data-template={t.key}>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{t.name}</h4>
                  {taken.has(t.key) && <Badge tone="good">In use</Badge>}
                </div>
                <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">Level: {levelOf(t.baseRole)?.label ?? t.baseRole}</p>
                <p className="mb-4 text-xs text-slate-600 dark:text-slate-300">{t.description}</p>
                <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} onClick={() => startFromTemplate(t)} aria-label={`Use the recommended role ${t.name}`}>
                  <Sparkles size={14} aria-hidden="true" /> Use this role
                </button>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="roles-levels" data-testid="roles-levels">
        <h3 id="roles-levels" className="text-sm font-semibold text-slate-900 dark:text-white">Access levels</h3>
        <p className="mb-3 mt-1 text-xs text-slate-500 dark:text-slate-400">
          Every role sits on one of these. The level decides where the role applies and whom the person may invite and manage; the permissions are what a role can change.
          Individual developer metrics are shown only for people who enabled developer insights, whatever the role.
        </p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {data.levels.map((l) => (
            <Card key={l.key} data-testid="role-level" data-level={l.key}>
              <div className="mb-1 flex items-start justify-between gap-2">
                <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{l.label}</h4>
                {!l.custom && <Badge>Fixed</Badge>}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">{SCOPE_TEXT[l.scope]}</p>
              <p className="mb-3 mt-1 text-xs text-slate-600 dark:text-slate-300">{LEVEL_PEOPLE[l.key]}</p>
              <PermissionList all={data.capabilities} held={l.capabilities} />
            </Card>
          ))}
        </div>
      </section>

      <Modal isOpen={!!draft} onClose={() => setDraft(null)} size="lg" scrollBody
        title={draft?.id ? 'Edit role' : 'New role'}
        subtitle={draft?.id ? 'Changes apply to everyone who holds the role, from their next page.' : 'The permissions start from our recommendation for the level. Change what you need.'}>
        {draft && draftLevel && (
          <form onSubmit={save} className="space-y-5" noValidate data-testid="role-form">
            {formError && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{formError}</p>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="role-name" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                <input id="role-name" data-autofocus value={draft.name} maxLength={60} onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Scrum Master" className={cx(inputClass, 'w-full')} data-testid="role-name" />
              </div>
              <div>
                <label htmlFor="role-base" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Access level</label>
                <select id="role-base" value={draft.baseRole} disabled={!!draft.id} className={cx(inputClass, 'w-full')} data-testid="role-base"
                  onChange={(e) => { const l = levelOf(e.target.value); if (l) setDraft({ ...draft, baseRole: l.key, capabilities: [...l.capabilities], templateKey: null }); }}>
                  {customLevels.map((l) => <option key={l.key} value={l.key}>{l.label} — {l.scope === 'department' ? 'a department' : 'a team'}</option>)}
                </select>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {draft.id ? 'The level of an existing role does not change; create a new role for another level.' : LEVEL_PEOPLE[draft.baseRole]}
                </p>
              </div>
            </div>
            <div>
              <label htmlFor="role-description" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Description <span className="font-normal text-slate-500 dark:text-slate-400">(optional)</span></label>
              <textarea id="role-description" rows={2} maxLength={300} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className={cx(inputClass, 'h-auto w-full py-2')} data-testid="role-description" />
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Permissions</p>
                <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} data-testid="role-reset"
                  disabled={sameSet(draft.capabilities, draftLevel.capabilities)}
                  onClick={() => setDraft({ ...draft, capabilities: [...draftLevel.capabilities] })}>
                  <RotateCcw size={14} aria-hidden="true" /> Back to recommended
                </button>
              </div>
              {(['See', 'Change'] as const).map((group) => (
                <fieldset key={group} className="mb-3 rounded-md border border-slate-200 p-3 dark:border-slate-800">
                  <legend className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{group === 'See' ? 'Can see' : 'Can change'}</legend>
                  <div className="space-y-3">
                    {data.capabilities.filter((c) => c.group === group).map((c) => {
                      const allowed = draftLevel.editable.includes(c.key);
                      const on = draft.capabilities.includes(c.key);
                      const recommended = draftLevel.capabilities.includes(c.key);
                      return (
                        <label key={c.key} className={cx('flex items-start gap-3', !allowed && 'opacity-60')}>
                          <input type="checkbox" checked={on} disabled={!allowed} data-testid={`role-cap-${c.key}`}
                            onChange={(e) => setDraft({ ...draft, capabilities: e.target.checked ? [...draft.capabilities, c.key] : draft.capabilities.filter((k) => k !== c.key) })}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600" />
                          <span className="min-w-0">
                            <span className="block text-sm text-slate-900 dark:text-white">
                              {c.label}
                              {recommended && <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">recommended for this level</span>}
                            </span>
                            <span className="block text-xs text-slate-500 dark:text-slate-400">
                              {c.description}{!allowed && ' Not available on this level.'}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className={buttonClass.primary} disabled={busy} data-testid="role-save">{busy ? 'Saving…' : draft.id ? 'Save role' : 'Create role'}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal isOpen={!!archiving} onClose={() => setArchiving(null)} title="Archive this role?" size="sm">
        {archiving && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              <strong>{archiving.name}</strong> will no longer be offered.{' '}
              {archiving.people > 0
                ? `${archiving.people} ${archiving.people === 1 ? 'person keeps' : 'people keep'} their assignments with the permissions of the level “${levelOf(archiving.baseRole)?.label ?? archiving.baseRole}”.`
                : 'Nobody holds it.'}
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={buttonClass.secondary} onClick={() => setArchiving(null)}>Cancel</button>
              <button type="button" className={buttonClass.primary} disabled={busy} onClick={archive} data-testid="role-archive-confirm">Archive role</button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
};

export default RolesView;
