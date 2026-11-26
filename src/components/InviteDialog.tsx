import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, MailCheck, MailWarning, Plus, RefreshCw, Send, Trash2, XCircle } from 'lucide-react';
import API_URL from '../config/api';
import Modal from './Modal';
import { Badge, buttonClass, cx, inputClass, type Tone } from './ui';
import { ROLE_LABELS, grantBody } from '../lib/policyActor';
import type { GrantRoleOption } from '../lib/policyActor';

/**
 * Invitations (Users page): invite a person by email to one or several role assignments (a Scrum Master of
 * team X in one department and teams A and B in another), and the list of invitations with resend / revoke.
 * The roles offered are the access levels and the company's own roles (Organisation → Roles). Who may invite to what is the shared rule canGrant
 * (server/lib/userPolicy.ts), passed in as `options`. When no email could be sent (SMTP not
 * configured, or it failed) the link is shown to copy — never a silent failure.
 */

export interface Invitation {
  id: string;
  email: string;
  role: string;
  scope_type: 'company' | 'department' | 'team';
  scope_id: string;
  scope_name: string | null;
  status: 'open' | 'expired' | 'accepted' | 'revoked';
  created_at: string;
  expires_at: string;
  last_sent_at: string;
  send_count: number;
  accepted_at: string | null;
  invited_by_name: string | null;
  custom_role_name?: string | null;
  /** Further assignments given with the same invitation. */
  extra_grants?: Array<{ role: string; scopeType: string; scopeId: string; scopeName?: string | null; roleName?: string | null }> | null;
}

/** Everything an invitation gives, in words: "Scrum Master of Payments; Scrum Master of Checkout". */
export const invitationAccess = (i: Invitation): string[] => [
  `${i.custom_role_name ?? ROLE_LABELS[i.role] ?? i.role} of ${i.scope_name ?? '—'}`,
  ...(i.extra_grants ?? []).map((x) => `${x.roleName ?? ROLE_LABELS[x.role] ?? x.role} of ${x.scopeName ?? '—'}`),
];

interface AccessRow { key: number; role: string; scopeId: string }
const MAX_EXTRA = 20;

interface Delivery { delivered: boolean; channel: 'resend' | 'smtp' | 'log'; error: string | null }
interface SendResult { invitation: Invitation; delivery: Delivery; link: string | null }

const STATUS: Record<Invitation['status'], { label: string; tone: Tone }> = {
  open: { label: 'Pending', tone: 'brand' },
  expired: { label: 'Expired', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'good' },
  revoked: { label: 'Revoked', tone: 'neutral' },
};

async function postJson(url: string, body?: object) {
  const res = await fetch(url, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** The link to pass on when no email went out. */
export const DeliveryResult: React.FC<{ email: string; result: SendResult }> = ({ email, result }) => {
  if (result.delivery.delivered) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300" role="status">
        <MailCheck size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>Invitation email sent to {email}.</span>
      </div>
    );
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.link ?? '');
      toast.success('Link copied');
    } catch {
      toast.error('Copy failed: select the link and copy it');
    }
  };
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40" role="status" data-testid="invite-link-box">
      <p className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
        <MailWarning size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
        <span>No email was sent. {result.delivery.error} Send this link to {email} yourself; it works once.</span>
      </p>
      <div className="flex gap-2">
        <label htmlFor="invite-link" className="sr-only">Invitation link</label>
        <input id="invite-link" readOnly value={result.link ?? ''} onFocus={(e) => e.currentTarget.select()} className={cx(inputClass, 'min-w-0 flex-1 font-mono text-xs')} data-testid="invite-link" />
        <button type="button" onClick={copy} className={buttonClass.secondary}><Copy size={15} aria-hidden="true" /> Copy</button>
      </div>
    </div>
  );
};

export const InviteDialog: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  options: GrantRoleOption[];
  onSent: () => void;
}> = ({ isOpen, onClose, options, onSent }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('');
  const [scopeId, setScopeId] = useState('');
  const [extras, setExtras] = useState<AccessRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const first = options.find((o) => o.role === 'qa_engineer') ?? options[0];
    setEmail(''); setError(null); setResult(null); setExtras([]);
    setRole(first?.role ?? '');
    setScopeId(first?.scopes[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [isOpen]);

  const roleOption = options.find((o) => o.role === role);
  const scopes = roleOption?.scopes ?? [];
  const scopeLabel = roleOption?.scopes[0]?.scopeType === 'department' ? 'Department' : roleOption?.scopes[0]?.scopeType === 'company' ? 'Organisation' : 'Team';

  // One assignment per team or department: a place already chosen is not offered again.
  const usedScopes = (exceptKey?: number) => new Set([scopeId, ...extras.filter((x) => x.key !== exceptKey).map((x) => x.scopeId)]);
  const addRow = () => {
    const used = usedScopes();
    // The same role on another place is the usual case; else the first role with a free place.
    const candidates = [roleOption, ...options].filter((o): o is GrantRoleOption => !!o && o.scopes[0]?.scopeType !== 'company');
    for (const o of candidates) {
      const free = o.scopes.find((s) => !used.has(s.id));
      if (free) return setExtras((rows) => [...rows, { key: Date.now() + rows.length, role: o.role, scopeId: free.id }]);
    }
    setError('There is no other team or department you can add.');
  };
  const setRow = (key: number, patch: Partial<AccessRow>) => setExtras((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const nameOf = (r: string, s: string) => {
    const o = options.find((x) => x.role === r);
    return `${o?.label ?? r} of ${o?.scopes.find((x) => x.id === s)?.name ?? '—'}`;
  };
  const isCompanyRole = roleOption?.scopes[0]?.scopeType === 'company';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (!role || !scopeId) return setError('Choose a role and where it applies.');
    setBusy(true);
    try {
      const data: SendResult = await postJson(`${API_URL}/admin/invitations`, {
        email: email.trim(), ...grantBody(role, scopeId),
        ...(extras.length && !isCompanyRole ? { extraGrants: extras.map((x) => grantBody(x.role, x.scopeId)) } : {}),
      });
      setResult(data);
      onSent();
      if (data.delivery.delivered) toast.success(`Invitation sent to ${data.invitation.email}`);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Invite a person" subtitle="They choose their own password (or use single sign-on) and get exactly the access you choose here." size="md" scrollBody>
      {result ? (
        <div className="space-y-4">
          <DeliveryResult email={result.invitation.email} result={result} />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {invitationAccess(result.invitation).join('; ')}. Expires {new Date(result.invitation.expires_at).toLocaleString()}.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => { setResult(null); setEmail(''); setExtras([]); }}>Invite another</button>
            <button type="button" className={buttonClass.primary} onClick={onClose}>Done</button>
          </div>
        </div>
      ) : options.length === 0 ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">There is no role you can invite people to.</p>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          <div>
            <label htmlFor="invite-email-input" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Email address</label>
            <input id="invite-email-input" data-autofocus type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com" className={cx(inputClass, 'w-full')} data-testid="invite-email" />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="invite-role" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Role</label>
              <select id="invite-role" value={role} className={cx(inputClass, 'w-full')} data-testid="invite-role"
                onChange={(e) => { setRole(e.target.value); setScopeId(options.find((o) => o.role === e.target.value)?.scopes[0]?.id ?? ''); }}>
                {options.filter((o) => !o.customRoleId).map((o) => <option key={o.role} value={o.role}>{o.label}</option>)}
                {options.some((o) => o.customRoleId) && (
                  <optgroup label="Your roles">
                    {options.filter((o) => o.customRoleId).map((o) => <option key={o.role} value={o.role}>{o.label}</option>)}
                  </optgroup>
                )}
              </select>
            </div>
            <div>
              <label htmlFor="invite-scope" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">{scopeLabel}</label>
              <select id="invite-scope" value={scopeId} onChange={(e) => setScopeId(e.target.value)} className={cx(inputClass, 'w-full')} data-testid="invite-scope">
                {scopes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.departmentName ? ` (${s.departmentName})` : ''}{role === 'team_lead' && s.leadName ? ` — led by ${s.leadName}` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {role === 'team_lead' && scopes.find((s) => s.id === scopeId)?.leadName && (
            <p className="text-xs text-amber-700 dark:text-amber-400">This team already has a lead. Invite the person as a software engineer, then change the lead on the Departments page.</p>
          )}
          {roleOption?.description && <p className="text-xs text-slate-500 dark:text-slate-400" data-testid="invite-role-description">{roleOption.description}</p>}
          {!isCompanyRole && (
            <fieldset className="rounded-md border border-slate-200 p-3 dark:border-slate-800" data-testid="invite-extra">
              <legend className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">More access with the same invitation</legend>
              {extras.length === 0 && <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">For someone who works with several teams or departments: add each one, with the role they have there.</p>}
              <ul className="space-y-2">
                {extras.map((x, n) => {
                  const o = options.find((opt) => opt.role === x.role);
                  const used = usedScopes(x.key);
                  return (
                    <li key={x.key} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2" data-testid="invite-extra-row">
                      <select aria-label={`Role of additional access ${n + 1}`} value={x.role} className={cx(inputClass, 'w-full')} data-testid="invite-extra-role"
                        onChange={(e) => { const next = options.find((opt) => opt.role === e.target.value); setRow(x.key, { role: e.target.value, scopeId: (next?.scopes.find((s) => !used.has(s.id)) ?? next?.scopes[0])?.id ?? '' }); }}>
                        {options.filter((opt) => opt.scopes[0]?.scopeType !== 'company').map((opt) => <option key={opt.role} value={opt.role}>{opt.label}</option>)}
                      </select>
                      <select aria-label={`Team or department of additional access ${n + 1}`} value={x.scopeId} className={cx(inputClass, 'w-full')} data-testid="invite-extra-scope"
                        onChange={(e) => setRow(x.key, { scopeId: e.target.value })}>
                        {(o?.scopes ?? []).filter((s) => s.id === x.scopeId || !used.has(s.id)).map((s) => (
                          <option key={s.id} value={s.id}>{s.name}{s.departmentName ? ` (${s.departmentName})` : ''}</option>
                        ))}
                      </select>
                      <button type="button" className={cx(buttonClass.secondary, 'h-9 px-2.5')} onClick={() => setExtras((rows) => rows.filter((r) => r.key !== x.key))} aria-label={`Remove additional access ${n + 1}`}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className={cx(buttonClass.secondary, 'mt-2 h-8 px-2.5 text-xs')} onClick={addRow} disabled={extras.length >= MAX_EXTRA} data-testid="invite-extra-add">
                <Plus size={14} aria-hidden="true" /> Add a team or department
              </button>
            </fieldset>
          )}
          {role && scopeId && (
            <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300" data-testid="invite-summary">
              <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">This invitation gives</p>
              <ul className="list-disc space-y-0.5 pl-4">
                <li>{nameOf(role, scopeId)}</li>
                {!isCompanyRole && extras.map((x) => <li key={x.key}>{nameOf(x.role, x.scopeId)}</li>)}
              </ul>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className={buttonClass.secondary} onClick={onClose}>Cancel</button>
            <button type="submit" className={buttonClass.primary} disabled={busy} data-testid="invite-submit"><Send size={15} aria-hidden="true" />{busy ? 'Sending…' : 'Send invitation'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
};

/** Invitations sent (pending and expired first; accepted / revoked behind a toggle). */
export const InvitationsPanel: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<{ email: string; result: SendResult } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/admin/invitations`, { credentials: 'include' });
      if (!res.ok) { setItems([]); return; }
      setItems((await res.json()).invitations ?? []);
    } catch {
      setItems([]);
    }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const visible = useMemo(
    () => (items ?? []).filter((i) => showAll || i.status === 'open' || i.status === 'expired'),
    [items, showAll],
  );
  if (items === null || items.length === 0) return null;

  const act = async (inv: Invitation, action: 'resend' | 'revoke') => {
    setBusyId(inv.id);
    try {
      const data = await postJson(`${API_URL}/admin/invitations/${inv.id}/${action}`);
      if (action === 'resend') {
        setLastResult({ email: inv.email, result: data });
        if (data.delivery?.delivered) toast.success(`Invitation re-sent to ${inv.email}`);
      } else {
        toast.success(`Invitation to ${inv.email} revoked`);
      }
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-6 rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900" aria-labelledby="invitations-title" data-testid="invitations-panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
        <div>
          <h2 id="invitations-title" className="text-sm font-semibold text-slate-900 dark:text-white">Invitations</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">Resending makes a new link; the previous one stops working.</p>
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-brand-500 dark:border-slate-600" />
          Show accepted and revoked
        </label>
      </div>
      {lastResult && !lastResult.result.delivery.delivered && (
        <div className="px-4 pt-3"><DeliveryResult email={lastResult.email} result={lastResult.result} /></div>
      )}
      {visible.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500 dark:text-slate-400">No pending invitations.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {visible.map((i) => (
            <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between" data-testid="invitation-row">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-white">{i.email}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {invitationAccess(i).join('; ')}
                  {' · '}
                  {i.status === 'accepted' && i.accepted_at ? `accepted ${new Date(i.accepted_at).toLocaleDateString()}`
                    : i.status === 'open' ? `expires ${new Date(i.expires_at).toLocaleDateString()}`
                    : i.status === 'expired' ? `expired ${new Date(i.expires_at).toLocaleDateString()}`
                    : `sent ${new Date(i.last_sent_at).toLocaleDateString()}`}
                  {i.invited_by_name ? ` · by ${i.invited_by_name}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS[i.status].tone}>{STATUS[i.status].label}</Badge>
                {(i.status === 'open' || i.status === 'expired') && (
                  <>
                    <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs')} disabled={busyId === i.id} onClick={() => act(i, 'resend')} aria-label={`Resend the invitation to ${i.email}`}>
                      <RefreshCw size={14} aria-hidden="true" /> Resend
                    </button>
                    <button type="button" className={cx(buttonClass.secondary, 'h-8 px-2.5 text-xs text-red-700 dark:text-red-400')} disabled={busyId === i.id} onClick={() => act(i, 'revoke')} aria-label={`Revoke the invitation to ${i.email}`}>
                      <XCircle size={14} aria-hidden="true" /> Revoke
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default InviteDialog;
