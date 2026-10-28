// Opening panels in their own windows, plus saved window layouts.

export const PANEL_ROUTES = [
  { path: '/map', title: 'Track map' },
  { path: '/tower', title: 'Timing tower' },
  { path: '/telemetry', title: 'Telemetry' },
  { path: '/race-control', title: 'Race control' },
  { path: '/strategy', title: 'Tyre strategy' },
  { path: '/pit-battles', title: 'Pit battles (undercuts)' },
  { path: '/compare', title: 'Fastest laps' },
  { path: '/moments', title: 'Key moments' },
  { path: '/race-trace', title: 'Race trace' },
  { path: '/positions', title: 'Positions' },
  { path: '/tyre-wear', title: 'Tyre wear' },
  { path: '/championship', title: 'Championship' },
  { path: '/long-runs', title: 'Long runs / stint pace' },
  { path: '/wall', title: 'Full pit wall' },
  { path: '/companion', title: 'TV companion' },
  { path: '/driver', title: 'Driver dashboard' },
  { path: '/tv', title: 'TV mode' },
  { path: '/report', title: 'Race report' },
] as const;

export interface WindowSpec {
  path: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Layout {
  id: string;
  name: string;
  /** Fractions of the screen (0–1) for presets; pixels for saved layouts. */
  units: 'fraction' | 'px';
  windows: WindowSpec[];
}

export const PRESETS: Layout[] = [
  {
    id: 'quad',
    name: 'Quad: map, tower, telemetry, race control',
    units: 'fraction',
    windows: [
      { path: '/map', left: 0, top: 0, width: 0.5, height: 0.5 },
      { path: '/tower', left: 0.5, top: 0, width: 0.5, height: 0.5 },
      { path: '/telemetry', left: 0, top: 0.5, width: 0.5, height: 0.5 },
      { path: '/race-control', left: 0.5, top: 0.5, width: 0.5, height: 0.5 },
    ],
  },
  {
    id: 'map-timing',
    name: 'Map + timing side by side',
    units: 'fraction',
    windows: [
      { path: '/map', left: 0, top: 0, width: 0.62, height: 1 },
      { path: '/tower', left: 0.62, top: 0, width: 0.38, height: 1 },
    ],
  },
  {
    id: 'engineer',
    name: 'Race engineer: everything',
    units: 'fraction',
    windows: [
      { path: '/map', left: 0, top: 0, width: 0.45, height: 0.6 },
      { path: '/tower', left: 0.45, top: 0, width: 0.3, height: 0.6 },
      { path: '/race-control', left: 0.75, top: 0, width: 0.25, height: 0.6 },
      { path: '/telemetry', left: 0, top: 0.6, width: 0.6, height: 0.4 },
      { path: '/strategy', left: 0.6, top: 0.6, width: 0.4, height: 0.4 },
    ],
  },
];

const opened = new Map<string, Window>();

export function openPanelWindow(path: string, spec?: Omit<WindowSpec, 'path'>) {
  const s = spec ?? { left: window.screenX + 40, top: window.screenY + 40, width: 900, height: 640 };
  const features = `popup=yes,left=${Math.round(s.left)},top=${Math.round(s.top)},width=${Math.round(s.width)},height=${Math.round(s.height)}`;
  const name = 'pitwall' + path.replace(/\//g, '-');
  const w = window.open(path, name, features);
  if (w) {
    opened.set(path, w);
    try {
      w.moveTo(s.left, s.top);
      w.resizeTo(s.width, s.height);
    } catch {
      // some browsers ignore this; the features string already asked nicely
    }
  }
  return w;
}

/** Open every window in a layout. Returns how many the browser actually allowed. */
export function openLayout(layout: Layout) {
  const sw = screen.availWidth;
  const sh = screen.availHeight;
  const ox = (screen as Screen & { availLeft?: number }).availLeft ?? 0;
  const oy = (screen as Screen & { availTop?: number }).availTop ?? 0;
  let ok = 0;
  for (const w of layout.windows) {
    const spec =
      layout.units === 'fraction'
        ? { left: ox + w.left * sw, top: oy + w.top * sh, width: w.width * sw, height: w.height * sh }
        : w;
    if (openPanelWindow(w.path, spec)) ok++;
  }
  return ok;
}

/** Snapshot where the windows opened from this tab currently are. */
export function captureLayout(name: string): Layout | null {
  const windows: WindowSpec[] = [];
  for (const [path, w] of opened) {
    if (w.closed) continue;
    try {
      windows.push({ path, left: w.screenX, top: w.screenY, width: w.outerWidth, height: w.outerHeight });
    } catch {
      // cross-origin or closed mid-read
    }
  }
  if (windows.length === 0) return null;
  return { id: 'saved-' + Date.now(), name, units: 'px', windows };
}

const KEY = 'pitwall.layouts';

export function savedLayouts(): Layout[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function saveLayouts(list: Layout[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
}
