import "./styles.css";
import type { Dataset, Ride } from "./types";
import {
  computeDayOfWeekPatterns,
  computeElevationRatioAnalysis,
  computeHourOfDayPatterns,
  computeHRZoneDistribution,
  computeMonthlyTrends,
  computeProgressiveMetrics,
  computeSpeedElevationBins
} from "./analytics";
import {
  connectGoogle,
  fetchDataset,
  getAuthStatus,
  logoutGoogle,
  type DatasetResult
} from "./sheets";

const app = document.querySelector<HTMLDivElement>("#app")!;
const tooltip = document.createElement("div");
tooltip.id = "tooltip";
tooltip.className = "tooltip";
tooltip.setAttribute("role", "tooltip");
document.body.appendChild(tooltip);

type Page =
  | "overview"
  | "calendar"
  | "performance"
  | "bikes"
  | "streaks"
  | "day-of-week"
  | "hour-of-day"
  | "monthly-trends"
  | "speed-elevation"
  | "hr-zones"
  | "progressive-metrics"
  | "rides"
  | "goals";

type Scope = "year" | "all";
type Metric = "cfi" | "distance" | "speed" | "elevation";
type SortKey = "date" | "distance" | "speed" | "elevation" | "hr" | "cfi";
type ToastKind = "success" | "info" | "error";

type GoalValues = {
  distanceKm: number;
  rides: number;
  elevationM: number;
};

type AppState = {
  dataset: Dataset | null;
  page: Page;
  year: number | null;
  scope: Scope;
  metric: Metric;
  loading: boolean;
  syncing: boolean;
  connected: boolean;
  error: string | null;
  lastSynced: string | null;
  search: string;
  bikeFilter: string;
  sortKey: SortKey;
  sortDirection: "asc" | "desc";
  ridePage: number;
  selectedRide: string | null;
  selectedDate: string | null;
  favorites: Set<string>;
  goals: GoalValues;
  menuOpen: boolean;
  toast: { message: string; kind: ToastKind } | null;
};

type PageMeta = {
  label: string;
  title: string;
  description: string;
  icon: string;
  group: "command" | "explore" | "trends" | "tools";
};

const PAGE_META: Record<Page, PageMeta> = {
  overview: {
    label: "Overview",
    title: "Your riding command center",
    description: "A live pulse of your distance, consistency, climbing, and performance.",
    icon: "overview",
    group: "command"
  },
  calendar: {
    label: "Calendar",
    title: "Every ride has a story",
    description: "Explore your riding history as an interactive year-at-a-glance heatmap.",
    icon: "calendar",
    group: "explore"
  },
  performance: {
    label: "Performance",
    title: "Performance / CFI",
    description: "See how your personal fitness index changes across seasons and years.",
    icon: "performance",
    group: "trends"
  },
  bikes: {
    label: "Cycles",
    title: "Your bikes, decoded",
    description: "Compare how each bike contributes to your total riding profile.",
    icon: "bike",
    group: "explore"
  },
  streaks: {
    label: "Consistency",
    title: "Consistency compounds",
    description: "Find your strongest riding blocks and the habits behind them.",
    icon: "streak",
    group: "trends"
  },
  "day-of-week": {
    label: "Day of week",
    title: "When you ride",
    description: "Find the weekdays that carry your training and recovery rhythm.",
    icon: "weekday",
    group: "trends"
  },
  "hour-of-day": {
    label: "Hours of day",
    title: "Your riding clock",
    description: "See when your rides happen when the source includes a start time.",
    icon: "clock",
    group: "trends"
  },
  "monthly-trends": {
    label: "Monthly trends",
    title: "The shape of your season",
    description: "Compare distance, climbing, speed, and CFI month by month.",
    icon: "trend",
    group: "trends"
  },
  "speed-elevation": {
    label: "Speed / elevation",
    title: "Flat speed meets climbing",
    description: "Understand how your speed profile changes as routes get steeper.",
    icon: "elevation",
    group: "trends"
  },
  "hr-zones": {
    label: "HR zones",
    title: "Effort, visualized",
    description: "A lightweight view of recorded heart-rate intensity and ride CFI.",
    icon: "heart",
    group: "trends"
  },
  "progressive-metrics": {
    label: "Progression",
    title: "The long view",
    description: "Track rolling ten-ride averages and the cumulative shape of your training.",
    icon: "progression",
    group: "trends"
  },
  rides: {
    label: "Ride explorer",
    title: "Every ride, searchable",
    description: "Search, sort, inspect, favorite, and export the rows behind the charts.",
    icon: "rides",
    group: "tools"
  },
  goals: {
    label: "Goals",
    title: "Make the next ride count",
    description: "Set personal targets and keep a little momentum visible.",
    icon: "goals",
    group: "tools"
  }
};

const ICON_PATHS: Record<string, string> = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  performance: '<path d="M4 19V5M4 19h17"/><path d="m7 15 4-5 3 2 5-7"/><path d="M17 5h2v2"/>',
  bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="m6 17 4-8 4 8M10 9l4 8M9 6h4M18 17l-2-6h-4"/>',
  streak: '<path d="M13 2 4.5 13H11l-1 9 8.5-12H12l1-8Z"/>',
  weekday: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M5 3 3 5M19 3l2 2"/>',
  trend: '<path d="M4 19V5M4 19h17"/><path d="m7 15 3-4 3 2 5-6"/><path d="M16 7h2v2"/>',
  elevation: '<path d="m3 19 6-8 4 4 3-5 5 7"/><path d="M3 19h18"/>',
  heart: '<path d="M20.8 8.7c0 5.2-8.8 10.3-8.8 10.3S3.2 13.9 3.2 8.7A4.7 4.7 0 0 1 12 6.4a4.7 4.7 0 0 1 8.8 2.3Z"/>',
  progression: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m4 18 4-5 3 2 4-7 5 5"/><path d="M4 21h16"/>',
  rides: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="11" cy="19" r="1.5"/>',
  goals: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/><path d="m19 5 2 2"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  sync: '<path d="M20 11a8.1 8.1 0 0 0-14.8-3L3 11m0 0V5m0 6h6M4 13a8.1 8.1 0 0 0 14.8 3L21 13m0 0v6m0-6h-6"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4M4 20h16"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  spark: '<path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/><path d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  moon: '<path d="M20 15.5A8.5 8.5 0 0 1 8.5 4 8.5 8.5 0 1 0 20 15.5Z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>'
};

const STORAGE_KEYS = {
  favorites: "ridescope-favorites",
  goals: "ridescope-goals"
};

const defaultGoals: GoalValues = { distanceKm: 500, rides: 30, elevationM: 5000 };

function readStoredGoals(): GoalValues {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.goals);
    if (!raw) return { ...defaultGoals };
    const parsed = JSON.parse(raw) as Partial<GoalValues>;
    return {
      distanceKm: Number(parsed.distanceKm) > 0 ? Number(parsed.distanceKm) : defaultGoals.distanceKm,
      rides: Number(parsed.rides) > 0 ? Number(parsed.rides) : defaultGoals.rides,
      elevationM: Number(parsed.elevationM) > 0 ? Number(parsed.elevationM) : defaultGoals.elevationM
    };
  } catch {
    return { ...defaultGoals };
  }
}

function readFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.favorites);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === "string") : []);
  } catch {
    return new Set();
  }
}

function pageFromHash(): Page {
  const value = window.location.hash.replace(/^#/, "") as Page;
  return value in PAGE_META ? value : "overview";
}

const state: AppState = {
  dataset: null,
  page: pageFromHash(),
  year: null,
  scope: "year",
  metric: "cfi",
  loading: true,
  syncing: false,
  connected: false,
  error: null,
  lastSynced: null,
  search: "",
  bikeFilter: "all",
  sortKey: "date",
  sortDirection: "desc",
  ridePage: 0,
  selectedRide: null,
  selectedDate: null,
  favorites: readFavorites(),
  goals: readStoredGoals(),
  menuOpen: false,
  toast: null
};

const fmt = {
  n(value: number | null | undefined, digits = 0): string {
    return Number(value ?? 0).toLocaleString(undefined, { maximumFractionDigits: digits });
  },
  km(value: number | null | undefined): string {
    return `${fmt.n(value, 1)} km`;
  },
  m(value: number | null | undefined): string {
    return `${fmt.n(value, 0)} m`;
  },
  hours(value: number | null | undefined): string {
    const hours = Number(value ?? 0);
    if (hours < 1) return `${Math.round(hours * 60)} min`;
    return `${hours.toFixed(hours >= 10 ? 0 : 1)} h`;
  },
  durationFromHours(value: number | null | undefined): string {
    const hours = Number(value ?? 0);
    if (!hours) return "—";
    return fmt.hours(hours);
  },
  speed(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : `${Number(value).toFixed(1)} km/h`;
  },
  cfi(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : Number(value).toFixed(1);
  },
  percent(value: number | null | undefined): string {
    return value === null || value === undefined ? "—" : `${Number(value).toFixed(0)}%`;
  },
  date(value: string | null | undefined): string {
    if (!value) return "—";
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return value;
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  },
  shortDate(value: string | null | undefined): string {
    if (!value) return "—";
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return value;
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric"
    });
  }
};

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return entities[character] ?? character;
  });
}

function icon(name: string, size = 18): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ICON_PATHS.spark}</svg>`;
}

function sum(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function average(values: Array<number | null>): number {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
}

function localDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getScopedRides(): Ride[] {
  if (!state.dataset) return [];
  return state.scope === "all"
    ? state.dataset.rides
    : state.dataset.rides.filter(ride => ride.year === state.year);
}

function getSelectedYear(): number {
  return state.year ?? state.dataset?.years.at(-1) ?? new Date().getFullYear();
}

function getSelectedRide(): Ride | null {
  if (!state.selectedRide || !state.dataset) return null;
  return state.dataset.rides.find(ride => ride.id === state.selectedRide) ?? null;
}

function isFavorite(ride: Ride): boolean {
  return state.favorites.has(ride.id) || state.favorites.has(ride.date);
}

function getRideValue(ride: Ride, key: SortKey): number {
  if (key === "date") return localDate(ride.date).getTime();
  if (key === "hr") return ride.hrMean ?? -1;
  if (key === "cfi") return ride.cfi ?? -1;
  if (key === "speed") return ride.avgSpeed ?? -1;
  return ride[key] ?? -1;
}

function getFilteredRides(): Ride[] {
  const query = state.search.trim().toLowerCase();
  const rides = getScopedRides().filter(ride => {
    const matchesBike = state.bikeFilter === "all" || ride.bike === state.bikeFilter;
    const haystack = `${ride.date} ${ride.bike} ${ride.device ?? ""}`.toLowerCase();
    return matchesBike && (!query || haystack.includes(query));
  });
  const direction = state.sortDirection === "asc" ? 1 : -1;
  return rides.sort((a, b) => {
    const comparison = getRideValue(a, state.sortKey) - getRideValue(b, state.sortKey);
    return comparison === 0 ? a.date.localeCompare(b.date) * direction : comparison * direction;
  });
}

function currentStreak(rides: Ride[]): number {
  const dates = [...new Set(rides.map(ride => ride.date))].sort();
  if (!dates.length) return 0;
  let streak = 1;
  for (let index = dates.length - 1; index > 0; index--) {
    const current = localDate(dates[index]);
    const previous = localDate(dates[index - 1]);
    if (Math.round((current.getTime() - previous.getTime()) / 86400000) !== 1) break;
    streak += 1;
  }
  return streak;
}

function bestRide(rides: Ride[], key: "distance" | "elevation" | "avgSpeed" | "movingHours" | "cfi"): Ride | null {
  if (!rides.length) return null;
  return [...rides].sort((a, b) => (b[key] ?? -Infinity) - (a[key] ?? -Infinity))[0] ?? null;
}

function scopeLabel(): string {
  return state.scope === "all" ? "All time" : String(getSelectedYear());
}

function metricLabel(metric: Metric): string {
  return { cfi: "CFI", distance: "Distance", speed: "Speed", elevation: "Elevation" }[metric];
}

function metricValue(ride: Ride, metric: Metric): number {
  if (metric === "cfi") return ride.cfi ?? 0;
  if (metric === "speed") return ride.avgSpeed ?? 0;
  return ride[metric] ?? 0;
}

function scopeYearOptions(): string {
  if (!state.dataset) return "";
  return `<label class="select-wrap" aria-label="Select year">
    <span class="sr-only">Year</span>
    <select class="select-control" data-input="year">
      ${state.dataset.years.map(year => `<option value="${year}" ${year === state.year ? "selected" : ""}>${year}</option>`).join("")}
    </select>
    ${icon("chevron", 15)}
  </label>`;
}

function pageHeader(eyebrow: string, title: string, description: string, actions = ""): string {
  return `<div class="page-heading reveal">
    <div>
      <div class="eyebrow"><span class="eyebrow-dot"></span>${escapeHtml(eyebrow)}</div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(description)}</p>
    </div>
    ${actions ? `<div class="heading-actions">${actions}</div>` : ""}
  </div>`;
}

function emptyPanel(title: string, message: string, action = ""): string {
  return `<div class="empty-panel reveal">
    <div class="empty-icon">${icon("spark", 24)}</div>
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(message)}</p>
    ${action}
  </div>`;
}

function loadingView(): string {
  return `<div class="auth-layout reveal">
    <div class="auth-card auth-card--loading">
      <div class="auth-mark">${icon("bike", 26)}</div>
      <div class="skeleton skeleton--eyebrow"></div>
      <div class="skeleton skeleton--title"></div>
      <div class="skeleton skeleton--copy"></div>
      <div class="skeleton skeleton--button"></div>
      <div class="loading-note"><span class="loading-pulse"></span>Connecting to your private Sheets source</div>
    </div>
  </div>`;
}

function loginView(): string {
  return `<div class="auth-layout reveal">
    <div class="auth-card">
      <div class="auth-kicker"><span class="status-dot"></span>Private data source</div>
      <div class="auth-mark">${icon("bike", 28)}</div>
      <h1>Turn your rides into a <em>living</em> dashboard.</h1>
      <p class="auth-copy">RideScope reads your Strava export from a private Google Sheet, keeps OAuth on the server, and turns every ride into clear, explorable insight.</p>
      <div class="auth-features">
        <span>${icon("check", 14)} Read-only access</span>
        <span>${icon("check", 14)} Local analytics</span>
        <span>${icon("check", 14)} No client secret</span>
      </div>
      <button class="button button--primary button--wide" data-action="connect">${icon("database", 17)} Continue with Google ${icon("arrow", 16)}</button>
      <p class="auth-footnote">Requested scope: <code>spreadsheets.readonly</code></p>
    </div>
  </div>`;
}

function errorView(): string {
  return `<div class="auth-layout reveal">
    <div class="auth-card auth-card--error">
      <div class="auth-mark auth-mark--error">!</div>
      <div class="auth-kicker auth-kicker--error">Connection interrupted</div>
      <h1>We could not load your rides.</h1>
      <p class="auth-copy">${escapeHtml(state.error ?? "Unknown error")}</p>
      <button class="button button--primary" data-action="retry">${icon("sync", 16)} Try again</button>
    </div>
  </div>`;
}

function noDataView(): string {
  return emptyPanel(
    "Your ride log is ready for data",
    "The Sheet connected successfully, but no valid ride rows were found. Check the date column and sync again.",
    `<button class="button button--secondary" data-action="sync">${icon("sync", 15)} Sync Sheet</button>`
  );
}

function navItem(page: Page): string {
  const meta = PAGE_META[page];
  const active = state.page === page;
  return `<button class="nav-item ${active ? "is-active" : ""}" data-nav="${page}" ${active ? 'aria-current="page"' : ""}>
    <span class="nav-icon">${icon(meta.icon, 17)}</span>
    <span class="nav-copy"><strong>${escapeHtml(meta.label)}</strong><small>${escapeHtml(meta.description)}</small></span>
    ${active ? '<span class="nav-indicator"></span>' : ""}
  </button>`;
}

function navGroup(label: string, pages: Page[]): string {
  return `<div class="nav-group"><div class="nav-group-label">${label}</div>${pages.map(navItem).join("")}</div>`;
}

function renderSidebar(): string {
  return `<aside class="sidebar" aria-label="Primary navigation">
    <div class="brand-lockup">
      <div class="brand-mark">${icon("bike", 22)}</div>
      <div><div class="brand-name">RIDE<span>SCOPE</span></div><div class="brand-subtitle">personal cycling intelligence</div></div>
    </div>
    <div class="sidebar-scroll">
      ${navGroup("Command", ["overview", "calendar"])}
      ${navGroup("Explore", ["rides", "bikes", "streaks", "goals"])}
      ${navGroup("Trends", ["performance", "day-of-week", "hour-of-day", "monthly-trends", "speed-elevation", "hr-zones", "progressive-metrics"])}
    </div>
    <div class="sidebar-footer">
      <div class="source-mini"><span class="source-icon">${icon("database", 15)}</span><div><strong>Google Sheets</strong><span>private source of truth</span></div><span class="source-live"></span></div>
      ${state.connected ? '<button class="sidebar-link" data-action="logout">Sign out of Google</button>' : ""}
    </div>
  </aside>`;
}

function renderQualityRail(): string {
  if (!state.dataset) {
    return `<div class="rail-card rail-card--empty"><div class="rail-icon">${icon("database", 18)}</div><div class="eyebrow">Source</div><h3>Waiting for your Sheet</h3><p>Connect Google to unlock the dashboard and data-quality signals.</p></div>`;
  }
  const quality = state.dataset.dataQuality;
  const total = Math.max(1, quality.totalRides);
  const complete = Math.round((quality.completeRides / total) * 100);
  const fieldRows = [
    ["Distance", quality.missing.distance],
    ["Elevation", quality.missing.elevation],
    ["Heart rate", quality.missing.hrMean],
    ["Start time", quality.missing.startTime]
  ] as const;
  return `<div class="rail-card rail-card--quality">
    <div class="rail-card-heading"><div><div class="eyebrow">Data pulse</div><h3>Sheet health</h3></div><span class="quality-score">${complete}%</span></div>
    <div class="quality-bar"><span style="width:${complete}%"></span></div>
    <p class="rail-copy">${fmt.n(quality.completeRides)} of ${fmt.n(quality.totalRides)} rides have the core metrics used for CFI.</p>
    <div class="quality-list">${fieldRows.map(([label, missing]) => {
      const coverage = Math.round(((total - missing) / total) * 100);
      return `<div class="quality-row"><span>${label}</span><span class="quality-track"><i style="width:${coverage}%"></i></span><strong>${coverage}%</strong></div>`;
    }).join("")}</div>
    <button class="rail-link" data-page-target="rides">Inspect all rides ${icon("arrow", 14)}</button>
  </div>`;
}

function renderRail(): string {
  const syncTime = state.lastSynced
    ? new Date(state.lastSynced).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : "";
  const syncLabel = state.syncing ? "Syncing" : state.lastSynced ? `Synced ${syncTime}` : "Ready";
  return `<aside class="insights-rail" aria-label="Dashboard insights">
    <div class="rail-topline"><span class="eyebrow">Signal desk</span><span class="rail-live"><i></i>${syncLabel}</span></div>
    ${renderQualityRail()}
    <div class="rail-card rail-card--actions">
      <div class="eyebrow">Quick actions</div>
      <button class="rail-action" data-page-target="rides">${icon("search", 16)} <span>Find a ride</span>${icon("arrow", 14)}</button>
      <button class="rail-action" data-page-target="goals">${icon("goals", 16)} <span>Set a goal</span>${icon("arrow", 14)}</button>
      <button class="rail-action" data-action="export">${icon("download", 16)} <span>Export visible data</span>${icon("arrow", 14)}</button>
    </div>
    <div class="rail-card rail-card--runtime">
      <div class="eyebrow">Runtime layer</div>
      <div class="runtime-row"><span class="runtime-dot runtime-dot--cyan"></span><span>View transitions</span><strong id="vtBadge">—</strong></div>
      <div class="runtime-row"><span class="runtime-dot runtime-dot--violet"></span><span>Ambient renderer</span><strong id="gpuBadge">—</strong></div>
      <p>Visual enhancement only. Analytics stay local and work without a GPU.</p>
    </div>
    <div class="rail-tip"><span class="tip-star">${icon("spark", 15)}</span><div><strong>Small ritual</strong><p>Sync after your next ride and watch your trendline respond.</p></div></div>
  </aside>`;
}

function renderTopbar(): string {
  const meta = PAGE_META[state.page];
  return `<header class="topbar">
    <button class="icon-button mobile-menu" data-action="menu" aria-label="Open navigation">${icon("menu", 20)}</button>
    <div class="topbar-title"><div class="breadcrumb"><span>Workspace</span>${icon("chevron", 12)}<span>${escapeHtml(meta.label)}</span></div><h1>${escapeHtml(meta.title)}</h1></div>
    <div class="topbar-actions">
      ${state.dataset && state.dataset.years.length ? `<div class="scope-toggle" role="group" aria-label="Data scope"><button class="${state.scope === "year" ? "is-active" : ""}" data-scope="year">Year</button><button class="${state.scope === "all" ? "is-active" : ""}" data-scope="all">All time</button></div>${scopeYearOptions()}` : ""}
      ${state.dataset ? `<button class="button button--sync ${state.syncing ? "is-syncing" : ""}" data-action="sync" ${state.syncing ? "disabled" : ""}>${icon("sync", 15)}<span>${state.syncing ? "Syncing" : "Sync"}</span></button>` : ""}
      <div class="topbar-avatar" aria-label="Connected profile">RS</div>
    </div>
  </header>`;
}

function renderMobileScopeControls(): string {
  if (!state.dataset || !state.dataset.years.length) return "";
  return `<div class="mobile-data-controls"><span class="mobile-data-label">Data scope</span><div class="scope-toggle" role="group" aria-label="Data scope"><button class="${state.scope === "year" ? "is-active" : ""}" data-scope="year">Year</button><button class="${state.scope === "all" ? "is-active" : ""}" data-scope="all">All time</button></div>${scopeYearOptions()}</div>`;
}

function renderDrawer(): string {
  const ride = getSelectedRide();
  if (!ride) return "";
  return `<div class="drawer-backdrop" data-action="close-drawer"></div>
    <aside class="ride-drawer" aria-label="Ride details">
      <div class="drawer-header"><div><div class="eyebrow">Ride detail</div><h2>${escapeHtml(fmt.date(ride.date))}</h2></div><button class="icon-button" data-action="close-drawer" aria-label="Close ride details">${icon("close", 18)}</button></div>
      <div class="drawer-hero"><div class="drawer-bike-icon">${icon("bike", 30)}</div><div><strong>${escapeHtml(ride.bike)}</strong><span>${escapeHtml(ride.device ?? "Device not recorded")}</span></div><button class="icon-button icon-button--star ${isFavorite(ride) ? "is-starred" : ""}" data-favorite="${ride.id}" aria-label="Toggle favorite">${icon("star", 18)}</button></div>
      <div class="drawer-grid">
        <div><span>Distance</span><strong>${fmt.km(ride.distance)}</strong></div>
        <div><span>Elevation</span><strong>${fmt.m(ride.elevation)}</strong></div>
        <div><span>Avg speed</span><strong>${fmt.speed(ride.avgSpeed)}</strong></div>
        <div><span>Max speed</span><strong>${fmt.speed(ride.maxSpeed)}</strong></div>
        <div><span>Moving time</span><strong>${fmt.hours(ride.movingHours)}</strong></div>
        <div><span>Heart rate</span><strong>${ride.hrMean === null ? "—" : `${ride.hrMean.toFixed(0)} bpm`}</strong></div>
        <div><span>Max HR</span><strong>${ride.hrMax === null ? "—" : `${ride.hrMax.toFixed(0)} bpm`}</strong></div>
        <div><span>CFI</span><strong class="text-violet">${fmt.cfi(ride.cfi)}</strong></div>
      </div>
      <div class="drawer-section"><div class="eyebrow">Source row</div><div class="source-row"><span>Elapsed</span><strong>${escapeHtml(ride.elapsedTime || "—")}</strong><span>Moving</span><strong>${escapeHtml(ride.movingTime || "—")}</strong><span>Start time</span><strong>${escapeHtml(ride.startTime ?? "Not captured")}</strong></div></div>
      <div class="drawer-note"><span>${icon("info", 15)}</span><p>CFI is a personal relative index, not a medical or clinical measurement.</p></div>
    </aside>`;
}

function renderToast(): string {
  if (!state.toast) return "";
  return `<div class="toast toast--${state.toast.kind}" role="status"><span>${icon(state.toast.kind === "success" ? "check" : state.toast.kind === "error" ? "close" : "info", 16)}</span>${escapeHtml(state.toast.message)}</div>`;
}

function shell(content: string): string {
  return `<div class="app-shell ${state.menuOpen ? "menu-open" : ""}">
    <div class="ambient ambient--one"></div><div class="ambient ambient--two"></div><div class="ambient-grid"></div>
    <button class="sidebar-backdrop" data-action="close-menu" aria-label="Close navigation"></button>
    ${renderSidebar()}
    <main class="main-content">
      ${renderTopbar()}
      ${renderMobileScopeControls()}
      <section class="content" id="content">${content}</section>
    </main>
    ${renderRail()}
    ${renderDrawer()}
    ${renderToast()}
  </div>`;
}

function renderContent(): string {
  if (state.loading) return loadingView();
  if (state.error) return errorView();
  if (!state.connected) return loginView();
  if (!state.dataset || state.dataset.rides.length === 0) return noDataView();
  if (!state.year && state.dataset.years.length) state.year = state.dataset.years.at(-1)!;

  switch (state.page) {
    case "overview": return overviewView();
    case "calendar": return calendarView();
    case "performance": return performanceView();
    case "bikes": return bikesView();
    case "streaks": return streaksView();
    case "day-of-week": return dayOfWeekView();
    case "hour-of-day": return hourOfDayView();
    case "monthly-trends": return monthlyTrendsView();
    case "speed-elevation": return speedElevationView();
    case "hr-zones": return hrZonesView();
    case "progressive-metrics": return progressiveMetricsView();
    case "rides": return ridesView();
    case "goals": return goalsView();
  }
}

function kpiCard(label: string, value: string, caption: string, iconName: string, tone: string, target?: Page): string {
  const element = target ? "button" : "div";
  const attrs = target ? `data-page-target="${target}"` : "";
  return `<${element} class="kpi-card kpi-card--${tone} tilt" ${attrs}>
    <div class="kpi-top"><span class="kpi-icon">${icon(iconName, 17)}</span><span class="kpi-caption">${escapeHtml(caption)}</span></div>
    <div class="kpi-value">${value}</div>
    <div class="kpi-label">${escapeHtml(label)}</div>
    ${target ? `<span class="kpi-arrow">${icon("arrow", 14)}</span>` : ""}
  </${element}>`;
}

function lineChart(
  values: Array<number | null>,
  labels: string[],
  options: { color?: string; valueFormatter?: (value: number) => string; height?: number } = {}
): string {
  const color = options.color ?? "#ff6b57";
  const formatter = options.valueFormatter ?? ((value: number) => fmt.n(value, 1));
  const height = options.height ?? 230;
  const width = 720;
  const padX = 22;
  const padTop = 18;
  const padBottom = 30;
  const clean = values.map(value => (value === null || !Number.isFinite(value) ? null : value));
  const valid = clean.filter((value): value is number => value !== null);
  if (valid.length < 2) return `<div class="chart-empty">Not enough data for a trend yet.</div>`;

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const range = max - min || 1;
  const xFor = (index: number) => padX + (index / Math.max(1, clean.length - 1)) * (width - padX * 2);
  const yFor = (value: number) => height - padBottom - ((value - min) / range) * (height - padTop - padBottom);
  const points = clean.map((value, index) => value === null ? null : [xFor(index), yFor(value)] as [number, number]);
  const linePoints = points.filter((point): point is [number, number] => point !== null);
  const path = linePoints.map(([x, y], index) => `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${path} L${linePoints.at(-1)?.[0].toFixed(2)},${height - padBottom} L${linePoints[0][0].toFixed(2)},${height - padBottom} Z`;
  const firstLabel = labels[0] ?? "";
  const middleLabel = labels[Math.floor(labels.length / 2)] ?? "";
  const lastLabel = labels.at(-1) ?? "";
  const id = `chart-${Math.random().toString(36).slice(2, 8)}`;
  return `<div class="chart-wrap chart-wrap--${height}">
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trend chart">
      <defs><linearGradient id="${id}" x1="0" x2="1"><stop offset="0" stop-color="${color}" stop-opacity=".28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      <path d="M${padX},${height - padBottom} H${width - padX}" class="chart-axis"/>
      <path d="${area}" fill="url(#${id})"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>
      ${points.map((point, index) => point ? `<circle cx="${point[0]}" cy="${point[1]}" r="4" class="chart-point" data-tooltip="${escapeHtml(`${labels[index] ?? ""} · ${formatter(values[index] ?? 0)}`)}"/>` : "").join("")}
      <text x="${padX}" y="${height - 7}" class="chart-label">${escapeHtml(firstLabel)}</text>
      <text x="${width / 2}" y="${height - 7}" text-anchor="middle" class="chart-label">${escapeHtml(middleLabel)}</text>
      <text x="${width - padX}" y="${height - 7}" text-anchor="end" class="chart-label">${escapeHtml(lastLabel)}</text>
    </svg>
  </div>`;
}

function barChart(items: Array<{ label: string; value: number; detail?: string }>, formatter: (value: number) => string, tone = "cyan"): string {
  const max = Math.max(...items.map(item => item.value), 1);
  if (!items.length || items.every(item => item.value === 0)) return `<div class="chart-empty">No activity recorded for this view.</div>`;
  return `<div class="bar-chart ${tone}">${items.map(item => `<div class="bar-column" data-tooltip="${escapeHtml(`${item.label} · ${formatter(item.value)}${item.detail ? ` · ${item.detail}` : ""}`)}"><div class="bar-value">${formatter(item.value)}</div><div class="bar-track"><i style="height:${Math.max(item.value ? 5 : 0, (item.value / max) * 100)}%"></i></div><span>${escapeHtml(item.label)}</span></div>`).join("")}</div>`;
}

function ringChart(value: number, total: number, label: string, color = "cyan"): string {
  const percent = total ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return `<div class="ring-chart ring-chart--${color}" style="--ring-progress:${percent * 3.6}deg"><div class="ring-inner"><strong>${percent.toFixed(0)}%</strong><span>${escapeHtml(label)}</span></div></div>`;
}

function statTile(label: string, value: string, detail = "", tone = "cyan"): string {
  return `<div class="stat-tile stat-tile--${tone}"><span>${escapeHtml(label)}</span><strong>${value}</strong>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</div>`;
}

function sectionHeading(eyebrow: string, title: string, detail = "", action = ""): string {
  return `<div class="section-heading"><div><div class="eyebrow">${escapeHtml(eyebrow)}</div><h2>${escapeHtml(title)}</h2>${detail ? `<p>${escapeHtml(detail)}</p>` : ""}</div>${action}</div>`;
}

function rideRow(ride: Ride, compact = false): string {
  const favorite = isFavorite(ride);
  return `<button class="ride-row ${compact ? "ride-row--compact" : ""}" data-ride-open="${ride.id}">
    <span class="ride-date"><strong>${escapeHtml(fmt.shortDate(ride.date))}</strong><small>${escapeHtml(ride.bike)}</small></span>
    <span class="ride-metric"><strong>${fmt.km(ride.distance)}</strong><small>${fmt.m(ride.elevation)}</small></span>
    <span class="ride-metric ride-metric--speed"><strong>${fmt.speed(ride.avgSpeed)}</strong><small>${ride.hrMean === null ? "HR —" : `${ride.hrMean.toFixed(0)} bpm`}</small></span>
    <span class="ride-cfi ${favorite ? "is-favorite" : ""}">${favorite ? icon("star", 13) : ""}${fmt.cfi(ride.cfi)}</span>
    ${icon("chevron", 15)}
  </button>`;
}

function overviewView(): string {
  const rides = getScopedRides();
  if (!rides.length) return emptyPanel("No rides in this scope", "Choose another year or sync the Sheet to refresh your ride log.");
  const totalDistance = sum(rides.map(r => r.distance));
  const totalElevation = sum(rides.map(r => r.elevation));
  const totalTime = sum(rides.map(r => r.movingHours));
  const cfi = average(rides.map(r => r.cfi ?? null));
  const monthly = computeMonthlyTrends(rides);
  const recent = [...rides].reverse().slice(0, 5);
  const longest = bestRide(rides, "distance");
  const biggestClimb = bestRide(rides, "elevation");
  const fastest = bestRide(rides, "avgSpeed");
  const trendRides = rides.slice(-24);
  const values = trendRides.map(ride => metricValue(ride, state.metric));
  const labels = trendRides.map(ride => fmt.shortDate(ride.date));
  const maxMonthly = Math.max(...monthly.map(month => month.distanceKm), 1);
  const activeDays = new Set(rides.map(ride => ride.date)).size;
  const streak = currentStreak(rides);
  const latest = rides.at(-1);
  const scope = scopeLabel();

  return `<div class="page-stack">
    ${pageHeader(`${scope} · ${fmt.n(rides.length)} rides`, "Your riding command center", "A live pulse of your distance, consistency, climbing, and performance.", `<button class="button button--secondary" data-action="export">${icon("download", 15)} Export view</button>`)}
    <section class="hero-card reveal reveal--delay-1">
      <div class="hero-copy"><div class="hero-kicker"><span class="status-dot"></span>${latest ? `Last ride ${escapeHtml(fmt.date(latest.date))}` : "Your data is ready"}</div><h2>${totalDistance > 0 ? `${fmt.n(totalDistance, 0)} <small>km explored</small>` : "Your next chapter starts here"}</h2><p>${activeDays ? `You have ridden on <strong>${activeDays} days</strong>${streak > 1 ? ` and your latest block reached <strong>${streak} consecutive days</strong>` : ""}.` : "No rides are available for this scope yet."}</p><div class="hero-actions"><button class="button button--primary" data-page-target="rides">Explore rides ${icon("arrow", 15)}</button><button class="button button--ghost" data-page-target="goals">Set a goal ${icon("goals", 15)}</button></div></div>
      <div class="hero-visual" aria-hidden="true"><div class="hero-ring hero-ring--outer"></div><div class="hero-ring hero-ring--inner"></div><div class="hero-core"><span>CFI</span><strong>${cfi.toFixed(1)}</strong></div><span class="hero-spark hero-spark--one"></span><span class="hero-spark hero-spark--two"></span></div>
    </section>
    <section class="kpi-grid reveal reveal--delay-2">
      ${kpiCard("Distance", fmt.km(totalDistance), `${scope} total`, "overview", "cyan", "rides")}
      ${kpiCard("Elevation", fmt.m(totalElevation), `${fmt.n(totalElevation / Math.max(totalDistance, 1), 0)} m / km`, "elevation", "violet", "speed-elevation")}
      ${kpiCard("Moving time", fmt.hours(totalTime), `${fmt.n(activeDays)} riding days`, "clock", "lime", "streaks")}
      ${kpiCard("Mean CFI", fmt.cfi(cfi), "personal index", "performance", "orange", "performance")}
      ${kpiCard("Longest ride", longest ? fmt.km(longest.distance) : "—", longest ? fmt.shortDate(longest.date) : "No record", "star", "pink", "rides")}
    </section>
    <section class="content-grid content-grid--main reveal reveal--delay-3">
      <div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Momentum</div><h2>${metricLabel(state.metric)} trajectory</h2><p>Last ${trendRides.length} rides in ${escapeHtml(scope.toLowerCase())}.</p></div><div class="metric-switcher">${(["cfi", "distance", "speed", "elevation"] as Metric[]).map(metric => `<button class="${state.metric === metric ? "is-active" : ""}" data-metric="${metric}">${metricLabel(metric)}</button>`).join("")}</div></div>${lineChart(values, labels, { color: state.metric === "elevation" ? "#ffc266" : state.metric === "speed" ? "#d87b95" : state.metric === "distance" ? "#ff6b57" : "#ff9a62", valueFormatter: value => state.metric === "cfi" ? value.toFixed(1) : state.metric === "distance" ? `${value.toFixed(1)} km` : state.metric === "speed" ? `${value.toFixed(1)} km/h` : `${value.toFixed(0)} m` })}</div>
      <div class="panel panel--pulse"><div class="panel-heading"><div><div class="eyebrow">Consistency</div><h2>Seasonal rhythm</h2><p>Distance by month</p></div><button class="text-button" data-page-target="monthly-trends">Full view ${icon("arrow", 14)}</button></div><div class="mini-bars">${monthly.map(month => `<div class="mini-bar" data-tooltip="${escapeHtml(`${month.monthName} · ${fmt.km(month.distanceKm)}`)}"><i style="height:${Math.max(month.distanceKm ? 5 : 0, (month.distanceKm / maxMonthly) * 100)}%"></i><span>${month.monthName.slice(0, 3)}</span></div>`).join("")}</div><div class="pulse-summary"><div><span>Active days</span><strong>${fmt.n(activeDays)}</strong></div><div><span>Latest streak</span><strong>${streak} days</strong></div><div><span>Busiest month</span><strong>${escapeHtml(monthly.find(month => month.distanceKm === Math.max(...monthly.map(item => item.distanceKm)))?.monthName ?? "—")}</strong></div></div></div>
    </section>
    <section class="content-grid content-grid--lower reveal reveal--delay-4">
      <div class="panel"><div class="panel-heading"><div><div class="eyebrow">Recent activity</div><h2>Latest rides</h2></div><button class="text-button" data-page-target="rides">View all ${icon("arrow", 14)}</button></div><div class="ride-list">${recent.map(ride => rideRow(ride, true)).join("")}</div></div>
      <div class="panel panel--records"><div class="panel-heading"><div><div class="eyebrow">Personal signals</div><h2>Records to beat</h2></div><span class="panel-badge">${fmt.n(rides.length)} rides</span></div><div class="record-list"><div class="record-row"><span class="record-icon record-icon--cyan">${icon("arrow", 15)}</span><div><small>Longest distance</small><strong>${longest ? fmt.km(longest.distance) : "—"}</strong></div><span>${longest ? escapeHtml(fmt.shortDate(longest.date)) : ""}</span></div><div class="record-row"><span class="record-icon record-icon--lime">${icon("elevation", 15)}</span><div><small>Biggest climb</small><strong>${biggestClimb ? fmt.m(biggestClimb.elevation) : "—"}</strong></div><span>${biggestClimb ? escapeHtml(fmt.shortDate(biggestClimb.date)) : ""}</span></div><div class="record-row"><span class="record-icon record-icon--violet">${icon("performance", 15)}</span><div><small>Fastest average</small><strong>${fastest ? fmt.speed(fastest.avgSpeed) : "—"}</strong></div><span>${fastest ? escapeHtml(fmt.shortDate(fastest.date)) : ""}</span></div></div><button class="panel-footer-link" data-page-target="performance">Explore performance ${icon("arrow", 14)}</button></div>
    </section>
  </div>`;
}

function calendarView(): string {
  const year = getSelectedYear();
  const rides = state.dataset?.rides.filter(ride => ride.year === year) ?? [];
  const byDate = new Map<string, Ride[]>();
  rides.forEach(ride => {
    const list = byDate.get(ride.date) ?? [];
    list.push(ride);
    byDate.set(ride.date, list);
  });
  const maxRides = Math.max(1, ...[...byDate.values()].map(list => list.length));
  const months = Array.from({ length: 12 }, (_, monthIndex) => {
    const month = monthIndex + 1;
    const first = new Date(year, monthIndex, 1);
    const days = new Date(year, month, 0).getDate();
    const start = (first.getDay() + 6) % 7;
    let cells = "";
    for (let index = 0; index < start; index++) cells += '<div class="calendar-cell calendar-cell--empty"></div>';
    for (let day = 1; day <= days; day++) {
      const key = dateKey(new Date(year, monthIndex, day));
      const dayRides = byDate.get(key) ?? [];
      const intensity = dayRides.length / maxRides;
      const distance = sum(dayRides.map(ride => ride.distance));
      const tooltip = `${fmt.date(key)}\n${dayRides.length ? `${dayRides.length} ride${dayRides.length === 1 ? "" : "s"} · ${fmt.km(distance)}` : "No ride recorded"}`;
      cells += `<button class="calendar-cell ${dayRides.length ? "has-rides" : ""} ${state.selectedDate === key ? "is-selected" : ""}" style="--heat:${dayRides.length ? 0.16 + intensity * 0.78 : 0}" data-day="${key}" data-tooltip="${escapeHtml(tooltip)}"><span>${day}</span>${dayRides.length ? `<b>${dayRides.length}</b>` : ""}</button>`;
    }
    return `<div class="month-block"><div class="month-heading"><strong>${first.toLocaleDateString(undefined, { month: "long" })}</strong><span>${dayRidesTotal(byDate, year, month)} rides</span></div><div class="weekday-row">${["M", "T", "W", "T", "F", "S", "S"].map(day => `<span>${day}</span>`).join("")}</div><div class="calendar-grid">${cells}</div></div>`;
  }).join("");
  const selectedRides = state.selectedDate ? byDate.get(state.selectedDate) ?? [] : [];
  const selectedDistance = sum(selectedRides.map(ride => ride.distance));
  return `<div class="page-stack">
    ${pageHeader(`${year} · ${fmt.n(rides.length)} rides`, "Every ride has a story", "Click any active day to inspect the rides behind the heatmap.", `<div class="calendar-legend"><span class="legend-label">Less</span><i class="legend-swatch"></i><i class="legend-swatch legend-swatch--mid"></i><i class="legend-swatch legend-swatch--high"></i><span class="legend-label">More</span></div>`)}
    <div class="calendar-layout">
      <section class="panel calendar-panel reveal reveal--delay-1"><div class="calendar-toolbar"><div><div class="eyebrow">Annual map</div><h2>${year} riding calendar</h2></div><div class="calendar-stat"><strong>${fmt.n(byDate.size)}</strong><span>active days</span></div><div class="calendar-stat"><strong>${fmt.km(sum(rides.map(ride => ride.distance)))}</strong><span>total distance</span></div></div><div class="calendar-months">${months}</div></section>
      <aside class="panel day-detail reveal reveal--delay-2">${state.selectedDate ? `<div class="eyebrow">Selected day</div><h2>${escapeHtml(fmt.date(state.selectedDate))}</h2><div class="day-detail-stat"><strong>${fmt.km(selectedDistance)}</strong><span>distance across ${selectedRides.length} ride${selectedRides.length === 1 ? "" : "s"}</span></div><div class="ride-list ride-list--drawer">${selectedRides.length ? selectedRides.map(ride => rideRow(ride, true)).join("") : '<div class="mini-empty">No ride recorded on this day.</div>'}</div>` : `<div class="day-detail-placeholder"><div class="empty-icon">${icon("calendar", 24)}</div><h3>Select a day</h3><p>Choose a square on the calendar to see distance, elevation, and individual rides.</p></div>`}</aside>
    </div>
  </div>`;
}

function dayRidesTotal(byDate: Map<string, Ride[]>, year: number, month: number): number {
  return [...byDate.entries()].filter(([date]) => date.startsWith(`${year}-${String(month).padStart(2, "0")}`)).reduce((total, [, rides]) => total + rides.length, 0);
}

function performanceView(): string {
  const allYears = state.dataset?.yearly ?? [];
  const years = state.scope === "all" ? allYears : allYears.filter(item => item.year === state.year);
  const rides = getScopedRides();
  const bestCfi = bestRide(rides, "cfi");
  const fastest = bestRide(rides, "avgSpeed");
  const longest = bestRide(rides, "distance");
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · relative performance`, "Performance / CFI", "A personal index built from speed, distance, elevation, moving time, and heart-rate efficiency.", `<button class="button button--secondary" data-page-target="progressive-metrics">View progression ${icon("arrow", 15)}</button>`)}
    <section class="performance-hero panel reveal reveal--delay-1"><div class="performance-score"><div class="eyebrow">Selected scope index</div><strong>${fmt.cfi(average(rides.map(ride => ride.cfi ?? null)))}</strong><span>out of 100 relative points</span><div class="score-meter"><i style="width:${Math.min(100, average(rides.map(ride => ride.cfi ?? null)))}%"></i></div></div><div class="factor-list"><div class="factor-row"><span>Speed</span><i><b style="width:30%"></b></i><strong>30%</strong></div><div class="factor-row"><span>Distance</span><i><b style="width:20%"></b></i><strong>20%</strong></div><div class="factor-row"><span>Elevation</span><i><b style="width:15%"></b></i><strong>15%</strong></div><div class="factor-row"><span>Moving time</span><i><b style="width:15%"></b></i><strong>15%</strong></div><div class="factor-row"><span>HR efficiency</span><i><b style="width:20%"></b></i><strong>20%</strong></div></div><div class="performance-note"><span>${icon("info", 15)}</span><p>CFI is normalized against your own ride history, so it measures relative change rather than a clinical fitness level.</p></div></section>
    <section class="content-grid content-grid--main reveal reveal--delay-2"><div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Year over year</div><h2>Index progression</h2><p>Annual CFI and distance context</p></div></div>${barChart(years.map(item => ({ label: String(item.year), value: item.cfi, detail: fmt.km(item.distanceKm) })), value => value.toFixed(1), "violet")}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Records</div><h2>What is trending up</h2></div></div><div class="record-list record-list--large"><div class="record-row"><span class="record-icon record-icon--violet">${icon("spark", 15)}</span><div><small>Best CFI</small><strong>${bestCfi ? fmt.cfi(bestCfi.cfi) : "—"}</strong></div><span>${bestCfi ? escapeHtml(fmt.shortDate(bestCfi.date)) : ""}</span></div><div class="record-row"><span class="record-icon record-icon--cyan">${icon("performance", 15)}</span><div><small>Fastest average</small><strong>${fastest ? fmt.speed(fastest.avgSpeed) : "—"}</strong></div><span>${fastest ? escapeHtml(fmt.shortDate(fastest.date)) : ""}</span></div><div class="record-row"><span class="record-icon record-icon--lime">${icon("overview", 15)}</span><div><small>Longest ride</small><strong>${longest ? fmt.km(longest.distance) : "—"}</strong></div><span>${longest ? escapeHtml(fmt.shortDate(longest.date)) : ""}</span></div></div></div></section>
    <section class="panel reveal reveal--delay-3"><div class="panel-heading"><div><div class="eyebrow">Annual ledger</div><h2>Year-by-year context</h2></div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Year</th><th>Rides</th><th>Distance</th><th>Elevation</th><th>Moving time</th><th>Weighted speed</th><th>CFI</th></tr></thead><tbody>${years.map(item => `<tr><td><strong>${item.year}</strong></td><td>${fmt.n(item.rides)}</td><td>${fmt.km(item.distanceKm)}</td><td>${fmt.m(item.elevationM)}</td><td>${fmt.hours(item.movingTimeH)}</td><td>${fmt.speed(item.weightedSpeed)}</td><td><span class="table-accent">${item.cfi.toFixed(1)}</span></td></tr>`).join("")}</tbody></table></div></section>
  </div>`;
}

function bikesView(): string {
  const bikes = state.dataset?.bikes ?? [];
  if (!bikes.length) return emptyPanel("No bikes detected", "Add a bike name in the source Sheet to unlock cycle comparisons.");
  const totalDistance = Math.max(1, sum(bikes.map(bike => bike.distanceKm)));
  const selected = bikes.find(bike => bike.bike === state.bikeFilter);
  return `<div class="page-stack">
    ${pageHeader(`${fmt.n(bikes.length)} bikes · ${fmt.km(totalDistance)} logged`, "Your bikes, decoded", "Every bike has a different rhythm. Compare the way you use them.", `<button class="button button--secondary" data-page-target="rides">Filter ride explorer ${icon("arrow", 15)}</button>`)}
    <section class="bike-overview-grid reveal reveal--delay-1">${bikes.map((bike, index) => `<button class="bike-card ${selected?.bike === bike.bike ? "is-selected" : ""}" data-bike-filter="${escapeHtml(bike.bike)}"><div class="bike-card-top"><span class="bike-number">0${index + 1}</span><span class="bike-card-icon">${icon("bike", 22)}</span></div><strong>${escapeHtml(bike.bike)}</strong><div class="bike-distance">${fmt.km(bike.distanceKm)} <small>${Math.round((bike.distanceKm / totalDistance) * 100)}% of distance</small></div><div class="share-track"><i style="width:${(bike.distanceKm / totalDistance) * 100}%"></i></div><div class="bike-stats"><span><small>Rides</small><strong>${fmt.n(bike.rides)}</strong></span><span><small>Avg speed</small><strong>${fmt.speed(bike.avgSpeed)}</strong></span><span><small>CFI</small><strong>${fmt.cfi(bike.cfi)}</strong></span></div></button>`).join("")}</section>
    <section class="content-grid content-grid--main reveal reveal--delay-2"><div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Bike contribution</div><h2>Distance share</h2><p>Click a bike above to filter the ride explorer.</p></div></div>${barChart(bikes.map(bike => ({ label: bike.bike.length > 12 ? `${bike.bike.slice(0, 11)}…` : bike.bike, value: bike.distanceKm, detail: `${bike.rides} rides` })), value => fmt.km(value), "cyan")}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Selected bike</div><h2>${selected ? escapeHtml(selected.bike) : "Choose a bike"}</h2></div></div>${selected ? `<div class="bike-detail-stat"><div class="bike-detail-ring">${ringChart(selected.distanceKm, totalDistance, "of all distance", "cyan")}</div><div class="bike-detail-facts"><div><span>Longest ride</span><strong>${fmt.km(selected.longestRideKm)}</strong></div><div><span>Elevation</span><strong>${fmt.m(selected.elevationM)}</strong></div><div><span>Avg HR</span><strong>${selected.avgHr === null ? "—" : `${selected.avgHr.toFixed(0)} bpm`}</strong></div></div></div>` : '<div class="mini-empty">Select a bike card to see its detailed contribution.</div>'}</div></section>
  </div>`;
}

function streaksView(): string {
  const rides = getScopedRides();
  const allStreaks = state.dataset?.streaks ?? [];
  const streaks = state.scope === "all"
    ? allStreaks
    : allStreaks.filter(streak => streak.start.slice(0, 4) === String(state.year) || streak.end.slice(0, 4) === String(state.year));
  const current = currentStreak(rides);
  const top = streaks[0] ?? null;
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · ${fmt.n(streaks.length)} qualifying blocks`, "Consistency compounds", "A streak is any run of at least three consecutive riding days.", `<button class="button button--secondary" data-page-target="calendar">Open calendar ${icon("arrow", 15)}</button>`)}
    <section class="streak-hero panel reveal reveal--delay-1"><div class="streak-orbit"><div class="streak-orbit-ring"></div><div><span>Latest run</span><strong>${current}</strong><small>consecutive days</small></div></div><div class="streak-copy"><div class="eyebrow">The long game</div><h2>${top ? `${top.days} days is your strongest block` : "Start a new consistency block"}</h2><p>${top ? `Your strongest run ran from ${escapeHtml(fmt.date(top.start))} to ${escapeHtml(fmt.date(top.end))}, covering ${fmt.km(top.distanceKm)}.` : "Three consecutive days is enough to begin a streak."}</p><div class="streak-badges"><span>${icon("streak", 14)} ${current} day current run</span><span>${icon("overview", 14)} ${fmt.n(rides.length)} rides in scope</span></div></div></section>
    <section class="content-grid content-grid--main reveal reveal--delay-2"><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Streak ledger</div><h2>All qualifying blocks</h2></div><span class="panel-badge">${fmt.n(streaks.length)} total</span></div><div class="streak-list">${streaks.length ? streaks.map((streak, index) => `<div class="streak-row"><span class="streak-rank">${String(index + 1).padStart(2, "0")}</span><div class="streak-range"><strong>${escapeHtml(fmt.shortDate(streak.start))} → ${escapeHtml(fmt.shortDate(streak.end))}</strong><small>${streak.rides} rides · ${fmt.km(streak.distanceKm)} · ${fmt.m(streak.elevationM)}</small></div><div class="streak-days"><strong>${streak.days}</strong><span>days</span></div></div>`).join("") : '<div class="mini-empty">No three-day blocks in this scope.</div>'}</div></div><div class="panel streak-side"><div class="eyebrow">Consistency cue</div><h2>Protect the run, not just the record.</h2><p>Short, repeatable rides are often more valuable than one heroic day. Use the calendar to spot your next three-day window.</p><button class="panel-footer-link" data-page-target="rides">Browse recent rides ${icon("arrow", 14)}</button></div></section>
  </div>`;
}

function dayOfWeekView(): string {
  const patterns = computeDayOfWeekPatterns(getScopedRides());
  const max = Math.max(...patterns.map(pattern => pattern.rides), 1);
  const busiest = [...patterns].sort((a, b) => b.rides - a.rides)[0];
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · weekly rhythm`, "When you ride", "Your weekday pattern is a small window into how training fits into real life.", `<button class="button button--secondary" data-page-target="monthly-trends">See seasonality ${icon("arrow", 15)}</button>`)}
    <section class="content-grid content-grid--main reveal reveal--delay-1"><div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Ride count</div><h2>Weekly cadence</h2><p>${busiest ? `${busiest.dayName} is your most active day.` : "No pattern yet."}</p></div></div>${barChart(patterns.map(pattern => ({ label: pattern.dayName.slice(0, 3), value: pattern.rides, detail: fmt.km(pattern.distanceKm) })), value => fmt.n(value), "lime")}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Pattern cards</div><h2>Every day has a role</h2></div></div><div class="pattern-grid">${patterns.map(pattern => `<div class="pattern-card ${pattern.rides === max ? "is-peak" : ""}"><div class="pattern-day">${escapeHtml(pattern.dayName)}</div><strong>${fmt.n(pattern.rides)}</strong><small>rides · ${fmt.km(pattern.distanceKm)}</small><span>${pattern.avgSpeed === null ? "—" : fmt.speed(pattern.avgSpeed)}</span></div>`).join("")}</div></div></section>
  </div>`;
}

function hourOfDayView(): string {
  const rides = getScopedRides();
  const timedRides = rides.filter(ride => ride.startTime !== null);
  if (!timedRides.length) return `<div class="page-stack">${pageHeader(`${scopeLabel()} · source capability`, "Your riding clock", "This view becomes useful as soon as the source includes a ride start time.")}${emptyPanel("Start time is not captured", "The current Sheet has date values but no clock time, so this dashboard will not invent hour-of-day data. Add a time column to the source row to enable the 24-hour view.", `<button class="button button--secondary" data-page-target="rides">Inspect source rows ${icon("arrow", 15)}</button>`)}<section class="panel reveal reveal--delay-1"><div class="section-heading"><div><div class="eyebrow">Why this is blank</div><h2>Data integrity first</h2><p>Date-only rows are kept accurate for calendar and weekday analysis. Hour buckets stay empty until real times exist.</p></div><span class="panel-badge">${fmt.n(rides.length)} date-only rides</span></div></section></div>`;
  const patterns = computeHourOfDayPatterns(timedRides);
  return `<div class="page-stack">${pageHeader(`${scopeLabel()} · ${fmt.n(timedRides.length)} timed rides`, "Your riding clock", "See which parts of the day carry your training.", `<span class="panel-badge">Time source detected</span>`)}<section class="panel panel--chart reveal reveal--delay-1"><div class="panel-heading"><div><div class="eyebrow">24-hour distribution</div><h2>When the wheels turn</h2><p>Ride count by local start hour</p></div></div>${barChart(patterns.map(pattern => ({ label: `${String(pattern.hour).padStart(2, "0")}`, value: pattern.rides, detail: fmt.km(pattern.distanceKm) })), value => fmt.n(value), "violet")}</section></div>`;
}

function monthlyTrendsView(): string {
  const trends = computeMonthlyTrends(getScopedRides());
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · seasonal view`, "The shape of your season", "Compare how distance, elevation, speed, and CFI move through the year.", `<button class="button button--secondary" data-page-target="calendar">See activity map ${icon("arrow", 15)}</button>`)}
    <section class="content-grid content-grid--main reveal reveal--delay-1"><div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Distance trajectory</div><h2>Monthly volume</h2><p>Distance accumulated in each calendar month</p></div></div>${lineChart(trends.map(trend => trend.distanceKm), trends.map(trend => trend.monthName.slice(0, 3)), { color: "#ff6b57", valueFormatter: value => fmt.km(value) })}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Month cards</div><h2>Seasonal detail</h2></div></div><div class="month-card-grid">${trends.map(trend => `<div class="month-card ${trend.rides ? "has-data" : ""}"><strong>${escapeHtml(trend.monthName.slice(0, 3))}</strong><span>${fmt.n(trend.rides)} rides</span><b>${fmt.km(trend.distanceKm)}</b><small>${fmt.m(trend.elevationM)} · ${trend.cfI === null ? "CFI —" : `CFI ${trend.cfI.toFixed(1)}`}</small></div>`).join("")}</div></div></section>
  </div>`;
}

function speedElevationView(): string {
  const bins = computeSpeedElevationBins(getScopedRides());
  const elevation = computeElevationRatioAnalysis(getScopedRides());
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · route character`, "Flat speed meets climbing", "Use the relationship between average speed and elevation to understand your terrain profile.", `<button class="button button--secondary" data-page-target="monthly-trends">Compare seasons ${icon("arrow", 15)}</button>`)}
    <section class="kpi-grid kpi-grid--three reveal reveal--delay-1">${kpiCard("Hilliness", `${fmt.n(elevation.avgElevationPerKm, 1)} m/km`, "elevation per km", "elevation", "lime")}${kpiCard("Moderate hills", fmt.percent(elevation.moderateHillPct), "5–15 m/km", "performance", "cyan")}${kpiCard("Steep hills", fmt.percent(elevation.steepHillPct), ">15 m/km", "trend", "orange")}</section>
    <section class="content-grid content-grid--main reveal reveal--delay-2"><div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Binned profile</div><h2>Speed × elevation</h2><p>Average speed bins with their average elevation gain</p></div></div>${bins.length ? `<div class="scatter-chart">${bins.map(bin => `<div class="scatter-point" style="--x:${((bin.avgSpeed - (bins[0]?.avgSpeed ?? 0)) / Math.max(0.1, (bins.at(-1)?.avgSpeed ?? 1) - (bins[0]?.avgSpeed ?? 0))) * 100}%;--y:${Math.max(4, 100 - (bin.avgElevation / Math.max(...bins.map(item => item.avgElevation), 1)) * 88)}%" data-tooltip="${escapeHtml(`${fmt.speed(bin.avgSpeed)} · ${fmt.m(bin.avgElevation)} · ${bin.rideCount} rides`)}"><i></i><span>${fmt.speed(bin.avgSpeed)}</span></div>`).join("")}<div class="scatter-axis scatter-axis--x">average speed →</div><div class="scatter-axis scatter-axis--y">elevation ↑</div></div>` : '<div class="chart-empty">Add speed and elevation values to unlock this profile.</div>'}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Interpretation</div><h2>Terrain fingerprint</h2></div></div><div class="insight-list"><div><span class="insight-number">${fmt.n(elevation.totalDistanceKm, 0)}</span><p>km with complete elevation data</p></div><div><span class="insight-number">${fmt.n(elevation.totalElevationM)}</span><p>meters climbed in this scope</p></div><div><span class="insight-number">${fmt.n(bins.length)}</span><p>speed bins currently represented</p></div></div><div class="drawer-note"><span>${icon("info", 15)}</span><p>Elevation bins are descriptive, not a route-level elevation model.</p></div></div></section>
  </div>`;
}

function hrZonesView(): string {
  const zones = computeHRZoneDistribution(getScopedRides());
  const total = sum(zones.map(zone => zone.rides));
  const withHr = total;
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · ${fmt.n(withHr)} rides with HR`, "Effort, visualized", "A lightweight intensity view based on average heart rate in the source rows.", `<span class="panel-badge">Typical cycling bands</span>`)}
    <section class="content-grid content-grid--main reveal reveal--delay-1"><div class="panel panel--chart"><div class="panel-heading"><div><div class="eyebrow">Distribution</div><h2>Average HR zones</h2><p>Ride count by recorded average heart rate</p></div></div>${withHr ? `<div class="zone-layout"><div class="zone-donut">${ringChart(total - (zones[0]?.rides ?? 0), total, "above recovery", "orange")}<div class="zone-legend">${zones.map((zone, index) => `<span><i class="zone-dot zone-dot--${index + 1}"></i>${escapeHtml(zone.label.split(" · ")[0])} <b>${zone.rides}</b></span>`).join("")}</div></div><div class="zone-bars">${zones.map(zone => `<div class="zone-row"><div><span>${escapeHtml(zone.label)}</span><strong>${zone.rides} rides</strong></div><i><b style="width:${total ? (zone.rides / total) * 100 : 0}%"></b></i><small>${fmt.km(zone.distanceKm)} · ${zone.avgCFI === null ? "CFI —" : `CFI ${zone.avgCFI.toFixed(1)}`}</small></div>`).join("")}</div></div>` : emptyPanel("No heart-rate rows yet", "When average HR is present in the Sheet, this view will group rides into readable intensity bands.")}</div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Read this carefully</div><h2>Personal context matters</h2></div></div><div class="callout callout--orange"><span>${icon("info", 18)}</span><p>These fixed bands are a starting point for interpretation, not a medical prescription. Use your own tested zones when available.</p></div><div class="stat-stack">${statTile("Rides with HR", fmt.n(withHr), "recorded average", "orange")}${statTile("Rides without HR", fmt.n(getScopedRides().length - withHr), "missing from this view", "violet")}</div></div></section>
  </div>`;
}

function progressiveMetricsView(): string {
  const rides = getScopedRides();
  const metrics = computeProgressiveMetrics(rides);
  const latest = metrics.at(-1);
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · rolling ten-ride window`, "The long view", "Cumulative distance with a rolling ten-ride average for a less noisy read on progress.", `<button class="button button--secondary" data-page-target="performance">Back to CFI ${icon("arrow", 15)}</button>`)}
    <section class="kpi-grid kpi-grid--three reveal reveal--delay-1">${kpiCard("Rolling speed", latest?.avgSpeed === null || latest === undefined ? "—" : fmt.speed(latest.avgSpeed), "last 10 rides", "performance", "cyan")}${kpiCard("Rolling CFI", latest?.cfI === null || latest === undefined ? "—" : fmt.cfi(latest.cfI), "last 10 rides", "spark", "violet")}${kpiCard("Cumulative distance", latest ? fmt.km(latest.distanceKm) : "—", `${fmt.n(rides.length)} rides`, "overview", "lime")}</section>
    <section class="panel panel--chart reveal reveal--delay-2"><div class="panel-heading"><div><div class="eyebrow">Rolling average</div><h2>Progression over time</h2><p>Each point uses the current ride and up to nine previous rides.</p></div></div>${metrics.length > 1 ? lineChart(metrics.map(metric => metric.cfI), metrics.map(metric => `Ride ${metric.index + 1}`), { color: "#d87b95", valueFormatter: value => value.toFixed(1), height: 270 }) : '<div class="chart-empty">Add at least two rides to see a rolling trend.</div>'}</section>
  </div>`;
}

function ridesView(): string {
  const allFiltered = getFilteredRides();
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(allFiltered.length / pageSize));
  const currentPage = Math.min(state.ridePage, pageCount - 1);
  const rides = allFiltered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const bikes = [...new Set((state.dataset?.rides ?? []).map(ride => ride.bike))].sort();
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · ${fmt.n(allFiltered.length)} matching rides`, "Every ride, searchable", "Search, sort, inspect, favorite, and export the rows behind the charts.", `<button class="button button--secondary" data-action="export">${icon("download", 15)} Export CSV</button>`)}
    <section class="panel ride-explorer-panel reveal reveal--delay-1"><div class="explorer-toolbar"><label class="search-field">${icon("search", 16)}<input data-input="search" value="${escapeHtml(state.search)}" placeholder="Search date, bike, or device" aria-label="Search rides"/><kbd>/</kbd></label><label class="select-wrap select-wrap--wide"><span class="sr-only">Filter by bike</span><select class="select-control" data-input="bike"><option value="all">All bikes</option>${bikes.map(bike => `<option value="${escapeHtml(bike)}" ${bike === state.bikeFilter ? "selected" : ""}>${escapeHtml(bike)}</option>`).join("")}</select>${icon("chevron", 15)}</label><label class="select-wrap"><span class="sr-only">Sort rides</span><select class="select-control" data-input="sort"><option value="date:desc" ${state.sortKey === "date" && state.sortDirection === "desc" ? "selected" : ""}>Newest first</option><option value="date:asc" ${state.sortKey === "date" && state.sortDirection === "asc" ? "selected" : ""}>Oldest first</option><option value="distance:desc" ${state.sortKey === "distance" && state.sortDirection === "desc" ? "selected" : ""}>Longest distance</option><option value="speed:desc" ${state.sortKey === "speed" && state.sortDirection === "desc" ? "selected" : ""}>Fastest speed</option><option value="elevation:desc" ${state.sortKey === "elevation" && state.sortDirection === "desc" ? "selected" : ""}>Most elevation</option><option value="hr:desc" ${state.sortKey === "hr" && state.sortDirection === "desc" ? "selected" : ""}>Highest HR</option><option value="cfi:desc" ${state.sortKey === "cfi" && state.sortDirection === "desc" ? "selected" : ""}>Highest CFI</option></select>${icon("chevron", 15)}</label>${(state.search || state.bikeFilter !== "all" || state.sortKey !== "date" || state.sortDirection !== "desc") ? '<button class="button button--ghost button--small" data-action="clear-filters">Clear</button>' : ""}</div><div class="table-wrap"><table class="data-table data-table--rides"><thead><tr><th>Ride</th><th>Distance</th><th>Elevation</th><th>Avg speed</th><th>Heart rate</th><th>CFI</th><th></th></tr></thead><tbody>${rides.length ? rides.map(ride => `<tr class="ride-table-row" data-ride-open="${ride.id}" role="button" tabindex="0" aria-label="Open ride from ${escapeHtml(fmt.date(ride.date))}"><td><div class="table-ride-name"><span class="table-ride-icon">${icon("bike", 14)}</span><div><strong>${escapeHtml(fmt.date(ride.date))}</strong><small>${escapeHtml(ride.bike)}</small></div></div></td><td>${fmt.km(ride.distance)}</td><td>${fmt.m(ride.elevation)}</td><td>${fmt.speed(ride.avgSpeed)}</td><td>${ride.hrMean === null ? "—" : `${ride.hrMean.toFixed(0)} bpm`}</td><td><span class="table-accent">${fmt.cfi(ride.cfi)}</span></td><td><button class="icon-button icon-button--star ${isFavorite(ride) ? "is-starred" : ""}" data-favorite="${ride.id}" aria-label="Toggle favorite">${icon("star", 15)}</button></td></tr>`).join("") : '<tr><td colspan="7"><div class="mini-empty">No rides match these filters.</div></td></tr>'}</tbody></table></div><div class="pagination"><span>Showing ${rides.length ? currentPage * pageSize + 1 : 0}–${Math.min((currentPage + 1) * pageSize, allFiltered.length)} of ${fmt.n(allFiltered.length)}</span><div><button class="icon-button" data-page-number="${currentPage - 1}" ${currentPage === 0 ? "disabled" : ""} aria-label="Previous page">${icon("chevron", 15)}</button><span>${currentPage + 1} / ${pageCount}</span><button class="icon-button icon-button--next" data-page-number="${currentPage + 1}" ${currentPage >= pageCount - 1 ? "disabled" : ""} aria-label="Next page">${icon("chevron", 15)}</button></div></div></section>
  </div>`;
}

function goalsView(): string {
  const rides = getScopedRides();
  const distance = sum(rides.map(ride => ride.distance));
  const elevation = sum(rides.map(ride => ride.elevation));
  const rideCount = rides.length;
  const goalCards = [
    { key: "distanceKm" as const, label: "Distance", value: distance, target: state.goals.distanceKm, unit: "km", tone: "cyan", iconName: "overview" },
    { key: "rides" as const, label: "Ride count", value: rideCount, target: state.goals.rides, unit: "rides", tone: "lime", iconName: "streak" },
    { key: "elevationM" as const, label: "Elevation", value: elevation, target: state.goals.elevationM, unit: "m", tone: "violet", iconName: "elevation" }
  ];
  return `<div class="page-stack">
    ${pageHeader(`${scopeLabel()} · personal targets`, "Make the next ride count", "These goals live in this browser and never change your private Sheet.", `<button class="button button--secondary" data-action="reset-goals">Reset defaults ${icon("sync", 15)}</button>`)}
    <section class="goals-grid reveal reveal--delay-1">${goalCards.map(goal => { const percent = Math.min(100, goal.target ? (goal.value / goal.target) * 100 : 0); return `<div class="goal-card goal-card--${goal.tone}"><div class="goal-card-top"><span class="goal-icon">${icon(goal.iconName, 18)}</span><span>${percent >= 100 ? "Complete" : "In progress"}</span></div><div class="eyebrow">${goal.label}</div><strong>${fmt.n(goal.value, goal.key === "distanceKm" ? 1 : 0)} <small>${goal.unit}</small></strong><div class="goal-progress"><i style="width:${percent}%"></i></div><div class="goal-footer"><span>${percent >= 100 ? "Target reached" : `${Math.round(percent)}% complete`}</span><span>Goal ${fmt.n(goal.target, 0)} ${goal.unit}</span></div><label class="goal-input"><span>Set target</span><input type="number" min="1" step="${goal.key === "distanceKm" ? "10" : "1"}" value="${goal.target}" data-goal-input="${goal.key}" aria-label="${goal.label} goal"/></label></div>`; }).join("")}</section>
    <section class="content-grid content-grid--main reveal reveal--delay-2"><div class="panel goal-insight"><div class="eyebrow">Goal math</div><h2>${goalCards[0].target && distance >= goalCards[0].target ? "Your distance goal is in reach." : "Build a rhythm that compounds."}</h2><p>Goals are scoped to ${escapeHtml(scopeLabel().toLowerCase())}. Switch to All time to see your complete history, or change the target for this browser.</p><div class="goal-insight-row"><span>${icon("database", 15)} Stored locally</span><span>${icon("check", 15)} No Sheet writes</span><span>${icon("spark", 15)} Your pace, your rules</span></div></div><div class="panel"><div class="panel-heading"><div><div class="eyebrow">Momentum cue</div><h2>${goalCards[0].target && distance >= goalCards[0].target ? "Keep the chain alive" : "Three days is a streak"}</h2></div></div><p class="body-copy">Consistency is easier to maintain when the next action is small. Use the streak view to find your next three-day window, then let the ride log do the remembering.</p><button class="panel-footer-link" data-page-target="streaks">Open consistency view ${icon("arrow", 14)}</button></div></section>
  </div>`;
}

function mountShell(): void {
  app.innerHTML = shell(renderContent());
  bindInputs();
  bindTilt();
  bindTooltips();
  updateRuntimeBadges();
}

function updateRuntimeBadges(): void {
  const supportsTransitions = typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === "function";
  const transitionBadge = document.querySelector<HTMLElement>("#vtBadge");
  if (transitionBadge) transitionBadge.textContent = supportsTransitions ? "NATIVE" : "FALLBACK";
}

function bindInputs(): void {
  document.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-input]").forEach(input => {
    input.addEventListener("change", () => {
      const type = input.dataset.input;
      if (type === "year") {
        state.year = Number(input.value);
        state.selectedDate = null;
        state.ridePage = 0;
        mountShell();
      } else if (type === "search") {
        state.search = input.value;
        state.ridePage = 0;
        mountShell();
        document.querySelector<HTMLInputElement>("[data-input='search']")?.focus();
      } else if (type === "bike") {
        state.bikeFilter = input.value;
        state.ridePage = 0;
        mountShell();
      } else if (type === "sort") {
        const [key, direction] = input.value.split(":");
        if (key === "date" || key === "distance" || key === "speed" || key === "elevation" || key === "hr" || key === "cfi") {
          state.sortKey = key;
          state.sortDirection = direction === "asc" ? "asc" : "desc";
          state.ridePage = 0;
          mountShell();
        }
      }
    });
  });

  document.querySelectorAll<HTMLInputElement>("[data-goal-input]").forEach(input => {
    input.addEventListener("change", () => {
      const key = input.dataset.goalInput as keyof GoalValues | undefined;
      if (!key) return;
      const value = Math.max(1, Number(input.value) || 1);
      state.goals = { ...state.goals, [key]: value };
      localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(state.goals));
      showToast("Goal updated for this browser", "success");
      mountShell();
    });
  });
}

function bindTooltips(): void {
  tooltip.classList.remove("is-visible");
  const targets = document.querySelectorAll<HTMLElement>("[data-tooltip]");
  targets.forEach(target => {
    target.addEventListener("pointerenter", event => {
      tooltip.textContent = target.dataset.tooltip ?? "";
      tooltip.classList.add("is-visible");
      moveTooltip(event as PointerEvent, tooltip);
    });
    target.addEventListener("pointermove", event => moveTooltip(event as PointerEvent, tooltip));
    target.addEventListener("pointerleave", () => tooltip.classList.remove("is-visible"));
    target.addEventListener("focus", () => {
      tooltip.textContent = target.dataset.tooltip ?? "";
      const rect = target.getBoundingClientRect();
      tooltip.style.left = `${Math.max(14, Math.min(window.innerWidth - tooltip.offsetWidth - 14, rect.left))}px`;
      tooltip.style.top = `${Math.max(14, rect.top - tooltip.offsetHeight - 10)}px`;
      tooltip.classList.add("is-visible");
    });
    target.addEventListener("blur", () => tooltip.classList.remove("is-visible"));
  });
}

function moveTooltip(event: PointerEvent, tooltip: HTMLElement): void {
  const pad = 14;
  const x = Math.max(pad, Math.min(window.innerWidth - tooltip.offsetWidth - pad, event.clientX + pad));
  const y = Math.max(pad, Math.min(window.innerHeight - tooltip.offsetHeight - pad, event.clientY + pad));
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}

let tiltFrame = 0;
function bindTilt(): void {
  cancelAnimationFrame(tiltFrame);
  const cards = [...document.querySelectorAll<HTMLElement>("[data-tilt]")];
  if (!cards.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const springs = new Map<HTMLElement, { x: number; y: number; tx: number; ty: number; vx: number; vy: number }>();
  cards.forEach(card => springs.set(card, { x: 0, y: 0, tx: 0, ty: 0, vx: 0, vy: 0 }));
  cards.forEach(card => {
    card.addEventListener("pointermove", event => {
      const rect = card.getBoundingClientRect();
      const spring = springs.get(card);
      if (!spring) return;
      spring.tx = ((event.clientX - rect.left - rect.width / 2) / rect.width) * 5;
      spring.ty = ((event.clientY - rect.top - rect.height / 2) / rect.height) * 5;
    });
    card.addEventListener("pointerleave", () => {
      const spring = springs.get(card);
      if (spring) spring.tx = spring.ty = 0;
    });
  });
  const tick = () => {
    springs.forEach((spring, card) => {
      spring.vx = (spring.vx + (spring.tx - spring.x) * 0.08) * 0.8;
      spring.vy = (spring.vy + (spring.ty - spring.y) * 0.08) * 0.8;
      spring.x += spring.vx;
      spring.y += spring.vy;
      card.style.transform = `translate3d(${spring.x}px, ${spring.y}px, 0)`;
    });
    tiltFrame = requestAnimationFrame(tick);
  };
  tiltFrame = requestAnimationFrame(tick);
}

function showToast(message: string, kind: ToastKind = "info"): void {
  state.toast = { message, kind };
  window.setTimeout(() => {
    if (state.toast?.message === message) {
      state.toast = null;
      mountShell();
    }
  }, 3200);
}

function setPage(page: Page, updateHistory = true): void {
  if (!(page in PAGE_META)) return;
  state.page = page;
  state.selectedRide = null;
  state.selectedDate = null;
  state.menuOpen = false;
  if (updateHistory) history.pushState({ page }, "", `#${page}`);
  renderWithTransition();
}

function renderWithTransition(): void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const transitionDocument = document as Document & { startViewTransition?: (callback: () => void) => unknown };
  if (!reduced && typeof transitionDocument.startViewTransition === "function") {
    transitionDocument.startViewTransition(() => mountShell());
  } else {
    mountShell();
  }
}

function toggleFavorite(id: string): void {
  const ride = state.dataset?.rides.find(item => item.id === id);
  const existing = state.favorites.has(id) || Boolean(ride && state.favorites.has(ride.date));
  if (existing) {
    state.favorites.delete(id);
    if (ride) state.favorites.delete(ride.date);
    showToast("Removed from favorites", "info");
  } else {
    state.favorites.add(id);
    showToast("Ride saved to favorites", "success");
  }
  localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...state.favorites]));
  mountShell();
}

function openRide(date: string): void {
  state.selectedRide = date;
  mountShell();
}

function openDay(date: string): void {
  state.selectedDate = date;
  mountShell();
}

function exportCsv(): void {
  const rides = getFilteredRides();
  if (!rides.length) {
    showToast("There are no visible rides to export", "error");
    return;
  }
  const header = ["Date", "Start time", "Bike", "Device", "Distance km", "Elevation m", "Average speed km/h", "Max speed km/h", "Moving time", "Average HR", "Max HR", "CFI"];
  const rows = rides.map(ride => [ride.date, ride.startTime ?? "", ride.bike, ride.device ?? "", ride.distance ?? "", ride.elevation ?? "", ride.avgSpeed ?? "", ride.maxSpeed ?? "", ride.movingTime, ride.hrMean ?? "", ride.hrMax ?? "", ride.cfi ?? ""]);
  const csv = [header, ...rows].map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ridescope-${scopeLabel().toLowerCase().replace(/\s+/g, "-")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`Exported ${fmt.n(rides.length)} rides`, "success");
}

function resetGoals(): void {
  state.goals = { ...defaultGoals };
  localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(state.goals));
  showToast("Goals reset to the starter targets", "info");
  mountShell();
}

function setScope(scope: Scope): void {
  state.scope = scope;
  state.selectedDate = null;
  state.ridePage = 0;
  mountShell();
}

function handleClick(event: MouseEvent): void {
  const target = event.target as HTMLElement;
  const nav = target.closest<HTMLElement>("[data-nav]");
  if (nav?.dataset.nav) {
    setPage(nav.dataset.nav as Page);
    return;
  }
  const pageTarget = target.closest<HTMLElement>("[data-page-target]");
  if (pageTarget?.dataset.pageTarget) {
    setPage(pageTarget.dataset.pageTarget as Page);
    return;
  }
  const scope = target.closest<HTMLElement>("[data-scope]");
  if (scope?.dataset.scope) {
    setScope(scope.dataset.scope as Scope);
    return;
  }
  const metric = target.closest<HTMLElement>("[data-metric]");
  if (metric?.dataset.metric) {
    state.metric = metric.dataset.metric as Metric;
    mountShell();
    return;
  }
  const favorite = target.closest<HTMLElement>("[data-favorite]");
  if (favorite?.dataset.favorite) {
    event.stopPropagation();
    toggleFavorite(favorite.dataset.favorite);
    return;
  }
  const ride = target.closest<HTMLElement>("[data-ride-open]");
  if (ride?.dataset.rideOpen) {
    openRide(ride.dataset.rideOpen);
    return;
  }
  const day = target.closest<HTMLElement>("[data-day]");
  if (day?.dataset.day) {
    openDay(day.dataset.day);
    return;
  }
  const bike = target.closest<HTMLElement>("[data-bike-filter]");
  if (bike?.dataset.bikeFilter) {
    state.bikeFilter = bike.dataset.bikeFilter;
    showToast(`${bike.dataset.bikeFilter} selected`, "info");
    setPage("rides");
    return;
  }
  const pageNumber = target.closest<HTMLElement>("[data-page-number]");
  if (pageNumber?.dataset.pageNumber) {
    const value = Number(pageNumber.dataset.pageNumber);
    if (Number.isFinite(value) && value >= 0) {
      state.ridePage = value;
      mountShell();
    }
    return;
  }
  const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "menu") {
    state.menuOpen = true;
    mountShell();
  } else if (action === "close-menu") {
    state.menuOpen = false;
    mountShell();
  } else if (action === "connect") {
    connectGoogle();
  } else if (action === "retry") {
    void loadData();
  } else if (action === "sync") {
    void syncData();
  } else if (action === "logout") {
    void logoutGoogle().then(() => window.location.reload());
  } else if (action === "close-drawer") {
    state.selectedRide = null;
    mountShell();
  } else if (action === "export") {
    exportCsv();
  } else if (action === "clear-filters") {
    state.search = "";
    state.bikeFilter = "all";
    state.sortKey = "date";
    state.sortDirection = "desc";
    state.ridePage = 0;
    mountShell();
  } else if (action === "reset-goals") {
    resetGoals();
  }
}

function handleKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement;
  const interactive = target.closest<HTMLElement>("[data-ride-open], [data-day]");
  if (interactive && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    if (interactive.dataset.rideOpen) openRide(interactive.dataset.rideOpen);
    if (interactive.dataset.day) openDay(interactive.dataset.day);
    return;
  }
  if (event.key === "Escape") {
    if (state.selectedRide || state.menuOpen) {
      state.selectedRide = null;
      state.menuOpen = false;
      mountShell();
    }
  }
  if (event.key === "/" && state.page === "rides" && document.activeElement?.tagName !== "INPUT") {
    event.preventDefault();
    document.querySelector<HTMLInputElement>("[data-input='search']")?.focus();
  }
}

function handlePopState(): void {
  state.page = pageFromHash();
  state.selectedRide = null;
  state.selectedDate = null;
  mountShell();
}

async function loadData(): Promise<void> {
  state.loading = true;
  state.error = null;
  mountShell();
  try {
    const auth = await getAuthStatus();
    state.connected = auth.connected;
    if (!auth.connected) {
      state.loading = false;
      mountShell();
      return;
    }
    const result = await fetchDataset();
    applyDataset(result);
  } catch (error) {
    state.error = error instanceof Error && error.message === "NOT_CONNECTED"
      ? "Google access is not connected for this app."
      : error instanceof Error ? error.message : "Unknown error";
  } finally {
    state.loading = false;
    mountShell();
  }
}

async function syncData(): Promise<void> {
  if (state.syncing) return;
  state.syncing = true;
  state.error = null;
  mountShell();
  try {
    const result = await fetchDataset();
    applyDataset(result);
    showToast("Sheet synced and analytics refreshed", "success");
  } catch (error) {
    state.error = error instanceof Error ? error.message : "Could not sync the Sheet";
    showToast("Sync failed — showing the last available data", "error");
  } finally {
    state.syncing = false;
    mountShell();
  }
}

function applyDataset(result: DatasetResult): void {
  state.dataset = result.dataset;
  state.lastSynced = result.syncedAt ?? new Date().toISOString();
  state.year = state.year && result.dataset.years.includes(state.year) ? state.year : result.dataset.years.at(-1) ?? null;
  if (state.bikeFilter !== "all" && !result.dataset.bikes.some(bike => bike.bike === state.bikeFilter)) state.bikeFilter = "all";
  state.ridePage = 0;
}

async function initWebGPU(): Promise<void> {
  const badge = document.querySelector<HTMLElement>("#gpuBadge");
  const setFallback = () => { if (badge) badge.textContent = "FALLBACK"; };
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    setFallback();
    return;
  }
  try {
    const adapter = await gpu.requestAdapter() as {
      requestDevice: () => Promise<{
        createShaderModule: (descriptor: { code: string }) => unknown;
        createRenderPipeline: (descriptor: unknown) => { getBindGroupLayout: (group: number) => unknown };
        createBuffer: (descriptor: unknown) => { size: number; usage: number };
        createBindGroup: (descriptor: unknown) => unknown;
        createCommandEncoder: () => {
          beginRenderPass: (descriptor: unknown) => { setPipeline: (pipeline: unknown) => void; setBindGroup: (group: number, bind: unknown) => void; draw: (count: number) => void; end: () => void };
          finish: () => unknown;
        };
        queue: { writeBuffer: (buffer: unknown, offset: number, data: ArrayBufferView) => void; submit: (commands: unknown[]) => void };
      }>;
    } | null;
    if (!adapter) throw new Error("No WebGPU adapter");
    const device = await adapter.requestDevice();
    const canvas = document.createElement("canvas");
    canvas.className = "webgpu-canvas";
    canvas.setAttribute("aria-hidden", "true");
    const context = canvas.getContext("webgpu") as { configure: (descriptor: unknown) => void; getCurrentTexture: () => { createView: () => unknown } } | null;
    if (!context) throw new Error("No WebGPU context");
    const gpuAny = gpu as unknown as { getPreferredCanvasFormat: () => string };
    const format = gpuAny.getPreferredCanvasFormat();
    const shader = device.createShaderModule({ code: `
      struct P { res: vec2f, time: f32, pad: f32, mouse: vec2f }
      @group(0) @binding(0) var<uniform> p: P
      struct O { @builtin(position) pos: vec4f }
      @vertex fn vs(@builtin(vertex_index) i: u32) -> O {
        var a = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))
        var o: O; o.pos = vec4f(a[i], 0, 1); return o
      }
      @fragment fn fs(@builtin(position) f: vec4f) -> @location(0) vec4f {
        let uv = f.xy / p.res
        let q = (uv - .5) * vec2f(p.res.x / max(p.res.y, 1.), 1.) * 2.
        let m = (p.mouse - .5) * vec2f(p.res.x / max(p.res.y, 1.), 1.) * 2.
        var c = vec3f(.012, .003, .005)
        for (var i: u32 = 0u; i < 28u; i++) {
          let fi = f32(i)
          let a = fi * .57 + p.time * (.035 + fi * .002)
          let r = .12 + fract(sin(fi * 91.7) * 13.1) * .9
          var pos = vec2f(cos(a), sin(a)) * r
          pos += (m - pos) * exp(-length(q - m) * 2.) * .12
          let g = exp(-length(q - pos) * 72.)
          c += g * mix(vec3f(1., .2, .1), vec3f(.8, .06, .2), fract(fi * .19))
        }
        return vec4f(c, 1.)
      }
    `});
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module: shader, entryPoint: "vs" },
      fragment: { module: shader, entryPoint: "fs", targets: [{ format }] },
      primitive: { topology: "triangle-list" }
    });
    const buffer = device.createBuffer({ size: 32, usage: 0x40 | 0x8 });
    const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }] });
    const mouse = { x: 0.5, y: 0.5 };
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      context.configure({ device, format, alphaMode: "premultiplied" });
    };
    const onPointerMove = (event: PointerEvent) => { mouse.x = event.clientX / window.innerWidth; mouse.y = event.clientY / window.innerHeight; };
    const onResize = () => resize();
    document.body.prepend(canvas);
    resize();
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    const start = performance.now();
    let running = true;
    const loop = () => {
      if (!running) return;
      device.queue.writeBuffer(buffer, 0, new Float32Array([canvas.width, canvas.height, (performance.now() - start) / 1000, 0, mouse.x, mouse.y, 0, 0]));
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" }] });
      pass.setPipeline(pipeline); pass.setBindGroup(0, bindGroup); pass.draw(3); pass.end();
      device.queue.submit([encoder.finish()]);
      requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      if (document.hidden) running = false;
      else if (!running) { running = true; requestAnimationFrame(loop); }
    };
    document.addEventListener("visibilitychange", onVisibility);
    loop();
    if (badge) badge.textContent = "LIVE";
  } catch {
    setFallback();
  }
}

app.addEventListener("click", handleClick);
document.addEventListener("keydown", handleKeydown);
window.addEventListener("popstate", handlePopState);
window.addEventListener("hashchange", handlePopState);

mountShell();
void loadData();
void initWebGPU();
