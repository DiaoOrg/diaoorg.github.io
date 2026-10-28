# miao-org.github.io

A short, single-page site for **miao — Mechanics, Intelligence, Actuation & Operation**,
the open robotics organization at [github.com/miao-org](https://github.com/miao-org).

Live at **<https://miao-org.github.io>**.

No build step, no framework, no dependencies to install. Just HTML, CSS and a
little JavaScript. The optional membership form uses a separate Cloudflare
Worker; the public site still has no build step.

## Preview locally

```bash
cd ~/workspace/miao-org.github.io
python3 -m http.server 5173
```

Then open <http://localhost:5173>.

## Structure

```
index.html          page markup and content
styles.css          design system and layout
main.js             nav, scroll reveal, scroll spy
onboarding.js       invitation form and Turnstile verification
join/index.html     dedicated membership page at /join/
onboarding-config.json  public invitation API origin (never a token)
worker/             Cloudflare invitation API and rate limits
tests/              invitation API regression tests
assets/favicon.svg  gradient "M" mark
.nojekyll           serve the files as-is on GitHub Pages
```

## Editing

- **Copy** lives in `index.html`. Sections are marked with IDs:
  `#pillars`, `#loop`, `#work`, `#open`.
- **Colors and type** are defined once as custom properties at the top of
  `styles.css` (`--m`, `--i`, `--a`, `--o` for the four pillars).
- **Project cards** in the Work section link only to public repositories owned
  by `miao-org`. Check each repository's current README before updating its
  description, and keep the organization profile's project list in sync.
- The site is responsive down to 360 px and respects
  `prefers-reduced-motion`.

## Deployment

The repository is named `miao-org.github.io` so GitHub Pages serves it as the
organization site for `miao-org`.

- **Branch:** `main`
- **Source:** repository root
- **URL:** <https://miao-org.github.io>

Pushes to `main` publish automatically. To change the custom domain later, add
a `CNAME` file and configure it in **Settings → Pages**.

## Fonts

Space Grotesk, Inter, and JetBrains Mono are loaded from Google Fonts. The site
falls back to system fonts when offline.

## Automatic organization onboarding

See [the deployment and operations guide](docs/onboarding.md).
GitHub sends the official invitation email; accepting it joins **miao-org** as
an ordinary member and adds the person to the community team (ID `20310971`).
Applicants must use an email verified on their GitHub account.
