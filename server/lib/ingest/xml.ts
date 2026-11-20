/**
 * A small, safe, non-validating XML reader (SAX style) for test and coverage reports.
 *
 * Safety (uploads are untrusted):
 *  - entity declarations (<!ENTITY …>) are refused, so there is no external entity (XXE) and no
 *    entity expansion ("billion laughs"); a DOCTYPE without an internal subset (JaCoCo writes one)
 *    is skipped and its DTD is never fetched;
 *  - only the five predefined entities and numeric character references are decoded; any other
 *    entity reference is an error;
 *  - nesting depth, attribute count and name length are limited.
 * The document is read in one pass over the string; callers keep only what they need.
 */
export class XmlError extends Error {}

export interface SaxHandlers {
  open(name: string, attrs: Record<string, string>): void;
  close(name: string): void;
  text?(text: string): void;
}

const MAX_DEPTH = 256;
const MAX_ATTRS = 256;
const MAX_NAME = 256;

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  // A bare "&" that starts no reference is kept as it is (some report writers do not escape it).
  return s.replace(/&(#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,10}|[A-Za-z_][\w.-]{0,31});/g, (_m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) throw new XmlError(`Invalid character reference &${ent};`);
      return String.fromCodePoint(code);
    }
    const v = PREDEFINED[ent];
    if (v === undefined) throw new XmlError(`Undefined entity &${ent}; (entity declarations are not allowed)`);
    return v;
  });
}

const NAME_END = /[\s/>]/;

function readAttrs(src: string, tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(src))) {
    if (++n > MAX_ATTRS) throw new XmlError(`Too many attributes on <${tag}>`);
    const raw = m[3] ?? m[4] ?? '';
    if (raw.indexOf('<') >= 0) throw new XmlError(`"<" in an attribute value of <${tag}>`);
    attrs[m[1]] = decodeEntities(raw);
  }
  return attrs;
}

/** Strip the namespace prefix (ns:testsuite → testsuite). */
const local = (name: string) => {
  const i = name.indexOf(':');
  return i >= 0 ? name.slice(i + 1) : name;
};

export function parseXml(xml: string, h: SaxHandlers): void {
  let i = 0;
  const len = xml.length;
  if (xml.charCodeAt(0) === 0xfeff) i = 1;
  const stack: string[] = [];
  let sawRoot = false;
  while (i < len) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      const tail = xml.slice(i);
      if (tail.trim()) {
        if (!stack.length) throw new XmlError('Text after the root element');
        h.text?.(decodeEntities(tail));
      }
      break;
    }
    if (lt > i) {
      const t = xml.slice(i, lt);
      if (stack.length) { if (h.text) h.text(decodeEntities(t)); }
      else if (t.trim()) throw new XmlError('Text outside the root element');
    }
    const c = xml[lt + 1];
    if (c === '?') {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('Unterminated processing instruction');
      i = end + 2;
    } else if (c === '!') {
      if (xml.startsWith('<!--', lt)) {
        const end = xml.indexOf('-->', lt + 4);
        if (end < 0) throw new XmlError('Unterminated comment');
        i = end + 3;
      } else if (xml.startsWith('<![CDATA[', lt)) {
        const end = xml.indexOf(']]>', lt + 9);
        if (end < 0) throw new XmlError('Unterminated CDATA section');
        if (!stack.length) throw new XmlError('CDATA outside the root element');
        h.text?.(xml.slice(lt + 9, end));
        i = end + 3;
      } else if (xml.startsWith('<!DOCTYPE', lt) || xml.startsWith('<!doctype', lt)) {
        if (sawRoot) throw new XmlError('DOCTYPE after the root element');
        // Skip to the matching ">", refusing an internal subset with entity declarations.
        let j = lt + 9;
        let depth = 0;
        for (; j < len; j++) {
          const ch = xml[j];
          if (ch === '[') depth++;
          else if (ch === ']') depth--;
          else if (ch === '<' && xml.startsWith('<!ENTITY', j)) throw new XmlError('XML entity declarations are not allowed');
          else if (ch === '>' && depth <= 0) break;
        }
        if (j >= len) throw new XmlError('Unterminated DOCTYPE');
        i = j + 1;
      } else {
        throw new XmlError('Unsupported markup declaration');
      }
    } else if (c === '/') {
      const end = xml.indexOf('>', lt + 2);
      if (end < 0) throw new XmlError('Unterminated end tag');
      const name = local(xml.slice(lt + 2, end).trim());
      const open = stack.pop();
      if (open !== name) throw new XmlError(`Mismatched end tag </${name}> (expected </${open ?? '—'}>)`);
      h.close(name);
      i = end + 1;
    } else {
      // Start tag: find the closing ">" outside attribute quotes.
      let j = lt + 1;
      let quote = '';
      for (; j < len; j++) {
        const ch = xml[j];
        if (quote) { if (ch === quote) quote = ''; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') break;
      }
      if (j >= len) throw new XmlError('Unterminated start tag');
      const selfClosing = xml[j - 1] === '/';
      const inner = xml.slice(lt + 1, selfClosing ? j - 1 : j);
      let k = 0;
      while (k < inner.length && !NAME_END.test(inner[k])) k++;
      const rawName = inner.slice(0, k);
      if (!rawName || rawName.length > MAX_NAME) throw new XmlError('Invalid element name');
      if (!stack.length && sawRoot) throw new XmlError('More than one root element');
      sawRoot = true;
      const name = local(rawName);
      const attrs = readAttrs(inner.slice(k), name);
      if (stack.length >= MAX_DEPTH) throw new XmlError('Elements are nested too deeply');
      h.open(name, attrs);
      if (selfClosing) h.close(name);
      else stack.push(name);
      i = j + 1;
    }
  }
  if (stack.length) throw new XmlError(`Unexpected end of document inside <${stack[stack.length - 1]}>`);
  if (!sawRoot) throw new XmlError('No root element');
}

/** The root element's local name, from the start of the document (cheap format detection). */
export function rootElementName(xml: string): string | null {
  const re = /<([A-Za-z_][\w.:-]*)[\s/>]/g;
  let m: RegExpExecArray | null;
  const head = xml.slice(0, 64 * 1024);
  // Skip declarations/comments by scanning tag names that do not start with ! or ?.
  while ((m = re.exec(head))) {
    const before = head.lastIndexOf('<!--', m.index);
    const closeC = head.lastIndexOf('-->', m.index);
    if (before > closeC) continue; // inside a comment
    return local(m[1]);
  }
  return null;
}
