# diaoorg.github.io

A short, single-page site for **DIAO — Dynamics, Intelligence, Actuation & Operation**,
the open robotics organization at [github.com/DiaoOrg](https://github.com/DiaoOrg).

Live at **<https://diaoorg.github.io>**.

No build step, no framework, no dependencies to install. Just HTML, CSS and a
little JavaScript.

## Preview locally

```bash
cd ~/workspace/diaoorg.github.io
python3 -m http.server 5173
```

Then open <http://localhost:5173>.

## Structure

```
index.html          page markup and content
styles.css          design system and layout
main.js             nav, scroll reveal, scroll spy
assets/favicon.svg  gradient "D" mark
.nojekyll           serve the files as-is on GitHub Pages
```

## Editing

- **Copy** lives in `index.html`. Sections are marked with IDs:
  `#pillars`, `#loop`, `#work`, `#open`.
- **Colors and type** are defined once as custom properties at the top of
  `styles.css` (`--d`, `--i`, `--a`, `--o` for the four pillars).
- **Project cards** in the Work section currently link to public repositories
  from the people behind the organization. Swap them for organization
  repositories as those are published.
- The site is responsive down to 360 px and respects
  `prefers-reduced-motion`.

## Deployment

The repository is named `diaoorg.github.io` so GitHub Pages serves it as the
organization site for `DiaoOrg`.

- **Branch:** `main`
- **Source:** repository root
- **URL:** <https://diaoorg.github.io>

Pushes to `main` publish automatically. To change the custom domain later, add
a `CNAME` file and configure it in **Settings → Pages**.

## Fonts

Space Grotesk, Inter, and JetBrains Mono are loaded from Google Fonts. The site
falls back to system fonts when offline.
