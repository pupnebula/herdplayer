// Gamepad helper: returns the first connected pad, normalised to a
// standard-mapping shape so callers can use Xbox-style axis/button indices
// regardless of brand.
//
// Why this exists: in Chromium on Windows, DualShock 4 / DualSense pads can
// report `mapping === ''` (non-standard) depending on the driver path. When
// that happens, axes[1] / buttons[0] etc. point at *different* physical
// inputs than the same indices on an Xbox pad, so the manual-mode and
// direct-mode polling silently does nothing useful. We patch the layout for
// known PS controllers so the rest of the code stays brand-agnostic.

const PS_ID_RE = /054c|dualshock|dualsense|wireless controller/i;

const seenPads = new Set();

window.addEventListener('gamepadconnected', (e) => {
  const pad = e.gamepad;
  console.log('[gamepad] connected:', pad.id, 'mapping:', pad.mapping || '(non-standard)',
              'axes:', pad.axes.length, 'buttons:', pad.buttons.length);
  if (!seenPads.has(pad.index)) {
    seenPads.add(pad.index);
    const note = pad.mapping === 'standard' ? '' :
                 PS_ID_RE.test(pad.id) ? ' (PS layout — remapped)' :
                                          ' (non-standard layout)';
    showToast(`Gamepad connected: ${shortId(pad.id)}${note}`, 'info');
  }
});

window.addEventListener('gamepaddisconnected', (e) => {
  console.log('[gamepad] disconnected:', e.gamepad.id);
  seenPads.delete(e.gamepad.index);
  showToast(`Gamepad disconnected: ${shortId(e.gamepad.id)}`, 'info');
});

function shortId(id) {
  // DS4 ids look like "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)".
  // Trim everything from the first paren onward for readability.
  const idx = id.indexOf('(');
  return (idx > 0 ? id.slice(0, idx) : id).trim() || id;
}

function showToast(text, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = text;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove());
  }, 3500);
}

// ── public API ──────────────────────────────────────────
//
// Returns the first connected gamepad, with axes/buttons remapped to the
// standard layout when needed. Returns null when no pad is connected.
//
// Standard-mapping semantics (callers can rely on these):
//   axes:    [LX, LY, RX, RY]
//   buttons: [A, B, X, Y, LB, RB, LT, RT, Back, Start, L3, R3, Up, Down, Left, Right]
export function getActivePad() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const p of pads) {
    if (p && p.connected) return normalize(p);
  }
  return null;
}

function normalize(pad) {
  if (pad.mapping === 'standard') return pad;
  if (PS_ID_RE.test(pad.id)) return remapDS4(pad);
  // Unknown non-standard pad — pass through and hope for the best. The
  // caller still gets *something*, and the connect toast warned the user.
  return pad;
}

// Translate a non-standard DualShock 4 / DualSense layout to standard.
// Reference layout (DS4 over Bluetooth without driver translation on Win):
//   axes:    LX=0, LY=1, RX=2, RY=5 (sometimes 3 on DualSense USB)
//   buttons: 0=Square, 1=Cross, 2=Circle, 3=Triangle,
//            4=L1, 5=R1, 6=L2, 7=R2,
//            8=Share, 9=Options, 10=L3, 11=R3, 12=PS, 13=Touchpad
function remapDS4(pad) {
  const a = pad.axes;
  const b = pad.buttons;
  const stub = { pressed: false, touched: false, value: 0 };
  const get = (i) => b[i] ?? stub;

  return {
    id: pad.id,
    index: pad.index,
    connected: pad.connected,
    mapping: 'standard',
    timestamp: pad.timestamp,
    axes: [
      a[0] ?? 0,                          // LX
      a[1] ?? 0,                          // LY
      a[2] ?? 0,                          // RX
      a[5] != null ? a[5] : (a[3] ?? 0),  // RY (often axis 5 on DS4)
    ],
    buttons: [
      get(1),  // A   = Cross
      get(2),  // B   = Circle
      get(0),  // X   = Square
      get(3),  // Y   = Triangle
      get(4),  // LB  = L1
      get(5),  // RB  = R1
      get(6),  // LT  = L2
      get(7),  // RT  = R2
      get(8),  // Back = Share
      get(9),  // Start = Options
      get(10), // L3
      get(11), // R3
      get(14) ?? stub, // D-Up    (some DS4 reports as button)
      get(15) ?? stub, // D-Down
      get(16) ?? stub, // D-Left
      get(17) ?? stub, // D-Right
    ],
  };
}
