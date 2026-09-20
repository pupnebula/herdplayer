# HerdPlayer Agent TODO

This file is the implementation backlog for coding agents working on HerdPlayer.
Treat the current working tree as user-owned: inspect `git status` before editing,
preserve unrelated changes, and do not assume the bundled Handy OpenAPI schema is
correct where it conflicts with verified device behavior.

## Important Handy API compatibility notes

- **Do not change HDSP `xp` scaling from 0..1 back to 0..100 without testing on
  real hardware.** `HandyDevice.hdspMoveToPercent()` intentionally divides the UI
  percentage by 100. The published v3 schema says `xp` is 0..100, but real-device
  testing found that range caused erratic behavior and 0..1 works correctly.
- The bundled `spec.yaml` and the current online v3 spec contain other apparent
  schema mistakes. Use the spec to identify likely problems, but verify ambiguous
  numeric ranges and indexes on an actual Handy before changing wire values.
- The review that produced this backlog was static. All JavaScript passed
  `node --check`, but no live-device integration tests or automated test suite were
  available.

## P1 - Safety and core API correctness

### [x] Detect Handy error payloads returned with HTTP 200

Affected: `js/handy.js`, especially `HandyDevice.request()`.

The API can return a successful HTTP status with an `error` object such as
`DeviceTimeout` or `DeviceNotConnected`. The current client checks only
`response.ok`, returns the error payload as if it were a result, and can mark mode
setup or commands successful when the device rejected them.

Implementation requirements:

- After parsing JSON, throw a structured error whenever `data.error` is present,
  even if the HTTP status is 2xx.
- Preserve useful fields such as error code, name, message, and `connected`.
- When `connected === false`, clear the device's connection and protocol-ready
  state.
- Keep HTTP-level and malformed-response errors distinguishable for diagnostics.

Acceptance criteria:

- A mocked `200 { "error": { ... } }` rejects the request.
- Setup methods do not mark the protocol ready after such a response.
- Stop/movement callers can surface the device error instead of reporting success.

### [x] Stop discarding `Promise.allSettled()` failures

Affected: `js/handy.js` manager broadcast methods and the HAMP/HSP device-group
operations in `js/app.js`.

Most broadcast methods await `Promise.allSettled()` and ignore the returned
statuses. Callers consequently report playing/stopped/ready even if every request
failed. This is especially unsafe for Emergency Stop.

Implementation requirements:

- Return a per-device result summary from every broadcast operation.
- Treat zero successful devices as an operation failure.
- Mark failed devices not-ready or disconnected when the error indicates that.
- Only send `hsp-playing`, `hsp-playing-devices`, and `hamp-playing-devices` UI
  messages for devices whose commands actually succeeded.
- Emergency Stop must visibly report partial or total failure and must not claim
  that all devices stopped when any stop request is unresolved or rejected.

Acceptance criteria:

- Tests cover all-success, partial-success, and all-failed broadcasts.
- One failed device remains visibly actionable after a partial stop.
- No outer `try/catch` assumes `allSettled()` will throw.

### [ ] Stop active devices before removing controls or exiting

Affected: device removal in `js/app.js`, group deletion in `js/group-app.js`, and
window/application shutdown in `main.js`.

Current behavior can orphan an active HAMP or looping HSP device:

- Removing a device row deletes its local object without sending stop.
- Deleting a playing group remaps devices without stopping or reconciling their
  actual motion state.
- Closing either window exits without stopping active devices.

Implementation requirements:

- Stop the device's active protocol before removing its row/reference.
- When deleting a playing group, explicitly stop its devices or transfer them to
  the destination group's actual state and settings.
- Add a shutdown path that attempts to stop all active HAMP, HSP, and HSSP devices
  before renderer state is destroyed. Use a bounded timeout so shutdown cannot hang.
- If guaranteed remote stop on process exit is impossible, warn the user and
  document the limitation clearly.

Acceptance criteria:

- Removing an active device issues stop before removal.
- Deleting a playing group leaves no device moving under a non-playing UI state.
- Normal application close performs bounded best-effort stops.

### [ ] Replace bulk HSP loading with capacity-aware streaming

Affected: `HandyDevice.hspAddPoints()`, `HandyManager.setupHSPAll()`, HSP playback
state in `js/app.js`, and queue management in `js/queue-app.js`.

The current implementation sends every chunk before playback. The API states that
adding to a full buffer evicts the oldest points. The client ignores the
`max_points` returned by HSP setup/state, so queues larger than the device buffer
can begin partway through the data. Fourteen bundled single-pattern expansions
already exceed 100 points, and multi-pattern queues usually do.

Implementation requirements:

- Capture and retain HSP setup/state fields including `max_points`, current point,
  tail index, and threshold.
- Initially buffer only a safe capacity, then start playback.
- Refill while playing using `hsp_threshold_reached` or another verified
  capacity-aware mechanism.
- Set `pause_on_starving` deliberately and handle both starvation behavior choices.
- Keep a per-device stream cursor; do not assume all devices have identical buffer
  state or consume points simultaneously.
- Ensure appends cannot evict points that have not yet played.

Acceptance criteria:

- A stream several times larger than `max_points` plays from its first point to its
  last point in order.
- Multi-device streaming tolerates devices reaching refill thresholds at different
  times.
- Starvation and reconnect tests do not silently skip to the tail of the stream.

### [ ] Use `/hsp/playbackrate` for live Queue speed changes

Affected: `HandyDevice`, `HandyManager`, and `App.hspSetRate()`.

`App.hspSetRate()` currently calls `/hsp/play` with `start_time: 0`, restarting the
pattern. The API has a dedicated `/hsp/playbackrate` endpoint.

Implementation requirements:

- Add `hspSetPlaybackRate()` and a manager broadcast wrapper.
- Use `/hsp/playbackrate` for an already-playing stream.
- Update queue depletion timing from the actual elapsed script position; do not
  reset a partially elapsed slot to its full duration when the rate changes.

Acceptance criteria:

- Changing speed during a pattern does not jump to timestamp zero.
- Queue transition timing remains aligned after one or more rate changes.

### [ ] Preserve required boundary points in repeated and queued patterns

Affected: `expandActions()`, `buildPatternPoints()`, `buildBuffer()`, and
`addPattern()` in `js/queue-app.js`.

The code always skips the first point of subsequent repeats and patterns under the
assumption that it duplicates the previous endpoint. Review of the 100 bundled
patterns found that 95 end before `period_ms`, 56 end at a different position from
their start, and none meet both conditions needed for the skipped point to be a
true duplicate.

Implementation requirements:

- Deduplicate only when both timestamp and position are genuinely identical.
- Preserve the next pattern's initial point when there is a time gap or position
  change.
- Define and test how a discontinuity at an identical timestamp should be handled.
- Base queue duration and starvation scheduling on the final emitted timestamp,
  not only `repeats * period`.

Acceptance criteria:

- Generated points reproduce each source cycle at every repeat boundary.
- Joining two different patterns preserves both intended endpoints.
- Tests cover `last.at < period`, matching/different positions, and exact timestamp
  collisions.

## P2 - Reliability, synchronization, and packaging

### [ ] Give devices stable identities instead of mixing DOM and manager indexes

Affected: `App.connectAll()`, `sendDevicesUpdate()`, reconnect/remove handling, and
manual group membership.

`connectAll()` compacts non-empty rows into `manager.devices`, while
`sendDevicesUpdate()` publishes the DOM row index. Later commands use that value as
the manager-array index. A blank row before a configured device can therefore
target the wrong device or no device.

Implementation requirements:

- Assign each device a stable ID and pass that ID through UI/group messages, or map
  rows directly to device objects without positional assumptions.
- Preserve group membership across row removal and reconnect where practical.

Acceptance criteria:

- Blank rows, removing a middle row, and reconnecting in a different order never
  redirect a command to another connection key.

### [ ] Clear every protocol-ready flag during Connect All and mode changes

Affected: `App.connectAll()`, `HandyManager.setup*All()`, and mode switching.

Connect All currently clears only `hsspReady`. Failed reconnections can leave stale
HAMP, HSP, or HDSP readiness and continue receiving commands. Old protocol flags
also remain true after successful mode changes.

Implementation requirements:

- Centralize a `clearReadyState()` operation on `HandyDevice`.
- Clear readiness before reconnecting and whenever the device mode changes.
- Count a device as ready only when it is connected and ready for the current mode.

Acceptance criteria:

- A device that fails reconnection is excluded from every command broadcast.
- The connection summary never counts a disconnected stale-ready device.

### [ ] Make mode transitions serial and race-safe

Affected: `App.setMode()` and setup functions.

Rapid mode clicks can overlap asynchronous stop/setup sequences. A slower earlier
transition may finish after the latest transition and leave the physical device in
a mode different from the selected UI mode.

Implementation requirements:

- Serialize transitions or use a monotonically increasing transition token.
- Ignore/cancel stale setup completions.
- Disable mode controls while a transition is committed if necessary.

Acceptance criteria:

- Repeated rapid mode changes always leave every responsive device in the final
  selected mode.

### [ ] Prevent stale HSSP script playback during upload/setup

Affected: `App.loadScriptFile()`, `setupHSSP()`, playlist selection, and video play
handling.

The previous `scriptHostUrl` and readiness remain usable while a new script is
uploading. Playback during that window can start the old script with the new video.
After the new setup completes, an already-playing video is not re-synchronized.
Scripts received while outside HSSP mode can also leave the previous hosted URL in
place.

Implementation requirements:

- Invalidate the old hosted URL/readiness as soon as a new script is selected.
- Associate upload/setup completion with the selected script using a generation ID.
- Ignore stale upload responses.
- If the video is playing after the current script finishes setup, start/sync that
  script at the current video time.

Acceptance criteria:

- Selecting scripts rapidly cannot cause an older upload to become active.
- Playing during upload never starts the previous script.

### [ ] Bound API request frequency and handle 429 responses

Affected: `js/direct-app.js`, `js/group-app.js`, `js/handy.js`.

The documented window is 240 requests/minute. Direct mode can send about 2,000
requests/minute per device at a 30 ms interval. Continuous Manual dragging can send
about 800 requests/minute per device because each 150 ms update sends both velocity
and stroke. Actual enforcement should be measured, but the client currently has no
rate-limit awareness.

Implementation requirements:

- Read `X-RateLimit-*` response headers.
- Coalesce superseded movement commands and cap concurrency/in-flight requests.
- Back off on 429 using the reset header.
- Prefer the latest requested state after throttling rather than replaying stale
  intermediate states.
- Preserve the empirically correct HDSP 0..1 `xp` scaling.

Acceptance criteria:

- Sustained input does not grow an unbounded request backlog.
- The latest slider position wins after throttling.
- 429 responses recover without falsely marking the device ready or stopped.

### [ ] Add network timeouts and wire the connection-timeout preference

Affected: `HandyDevice.request()`, server-time sampling, and `prefs-app.js`.

Renderer `fetch()` calls have no client-side abort timeout. The exposed
`connectionTimeout` preference is unused, so network failures can leave Connect All
or mode changes pending indefinitely even though device-operation timeouts exist on
the server.

Implementation requirements:

- Use `AbortController` with the configured timeout.
- Distinguish client abort, server/device timeout, and authentication failure.
- Ensure repeated server-time sampling is abortable.

### [ ] Include runtime data files in packaged builds

Affected: `package.json` Electron Builder `files` configuration.

The packaging allowlist excludes `patterns/**/*` and `spec.yaml`. Packaged builds
therefore have no bundled Queue library, and the About screen points to a missing
spec file.

Implementation requirements:

- Package the patterns directory and `spec.yaml`, using `files` or
  `extraResources` with paths that match runtime lookup.
- Verify reads both unpacked and inside the packaged application.

Acceptance criteria:

- A clean packaged build lists all bundled patterns.
- “Open spec.yaml” opens an existing file or is removed from production UI.

### [ ] Implement or remove settings that currently do nothing

Affected: `js/prefs-app.js`, `main.js`, video handling, gamepad handling, and pattern
loading.

Currently exposed but unused settings include:

- Open video beside control window
- Remember last video position
- Mute on autoplay
- Auto-reconnect dropped devices
- Connection timeout
- Custom patterns folder
- Verbose logging
- Gamepad auto-detect

The default global offset is read only during application construction, so changing
it does not affect newly loaded videos until restart.

Implementation requirements:

- Either wire each setting through to real behavior or remove it from the UI.
- For a custom patterns folder, validate and constrain main-process file access;
  do not expose unrestricted arbitrary filesystem reads to the renderer.
- Replace the placeholder GitHub/update links in the About panel with the real
  project URLs or remove them.

## P3 - Contract checks and hardening

### [ ] Verify HSP tail index base on real hardware

Affected: HSP start/append code in `js/app.js` and chunk-tail math in `js/handy.js`.

The client initializes the tail to `points.length - 1` (zero-based). The published
schema requires a minimum of 1 and illustrates 100 points with tail index 100. This
looks like a one-based contract, but the spec has known numeric-range errors.

Do not change this from documentation alone. Capture actual setup/add responses and
test first-point, 100-point, multi-chunk, flush, and append cases on a real device.

### [ ] Prevent generation of HSP `stream_id: 0`

Affected: `HandyDevice.hspSetup()`.

`Math.floor(Math.random() * 1024)` can produce zero, while the published schema says
the minimum is 1. Prefer omitting `stream_id` and using the returned server-generated
ID, or generate within the verified valid range and retain the returned ID.

### [ ] Add input validation for scripts and patterns

Affected: `js/funscript.js` and Queue pattern loading.

Validate finite, non-negative, strictly ordered timestamps; valid positions; usable
periods; and a minimum number of points before uploading or streaming. Malformed
custom data should be rejected with a useful filename-specific error rather than
creating `NaN`, zero-period loops, or invalid HSP payloads.

### [ ] Harden the local authorization mechanism or document its limits

Affected: `auth-config.js`, `auth.js`, and packaging configuration.

The per-build token and AES key are shipped together in the application. This is not
an enforceable security boundary against a local user who can inspect or modify the
package. Decide whether the mechanism is only a revocation/convenience gate; if
strong authorization is required, validate a signed entitlement that does not ship
the signing secret and define offline/cache behavior.

### [ ] Add automated coverage for device protocols

Create a mock Handy REST server or mock `fetch` layer covering:

- HTTP failures and HTTP-200 error payloads
- Mode -> setup -> play/stop ordering for HSSP, HSP, HAMP, and HDSP
- Partial multi-device failures
- Emergency Stop failures
- HSP bounded buffering, thresholds, starvation, append, looping, and rate changes
- HSSP upload races and current-time resynchronization
- Connection/reconnect state clearing and stable device identity
- API throttling, client timeouts, and 429 recovery
- Shutdown/removal stop behavior

Add at least `test` and lint/static-check scripts to `package.json` and run them in a
clean packaged-build verification workflow.
