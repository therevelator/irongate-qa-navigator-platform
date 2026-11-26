#!/usr/bin/env node
/**
 * Builds the QE Navigator PDFs (docs/pdf/**) from the content in docs/pdf/src/content with headless Chromium.
 *
 *   npm run docs:pdf              every document
 *   npm run docs:pdf -- flaky     only documents whose path contains "flaky"
 *
 * Content lives in plain data (src/content/*.mjs); the look is src/theme.css (the app's Porcelain theme);
 * screenshots are src/screens/<slug>.jpg (npm run docs:pdf:screens takes them from a running app).
 * The PDFs are committed, so people read them without building anything.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import os from 'node:os';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, 'src');
const ROOT = path.resolve(HERE, '..', '..');
// Only characters of the standard Windows-1252 set reach the page (see "Fonts" below): arrows become ›.
const esc = (s) => String(s ?? '').replace(/→/g, '›').replace(/−/g, '-').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Inline markup in content strings: **bold**, `code`, [text](url). Everything else is escaped. */
const md = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code>$1</code>')
  .replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>');
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;
const LOGO = dataUri(path.join(ROOT, 'public/brand/qe-shield-240.png'), 'image/png');
// Inter is embedded from src/fonts (TrueType outlines, so every viewer gets real, selectable text) and the build
// does not depend on the fonts installed on the machine.
const FONTS = [400, 500, 600, 700].map((w) => `@font-face{font-family:"Inter PDF";font-weight:${w};font-style:normal;src:url(${dataUri(path.join(SRC, 'fonts', `inter-latin-${w}-normal.woff2`), 'font/woff2')}) format("woff2");}`).join('\n');
const CSS = `${FONTS}\n${fs.readFileSync(path.join(SRC, 'theme.css'), 'utf8')}`;

const ul = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${md(i)}</li>`).join('')}</ul>` : '');
const paras = (ps) => (Array.isArray(ps) ? ps : [ps]).filter(Boolean).map((p) => `<p>${md(p)}</p>`).join('');
const table = (head, rows, cls = '') => `<table class="${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${md(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
const card = (title, body, cls = '') => `<div class="card avoid ${cls}">${title ? `<h3>${md(title)}</h3>` : ''}${body}</div>`;
const callout = (text, kind = '') => (text ? `<div class="callout ${kind}">${md(text)}</div>` : '');
/** A step is a bold title and a sentence under it; content may write the sentence as a continuation (": the page…"). */
const sentence = (d) => { const t = String(d ?? '').replace(/^[:\s]+/, ''); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
const steps = (items) => `<ol class="steps">${items.map(([t, d]) => `<li><b>${md(String(t).replace(/[.:]$/, ''))}</b>${md(sentence(d))}</li>`).join('')}</ol>`;
// The address is printed: the final PDFs carry no clickable links (see "Fonts" below).
const sources = (list) => (list?.length ? `<p class="source" style="margin-top:6pt">Sources: ${list.map(([t, u]) => `${esc(t)}: ${esc(u.replace(/^https?:\/\//, ''))}`).join(' · ')}</p>` : '');

const cover = ({ kicker, title, lead, chips = [] }) => `
<header class="cover avoid">
  <div class="cover-top"><img src="${LOGO}" alt=""><div class="cover-brand">IronGate QE Navigator<span>Quality engineering intelligence</span></div></div>
  <div class="kicker">${esc(kicker)}</div>
  <h1>${esc(title)}</h1>
  ${lead ? `<p class="lead">${md(lead)}</p>` : ''}
  ${chips.length ? `<div class="chips">${chips.map(([k, v]) => `<span class="chip"><b>${esc(k)}</b> ${md(v)}</span>`).join('')}</div>` : ''}
</header>`;

/** Generic blocks, for the documents that are not a feature or a role. */
function block(b) {
  if (b.h2) return `<h2>${esc(b.h2)}</h2>`;
  if (b.p) return `<div class="card avoid">${paras(b.p)}</div>`;
  if (b.ul) return card(b.title, ul(b.ul));
  if (b.table) return `<div class="card">${b.title ? `<h3>${md(b.title)}</h3>` : ''}${table(b.table.head, b.table.rows, b.table.wrap ? 'wrap' : '')}${b.note ? `<p class="small muted" style="margin-top:6pt">${md(b.note)}</p>` : ''}</div>`;
  if (b.steps) return `<div class="card">${b.title ? `<h3>${md(b.title)}</h3>` : ''}${steps(b.steps)}</div>`;
  if (b.cards) return `<div class="grid${b.cols ?? 2}">${b.cards.map(([t, d]) => card(t, Array.isArray(d) ? ul(d) : paras(d))).join('')}</div>`;
  if (b.callout) return callout(b.callout, b.kind);
  if (b.sources) return sources(b.sources);
  return '';
}

function shot(slug, caption) {
  const file = path.join(SRC, 'screens', `${slug}.jpg`);
  if (!fs.existsSync(file)) return '';
  return `<figure class="shot"><img src="${dataUri(file, 'image/jpeg')}" alt=""><figcaption>${esc(caption)}</figcaption></figure>`;
}

function featureHtml(f) {
  return `${cover({
    kicker: `Feature guide · ${f.group}`, title: f.name, lead: f.oneLine,
    chips: [['Menu', f.menu ?? `${f.group} → ${f.name}`], ['Who opens it', f.access], ...(f.address ? [['Address', `\`${f.address}\``]] : [])],
  })}
${shot(f.slug, `${f.name} in the Porcelain theme, with demonstration data.`)}
<h2>What it does</h2>${card('', ul(f.does))}
<h2>What it is good for</h2>${card('', ul(f.goodFor))}
<h2>Why you need it</h2><div class="card avoid">${paras(f.why)}${sources(f.sources)}</div>
<h2>Who uses it, and for what</h2><div class="card">${table(['Role', 'What they do here'], f.roles, 'wrap')}</div>
<h2>Where the numbers come from</h2><div class="card avoid">${paras(f.data)}</div>
${f.read?.length ? `<h2>How to read it</h2>${card('', ul(f.read))}` : ''}
${f.limits?.length ? `<h2>What it does not do</h2>${card('', ul(f.limits))}` : ''}
${f.related?.length ? `<h2>Goes together with</h2><div class="card avoid"><p>${f.related.map((r) => `<span class="tag">${esc(r)}</span>`).join(' ')}</p></div>` : ''}`;
}

function roleHtml(r) {
  return `${cover({
    kicker: 'Use cases by role', title: r.role, lead: r.oneLine,
    chips: [['Also called', r.aka], ['Role in QE Navigator', r.navigatorRole], ['Sees', r.scope]],
  })}
<h2>What this person is accountable for</h2><div class="card avoid">${paras(r.accountable)}</div>
<h2>The questions they bring</h2>${card('', ul(r.questions))}
<h2>Use cases</h2>
${r.useCases.map((u, i) => `<div class="card usecase"><h3>${i + 1}. ${md(u.title)}</h3><p><strong>Situation.</strong> ${md(u.when)}</p><p><strong>In QE Navigator.</strong> ${md(u.how)}</p><p><strong>Result.</strong> ${md(u.result)}</p><p class="where">${esc(u.where)}</p></div>`).join('')}
<h2>Their rhythm</h2><div class="card">${table(['When', 'What they open, and why'], r.rhythm, 'wrap')}</div>
<h2>Numbers they watch</h2>${card('', ul(r.metrics))}
<h2>Limits that protect the team</h2>${card('', ul(r.limits))}
${r.why ? `<h2>Why it matters</h2><div class="card avoid">${paras(r.why)}${sources(r.sources)}</div>` : ''}`;
}

function docHtml(d) {
  return `${cover({ kicker: d.kicker, title: d.title, lead: d.lead, chips: d.chips })}${d.blocks.map(block).join('\n')}`;
}

function slideBody(s) {
  if (s.cards) return `<div class="grid${s.cols ?? 3}">${s.cards.map(([t, d, n]) => `<div class="card">${n ? `<div class="num">${esc(n)}</div>` : ''}<h3>${md(t)}</h3>${Array.isArray(d) ? ul(d) : paras(d)}</div>`).join('')}</div>`;
  if (s.steps) return steps(s.steps);
  if (s.table) return `<div class="card">${table(s.table.head, s.table.rows, 'wrap')}</div>`;
  if (s.ul) return `<div class="card">${ul(s.ul)}</div>`;
  return '';
}

function deckHtml(d) {
  const total = d.slides.length + 1;
  const foot = (n) => `<div class="foot"><span>IronGate QE Navigator · ${esc(d.title)}</span><span>${n} / ${total}</span></div>`;
  const head = `<div class="slide-head"><span class="who"><img src="${LOGO}" alt="">QE Navigator</span><span>${esc(d.kicker)}</span></div>`;
  return `<section class="slide title"><img class="logo" src="${LOGO}" alt=""><div class="kicker">${esc(d.kicker)}</div><h1>${esc(d.title)}</h1><p class="lead">${md(d.lead)}</p>${foot(1)}</section>
${d.slides.map((s, i) => `<section class="slide">${head}<h2>${md(s.title)}</h2>${s.sub ? `<p class="sub">${md(s.sub)}</p>` : ''}<div class="body">${slideBody(s)}${callout(s.note, s.noteKind)}</div>${foot(i + 2)}</section>`).join('\n')}`;
}

let GLOW = '';
const page = (body, deck) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${CSS}\n.cover, .slide { background: #f6f2ec url(${GLOW}) center / 100% 100% no-repeat; }</style></head><body class="${deck ? 'deck' : ''}">${body}</body></html>`;

async function load() {
  const out = [];
  const dir = path.join(SRC, 'content');
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(dir, file)).href);
    for (const f of mod.features ?? []) out.push({ file: `features/${f.file ?? f.slug}.pdf`, title: f.name, html: featureHtml(f) });
    for (const r of mod.roles ?? []) out.push({ file: `use-cases/${r.slug}.pdf`, title: `Use cases: ${r.role}`, html: roleHtml(r) });
    for (const d of mod.docs ?? []) out.push({ file: `${d.file}.pdf`, title: d.title, html: docHtml(d) });
    for (const d of mod.decks ?? []) out.push({ file: `${d.file}.pdf`, title: d.title, html: deckHtml(d), deck: true });
  }
  return out;
}

const footer = (title) => `<style>${FONTS}</style><div style="width:100%;font-family:'Inter PDF',sans-serif;font-size:7pt;color:#7a7268;padding:0 16mm;display:flex;justify-content:space-between;">
  <span>IronGate QE Navigator · ${esc(title)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;

const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const documents = (await load()).filter((d) => !only.length || only.some((o) => d.file.includes(o)));
/*
 * Fonts. Chromium writes text with subset fonts in a two-byte encoding (Type 0 / Identity-H). Chrome, Acrobat,
 * Preview and pdf.js read that; some simpler viewers (the GitHub mobile app is one) do not, and show the glyph
 * numbers as random letters. So every PDF is rewritten with poppler's pdftocairo, which embeds the same fonts as
 * simple TrueType subsets in the standard WinAnsi encoding: the form every viewer handles, and one in which even
 * a viewer that ignores embedded fonts still shows the right letters. That is also why only Windows-1252
 * characters are used. The rewrite drops link annotations, so addresses are printed as text.
 */
let cairo = true;
try { execFileSync('pdftocairo', ['-v'], { stdio: 'ignore' }); } catch { cairo = false; }
if (!cairo) { console.error('pdftocairo (poppler-utils) is required: without it the PDFs are unreadable in some viewers.\n  macOS: brew install poppler   Debian/Ubuntu: apt install poppler-utils'); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qe-pdf-'));
const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
const tab = await browser.newPage();
// The Porcelain glow (soft radial gradients) is painted once as a small image: as CSS gradients with transparency
// Chromium writes them into every PDF as large shadings (about 0.5 MB per document).
await tab.setViewportSize({ width: 1280, height: 720 });
await tab.setContent(`<style>${CSS} body{margin:0} div{width:1280px;height:720px;background:var(--glow)}</style><div></div>`);
GLOW = `data:image/jpeg;base64,${(await tab.screenshot({ type: 'jpeg', quality: 82 })).toString('base64')}`;
for (const d of documents) {
  const target = path.join(HERE, d.file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const raw = path.join(tmp, 'raw.pdf');
  await tab.setContent(page(d.html, d.deck), { waitUntil: 'load' });
  await tab.evaluate(() => document.fonts.ready);
  if (d.deck) {
    // A slide with more content than fits is scaled down as a whole (never clipped): its body shrinks in small
    // steps until it fits above the footer.
    await tab.evaluate(() => {
      for (const body of document.querySelectorAll('.slide .body')) {
        let zoom = 1;
        while (body.scrollHeight > body.clientHeight + 1 && zoom > 0.6) { zoom -= 0.03; body.style.zoom = String(zoom); }
      }
    });
    await tab.pdf({ path: raw, width: '13.333in', height: '7.5in', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } else {
    await tab.pdf({
      path: raw, format: 'A4', printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer(d.title),
      margin: { top: '14mm', bottom: '16mm', left: '16mm', right: '16mm' },
    });
  }
  execFileSync('pdftocairo', ['-pdf', raw, target]);
  const fonts = execFileSync('pdffonts', [target]).toString();
  if (/Type 3|CID|Identity/.test(fonts)) throw new Error(`${d.file}: a font is not in the simple WinAnsi form (a character outside Windows-1252, or a font that is not Inter PDF?)\n${fonts}`);
  console.log(`  ${d.file}`);
}
await browser.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${documents.length} PDF${documents.length === 1 ? '' : 's'} written to docs/pdf/`);
