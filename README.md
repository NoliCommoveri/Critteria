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
reset.sql     Drops every table so schema.sql can be re-applied. Only
              safe while there's no real data; see SPEC.md §9 Step 5a.
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
- **Multiple pets**: a kid earns a second pet after 7 good-care days and
  a third after 21, capped at three. A good-care day is banked by
  looking after your *own* pet well enough to leave its stats averaging
  80+ — once per day, and helping a sibling never counts. Since only
  sleep raises energy, a full round of care (and, on a pet that's been
  up all day, a nap) is what banks a day; mashing feed/play/clean at an
  exhausted pet doesn't. The pet you're
  not currently watching sits in the "burrow" and decays at a tenth of
  the normal rate, so extra pets add care load without multiplying it.
  The roster strip above the pet shows what you have and how many days
  are left on the next egg. Works offline too. See `SPEC.md §5`
  "Multiple pets". `schema.sql` already has the shape this needs; a
  database created before it needs the reset in `SPEC.md §9` Step 5a.
- **Hatching sequence**: T-Rex and Dragon have the full one-time animated
  hatch/birth sequence (egg → crack → crack → newborn) played right after
  species selection; see `SPEC.md §5` "Hatching / birth sequence" for the
  build plan and per-species progress. The other four species still skip
  straight to instant pet creation pending their four hatch frames.
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
