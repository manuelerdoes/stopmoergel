# Plan: phone layout (full-screen stage with overlay controls)

## Problem

On phones the studio stacks the stage, tools, play bar and timeline vertically. The stage ends up tiny
and some buttons are off-screen.

## Scope

- **Only phones.** Phone mode = `(max-width: 600px), (max-height: 500px)`, which covers phones in portrait and in
  landscape. Desktop and tablets (iPad) keep the **existing layout unchanged**.
- The same Studio state and logic; only the arrangement differs. `Studio.tsx` builds the pieces (stage,
  buttons, timeline, dialogs) once and either the existing desktop layout or the new `PhoneLayout`
  places them.

## Design

The stage (camera / picture / player) fills the **whole screen** on black. Controls float on top along the edges,
as round, translucent, icon-only buttons (with aria-labels).

### Portrait
```
┌──────────────────────────────┐
│ ←      Film 1 · 12      👁  ⬇ │  top bar
│ 👻                         ↶ │
│ #          STAGE           🔁 │  left: tools · right: undo / loop / speed
│ ⇋        (full screen)     🐇 │
│ 📷                            │
│ 🖼                            │
│      [✂ Cut] [Copy] [🗑]      │  actions (when a picture/sound is selected)
│ ▓▓▓▓▓ pictures + sound ▓▓▓▓▓ │  drawer (toggle)
│  ▶   🎤   ( FOTO )   ♪   ▤    │  bottom bar
└──────────────────────────────┘
```

### Landscape
```
┌──────────────────────────────────────────────┐
│ ←  Film 1 · 12        ↶ 🔁 🐇 ▤ 👁          ⬇ │
│ 👻                                         ▶ │
│ #                 STAGE                    🎤 │
│ ⇋                                       (FOTO)│
│ 📷                                         ♪ │
│ 🖼  ▓▓▓▓▓▓▓ drawer (starts closed) ▓▓▓▓▓▓      │
└──────────────────────────────────────────────┘
```

- **👁 Hide buttons:** collapses everything except Foto!, Play, Record-stop and the 👁 button itself,
  so the child sees the whole picture. Tapping 👁 again brings everything back.
- **▤ Strip toggle:** shows or hides the drawer with pictures and sound (open by default in portrait,
  closed in landscape, where it would cover a third of the picture).
- **🐇 Speed:** opens a small floating panel with the existing turtle/rabbit slider.
- **Picture and sound actions** float above the drawer when something is selected.
- The ghost-strength slider is not shown on phones (as before).
- Timeline on phones: smaller pictures (`--pitch: 76px`), so more of the movie fits.

## Not in scope

- Tablet layout changes.
- The camera switching reliability on iPhone (open issue, see PLAN.md).

## Status: done (2026-11-17)

Files: `src/lib/useMediaQuery.ts`, `src/components/Studio/PhoneLayout.tsx` + `.css`. `Studio.tsx` now builds the
shared pieces once (`stageBase`, `stageOverlays`, `actionButtons`, `captureButton`, `timelineEl`,
`dialogsEl`, `hiddenInputs`). The desktop JSX uses them in the same places as before.

Verified in Chrome with phone emulation (390×844, 844×390, 375×667):
- An automated check confirms all visible buttons are fully on screen with no overlaps, in portrait,
  landscape, with a picture selected, with the strip open and in hidden mode.
- Desktop (1280×800) still renders the classic layout, and all desktop browser tests pass.

Open:
- The fake camera in Chrome delivers landscape video, so the portrait stage was 390×219 in tests. iPhones
  deliver portrait video when held upright, which should fill most of the screen. This needs checking on
  a real phone.
- Turning the phone mid-movie mixes portrait and landscape pictures. The video export letterboxes them.
