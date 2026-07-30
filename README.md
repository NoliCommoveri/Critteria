# Critteria

A Tamagotchi-style virtual pet for four siblings (and, later, invited
friends), built as a web app / PWA and hosted at
[pet.immotus.app](https://pet.immotus.app).

## Layout

```
index.html    Single-file PWA. Loads pixel-art sprites from assets/.
assets/       Species sprites, palettes, and generation reference art.
SPEC.md       Full design spec — read this before making changes.
worker/       (planned) Cloudflare Worker + D1 backend for cross-device
              sync, sibling visits, gifting, and presence. Not yet built.
```

Everything under the repo root is served by GitHub Pages. Local development
is just opening `index.html` in a browser — no build step.

## History

Extracted from [`NoliCommoveri/site`](https://github.com/NoliCommoveri/site)
via `git subtree split -P pet` on 2026-07-30, so the pre-split commits still
live in this repo's `main` history.

## Status

- **Frontend prototype**: works locally, five species with idle/happy/sad/
  sleep poses drawn to the style rules in `SPEC.md §4`.
- **Backend**: not built. `SPEC.md §5–7` describes the target end-state
  (Cloudflare Workers + D1 + Durable Objects, family passcode + kid PIN
  auth, polling-based sibling visits).
