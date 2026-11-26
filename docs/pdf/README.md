# QE Navigator PDFs

Documents for people who evaluate, roll out and use QE Navigator. English, in the product's **Porcelain** theme.
They live in the repository only; the app does not serve them.

| Folder | What is in it |
|---|---|
| [`features/`](features) | One guide per page of the menu (33): what it does, what it is good for, why you need it, who uses it, where the numbers come from, how to read it, what it does not do. |
| [`use-cases/`](use-cases) | Use cases for 16 roles of a software company, from CTO to HR partner, and an overview of who uses what ([`00-roles-and-features.pdf`](use-cases/00-roles-and-features.pdf)). |
| [`getting-started/`](getting-started) | The initial process as presentations: the whole setup ([`00-initial-setup.pdf`](getting-started/00-initial-setup.pdf)) and one deck per role (10). |
| [`data-collection-frequency.pdf`](data-collection-frequency.pdf) | How often data is collected, our recommendations, and how to change them. |

## Changing a document

The text is plain data in [`src/content/`](src/content) (one file per group), the look is [`src/theme.css`](src/theme.css),
the screenshots are [`src/screens/`](src/screens). Edit, then:

```bash
npm run docs:pdf              # every document
npm run docs:pdf -- flaky     # only the ones whose path contains "flaky"
npm run docs:pdf:screens      # retake the screenshots from a running app with the demo data (then rebuild)
```

Headless Chromium (Playwright, already a dev dependency) prints them; Inter is embedded from `src/fonts`. Each file is
then rewritten with `pdftocairo` (poppler-utils: `brew install poppler` / `apt install poppler-utils`), which stores
the fonts in the plain WinAnsi form every viewer reads. Chromium's own output showed as random letters in simpler
viewers such as the GitHub mobile app. The build stops if any font is left in another form, which happens when a
character outside Windows-1252 is used (write `›` or "to" instead of an arrow). The rewrite drops clickable links, so
addresses are printed as text. Commit the PDFs
with the content change, so nobody needs to build to read them.

## Rules the content follows

- Describe what the product does today. If a page changes, change its guide in the same pull request.
- External figures carry their source in the document. No figure without a source we could name; no "100x" folklore.
- Teams, not people: nothing here presents individual data as a way to judge someone.
