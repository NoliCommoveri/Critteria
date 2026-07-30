# Critteria App

A Tamagotchi-style virtual pet for four siblings (and, later, invited
friends), built as a web app / PWA and hosted at
[critteria.immotus.app](https://critteria.immotus.app).

## Layout

```
index.html    Single-file PWA. Loads pixel-art sprites from assets/, syncs
              pet state to the API once a device joins a family (SPEC.md §9
              Step 10).
assets/       Species sprites, palettes, and generation reference art.
SPEC.md       Full design spec — read this before making changes.
schema.sql    D1 schema — full CREATE TABLE inline in SPEC.md §9 Step 5.
functions/    Cloudflare Worker endpoints (Pages-Functions file-based
              routing), bundled by `wrangler pages functions build` into
              dist/worker/index.js. Endpoint list in SPEC.md §9.
dist/worker/  Bundled Worker entrypoint; committed because CF's
              git-connected Worker deploy doesn't run the bundler. Rebuild
              and commit by hand after any change under functions/.
wrangler.toml Worker config: [assets] binding + [[d1_databases]] binding.
              Full contents in SPEC.md §9 Step 6.
.assetsignore Static-assets ignore list — must include .git/ (SPEC.md §9
              Step 8 has the full list and the reason).
```

Everything under the repo root is served by the Worker via the `[assets]`
binding. Local development for the frontend is opening `index.html` in a
browser — no build step. Local backend development uses `npx wrangler dev`.

## Hosting

Cloudflare Workers, static assets + D1, git-connected to `main`. Both the
static PWA and the API (`/api/*`) are served from `critteria.immotus.app`
by the same Worker — same origin, no CORS. This mirrors the pattern
documented in `NoliCommoveri/Star-homeschool` under
`docs/parent-sync-spec.md §12`.

GitHub Pages is not used, despite this repo being on GitHub. An earlier
draft of the plan had it on GH Pages; the switch to CF Workers happened
before any backend code landed.

## History

Extracted from [`NoliCommoveri/site`](https://github.com/NoliCommoveri/site)
via `git subtree split -P pet` on 2026-07-30, so the pre-split commits still
live in this repo's `main` history.

## Status

- **Frontend**: six species with idle/happy/sad/sleep poses drawn to the
  style rules in `SPEC.md §4`. Action poses (eat/play/bath) still fall
  back to the required tier per the fallback chain.
- **Backend**: live at `critteria.immotus.app` — CF Workers with
  `[assets]` + D1, `SIGNUP_SECRET`-gated family creation, pairing codes
  for kid device tokens, once-a-day helper actions on a sibling's pet,
  polling reads at ~5 s. Adapted from `NoliCommoveri/Star-homeschool`
  `docs/parent-sync-spec.md §12`. The pairing-code round-trip is still
  unconfirmed against the live deployment (`SPEC.md §9` Step 9).
- **Sync**: `index.html` is now wired to the backend (`SPEC.md §9` Step
  10) — family setup, kid picker, server-synced pet state, and a
  sibling-visit view with helper actions. A device with no family token
  still plays fully offline from `localStorage`, unchanged from the
  original prototype.
