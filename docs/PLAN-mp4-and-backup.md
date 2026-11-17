# Plan: MP4 export + project backup files

Two requests:
1. Videos should always be saved as **MP4**, in every browser where that is technically possible.
2. A movie project can be **saved as a file** and **loaded again** later, so work survives a cleared
   browser cache, a different computer, or a teacher collecting projects.

## 1. MP4 export via WebCodecs

Problem: the current export uses `MediaRecorder`, whose output format depends on the browser
(Chrome/Safari can do MP4, Firefox only WebM). It also records in real time and breaks when the tab is
in the background.

Solution: encode frames directly with the **WebCodecs `VideoEncoder` (H.264/AVC)** and write an MP4
container with **`mediabunny`** (pure TS, tree-shakeable, successor of `mp4-muxer`).

- Draw each frame on a canvas → `CanvasSource.add(timestamp, duration)` with exact timestamps
  (`i / fps`). No timers, so it is **much faster than real time** and works in background tabs.
- Supported: Chrome/Edge 94+, Safari 16.4+, Firefox 130+ (desktop). Check with `canEncodeVideo('avc', …)`.
- Fallback chain: WebCodecs MP4 → MediaRecorder MP4 → MediaRecorder WebM. The public API
  of `exportVideo.ts` stays the same, so the UI barely changes.
- The encoder module is loaded on demand (dynamic import) so the start bundle stays small.
- Fast-start MP4 (`moov` at the front) so it plays well everywhere, incl. Windows and iOS Photos.

## 2. Project backup file (`.stopmoergel.zip`)

A normal ZIP file (teachers can open it and see the pictures), named `<Movie name>.stopmoergel.zip`.

```
project.json
frames/0001.jpg
frames/0002.jpg
...
```

`project.json`:
```json
{
  "app": "stopmoergel",
  "formatVersion": 1,
  "exportedAt": "2026-11-17T20:00:00.000Z",
  "project": { "name": "Film 1", "fps": 8, "createdAt": 0, "updatedAt": 0 },
  "frames": ["frames/0001.jpg", "frames/0002.jpg", "frames/0001.jpg"],
  "frameInfo": { "frames/0001.jpg": { "width": 1280, "height": 720 } }
}
```

- `frames` is the movie order and may repeat a file (a copied picture is stored only once).
- JPEGs are stored without recompression (ZIP level 0) — they are already compressed. This keeps zipping quick.
- Library: **`fflate`** (small and fast).
- Import always creates a **new** project with new ids, so importing twice never overwrites anything.
  If anything fails halfway, the partly imported project is deleted again.
- Validation: must contain `project.json` with `app === "stopmoergel"`; a newer `formatVersion` gives
  a friendly "made with a newer version" message. Missing or broken frames make the import fail with a clear error.

### UI

- **Studio:** the green "Save" button opens a dialog with two big choices:
  - 🎬 **Video** (MP4), to watch and share
  - 📦 **Projekt sichern** (save project), to keep working later
- **Gallery:**
  - an "Open project" button / tile (file picker, `.zip`)
  - dragging a `.zip` onto the gallery imports it too
  - each card gets a "save project" action (package icon) next to rename and delete
- After an import, the new movie appears in the gallery with a short success toast.

## Task split

| Task | Owner | Status |
|------|-------|--------|
| `exportVideo.ts`: WebCodecs + mediabunny MP4 path with fallback | subagent | done |
| `projectArchive.ts` + tests (fflate, export/import, validation) | subagent | done |
| Studio save dialog, Gallery import button, drag & drop, card action, i18n | main agent | done |
| Browser test: MP4 output, archive round trip | main agent | done |

## Verification (headless Chrome, fake camera)

- MP4: `ffprobe` shows h264, 1280×720, 8/1 fps, 13 frames, 1.625 s; it plays in the browser. Encoding
  takes well under the movie length.
- Archive: 12 unique JPEGs for 13 frames (the copied frame is stored once). Importing it into a fresh
  browser profile (empty storage) restores the name, frame count and order.
- An invalid file shows a friendly error dialog.
- Found and fixed along the way: capturing right after the camera opened could store a black frame.
  "Foto!" now waits until a real video frame has been presented.
