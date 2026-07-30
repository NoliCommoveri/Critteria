# Critteria

A Tamagotchi-style virtual pet for four siblings (and, later, invited
friends), built as a web app / PWA and hosted at
[critteria.immotus.app](https://critteria.immotus.app).

## Layout

```
index.html    Single-file PWA. Loads pixel-art sprites from assets/.
assets/       Species sprites, palettes, and generation reference art.
SPEC.md       Full design spec — read this before making changes.
schema.sql    (planned) D1 schema for family/kid/pet sync.
functions/    (planned) Cloudflare Worker endpoints (Pages-Functions
              file-based routing), bundled by `wrangler pages functions
              build` into dist/worker/index.js.
dist/worker/  (planned) Bundled Worker entrypoint; committed because
              CF's git-connected Worker deploy doesn't run the bundler.
wrangler.toml (planned) Worker config: [assets] binding + [[d1_databases]]
              binding. Source of truth for a git-connected Worker; the
              dashboard's binding editor is locked.
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

- **Frontend prototype**: works locally, five species with idle/happy/sad/
  sleep poses drawn to the style rules in `SPEC.md §4`.
- **Backend**: not built. `SPEC.md §5–7` describes the target end-state;
  the concrete v1 plan is D1-only sync, polling reads, `SIGNUP_SECRET`-gated
  family creation, pairing codes for kid device tokens, once-a-day helper
  actions on a sibling's pet.
