# Plan: Audio track

Kids can record sounds (voice, noises) or add music, and place, move and cut those sound clips on an
**audio track directly under the picture strip**, with the same tap-to-select, drag-to-move, copy,
delete and undo feel as the picture tools.

## Core decisions

### Time: clips are anchored to pictures, not to seconds
- A clip's start is stored as a **frame index** (`startFrame`, whole number). A "BOOM" recorded for
  picture 20 stays at picture 20 even when the kid changes the speed (turtle/rabbit).
- The clip's length is in **seconds** (it is real audio). Its width on the track is
  `duration × fps × pitch`, so it gets wider when the movie gets faster.
- The two tracks share one horizontal scroll container and the same pixels-per-frame (`--pitch`
  CSS variable), so a clip under picture 20 lines up with picture 20.
- Audio that goes past the movie end is drawn faded and is cut off in playback and in the video.

### Storage: always WAV (16-bit PCM, mono)
- Recorded audio is captured as raw PCM in an AudioWorklet (falling back to ScriptProcessor) and saved
  as WAV. Imported music is decoded and turned into mono WAV.
- Why WAV: the browser's own recording formats differ (WebM/Opus in Chrome, MP4/AAC in Safari), and a
  project made in one browser must work in the others (backup files). WAV decodes everywhere,
  and cutting it is exact to the sample.
- Size: about 5.7 MB per minute at 48 kHz. Fine for kids' movies. Imported music is capped at 5 minutes.

### Data model
```ts
Sound     { id, projectId, blob: Blob /* audio/wav */, duration /* s */, createdAt }   // own IndexedDB store
AudioClip { id, soundId, startFrame /* int ≥ 0 */, offset /* s into sound */, duration /* s */ }
Project   { ..., audioClips: AudioClip[] }
```
- Cutting is **non-destructive**: trimming and splitting only change `offset` and `duration`. Two
  clips can share one sound.
- Undo snapshots now hold `{ frameIds, audioClips }`.
- Sounds that no clip uses are garbage-collected when the project is opened, the same as frames.
- Overlapping clips are allowed (voice over music). They are shown in automatic **lanes**
  (computed, not stored), so the track grows a row when clips overlap.

## UX

- **Audio row** under the picture strip, the same width per picture. Empty state: a dashed lane with a
  mic and note icon and the hint "Ton aufnehmen" (record sound).
- **Clips** are colorful pills with a waveform. Recorded clips are pink, music is blue.
- **Tap** a clip to select it. Like a selected picture, a selected clip can be dragged. It snaps to
  whole pictures.
- A selected clip shows **big trim handles** on both edges. Dragging them cuts the start or end away.
- **Scissors line (playhead):** when a clip is selected, a vertical line marks the selected picture.
  Tapping a picture moves the line while keeping the clip selected. If the line isn't inside the
  clip when it gets selected, it jumps to the clip's middle picture.
- **Clip actions** appear on the stage, the same place as the picture actions: ✂️ Cut ("Schneiden",
  split at the line), Copy, Delete. Deleting can be undone with a toast.
- **Record** (big mic button in the play bar):
  1. Ask for the mic the first time.
  2. A big 3-2-1 countdown on the stage.
  3. The movie plays from the selected picture (or from the start) while recording, so the kid can
     talk along. A live level meter and timer show on the stage. The button turns into a pulsing
     red Stop.
  4. Stop gives a new clip at the start picture. Recording stops automatically after 60 s.
  - Other clips are muted while recording, to avoid echo without headphones.
- **Music** button in the tools column: pick an audio file. It's placed at the selected picture (or
  the start).
- **Playback:** clips play in sync with the pictures (Web Audio scheduling). They are rescheduled on
  loop, on speed change and on start from a selected picture.

## Export

- **Video:** the clips are mixed with an `OfflineAudioContext` into one buffer as long as the movie,
  then encoded as an **AAC** track (Opus if AAC isn't available) into the MP4 via mediabunny.
  The MediaRecorder fallback plays the mix into a `MediaStreamAudioDestinationNode`.
- **Backup zip** goes to `formatVersion: 2`, with a `sounds/0001.wav…` folder and `audioClips` in
  `project.json`. Version 1 files (no audio) still import.

## Module split

| Module | Content | Owner | Status |
|---|---|---|---|
| `src/lib/types.ts` | `Sound`, `AudioClip`, `Project.audioClips` | main | done |
| `src/lib/audio/clips.ts` (+test) | pure clip ops: move, trim, split, lanes | subagent | done |
| `src/lib/audio/wav.ts` (+test) | WAV encoder | subagent | done |
| `src/lib/audio/context.ts`, `recorder.ts` | shared AudioContext, mic capture (AudioWorklet), level meter, file → WAV | subagent | done |
| `src/lib/audio/mix.ts`, `exportVideo.ts` | mixdown + audio track in MP4 / fallback | subagent | done |
| `src/lib/db.ts`, `projectArchive.ts` (+tests) | DB v2 `sounds` store, archive v2 | subagent | done |
| `src/lib/audio/peaks.ts`, `useAudioPlayback.ts`, `useProject` | waveform peaks, synced playback, clip ops + undo | main | done |
| `Studio/AudioTrack.tsx`, `Timeline.tsx`, `useSoundRecorder.ts`, `Studio.tsx` | audio row, playhead/scissors, record flow, music import | main | done |

## Verification (headless Chrome, fake camera + fake microphone)

- Record: the countdown, live level meter and timer show, and the movie plays along. The clip lands at the
  start picture, and the lead-in (about 25 ms) is trimmed automatically.
- Cut at the scissors line gives two clips that share one sound with different offsets.
- Drag-moving snaps to pictures; trimming the end with the handle works; deleting can be undone.
- Imported music (MP3) goes into a second lane when it overlaps.
- MP4 export: `ffprobe` shows h264 plus **AAC 48 kHz stereo**, with the audio length matching the movie.
  Loudness is mean −20 dB and peak −0.5 dB (the limiter works).
- Backup v2 holds `sounds/0001.wav` and `0002.wav`. Importing it into a fresh profile restores all 3 clips.
  The clips also survive a reload.
- Layouts checked at 1280×860, iPad landscape 1024×768 and phone 390×844.

## Known limitations

- Other clips are muted while recording (no echo without headphones). Hearing music while recording
  is in the backlog.
- Mic and AudioWorklet need HTTPS or localhost, the same as the camera.
- Not yet tried on a real iPad or Safari. iOS switches the audio session while the mic is open, so
  playback may get quieter during recording.
- Very long imported audio is decoded in full before being cut to 5 minutes, which uses a lot of memory.

## Later

- Volume per clip, fade in and out.
- Hearing other clips while recording (with headphones).
- A built-in sound effects library.
