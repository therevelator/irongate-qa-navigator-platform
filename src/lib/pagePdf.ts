import { applyTheme, isThemeId, type ThemeId } from './appearance';

/**
 * "Download PDF" of the page on screen: the whole page with every section expanded, in the light theme, through
 * the browser's own print-to-PDF (the text stays text, tables break across pages; nothing is uploaded anywhere).
 *
 * Before printing: every collapsed <details> and every collapsed accordion (a button with aria-expanded="false") is opened, the one-at-a-time sections are all shown (their panels
 * carry `print:block`), the page switches to the light theme and the document title becomes the file name the
 * browser proposes. After printing everything is put back.
 */
export function pdfFileName(page: string, context: string | null, day = new Date()): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return [clean('QE Navigator'), clean(page), context ? clean(context) : null, day.toISOString().slice(0, 10)].filter(Boolean).join(' - ');
}

export function downloadPagePdf(page: string, context: string | null = null): void {
  const root = document.documentElement;
  const previousTheme = root.getAttribute('data-theme');
  const previousTitle = document.title;
  const opened: HTMLDetailsElement[] = [];
  document.querySelectorAll<HTMLDetailsElement>('main details:not([open])').forEach((d) => { d.open = true; opened.push(d); });
  // Accordions kept in component state: the buttons that say they are collapsed (menus and pop-ups are left alone).
  const expanded: HTMLElement[] = [];
  document.querySelectorAll<HTMLElement>('main button[aria-expanded="false"]:not([aria-haspopup]):not([role="combobox"])').forEach((btn) => { btn.click(); expanded.push(btn); });
  root.setAttribute('data-printing', 'true');
  applyTheme(root, 'light');
  document.title = pdfFileName(page, context);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    window.removeEventListener('afterprint', restore);
    opened.forEach((d) => { d.open = false; });
    expanded.forEach((btn) => { if (btn.isConnected && btn.getAttribute('aria-expanded') === 'true') btn.click(); });
    root.removeAttribute('data-printing');
    if (isThemeId(previousTheme)) applyTheme(root, previousTheme as ThemeId);
    document.title = previousTitle;
  };
  window.addEventListener('afterprint', restore);
  // Let the theme and the opened sections paint before the print dialog takes its snapshot.
  window.setTimeout(() => { window.print(); window.setTimeout(restore, 1500); }, 400);
}
