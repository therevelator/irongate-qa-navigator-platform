/**
 * The local copy of the raw records: it stays in your network, on the Collector's volume, so the Collector
 * can calculate (and recalculate after an engine update: qe-collector recalc --since …) without sending raw
 * data anywhere. No database and no dependency: JSON lines, one folder per kind, one file per month of the
 * record's own time (<dataDir>/<kind>/<YYYY-MM>.jsonl, mode 0600, folders 0700).
 *
 *   write     a record that changed is appended (one line: team, id, write sequence, record); an unchanged
 *             record writes nothing (a fingerprint per record is kept in memory)
 *   read      every file; per team and id the line with the highest write sequence wins
 *   rotation  monthly files; a file is rewritten without its superseded lines when they make up most of it
 *   retention month files older than state.retentionDays are deleted; per-test results and per-file coverage
 *             are dropped from records older than state.detailDays (as QE Navigator keeps them: 35 days)
 *
 * The records are the shared engine's (packages/engine/src/store/records.ts): the same rows QE Navigator's raw
 * store keeps, so the Collector's values equal QE Navigator's.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { AnalysisRec, CommitRec, CoverageRec, DeploymentRec, IncidentRec, IssueRec, PipelineRec, SprintRec, TestRunRec } from '../../packages/engine/src/index';

export interface KindMap {
  testRun: TestRunRec; coverage: CoverageRec; pipeline: PipelineRec; deployment: DeploymentRec; commit: CommitRec;
  incident: IncidentRec; issue: IssueRec; sprint: SprintRec; analysis: AnalysisRec;
}
export type StoreKind = keyof KindMap;
export const STORE_KINDS: StoreKind[] = ['testRun', 'coverage', 'pipeline', 'deployment', 'commit', 'incident', 'issue', 'sprint', 'analysis'];

export interface TeamRecords {
  testRuns: TestRunRec[]; coverage: CoverageRec[]; pipelines: PipelineRec[]; deployments: DeploymentRec[]; commits: CommitRec[];
  incidents: IncidentRec[]; issues: IssueRec[]; sprints: SprintRec[]; analyses: AnalysisRec[];
}

interface Entry { team: string; id: string; w: number; fp: string; month: string; rec: any }

const DAY = 86_400_000;
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const fpOf = (rec: unknown) => createHash('sha256').update(JSON.stringify(rec)).digest('hex').slice(0, 24);

/** The time a record is filed under (its own time; for records that change, the latest of their times). */
export function recordTime(kind: StoreKind, r: any, now: number): number {
  switch (kind) {
    case 'testRun': return r.startedAt;
    case 'coverage': return r.createdAt;
    case 'pipeline': return r.startedAt;
    case 'deployment': return r.finishedAt;
    case 'commit': return r.authoredAt ?? r.committedAt ?? now;
    case 'incident': return Math.max(r.openedAt, r.acknowledgedAt ?? 0, r.resolvedAt ?? 0);
    case 'issue': return Math.max(r.openedAt, r.resolvedAt ?? 0, r.updatedAt ?? 0, ...(r.transitions ?? []).map((t: any) => t.at));
    case 'sprint': return r.completedAt ?? r.startedAt ?? now;
    case 'analysis': return r.analyzedAt;
  }
}

export class LocalStore {
  private data = new Map<StoreKind, Map<string, Entry>>();
  private seq = 0;
  private lines = new Map<string, number>();
  written = 0;

  /** memoryOnly: nothing is written to disk (preview). */
  constructor(public dir: string, private retentionDays = 400, private detailDays = 35, private opts: { memoryOnly?: boolean } = {}) {
    for (const k of STORE_KINDS) this.data.set(k, new Map());
  }

  private file(kind: StoreKind, month: string): string { return join(this.dir, kind, `${month}.jsonl`); }

  /** Read every file (a missing folder is an empty store). A damaged line is skipped and reported. */
  load(): { records: number; damaged: number } {
    let damaged = 0;
    let records = 0;
    this.seq = Date.now() * 1000;
    if (!existsSync(this.dir)) return { records, damaged };
    for (const kind of STORE_KINDS) {
      const d = join(this.dir, kind);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x)).sort()) {
        const month = f.slice(0, 7);
        let n = 0;
        for (const line of readFileSync(join(d, f), 'utf8').split('\n')) {
          if (!line.trim()) continue;
          n++;
          let x: any;
          try { x = JSON.parse(line); } catch { damaged++; continue; }
          if (!x || typeof x.t !== 'string' || typeof x.id !== 'string' || typeof x.w !== 'number' || !x.r) { damaged++; continue; }
          const key = `${x.t}\u0000${x.id}`;
          const cur = this.data.get(kind)!.get(key);
          if (!cur || x.w >= cur.w) this.data.get(kind)!.set(key, { team: x.t, id: x.id, w: x.w, fp: fpOf(x.r), month, rec: x.r });
          if (x.w >= this.seq) this.seq = x.w + 1;
        }
        this.lines.set(`${kind}/${month}`, n);
      }
      records += this.data.get(kind)!.size;
    }
    return { records, damaged };
  }

  get<K extends StoreKind>(kind: K, team: string, id: string): KindMap[K] | null {
    return (this.data.get(kind)!.get(`${team}\u0000${id}`)?.rec as KindMap[K]) ?? null;
  }

  /** Store a record; false when it is unchanged (nothing written). */
  put<K extends StoreKind>(kind: K, team: string, id: string, rec: KindMap[K], now = Date.now()): boolean {
    const key = `${team}\u0000${id}`;
    const fp = fpOf(rec);
    const cur = this.data.get(kind)!.get(key);
    if (cur && cur.fp === fp) return false;
    const month = monthOf(recordTime(kind, rec, now));
    const w = ++this.seq;
    if (!this.opts.memoryOnly) {
      mkdirSync(join(this.dir, kind), { recursive: true, mode: 0o700 });
      appendFileSync(this.file(kind, month), JSON.stringify({ t: team, id, w, r: rec }) + '\n', { mode: 0o600 });
      this.lines.set(`${kind}/${month}`, (this.lines.get(`${kind}/${month}`) ?? 0) + 1);
    }
    this.data.get(kind)!.set(key, { team, id, w, fp, month, rec });
    this.written++;
    return true;
  }

  teams(): string[] {
    const s = new Set<string>();
    for (const m of this.data.values()) for (const e of m.values()) s.add(e.team);
    return Array.from(s).sort();
  }

  count(kind?: StoreKind): number {
    return kind ? this.data.get(kind)!.size : STORE_KINDS.reduce((n, k) => n + this.data.get(k)!.size, 0);
  }

  records(team: string): TeamRecords {
    const of = <K extends StoreKind>(k: K): KindMap[K][] => Array.from(this.data.get(k)!.values()).filter((e) => e.team === team).map((e) => e.rec);
    return {
      testRuns: of('testRun'), coverage: of('coverage'), pipelines: of('pipeline'), deployments: of('deployment'), commits: of('commit'),
      incidents: of('incident'), issues: of('issue'), sprints: of('sprint'), analyses: of('analysis'),
    };
  }

  /** The days of the records written in this run (what needs recalculating). */
  changedSince(w: number): Array<{ team: string; kind: StoreKind; time: number }> {
    const out: Array<{ team: string; kind: StoreKind; time: number }> = [];
    for (const [kind, m] of this.data) for (const e of m.values()) if (e.w > w) out.push({ team: e.team, kind, time: recordTime(kind, e.rec, Date.now()) });
    return out;
  }
  get sequence(): number { return this.seq; }

  /**
   * Retention and rotation: delete month files older than retentionDays; drop per-test results and per-file
   * coverage from records older than detailDays; rewrite a file whose lines are mostly superseded.
   */
  compact(now = Date.now()): { deletedFiles: number; rewrittenFiles: number; detailDropped: number } {
    const res = { deletedFiles: 0, rewrittenFiles: 0, detailDropped: 0 };
    if (this.opts.memoryOnly || !existsSync(this.dir)) return res;
    const oldest = monthOf(now - this.retentionDays * DAY);
    const detailBefore = now - this.detailDays * DAY;
    for (const kind of STORE_KINDS) {
      const d = join(this.dir, kind);
      if (!existsSync(d)) continue;
      const m = this.data.get(kind)!;
      for (const f of readdirSync(d).filter((x) => /^\d{4}-\d{2}\.jsonl$/.test(x))) {
        const month = f.slice(0, 7);
        if (month < oldest) {
          unlinkSync(join(d, f));
          for (const [k, e] of m) if (e.month === month) m.delete(k);
          this.lines.delete(`${kind}/${month}`);
          res.deletedFiles++;
          continue;
        }
        const live = Array.from(m.values()).filter((e) => e.month === month);
        let changed = false;
        for (const e of live) {
          if (recordTime(kind, e.rec, now) >= detailBefore) continue;
          if (kind === 'testRun' && e.rec.cases?.length) { e.rec = { ...e.rec, cases: [] }; changed = true; res.detailDropped++; }
          if (kind === 'coverage' && e.rec.files?.length) { e.rec = { ...e.rec, files: [] }; changed = true; res.detailDropped++; }
          if (changed) e.fp = fpOf(e.rec);
        }
        const lines = this.lines.get(`${kind}/${month}`) ?? 0;
        if (changed || lines > Math.max(50, live.length * 2)) {
          const tmp = join(d, `${f}.tmp-${process.pid}`);
          const fd = openSync(tmp, 'w', 0o600);
          try {
            for (const e of live.sort((a, b) => a.w - b.w)) writeSync(fd, JSON.stringify({ t: e.team, id: e.id, w: e.w, r: e.rec }) + '\n');
            fsyncSync(fd);
          } finally { closeSync(fd); }
          renameSync(tmp, join(d, f));
          this.lines.set(`${kind}/${month}`, live.length);
          res.rewrittenFiles++;
        }
      }
    }
    return res;
  }

  /** Size on disk (diagnostics). */
  size(): { files: number; bytes: number } {
    let files = 0;
    let bytes = 0;
    if (!existsSync(this.dir)) return { files, bytes };
    for (const kind of STORE_KINDS) {
      const d = join(this.dir, kind);
      if (!existsSync(d)) continue;
      for (const f of readdirSync(d)) { files++; bytes += statSync(join(d, f)).size; }
    }
    return { files, bytes };
  }
}
