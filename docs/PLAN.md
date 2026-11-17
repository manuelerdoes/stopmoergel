# Stopmoergel — Plan (Iteration 1)

A browser-based stop motion app for children, in the spirit of "Cloud Stop Motion",
but without classroom/account features for now. Everything runs locally in the browser.

## Goals for iteration 1

- A child (approx. 6–12 years) can, without reading much text:
  1. create a new movie,
  2. take pictures with the webcam / tablet camera,
  3. see the previous picture as a ghost (onion skin) to line up the next one,
  4. play the movie back, faster or slower,
  5. fix mistakes (delete, duplicate, reorder frames, undo),
  6. save the movie as a video file.
- Projects survive a page reload (stored in IndexedDB).
- Works on desktop Chrome/Edge/Firefox/Safari and on iPad/Android tablets.

## Non-goals (later iterations)

- Classrooms, teacher accounts, sharing, cloud sync.
- Drawing on frames, titles, green screen.
- Remote camera (phone as camera for laptop).

## Tech stack

- Vite + React + TypeScript (strict).
- Plain CSS with CSS custom properties (one global theme file + per-component CSS files).
- `idb` for a small promise-based IndexedDB wrapper.
- `lucide-react` icons.
- `vitest` + `fake-indexeddb` for unit tests of non-UI logic.
- No backend. Static build, can be hosted anywhere.

## Architecture

```
src/
  main.tsx              entry
  App.tsx               tiny view switch: Gallery <-> Studio(projectId)
  i18n.ts               all UI strings (de + en), auto-detected
  theme.css             colors, fonts, sizes (CSS variables), base styles
  lib/
    types.ts            Project, Frame types
    db.ts               IndexedDB persistence (projects + frame blobs)
    frames.ts           pure helpers for frame-list ops (move, insert, remove)
    camera.ts           useCamera hook: getUserMedia, device list, switching
    capture.ts          grab current video frame -> JPEG Blob
    exportVideo.ts      frames -> MP4/WebM via canvas + MediaRecorder
    sounds.ts           tiny synthesized UI sounds (shutter, pop) via WebAudio
    useProject.ts       loads a project, exposes frame ops + undo, persists
  components/
    Gallery/            project list, new / rename / delete
    Studio/             main editing screen
      CameraView        live video + onion skin overlay + grid
      Timeline          thumbnails strip, select, drag to reorder
      Player            playback of frames at fps
      Toolbar           big icon buttons
      SpeedControl      turtle <-> rabbit fps slider
      ExportDialog      progress + download
    ui/                 BigButton, Dialog, Toast (shared primitives)
```

### Data model

```ts
Project { id, name, createdAt, updatedAt, fps, frameIds: string[], thumbFrameId? }
Frame   { id, projectId, blob: Blob (JPEG), width, height, createdAt }
```

- The project's `frameIds` array is the single source of truth for order.
- Undo = stack of previous `frameIds` arrays (cheap). Frame blobs are only
  removed from the DB when they are no longer referenced (garbage collection
  when a project is opened and when it is deleted), so undoing a delete works.

### Key UX decisions (kid-friendly)

- Huge round red capture button; also Space / Enter key.
- Icons first, short labels underneath. Rounded friendly font (Baloo 2), bright palette.
- Onion skin is ON by default (ghost of last frame, ~35% opacity), adjustable.
- Speed control shows a turtle and a rabbit, not "fps".
- Destructive actions (delete project) ask with a big friendly dialog; frame delete is instant but undoable (toast with "undo").
- Shutter sound + flash animation as feedback on capture.
- No text input needed except optional project renaming; new projects get a fun default name ("Movie 3").
- Capture appends at the end of the movie. (Insert-at-cursor is a later idea.)

### Export

- Draw each frame onto a canvas, `canvas.captureStream()` + `MediaRecorder`.
- Prefer `video/mp4` when supported (Safari, recent Chrome), fall back to `video/webm`.
- Export runs in real time of the movie length (fine for short kids' movies); show progress.

## Milestones / task split

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Plan, CLAUDE.md, scaffold, theme, types, i18n, ui primitives, `frames.ts` | main agent | done |
| 2 | `db.ts` + tests | subagent | done |
| 3 | `exportVideo.ts` + `sounds.ts` | subagent | done |
| 4 | Gallery screen | subagent | done |
| 5 | Camera, capture, useProject, Studio, Timeline, Player | main agent | done |
| 6 | Integration, build, smoke test in headless Chrome with fake camera | main agent | done |

Verified end to end (headless Chrome, fake camera): create movie, capture via button and
Space, duplicate, delete + undo, drag-reorder, playback, MP4 export download, reload persistence,
layouts at 1280×800, iPad portrait and phone width. Also shipped: importing pictures from files.

## Known limitations / to check on real devices

- Video export uses WebCodecs (fast, MP4). Only the MediaRecorder fallback for old browsers records in
  real time and needs the tab in the foreground. See [PLAN-mp4-and-backup.md](PLAN-mp4-and-backup.md).
- Camera access needs a secure context: `localhost` works, but testing on an iPad over the LAN
  needs HTTPS (e.g. add `@vitejs/plugin-basic-ssl` or deploy to an HTTPS host).
- **Open: iPhone camera switching is unreliable.** The switch used to cycle device IDs, which on iPhones hit
  extra back cameras or hung, leaving "please allow camera" on screen. It now toggles front/back via
  `facingMode`, releases the old camera first, and shows a retry when starting takes over 6 s. That improved
  it (verified in a simulated iOS setup), but on a real iPhone it still only works sometimes (user report,
  2026-11-17). Next idea: reuse a single `getUserMedia` call per facing, or apply
  `track.applyConstraints({ facingMode })` instead of reopening, and test on a real device with remote
  Web Inspector.
- Not yet tested on real Safari/iPad or Firefox (WebCodecs H.264 should give MP4 there too; very old browsers fall back to WebM).
- No automated UI tests in the repo yet (smoke test was a one-off Playwright script).

## Shipped after iteration 1

- MP4 export and project backup: [PLAN-mp4-and-backup.md](PLAN-mp4-and-backup.md)
- Audio track (record, music, cut/move/trim): [PLAN-audio.md](PLAN-audio.md)

## Ideas backlog (later)

- Insert frames at cursor position, frame hold (duplicate x N).
- Sound effects library, per-clip volume, fades.
- Timelapse auto-capture.
- GIF export.
- Commit a Playwright smoke test (fake camera) to the repo.
- HTTPS dev server for tablet testing.
- Use phone as remote camera.
- PWA / offline install.
- Classroom features (teacher dashboard, sharing).
