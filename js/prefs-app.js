// Preferences modal — vanilla DOM, persists to localStorage['herdplayer:prefs'].
// See HP_handoff/design_handoff_preferences_modal/README.md for the spec.

const PREFS_KEY = 'herdplayer:prefs';

// Keyboard actions for Manual mode. `rate: true` repeats while held.
export const KEYBIND_ACTIONS = [
  { id: 'velocityDec',      label: 'Velocity −5%',         help: 'Hold to repeat.',                              rate: true,  defaultKey: 'KeyA' },
  { id: 'velocityInc',      label: 'Velocity +5%',         help: 'Hold to repeat.',                              rate: true,  defaultKey: 'KeyD' },
  { id: 'strokeLenInc',     label: 'Stroke length +5%',    help: 'Adjusts whichever bound (min/max) is focused.', rate: true,  defaultKey: 'KeyW' },
  { id: 'strokeLenDec',     label: 'Stroke length −5%',    help: 'Adjusts whichever bound (min/max) is focused.', rate: true,  defaultKey: 'KeyS' },
  { id: 'focusToggle',      label: 'Toggle min / max focus', help: null,                                         rate: false, defaultKey: 'KeyQ' },
  { id: 'strokeLinkToggle', label: 'Toggle stroke link',   help: null,                                           rate: false, defaultKey: 'KeyF' },
];

// Standard gamepad button index → human label.
export const GP_BUTTON_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'L3', 'R3', 'D-Up', 'D-Down', 'D-Left', 'D-Right'];

export const GAMEPAD_ACTIONS = [
  { id: 'gpStrokeMaxUp',   label: 'Max stroke +1%',  help: 'Hold to repeat.', defaultButton: 3 /* Y     */ },
  { id: 'gpStrokeMaxDown', label: 'Max stroke −1%',  help: 'Hold to repeat.', defaultButton: 1 /* B     */ },
  { id: 'gpStrokeMinUp',   label: 'Min stroke +1%',  help: 'Hold to repeat.', defaultButton: 2 /* X     */ },
  { id: 'gpStrokeMinDown', label: 'Min stroke −1%',  help: 'Hold to repeat.', defaultButton: 0 /* A     */ },
  { id: 'gpSpeedUp',       label: 'Speed +1%',       help: 'Hold to repeat.', defaultButton: 5 /* RB    */ },
  { id: 'gpSpeedDown',     label: 'Speed −1%',       help: 'Hold to repeat.', defaultButton: 7 /* RT    */ },
  { id: 'gpPlayStop',      label: 'Start / stop',    help: null,              defaultButton: 9 /* Start */ },
];

function defaultKeybinds() {
  const out = {};
  for (const a of KEYBIND_ACTIONS) out[a.id] = a.defaultKey;
  return out;
}
function defaultGamepadBinds() {
  const out = {};
  for (const a of GAMEPAD_ACTIONS) out[a.id] = a.defaultButton;
  return out;
}

const DEFAULTS = {
  // Appearance
  textSize: 'md',           // sm | md | lg | xl
  compactDensity: false,
  reduceMotion: false,
  accent: 'orange',         // orange | green | blue | purple

  // Playback
  defaultGlobalOffset: 0,   // ms
  syncInterval: 2000,       // ms
  videoBesideControl: true,
  rememberVideoPosition: true,
  muteOnAutoplay: false,

  // Devices
  autoReconnect: true,
  connectionTimeout: 10,    // s

  // Advanced
  customPatternsFolder: '',
  verboseLogging: false,

  // Gamepad
  gamepadAutoDetect: true,

  // Layout
  devicesCollapsed: false,

  // Bindings
  keybinds: defaultKeybinds(),     // actionId → KeyboardEvent.code (or null)
  gamepadBinds: defaultGamepadBinds(), // actionId → button index (or null)
};

const TEXT_SIZE_PX = { sm: 12, md: 14, lg: 16, xl: 18 };

const ACCENTS = {
  orange: { hex: '#e8863a', hover: '#f09550', rgb: [232, 134, 58] },
  green:  { hex: '#4cc68a', hover: '#6ed4a0', rgb: [76, 198, 138] },
  blue:   { hex: '#5b9df0', hover: '#7eb1f3', rgb: [91, 157, 240] },
  purple: { hex: '#c87df0', hover: '#d597f3', rgb: [200, 125, 240] },
};

const SECTIONS = [
  { id: 'keybinds',   label: 'Keyboard & Controller', icon: '⌨', title: 'Keyboard & Controller' },
  { id: 'appearance', label: 'Appearance',            icon: '◑', title: 'Appearance' },
  { id: 'playback',   label: 'Playback',              icon: '▶', title: 'Playback' },
  { id: 'devices',    label: 'Devices',               icon: '◉', title: 'Devices & Connection' },
  { id: 'advanced',   label: 'Advanced',              icon: '⚙', title: 'Advanced' },
  { id: 'about',      label: 'About',                 icon: 'ⓘ', title: 'About' },
];

let prefs = loadPrefs();
let activeSection = 'keybinds';
let envInfo = null;     // populated lazily for About / Advanced
const listeners = new Set();

// ── persistence ──────────────────────────────────────────
function loadPrefs() {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const merged = { ...DEFAULTS, ...stored };
    merged.keybinds     = { ...DEFAULTS.keybinds,     ...(stored.keybinds     || {}) };
    merged.gamepadBinds = { ...DEFAULTS.gamepadBinds, ...(stored.gamepadBinds || {}) };
    return merged;
  } catch {
    return { ...DEFAULTS, keybinds: { ...DEFAULTS.keybinds }, gamepadBinds: { ...DEFAULTS.gamepadBinds } };
  }
}

function savePrefs() {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function setPref(key, value) {
  prefs[key] = value;
  savePrefs();
  applyPrefs();
  for (const fn of listeners) {
    try { fn(key, value, prefs); } catch { /* ignore */ }
  }
}

function applyPrefs() {
  const root = document.documentElement;
  // Text size — set body font-size; tokens are mostly absolute px so this
  // is a baseline scale that affects relative sizing.
  document.body.style.fontSize = `${TEXT_SIZE_PX[prefs.textSize] || 14}px`;
  root.style.setProperty('--text-scale', String((TEXT_SIZE_PX[prefs.textSize] || 14) / 14));

  // Accent palette
  const a = ACCENTS[prefs.accent] || ACCENTS.orange;
  root.style.setProperty('--accent',         a.hex);
  root.style.setProperty('--accent-hover',   a.hover);
  root.style.setProperty('--accent-rgb',     a.rgb.join(', '));
  root.style.setProperty('--accent-dim',     `rgba(${a.rgb.join(', ')}, 0.2)`);
  root.style.setProperty('--accent-subtle',  `rgba(${a.rgb.join(', ')}, 0.08)`);

  document.body.classList.toggle('compact-density', !!prefs.compactDensity);
  document.body.classList.toggle('reduce-motion',   !!prefs.reduceMotion);
  document.body.classList.toggle('devices-collapsed', !!prefs.devicesCollapsed);
}

export function togglePref(key) {
  setPref(key, !prefs[key]);
}

// Apply on script load (before app.js renders), persist defaults if first run.
applyPrefs();
if (!localStorage.getItem(PREFS_KEY)) savePrefs();

// ── modal control ────────────────────────────────────────
let root, navEl, bodyEl, gearBtn;
let lastFocus = null;

function isOpen() {
  return root && !root.hidden;
}

function openModal() {
  if (isOpen()) return;
  lastFocus = document.activeElement;
  root.hidden = false;
  gearBtn?.classList.add('is-open');
  render();
  // Focus the first nav item after enter animation.
  requestAnimationFrame(() => {
    navEl.querySelector('.prefs-nav-item')?.focus();
  });
}

function closeModal() {
  if (!isOpen()) return;
  cancelCapture();
  if (prefs.reduceMotion) {
    root.hidden = true;
    gearBtn?.classList.remove('is-open');
    lastFocus?.focus?.();
    return;
  }
  root.classList.add('closing');
  setTimeout(() => {
    root.hidden = true;
    root.classList.remove('closing');
    gearBtn?.classList.remove('is-open');
    lastFocus?.focus?.();
  }, 120);
}

function toggleModal() {
  isOpen() ? closeModal() : openModal();
}

// ── rendering ────────────────────────────────────────────
function render() {
  renderNav();
  renderBody();
}

function renderNav() {
  navEl.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'prefs-nav-title';
  title.textContent = 'Preferences';
  navEl.appendChild(title);

  for (const s of SECTIONS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'prefs-nav-item' + (s.id === activeSection ? ' active' : '');
    btn.dataset.section = s.id;
    btn.innerHTML = `<span class="prefs-nav-icon">${s.icon}</span><span>${s.label}</span>`;
    btn.addEventListener('click', () => {
      activeSection = s.id;
      render();
    });
    navEl.appendChild(btn);
  }
}

function renderBody() {
  const section = SECTIONS.find(s => s.id === activeSection);
  bodyEl.innerHTML = '';

  // Header bar (title + close)
  const header = document.createElement('div');
  header.className = 'prefs-body-header';
  header.innerHTML = `
    <span class="prefs-body-title" id="prefs-title">${section.title}</span>
    <button class="prefs-close" type="button" aria-label="Close" data-prefs-close>✕</button>
  `;
  bodyEl.appendChild(header);

  switch (activeSection) {
    case 'keybinds':   renderKeybinds(bodyEl);   break;
    case 'appearance': renderAppearance(bodyEl); break;
    case 'playback':   renderPlayback(bodyEl);   break;
    case 'devices':    renderDevices(bodyEl);    break;
    case 'advanced':   renderAdvanced(bodyEl);   break;
    case 'about':      renderAbout(bodyEl);      break;
  }
}

// ── helpers ──────────────────────────────────────────────
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

function settingsSection(heading, ...rows) {
  return el('div', { class: 'prefs-section' },
    el('h3', {}, heading),
    ...rows,
  );
}

function settingsRow(name, help, control) {
  const labelChildren = [el('span', { class: 'prefs-row-name' }, name)];
  if (help) labelChildren.push(el('span', { class: 'prefs-row-help' }, help));
  return el('div', { class: 'prefs-row' },
    el('div', { class: 'prefs-row-label' }, ...labelChildren),
    el('div', {}, control),
  );
}

// ── Binding capture ──────────────────────────────────────
function keyCodeLabel(code) {
  if (!code) return '—';
  if (code.startsWith('Key'))   return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return '←↑→↓'[['ArrowLeft','ArrowUp','ArrowRight','ArrowDown'].indexOf(code)] || code;
  if (code === 'Space')         return 'Space';
  return code;
}

function gamepadButtonLabel(idx) {
  if (idx == null) return '—';
  return GP_BUTTON_NAMES[idx] || `B${idx}`;
}

function setKeybind(actionId, code) {
  const next = { ...prefs.keybinds, [actionId]: code };
  setPref('keybinds', next);
}

function setGamepadBind(actionId, buttonIdx) {
  const next = { ...prefs.gamepadBinds, [actionId]: buttonIdx };
  setPref('gamepadBinds', next);
}

let activeCapture = null; // { cancel(): void } — at most one at a time

function cancelCapture() {
  if (activeCapture) { activeCapture.cancel(); activeCapture = null; }
}

function keyBindButton(actionId) {
  const btn = el('button', {
    type: 'button',
    class: 'prefs-bind-chip',
    title: 'Click to rebind, then press a key. Esc cancels.',
  });
  const render = () => {
    btn.textContent = keyCodeLabel(prefs.keybinds[actionId]);
    btn.classList.remove('capturing');
  };
  render();

  btn.addEventListener('click', () => {
    cancelCapture();
    btn.textContent = 'Press a key…';
    btn.classList.add('capturing');

    const onKey = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') { cleanup(); render(); return; }
      setKeybind(actionId, e.code);
      cleanup();
      render();
    };
    const cleanup = () => {
      window.removeEventListener('keydown', onKey, true);
      activeCapture = null;
    };
    activeCapture = { cancel: () => { cleanup(); render(); } };
    window.addEventListener('keydown', onKey, true);
  });
  return btn;
}

function gamepadBindButton(actionId) {
  const btn = el('button', {
    type: 'button',
    class: 'prefs-bind-chip',
    title: 'Click to rebind, then press a gamepad button. Esc cancels.',
  });
  const render = () => {
    btn.textContent = gamepadButtonLabel(prefs.gamepadBinds[actionId]);
    btn.classList.remove('capturing');
  };
  render();

  btn.addEventListener('click', () => {
    cancelCapture();
    btn.textContent = 'Press a button…';
    btn.classList.add('capturing');

    let prevDown = new Set();
    let raf = 0;
    const tick = () => {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const p of pads) {
        if (!p?.connected) continue;
        for (let i = 0; i < (p.buttons?.length ?? 0); i++) {
          const down = !!p.buttons[i]?.pressed;
          if (down && !prevDown.has(i)) {
            setGamepadBind(actionId, i);
            cleanup();
            render();
            return;
          }
        }
        prevDown = new Set();
        for (let i = 0; i < p.buttons.length; i++) {
          if (p.buttons[i]?.pressed) prevDown.add(i);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    const onKey = (e) => {
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); cleanup(); render(); }
    };
    const cleanup = () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKey, true);
      activeCapture = null;
    };
    activeCapture = { cancel: () => { cleanup(); render(); } };
    window.addEventListener('keydown', onKey, true);
    raf = requestAnimationFrame(tick);
  });
  return btn;
}

function toggle(prefKey) {
  const t = el('button', {
    type: 'button',
    class: 'prefs-toggle' + (prefs[prefKey] ? ' on' : ''),
    role: 'switch',
    'aria-checked': prefs[prefKey] ? 'true' : 'false',
    onClick: () => {
      setPref(prefKey, !prefs[prefKey]);
      t.classList.toggle('on', prefs[prefKey]);
      t.setAttribute('aria-checked', prefs[prefKey] ? 'true' : 'false');
    },
  });
  return t;
}

function selectControl(prefKey, options) {
  const sel = el('select', { class: 'prefs-select' });
  for (const opt of options) {
    const o = el('option', { value: String(opt.value) }, opt.label);
    if (String(prefs[prefKey]) === String(opt.value)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const raw = sel.value;
    const sample = options[0].value;
    const value = typeof sample === 'number' ? Number(raw) : raw;
    setPref(prefKey, value);
  });
  return sel;
}

function numberInput(prefKey) {
  const inp = el('input', {
    type: 'number',
    class: 'prefs-num',
    value: String(prefs[prefKey] ?? 0),
    step: '50',
  });
  inp.addEventListener('change', () => {
    setPref(prefKey, parseInt(inp.value, 10) || 0);
  });
  return inp;
}

function actionButton(label, onClick, opts = {}) {
  return el('button', {
    type: 'button',
    class: 'prefs-btn' + (opts.danger ? ' prefs-btn-danger' : ''),
    onClick,
  }, label);
}

// ── section renderers ───────────────────────────────────
function renderKeybinds(parent) {
  const kbRows = KEYBIND_ACTIONS.map(a =>
    settingsRow(a.label, a.help, keyBindButton(a.id))
  );
  parent.appendChild(settingsSection('Manual mode — keyboard', ...kbRows,
    el('div', { class: 'prefs-button-row' },
      actionButton('Reset keyboard to defaults', () => {
        cancelCapture();
        setPref('keybinds', defaultKeybinds());
        renderBody();
      }),
    ),
  ));

  const gpRows = GAMEPAD_ACTIONS.map(a =>
    settingsRow(a.label, a.help, gamepadBindButton(a.id))
  );
  parent.appendChild(settingsSection('Gamepad — DualShock / Xbox', ...gpRows,
    settingsRow('Auto-detect on connect',
      'Switch input to gamepad when one is plugged in.',
      toggle('gamepadAutoDetect')),
    el('div', { class: 'prefs-button-row' },
      actionButton('Reset gamepad to defaults', () => {
        cancelCapture();
        setPref('gamepadBinds', defaultGamepadBinds());
        renderBody();
      }),
    ),
  ));
}

function renderAppearance(parent) {
  parent.appendChild(settingsSection('Display',
    settingsRow('Text size',
      'Scales all interface text. Useful on 4K monitors viewed from a distance.',
      selectControl('textSize', [
        { value: 'sm', label: 'Small (12 px)' },
        { value: 'md', label: 'Medium (14 px)' },
        { value: 'lg', label: 'Large (16 px)' },
        { value: 'xl', label: 'Extra Large (18 px)' },
      ])),
    settingsRow('Compact density', 'Reduce padding throughout the app.', toggle('compactDensity')),
    settingsRow('Reduce motion',    null, toggle('reduceMotion')),
    settingsRow('Accent color',     null, accentSwatches()),
  ));
}

function accentSwatches() {
  const wrap = el('div', { class: 'prefs-swatch-row' });
  for (const [id, palette] of Object.entries(ACCENTS)) {
    const sw = el('button', {
      type: 'button',
      class: 'prefs-swatch' + (prefs.accent === id ? ' selected' : ''),
      'aria-label': `Accent: ${id}`,
      title: id,
      style: `background: ${palette.hex};`,
      onClick: () => {
        setPref('accent', id);
        for (const child of wrap.children) child.classList.remove('selected');
        sw.classList.add('selected');
      },
    });
    wrap.appendChild(sw);
  }
  return wrap;
}

function renderPlayback(parent) {
  parent.appendChild(settingsSection('Sync',
    settingsRow('Default global offset',
      'Applied to every newly-loaded video. Per-device offsets stack on top.',
      numberInput('defaultGlobalOffset')),
    settingsRow('Re-sync interval',
      'How often the app pushes a fresh time reference to each device while playing.',
      selectControl('syncInterval', [
        { value: 1000, label: '1 s' },
        { value: 2000, label: '2 s (default)' },
        { value: 5000, label: '5 s' },
      ])),
  ));
  parent.appendChild(settingsSection('Video window',
    settingsRow('Open beside control window', null, toggle('videoBesideControl')),
    settingsRow('Remember last position',     null, toggle('rememberVideoPosition')),
    settingsRow('Mute on autoplay',           null, toggle('muteOnAutoplay')),
  ));
}

function renderDevices(parent) {
  parent.appendChild(settingsSection('Connection',
    settingsRow('Auto-reconnect dropped devices',
      'Retries up to 3 times with exponential backoff before showing an error.',
      toggle('autoReconnect')),
    settingsRow('Connection timeout', null,
      selectControl('connectionTimeout', [
        { value: 5,  label: '5 s' },
        { value: 10, label: '10 s' },
        { value: 30, label: '30 s' },
      ])),
  ));

  // Saved data
  const apiKey = localStorage.getItem('herdplayer_apiKey') || '';
  const masked = apiKey ? maskAppId(apiKey) : 'Not set';

  let savedKeys = [], savedNicknames = [];
  try { savedKeys = JSON.parse(localStorage.getItem('herdplayer_deviceKeys') || '[]') || []; } catch { /* ignore */ }
  try { savedNicknames = JSON.parse(localStorage.getItem('herdplayer_deviceNicknames') || '[]') || []; } catch { /* ignore */ }
  const realKeys = savedKeys.filter(k => k && k.trim());
  const nicknameStr = savedNicknames.filter(n => n && n.trim()).join(', ') || `${realKeys.length} saved`;
  const devicesHelp = realKeys.length
    ? `${nicknameStr}. Removing forgets keys, nicknames, and per-device offsets.`
    : 'No devices saved yet.';

  parent.appendChild(settingsSection('Saved data',
    settingsRow('Application ID', masked,
      actionButton('Clear', async () => {
        if (!apiKey) return;
        const ok = await confirmDialog({
          message: 'Clear saved Application ID?',
          detail: 'You will need to re-enter it to connect.',
        });
        if (!ok) return;
        localStorage.removeItem('herdplayer_apiKey');
        const input = document.getElementById('api-key');
        if (input) input.value = '';
        renderBody();
      })),
    settingsRow(`Saved devices (${realKeys.length})`, devicesHelp,
      actionButton('Forget all', async () => {
        if (realKeys.length === 0) return;
        const ok = await confirmDialog({
          message: 'Forget all saved devices?',
          detail: 'This removes connection keys, nicknames, and per-device offsets.',
        });
        if (!ok) return;
        localStorage.removeItem('herdplayer_deviceKeys');
        localStorage.removeItem('herdplayer_deviceOffsets');
        localStorage.removeItem('herdplayer_deviceNicknames');
        renderBody();
      }, { danger: true })),
  ));
}

function maskAppId(id) {
  if (id.length <= 4) return `${'•'.repeat(id.length)}`;
  return `${id.slice(0, 7)}${'•'.repeat(Math.max(6, id.length - 11))}${id.slice(-4)}`;
}

async function renderAdvanced(parent) {
  parent.appendChild(settingsSection('Files',
    settingsRow('Patterns folder',
      'Where Queue mode looks for .funscript patterns.',
      actionButton('Open in Explorer', async () => {
        const info = await getInfo();
        if (info?.patternsPath) window.electronAPI.prefsOpenPath(info.patternsPath);
      })),
    settingsRow('Custom patterns folder',
      prefs.customPatternsFolder || 'Using bundled patterns folder.',
      actionButton(prefs.customPatternsFolder ? 'Change…' : 'Choose…', async () => {
        const folder = await window.electronAPI.prefsChooseFolder();
        if (folder) {
          setPref('customPatternsFolder', folder);
          renderBody();
        }
      })),
  ));

  parent.appendChild(settingsSection('Diagnostics',
    settingsRow('Verbose logging', null, toggle('verboseLogging')),
    settingsRow('Open log folder', null,
      actionButton('Reveal', async () => {
        const info = await getInfo();
        if (info?.logsPath) window.electronAPI.prefsOpenPath(info.logsPath);
      })),
    settingsRow('Reset all preferences', null,
      actionButton('Reset…', async () => {
        const ok = await confirmDialog({
          message: 'Reset all preferences to defaults?',
          detail: 'Saved devices, keys, and offsets are not affected.',
        });
        if (!ok) return;
        prefs = { ...DEFAULTS };
        savePrefs();
        applyPrefs();
        renderBody();
      }, { danger: true })),
  ));
}

async function renderAbout(parent) {
  // Render scaffold immediately, populate version info async.
  const info = await getInfo();
  const buildDate = new Date().toLocaleDateString();
  const versionLine = info
    ? `Version ${info.version} · Electron ${info.electronVersion} · Handy v3 API`
    : 'HerdPlayer · Handy v3 API';

  parent.appendChild(settingsSection('HerdPlayer',
    el('div', { class: 'prefs-about-text' },
      el('div', {}, versionLine),
      el('div', {}, `Built ${buildDate}`),
    ),
    el('div', { class: 'prefs-button-row' },
      actionButton('Check for updates', () => {
        window.electronAPI.prefsOpenExternal('https://github.com/');
      }),
      actionButton('View on GitHub', () => {
        window.electronAPI.prefsOpenExternal('https://github.com/');
      }),
      actionButton('Open spec.yaml', () => {
        if (info?.specPath) window.electronAPI.prefsOpenPath(info.specPath);
      }),
    ),
  ));
}

async function getInfo() {
  if (envInfo) return envInfo;
  try { envInfo = await window.electronAPI.prefsGetInfo(); }
  catch { envInfo = null; }
  return envInfo;
}

async function confirmDialog(opts) {
  // Prefer native dialog (Electron); fall back to window.confirm.
  if (window.electronAPI?.prefsConfirm) {
    try { return await window.electronAPI.prefsConfirm(opts); }
    catch { /* fall through */ }
  }
  return window.confirm(`${opts.message}\n\n${opts.detail || ''}`);
}

// ── wiring ──────────────────────────────────────────────
function init() {
  root    = document.getElementById('prefs-modal');
  navEl   = document.getElementById('prefs-nav');
  bodyEl  = document.getElementById('prefs-body');
  gearBtn = document.getElementById('open-prefs-btn');
  if (!root || !gearBtn) return;

  gearBtn.addEventListener('click', toggleModal);

  // Click on backdrop or any [data-prefs-close] closes the modal.
  root.addEventListener('click', (e) => {
    if (e.target?.dataset?.prefsClose !== undefined) closeModal();
  });

  // Global shortcuts.
  window.addEventListener('keydown', (e) => {
    // Ctrl+,  → open / focus
    if ((e.ctrlKey || e.metaKey) && e.key === ',') {
      e.preventDefault();
      isOpen() ? navEl.querySelector('.prefs-nav-item.active')?.focus() : openModal();
      return;
    }
    // Esc → close (only when open)
    if (e.key === 'Escape' && isOpen()) {
      e.preventDefault();
      closeModal();
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}

// ── public API for other modules ─────────────────────────
export function getPrefs() {
  return { ...prefs };
}

export function getPref(key) {
  return prefs[key];
}

export function getAccentRgb() {
  return [...(ACCENTS[prefs.accent] || ACCENTS.orange).rgb];
}

export function getKeybinds() {
  return { ...prefs.keybinds };
}

export function getGamepadBinds() {
  return { ...prefs.gamepadBinds };
}

export function onPrefChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
