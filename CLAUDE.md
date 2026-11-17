# Stopmoergel

Browser-based stop motion app for **children (approx. 6–12)**. Local-only (no backend, no accounts):
projects and frames live in IndexedDB. Plans and design notes live in `docs/` — read
[docs/PLAN.md](docs/PLAN.md) before larger changes and keep it up to date.

## Commands

- `npm run dev` — dev server (Vite, also exposed on LAN for testing on tablets; camera needs HTTPS or localhost)
- `npm run build` — typecheck + production build into `dist/`
- `npm run typecheck` — TypeScript only
- `npm test` — vitest unit tests (jsdom + fake-indexeddb)

Always run `npm run typecheck && npm test` after changes; run `npm run build` before declaring done.

## Deployment

Docker image (Node build → `nginx-unprivileged` on :8080) + Caddy for HTTPS via `docker-compose.yml`.
See [docs/DEPLOY.md](docs/DEPLOY.md). HTTPS is mandatory in production (camera/mic need a secure origin).
`deploy/nginx.conf` sets a strict **Content-Security-Policy**: everything must be served from the app itself
(no CDNs, no external fonts/scripts). If a feature needs a new source (e.g. a `blob:` worker), update the CSP
there and test against the container (`docker build` + run, then the browser smoke tests).

## Stack

Vite + React 19 + TypeScript (strict), plain CSS with variables, `idb`, `lucide-react` icons,
font `@fontsource/baloo-2`, `mediabunny` (MP4 muxing), `fflate` (zip). No state library, no CSS framework, no router library.

## Layout

- `src/App.tsx` — hash routing: `#/` (Gallery) and `#/movie/<id>` (Studio)
- `src/i18n.ts` — **all** UI strings (de + en). Never hard-code user-facing text in components.
- `src/theme.css` — design tokens (colors, radii, `--touch` size). Use the variables, don't invent new colors.
- `src/lib/` — non-UI logic: `types.ts`, `db.ts`, `frames.ts`, `camera.ts`, `capture.ts`,
  `exportVideo.ts` (MP4 via WebCodecs + `mediabunny`, MediaRecorder fallback),
  `projectArchive.ts` (`.stopmoergel.zip` backup/import via `fflate`), `sounds.ts` (UI blips), `useProject.ts`
- `src/lib/audio/` — audio track: `clips.ts` (pure clip ops), `wav.ts`, `context.ts` (shared AudioContext),
  `recorder.ts` (mic → WAV, file → WAV), `mix.ts` (export mixdown), `peaks.ts` (waveforms),
  `useAudioPlayback.ts` (sync with the picture player)
- `src/components/ui/` — shared primitives: `BigButton`, `Dialog`, `Toast`
- `src/components/Gallery/`, `src/components/Studio/` — the two screens
- Tests sit next to the code as `*.test.ts`.

## Conventions

- Each component has a co-located `.css` file with BEM-ish class names prefixed by the component (`timeline__thumb`).
- Data model: `Project.frameIds` is the single source of truth for frame order. Frame blobs are
  stored separately and garbage-collected (`collectGarbage`) — never delete a frame blob directly
  from UI code, just drop it from `frameIds` (this keeps undo cheap and safe).
- Revoke every `URL.createObjectURL` you create.
- The backup format (`projectArchive.ts`) is a public contract: files from older versions must keep
  importing. Bump `ARCHIVE_FORMAT_VERSION` only for breaking changes and keep reading old versions.
- Audio clips are anchored to **pictures** (`startFrame`), their length is in **seconds**. Picture strip and
  audio row share the CSS variable `--pitch` (px per picture), so never size them independently.
  Sounds are always stored as mono WAV so projects work across browsers. See [docs/PLAN-audio.md](docs/PLAN-audio.md).
- Call `useProject().flush()` before reading the project back from the DB (e.g. for the backup file).
- Camera streams must be stopped (`track.stop()`) on unmount.

## UX rules (audience: kids)

- Icons first, very short labels. Touch targets ≥ `--touch` (64px). Big, chunky, colorful.
- Never lose work by accident: frame deletes are undoable; deleting a project needs a confirm dialog.
- No jargon: "Tempo" with turtle/rabbit, not "fps"; "Geist" (ghost) for onion skin.
- Give feedback for every action (sound, animation, toast).
- Must work with touch (iPad) and mouse/keyboard (Space = take picture).

## Working style

- Write plans for new features into `docs/*.md` before implementing.
- Delegate well-specified, self-contained pieces to subagents; keep integration and core UX work in the main agent.
