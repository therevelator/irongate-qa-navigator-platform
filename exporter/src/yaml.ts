/**
 * A small, strict YAML subset parser for the configuration file (no dependency to review).
 *
 * Supported: block mappings and sequences (indentation with spaces), "- key: value" items, comments
 * (#), plain, 'single' and "double" quoted scalars, numbers, true / false, null / ~, and one-line
 * flow collections ([a, b] and {a: 1}). Anything else (tabs for indentation, anchors and aliases,
 * tags, block scalars | and >, several documents) is refused with the line number, so a config
 * never means something other than what it looks like.
 */
export class YamlError extends Error {
  constructor(message: string, public line: number) {
    super(`config line ${line}: ${message}`);
  }
}

interface Line { indent: number; text: string; no: number }

function stripComment(s: string, no: number): string {
  let q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") { i++; continue; }
        q = null;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      // A quote starts a quoted scalar only at the start of a value.
      const before = s.slice(0, i).trimEnd();
      if (before === '' || /[:\-[{,]$/.test(before)) q = c;
      continue;
    }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  if (q) throw new YamlError('unterminated quoted string', no);
  return s.trimEnd();
}

function lines(src: string): Line[] {
  const out: Line[] = [];
  src.replace(/^﻿/, '').split(/\r?\n/).forEach((raw, i) => {
    const no = i + 1;
    if (/^\s*$/.test(raw) || /^\s*#/.test(raw)) return;
    const lead = /^[ \t]*/.exec(raw)![0];
    if (lead.includes('\t')) throw new YamlError('tabs are not allowed for indentation (use spaces)', no);
    const text = stripComment(raw.slice(lead.length), no);
    if (text === '---' && out.length === 0) return;
    if (text === '---' || text === '...') throw new YamlError('only one YAML document is supported', no);
    if (text) out.push({ indent: lead.length, text, no });
  });
  return out;
}

function unquoteDouble(s: string, no: number): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_m, e: string) => {
    if (e[0] === 'u') return String.fromCharCode(parseInt(e.slice(1), 16));
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0' };
    if (!(e in map)) throw new YamlError(`unknown escape \\${e}`, no);
    return map[e];
  });
}

function scalar(raw: string, no: number): unknown {
  const s = raw.trim();
  if (s === '') return null;
  if (s.startsWith('"')) {
    if (!s.endsWith('"') || s.length < 2) throw new YamlError('unterminated "string"', no);
    return unquoteDouble(s.slice(1, -1), no);
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw new YamlError("unterminated 'string'", no);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith('[') || s.startsWith('{')) return flow(s, no);
  if (/^[&*!]/.test(s)) throw new YamlError('anchors, aliases and tags are not supported', no);
  if (s === '|' || s === '>' || /^[|>][+-]?\d*$/.test(s)) throw new YamlError('block scalars (| and >) are not supported: write the value on one line', no);
  if (/^(null|Null|NULL|~)$/.test(s)) return null;
  if (/^(true|True|TRUE)$/.test(s)) return true;
  if (/^(false|False|FALSE)$/.test(s)) return false;
  if (/^[-+]?\d+$/.test(s) && Math.abs(Number(s)) <= Number.MAX_SAFE_INTEGER) return Number(s);
  if (/^[-+]?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return s;
}

/** One-line flow collection: [a, "b", {c: 1}] or {a: 1, b: [x]}. */
function flow(s: string, no: number): unknown {
  let i = 0;
  const ws = () => { while (i < s.length && s[i] === ' ') i++; };
  const value = (): unknown => {
    ws();
    if (s[i] === '[') {
      i++;
      const arr: unknown[] = [];
      ws();
      if (s[i] === ']') { i++; return arr; }
      for (;;) {
        arr.push(value());
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return arr; }
        throw new YamlError('expected , or ] in a flow sequence', no);
      }
    }
    if (s[i] === '{') {
      i++;
      const obj: Record<string, unknown> = {};
      ws();
      if (s[i] === '}') { i++; return obj; }
      for (;;) {
        ws();
        const k = token(':');
        if (s[i] !== ':') throw new YamlError('expected key: value in a flow mapping', no);
        i++;
        const key = String(scalar(k, no));
        if (key in obj) throw new YamlError(`duplicate key "${key}"`, no);
        obj[key] = value();
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return obj; }
        throw new YamlError('expected , or } in a flow mapping', no);
      }
    }
    return scalar(token(''), no);
  };
  const token = (extraStop: string): string => {
    ws();
    const start = i;
    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++];
      while (i < s.length && s[i] !== q) { if (q === '"' && s[i] === '\\') i++; i++; }
      if (s[i] !== q) throw new YamlError('unterminated quoted string', no);
      i++;
      return s.slice(start, i);
    }
    while (i < s.length && !',]}'.includes(s[i]) && !(extraStop && s[i] === extraStop)) i++;
    return s.slice(start, i).trim();
  };
  const v = value();
  ws();
  if (i !== s.length) throw new YamlError('unexpected text after a flow collection', no);
  return v;
}

/** Split "key: value" (key may be quoted). Returns null when the text is not a mapping entry. */
function splitKey(text: string): { key: string; rest: string } | null {
  let key: string;
  let i: number;
  if (text.startsWith('"') || text.startsWith("'")) {
    const q = text[0];
    i = 1;
    while (i < text.length && text[i] !== q) { if (q === '"' && text[i] === '\\') i++; i++; }
    if (i >= text.length) return null;
    key = q === '"' ? unquoteDouble(text.slice(1, i), 0) : text.slice(1, i).replace(/''/g, "'");
    i++;
    if (text[i] !== ':') return null;
  } else {
    const m = /^([^\s:[\]{},#&*!|>'"%@`][^:]*?|[^\s:[\]{},#&*!|>'"%@`]):(\s|$)/.exec(text);
    if (!m) return null;
    key = m[1].trim();
    i = m[1].length;
  }
  return { key, rest: text.slice(i + 1).trim() };
}

class Parser {
  i = 0;
  constructor(private ls: Line[]) {}

  node(indent: number): unknown {
    const l = this.ls[this.i];
    if (!l || l.indent < indent) return null;
    if (l.text === '-' || l.text.startsWith('- ')) return this.seq(l.indent);
    if (splitKey(l.text)) return this.map(l.indent);
    this.i++;
    const v = scalar(l.text, l.no);
    const next = this.ls[this.i];
    if (next && next.indent > l.indent) throw new YamlError('unexpected indentation (multi-line plain scalars are not supported)', next.no);
    return v;
  }

  seq(indent: number): unknown[] {
    const out: unknown[] = [];
    while (this.i < this.ls.length) {
      const l = this.ls[this.i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
      if (!(l.text === '-' || l.text.startsWith('- '))) break;
      const rest = l.text === '-' ? '' : l.text.slice(2);
      const restIndent = indent + 2 + (rest.length - rest.trimStart().length);
      const r = rest.trim();
      if (!r) {
        this.i++;
        const next = this.ls[this.i];
        out.push(next && next.indent > indent ? this.node(next.indent) : null);
      } else if (r.startsWith('- ') || r === '-' || (splitKey(r) && !r.startsWith('[') && !r.startsWith('{'))) {
        // "- key: value" (or a nested "- - x"): the rest is the first line of a block at its column.
        this.ls[this.i] = { indent: restIndent, text: r, no: l.no };
        out.push(this.node(restIndent));
      } else {
        this.i++;
        out.push(scalar(r, l.no));
        const next = this.ls[this.i];
        if (next && next.indent > indent) throw new YamlError('unexpected indentation after a list item', next.no);
      }
    }
    return out;
  }

  map(indent: number): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    while (this.i < this.ls.length) {
      const l = this.ls[this.i];
      if (l.indent < indent) break;
      if (l.indent > indent) throw new YamlError('unexpected indentation', l.no);
      if (l.text === '-' || l.text.startsWith('- ')) throw new YamlError('a list item where a "key: value" was expected', l.no);
      const kv = splitKey(l.text);
      if (!kv) throw new YamlError(`expected "key: value", found "${l.text.slice(0, 40)}"`, l.no);
      if (kv.key === '<<') throw new YamlError('merge keys (<<) are not supported', l.no);
      if (Object.prototype.hasOwnProperty.call(out, kv.key)) throw new YamlError(`duplicate key "${kv.key}"`, l.no);
      this.i++;
      if (kv.rest) {
        out[kv.key] = scalar(kv.rest, l.no);
        const next = this.ls[this.i];
        if (next && next.indent > indent) throw new YamlError(`unexpected indentation after "${kv.key}: ${kv.rest.slice(0, 20)}"`, next.no);
      } else {
        const next = this.ls[this.i];
        if (next && next.indent > indent) out[kv.key] = this.node(next.indent);
        else if (next && next.indent === indent && (next.text === '-' || next.text.startsWith('- '))) out[kv.key] = this.seq(indent);
        else out[kv.key] = null;
      }
    }
    return out;
  }
}

export function parseYaml(src: string): unknown {
  const ls = lines(src);
  if (!ls.length) return null;
  const p = new Parser(ls);
  const v = p.node(ls[0].indent);
  if (p.i < ls.length) throw new YamlError('unexpected content (check the indentation)', ls[p.i].no);
  return v;
}
