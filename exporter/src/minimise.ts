/**
 * Report files are sent as files, but without what QE Navigator does not need: the Exporter strips failure messages,
 * stack traces, test output, properties and finding messages before a file leaves the network (the same rule as for
 * issues and incidents: no free text). What stays is what the calculations read: suites, test names, statuses, times
 * and retries; file paths with lines and branches; rule ids, severities, locations and fingerprints.
 *
 * A file that declares XML entities (XXE, billion laughs) is not sent at all (a DOCTYPE without entities, as JaCoCo
 * and Cobertura write, is fine: QE Navigator's parser refuses entities too).
 */
import { createHash } from 'node:crypto';

export class ReportRefused extends Error {}

const strip = (xml: string, tag: string, replacement: string) =>
  xml.replace(new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}\\s*>)`, 'g'), replacement);

/** A JUnit / xUnit / TRX file without messages, stack traces, output or properties. */
export function minimiseTestXml(xml: string): string {
  if (/<!ENTITY/i.test(xml)) throw new ReportRefused('the file declares XML entities (not sent)');
  let out = xml;
  for (const t of ['system-out', 'system-err', 'properties', 'Output', 'StdOut', 'StdErr', 'ErrorInfo', 'DebugTrace', 'TextMessages', 'ResultFiles', 'reason']) out = strip(out, t, '');
  for (const t of ['failure', 'error', 'skipped', 'flakyFailure', 'flakyError', 'rerunFailure', 'rerunError']) out = strip(out, t, `<${t}/>`);
  // xUnit.net: <failure> inside <test> carries <message> and <stack-trace>.
  for (const t of ['message', 'stack-trace']) out = strip(out, t, '');
  return out;
}

/** A Cucumber JSON report without error messages, output, attachments or step arguments. */
export function minimiseCucumber(text: string): string {
  const doc = JSON.parse(text);
  const drop = new Set(['error_message', 'output', 'embeddings', 'doc_string', 'rows', 'arguments', 'description', 'comments']);
  const walk = (v: any): any => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !drop.has(k)).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return JSON.stringify(walk(doc));
}

/** A SARIF file without messages, code flows, snippets, invocations or rule texts. */
export function minimiseSarif(text: string): string {
  const doc = JSON.parse(text);
  for (const run of Array.isArray(doc?.runs) ? doc.runs : []) {
    delete run.invocations;
    delete run.artifacts;
    delete run.originalUriBaseIds;
    delete run.versionControlProvenance;
    const driver = run?.tool?.driver;
    if (driver) {
      delete driver.notifications;
      if (Array.isArray(driver.rules)) driver.rules = driver.rules.map((r: any) => ({ id: r?.id, ...(r?.name ? { name: r.name } : {}), ...(r?.defaultConfiguration ? { defaultConfiguration: r.defaultConfiguration } : {}), ...(r?.properties ? { properties: { ...(r.properties['security-severity'] ? { 'security-severity': r.properties['security-severity'] } : {}), ...(r.properties.severity ? { severity: r.properties.severity } : {}), ...(Array.isArray(r.properties.tags) ? { tags: r.properties.tags.slice(0, 20) } : {}) } } : {}) }));
    }
    if (Array.isArray(run.results)) {
      run.results = run.results.map((r: any) => {
        const out: Record<string, unknown> = {};
        for (const k of ['ruleId', 'ruleIndex', 'rule', 'level', 'kind', 'baselineState', 'suppressions', 'fingerprints', 'partialFingerprints', 'properties']) if (r?.[k] !== undefined) out[k] = r[k];
        if (Array.isArray(out.suppressions)) out.suppressions = (out.suppressions as any[]).map((s) => ({ kind: s?.kind, status: s?.status }));
        if (Array.isArray(r?.locations)) {
          out.locations = r.locations.slice(0, 5).map((l: any) => {
            const p = l?.physicalLocation ?? {};
            return { physicalLocation: { artifactLocation: p.artifactLocation?.uri ? { uri: p.artifactLocation.uri, ...(p.artifactLocation.uriBaseId ? { uriBaseId: p.artifactLocation.uriBaseId } : {}) } : undefined, region: p.region?.startLine ? { startLine: p.region.startLine, ...(p.region.endLine ? { endLine: p.region.endLine } : {}) } : undefined } };
          });
        }
        // A result without a fingerprint keeps a stable one (rule, file, line, message) before its message is dropped.
        if (!out.fingerprints && !out.partialFingerprints) {
          const l = r?.locations?.[0]?.physicalLocation;
          out.partialFingerprints = { primaryLocationLineHash: createHash('sha256').update([r?.ruleId, l?.artifactLocation?.uri, l?.region?.startLine, r?.message?.text].map((x) => String(x ?? '')).join('\u0000')).digest('hex').slice(0, 32) };
        }
        out.message = { text: '' };
        return out;
      });
    }
  }
  return JSON.stringify(doc);
}

/** The minimised text of a report file of a kind (coverage files carry no free text and are sent as they are). */
export function minimiseReport(kind: 'tests' | 'coverage' | 'sarif', text: string): string {
  if (kind === 'sarif') return minimiseSarif(text);
  if (kind === 'tests') return /^\s*\[/.test(text) ? minimiseCucumber(text) : minimiseTestXml(text);
  if (/<!ENTITY/i.test(text)) throw new ReportRefused('the file declares XML entities (not sent)');
  return text;
}
