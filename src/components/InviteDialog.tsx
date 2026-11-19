import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, MailCheck, MailWarning, RefreshCw, Send, XCircle } from 'lucide-react';
import API_URL from '../config/api';
import Modal from './Modal';
import { Badge, buttonClass, cx, inputClass, type Tone } from './ui';
import { ROLE_LABELS } from '../lib/policyActor';
import type { GrantRoleOption } from '../lib/policyActor';

/**
 * Invitations (Users page): invite a person by email to one role assignment, and the list of
 * invitations with resend / revoke. Who may invite to what is the shared rule canGrant
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
}

interface Delivery { delivered: boolean; channel: 'smtp' | 'log'; error: string | null }
interface SendResult { invitation: Invitation; delivery: Delivery; link: string | null }

const ROLE_NAMES = ROLE_LABELS;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const first = options.find((o) => o.role === 'qa_engineer') ?? options[0];
    setEmail(''); setError(null); setResult(null);
    setRole(first?.role ?? '');
    setScopeId(first?.scopes[0]?.id ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [isOpen]);

  const roleOption = options.find((o) => o.role === role);
  const scopes = roleOption?.scopes ?? [];
  const scopeLabel = roleOption?.scopes[0]?.scopeType === 'department' ? 'Department' : roleOption?.scopes[0]?.scopeType === 'company' ? 'Organisation' : 'Team';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (!role || !scopeId) return setError('Choose a role and where it applies.');
    setBusy(true);
    try {
      const data: SendResult = await postJson(`${API_URL}/admin/invitations`, { email: email.trim(), role, scopeId });
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
    <Modal isOpen={isOpen} onClose={onClose} title="Invite a person" subtitle="They choose their own password (or use single sign-on) and get exactly this assignment." size="md">
      {result ? (
        <div className="space-y-4">
          <DeliveryResult email={result.invitation.email} result={result} />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {ROLE_NAMES[result.invitation.role]} of {result.invitation.scope_name}. Expires {new Date(result.invitation.expires_at).toLocaleString()}.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => { setResult(null); setEmail(''); }}>Invite another</button>
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
                {options.map((o) => <option key={o.role} value={o.role}>{o.label}</option>)}
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
                  {ROLE_NAMES[i.role] ?? i.role} of {i.scope_name ?? '—'}
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
