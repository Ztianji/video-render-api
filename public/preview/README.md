# Preview proxy assets

Remotion Studio uses local proxy files so HTTP-only media can play without CORS or expiring links. Drop the preview assets into this folder structure so the `CombinedSimplifiedShowcase` demo can resolve them automatically:

- `public/preview/audio` – speaker tracks and background music.
- `public/preview/background` – background videos or stills referenced by each segment.
- `public/preview/images` – optional cover art (for example `combined-simplified-cover.png`).

When Studio rewrites a remote URL it lowercases the original filename and replaces any character outside `[a-z0-9._-]` with `-`. Name your proxy files accordingly (e.g. `PASSO BEM SOLTO.mp3` → `passo-bem-solto.mp3`) so the computed lookup path matches the file you drop here.
