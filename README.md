# HerdPlayer

A multi-device [Handy](https://www.thehandy.com/) controller for Windows. Drive any number of Handy devices in lockstep from a single app — synchronize them to a video, drive them live with sliders, or queue up pre-built patterns from a library.

Built on Electron and the Handy v3 API.

---

## Installation

### Run the prebuilt binary

Grab `HerdPlayer.exe` from the project root (or build one yourself — see below). It's a portable executable, no install required.

### Build from source

Requires Node.js.

```bash
npm install
npm start              # run in dev mode
npm run build          # produce HerdPlayer.exe (portable, in dist/)
```

---

## First-time setup

You need two things from the Handy side before the app can talk to a device:

1. **Application ID** — Get one from <https://user.handyfeeling.com/>. This identifies your installation to Handy's servers and is shared across all your devices.
2. **Connection Key** — This identifies and allows connection to each Handy device.

In HerdPlayer:

1. Paste the Application ID into the **Application ID** field at the top of the right-hand **Devices** panel.
2. For each Handy you want to control, click **+ Add Device** and paste the Connection Key into the new row. You can also give it a nickname.
3. Click **Connect All**.

Each row turns green when its device is connected and shows the round-trip clock offset to the Handy server. Both the Application ID and the device list are persisted to local storage, so you only have to do this once.

---

## The three modes

Switch modes from the buttons at the top: **Script**, **Manual**, **Queue**. Each mode uses a different Handy protocol under the hood; the app handles tearing down the previous mode and setting up the new one when you switch.

### Script mode (HSSP)

Plays a `.funscript` in time with a video, on every connected device at once.

#### Loading media

- **Choose Video** — pick a single video file.
- **Open Folder** — load a folder of videos. The app auto-pairs each video with any matching `.funscript` / `.json` / `.csv` script in the same folder. Matching is by filename: exact match first, then any script whose name shares the video's base. When multiple scripts match one video (e.g. `scene.funscript` and `scene_alt.funscript`), they're shown as a tree under the video so you can pick which one to play.
- **Load URL** — paste a remote video URL.
- **Choose Script** — load a script file by hand if it isn't in the folder.

The library on the left lists everything in the loaded folder. A ✓ badge means the video has a matched script; – means none was found. Click any item to load it.

#### Playback

The video plays in a separate window. Hit play/pause/seek as normal — the connected Handys follow along. Behind the scenes the app uploads the script to Handy's hosting service, points each device at it, and re-syncs every two seconds while playing.

#### Video engines, codecs, and HDR

The built-in Chromium player is the default. For formats/codecs it cannot decode, or for better HDR handling, open **Settings → Advanced → Video engine** and select **mpv**. Windows packages include a pinned x86-64 mpv build. HerdPlayer can also use an mpv executable you choose or `mpv` from the system `PATH`.

The mpv engine runs in its own player window with safe hardware decoding, `gpu-next`, HDR display hints, and automatic tone mapping. Playback time, pause, seek, duration, decoder, and video metadata return to HerdPlayer through mpv's JSON IPC so Handy synchronization continues to use the active player clock. If mpv cannot start for a selected video, HerdPlayer reports the reason and falls back to Chromium for that session. Actual HDR output still depends on the video, display, Windows HDR setting, GPU driver, and mpv build.

The bundled mpv build is an unmodified separate GPLv2+ program. Credits, exact revisions, checksums, license text, build details, and source links are included under `vendor/mpv/` and in **Settings → About**. Its source code is not embedded in HerdPlayer's executable.

#### Sync controls

- **Offset (ms)** — global timing offset applied to every device. Use the −50 / +50 buttons or type a value directly.
- **Per-device offset** — each device row in the right panel has its own ±50 ms offset, useful when one Handy is consistently ahead of or behind the others.
- **Sync** — once connected, shows the average server-clock offset across your devices.

#### Timeline

The waveform across the bottom of the window is the loaded script, colored by stroke speed (teal = slow, your selected accent = medium, red = fast). Click anywhere on it to seek; hover to preview the time.

### Manual mode (HAMP)

Live, hands-on control. No script, no video — just sliders.

#### Controls

- **Velocity** — stroke speed (0–100%).
- **Stroke Min / Stroke Max** — the bottom and top of the stroke range. Min cannot exceed max; the sliders enforce a 1% gap.
- **Start / Stop** — engage or disengage the active group.

Slider changes update the device live (throttled to ~150 ms while dragging) so you can fine-tune in real time without spamming the API.

#### Presets

A 4×4 grid of one-click presets combining stroke region (Top, Mid, Bottom, Full) with speed (Slow, Med, High, Fast). Click one to immediately set the sliders and start the group.

#### Groups

When you have multiple devices, you can split them into groups and drive each group independently. Each group has its own velocity / stroke / start state.

- **+ New Group** — create another group. Drag a device card into it to assign it.
- Click a group card to make it active — the sliders and presets now control that group.
- Devices not assigned to any group sit idle.

This means you can, for example, run one Handy in slow-deep mode while a second runs fast-shallow.

### Queue mode (HSP)

A "DJ queue" for short looping patterns. Pick patterns from the built-in library, line them up, and they play through one after another seamlessly.

#### The library

The bottom panel lists every pattern shipped in [patterns/](patterns/). Each card shows a small waveform preview. Click one to add it to the queue.

#### Filters

Two rows of filter buttons narrow the library:

- **Speed:** All / Slow / Med / Fast / Sprint
- **Position:** All / Top / Bottom / Full

#### The queue

The middle panel is the play order. Patterns play in order, and each pattern repeats enough times to fill an ~8-second buffer slot before the next one begins, so transitions are seamless. When the queue runs out, the last pattern keeps looping until you stop or add more.

#### Queue controls

- **Speed** — global playback rate multiplier (0.2× to 3×). Adjustable while playing.
- **Start Queue** — begin playback.
- **Emergency Stop** — instant halt. Use this if anything looks wrong.

You can add patterns mid-playback; they'll be appended to the buffer without interrupting the current one.

---

## Devices panel (always visible)

The right-hand panel works the same in all modes:

- **+ Add Device** — add another row.
- **Connect All** — (re)connect every row at once.
- **↻ on a row** — reconnect that row only, useful if a single device drops.
- **× on a row** — stop that device if necessary, then remove it. The row stays available if the stop cannot be confirmed.
- Each row shows: nickname, connection key, a per-device ms offset, and live status (Connecting → Syncing → Connected, or an error).
- The summary line at the top of the panel reports `connected/total` and how many are ready in the current mode's protocol.

---

## Tips & gotchas

- **Application ID vs Connection Key** — easy to mix up. The Application ID is yours and is the same for every device; the Connection Key is per-device and printed on the Handy's screen.
- **Switching modes stops the current mode** — the app cleanly stops HSSP / HSP / HAMP playback before setting the new one up.
- **Folder pairing is filename-based** — if a script isn't matching, rename it to share a prefix with the video.
- **Local video files** — videos loaded from disk are streamed via a custom `localfile://` protocol so seeking works even on large files (no full-file blob URL).
- **Video window** — Chromium mode launches a separate Electron video window beside the controls. mpv mode uses mpv's own player window instead.
- **Safe shutdown** — closing either window gives active devices up to five seconds to stop. If any stop fails or times out, HerdPlayer warns that devices may still be moving and keeps the app open by default. A forced process termination, power loss, or network outage cannot guarantee a remote stop; use the Handy's physical controls if needed.
- **State persistence** — Application ID, device keys, nicknames, and per-device offsets are saved to local storage. Other settings (mode, current video, group layout) are not.

---

## Project layout

```text
main.js              Electron main process (windows, IPC, localfile protocol)
mpv-controller.js     Optional mpv process and JSON IPC integration
runtime-config.js     Pre-start graphics/player configuration
preload.js           Renderer bridge
index.html           Control window
video.html           Video window
js/
  app.js             Main controller: devices, modes, playback, IPC routing
  handy.js           Handy v3 API client (HSSP, HSP, HAMP)
  funscript.js       Script parsing + timeline rendering
  manual-app.js      HAMP UI
  queue-app.js       HSP queue UI
  group-app.js       Shared group-management base class
  patterns.js        Pattern utilities (waveform drawing, expansion)
  video-app.js       Video window logic
css/style.css
patterns/            Bundled HSP patterns
spec.yaml            Handy v3 REST API spec
```
