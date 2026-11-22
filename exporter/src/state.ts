/**
 * Local state: per source the cursor (the newest change time read and delivered) and a fingerprint
 * of every item already delivered (no data is kept), so a re-run sends nothing that QE Navigator already has.
 * Written atomically (temporary file, fsync, rename, fsync of the directory), so a crash or a full
 * disk never leaves a half-written state. A lock file stops two runs from overlapping (cron).
 * The state holds no secret and no record content: only ids, change times and SHA-256 fingerprints.
 */
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { VERSION } from './version';

export interface SourceState {
  /** ISO time: the next incremental read starts here (minus the overlap). */
  cursor: string | null;
  lastSuccessAt: string | null;
  /** record id → fingerprint (first 24 hex of the SHA-256 of the minimised record). */
  sent: Record<string, string>;
  /** record id → fingerprint of a record QE Navigator refused (not retried until it changes). */
  rejected?: Record<string, string>;
  /** Failed runs since the last successful one, the time and kind (auth, network, http, …) of the last failure: for the heartbeat. */
  errors?: number;
  lastErrorAt?: string | null;
  lastErrorKind?: string | null;
}

export interface State {
  version: 1;
  /** The release that last wrote the state (collectorVersion in releases before 0.3.0). */
  exporterVersion?: string;
  collectorVersion?: string;
  sources: Record<string, SourceState>;
  lastHeartbeatAt?: string | null;
}

export const MAX_FINGERPRINTS = 250_000;

export function emptyState(): State {
  return { version: 1, exporterVersion: VERSION, sources: {} };
}

export function loadState(path: string): State {
  if (!existsSync(path)) return emptyState();
  let raw: any;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    throw new Error(`The state file ${path} is not valid JSON (${(e as Error).message}). Move it away to start over (the next run then reads the backfill window again; QE Navigator ignores what it already has).`);
  }
  if (!raw || raw.version !== 1 || typeof raw.sources !== 'object') throw new Error(`The state file ${path} has an unknown format`);
  // Values and evidence fingerprints of releases before 0.3.0 (they calculated locally) are no longer used.
  delete raw.metrics;
  delete raw.evidence;
  return raw as State;
}

export function sourceState(s: State, name: string): SourceState {
  if (!s.sources[name]) s.sources[name] = { cursor: null, lastSuccessAt: null, sent: {} };
  return s.sources[name];
}

export function saveState(path: string, s: State): void {
  const abs = resolve(path);
  const tmp = `${abs}.tmp-${process.pid}`;
  s.exporterVersion = VERSION;
  delete s.collectorVersion;
  for (const src of Object.values(s.sources)) {
    const keys = Object.keys(src.sent);
    // Oldest fingerprints go first when the cap is reached (insertion order = delivery order).
    if (keys.length > MAX_FINGERPRINTS) for (const k of keys.slice(0, keys.length - MAX_FINGERPRINTS)) delete src.sent[k];
  }
  const data = JSON.stringify(s);
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, abs);
  try {
    const dfd = openSync(dirname(abs), 'r');
    try { fsyncSync(dfd); } finally { closeSync(dfd); }
  } catch {
    // Some platforms cannot fsync a directory; the rename is still atomic.
  }
}

export const fingerprint = (record: unknown) => createHash('sha256').update(JSON.stringify(record)).digest('hex').slice(0, 24);

/** Take the run lock (state path + ".lock"); a lock older than staleMs or of a dead process is taken over. */
export function acquireLock(statePath: string, staleMs = 6 * 3600_000): () => void {
  const lock = resolve(statePath) + '.lock';
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(lock, 'wx', 0o600);
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return () => { try { unlinkSync(lock); } catch { /* already gone */ } };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let stale = false;
      try {
        const info = JSON.parse(readFileSync(lock, 'utf8'));
        const age = Date.now() - statSync(lock).mtimeMs;
        let alive = true;
        try { process.kill(Number(info.pid), 0); } catch (err) { alive = (err as NodeJS.ErrnoException).code === 'EPERM'; }
        // The same pid as ours is a previous run of a container (pid 1 every time): not alive.
        stale = age > staleMs || !alive || Number(info.pid) === process.pid;
      } catch {
        stale = true;
      }
      if (!stale) throw new LockError(`Another qe-exporter run holds ${lock}; nothing done`);
      try { unlinkSync(lock); } catch { /* raced */ }
    }
  }
  throw new LockError(`Could not take the lock ${lock}`);
}

export class LockError extends Error {}
