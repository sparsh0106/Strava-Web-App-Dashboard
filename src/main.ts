import "./styles.css";
import type { Dataset } from "./types";
import { connectGoogle, fetchDataset, getAuthStatus, logoutGoogle } from "./sheets";
import { computeDayOfWeekPatterns, computeHourOfDayPatterns, computeMonthlyTrends, computeSpeedElevationBins, computeHRZoneDistribution, computeProgressiveMetrics, computeElevationRatioAnalysis } from "./analytics";

const app = document.querySelector<HTMLDivElement>("#app")!;
const tooltip = document.createElement("div");
tooltip.id = "tooltip";
tooltip.className = "tooltip";
document.body.appendChild(tooltip);

type AppState = {
  dataset: Dataset | null;
  page: "overview" | "calendar" | "performance" | "bikes" | "streaks" | "day-of-week" | "hour-of-day" | "monthly-trends" | "speed-elevation" | "hr-zones" | "progressive-metrics" | "rides";
  year: number | null;
  loading: boolean;
  connected: boolean;
  error: string | null;
};

const state: AppState = {
  dataset: null,
  page: "overview",
  year: null,
  loading: true,
  connected: false,
  error: null
};

const fmt = {
  n: (x: number, d = 0) => Number(x || 0).toLocaleString(undefined, { maximumFractionDigits: d }),
  km: (x: number) => `${Number(x || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`,
  speed: (x: number) => `${Number(x || 0).toFixed(1)} km/h`,
  cfi: (x: number) => Number(x || 0).toFixed(1)
};

function shell(content: string): string {
  return `
    <div class="min-h-full grid" style="grid-template-columns:250px minmax(0,1fr) 320px;">
      <aside class="border-r border-white/[.07] p-4 flex flex-col bg-black/10">
        <div class="mb-5">
          <div class="flex items-center gap-3 mb-5">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-500 to-cyan-400 flex items-center justify-center shadow-lg">
              <span class="font-black text-white">S</span>
            </div>
            <div><div class="font-bold tracking-wide">STRAVA / RUNTIME</div><div class="text-[10px] text-slate-500 mono uppercase tracking-[.18em]">sheets edition</div></div>
          </div>
          <div class="text-[10px] text-slate-500 uppercase tracking-[.2em] mb-2">Dashboard</div>
          <nav class="space-y-1.5">
            ${nav("overview","Overview","Whole history")}
            ${nav("calendar","Calendar","Every riding day")}
            ${nav("performance","Performance","CFI + progression")}
            ${nav("bikes","Cycles","Bike analysis")}
            ${nav("streaks","Consistency","3+ day streaks")}
            ${nav("day-of-week","Day of Week","Riding pattern by day of week")}
            ${nav("hour-of-day","Hours of Day","Riding pattern by hour of day")}
            ${nav("monthly-trends","Monthly Trends","Performance by month")}
            ${nav("speed-elevation","Speed/Elevation","Climbing vs. speed profile")}
            ${nav("hr-zones","HR Zones","Heart rate intensity distribution")}
            ${nav("progressive-metrics","Progressive Metrics","Moving averages and trends")}
            ${nav("rides","Ride explorer","Row-level data")}
          </nav>
        </div>
        <div class="mt-auto card rounded-2xl p-3">
          <div class="flex justify-between items-center"><span class="text-[10px] uppercase tracking-wider text-slate-500">Source</span><span class="text-[10px] mono text-lime">GOOGLE SHEETS</span></div>
          <div class="text-xs text-slate-400 mt-2">The Sheet is the source of truth. Dashboard analytics are recomputed from the latest sync.</div>
          <button id="logoutBtn" class="mt-3 text-[11px] text-slate-500 hover:text-white">Sign out of Google</button>
        </div>
      </aside>

      <main class="min-w-0 p-5 md:p-6 relative overflow-hidden">
        <div class="absolute inset-0 grid-bg pointer-events-none"></div>
        <div class="relative z-10 min-h-full flex flex-col gap-4">
          <header class="flex items-end justify-between gap-4">
            <div>
              <div class="text-[10px] mono uppercase tracking-[.22em] text-cyan-300/80">personal cycling intelligence</div>
              <h1 id="pageTitle" class="text-2xl md:text-3xl font-black tracking-tight mt-1">Strava Overview</h1>
              <p id="pageSub" class="text-sm text-slate-400 mt-1">Google Sheets → normalized rides → analytics → runtime UI.</p>
            </div>
            <div class="flex items-center gap-2">
              ${state.dataset ? yearControl(state.dataset.years) : ""}
              ${state.dataset ? `<button id="syncBtn" class="rounded-xl px-3 py-2 bg-cyan-400/10 text-cyan-200 border border-cyan-300/15 text-sm hover:bg-cyan-400/15">Sync</button>` : ""}
            </div>
          </header>
          <section id="content" style="view-transition-name:page" class="flex-1 min-h-0">${content}</section>
        </div>
      </main>

      <aside class="border-l border-white/[.07] p-4 overflow-y-auto">
        <div class="text-[10px] uppercase tracking-[.2em] text-slate-500 mb-3">Runtime layer</div>
        <details open class="card rounded-2xl p-3 mb-2"><summary class="cursor-pointer list-none flex justify-between"><span class="text-sm font-semibold">WebGPU</span><span id="gpuBadge" class="text-[10px] mono text-cyan-300">PROBE</span></summary><p class="text-xs leading-5 text-slate-400 mt-3">GPU-native procedural background. It is visual enhancement only; the analytics do not depend on WebGPU.</p></details>
        <details class="card rounded-2xl p-3 mb-2"><summary class="cursor-pointer list-none flex justify-between"><span class="text-sm font-semibold">View Transitions</span><span id="vtBadge" class="text-[10px] mono text-lime-300">PROBE</span></summary><p class="text-xs leading-5 text-slate-400 mt-3">Same-document page changes preserve continuity when the browser supports the View Transition API.</p></details>
        <details class="card rounded-2xl p-3"><summary class="cursor-pointer list-none flex justify-between"><span class="text-sm font-semibold">Physics UI</span><span class="text-[10px] mono text-violet-300">LIVE</span></summary><p class="text-xs leading-5 text-slate-400 mt-3">Interactive KPI cards settle through a pointer-reactive spring transform.</p></details>
        ${state.dataset ? `<div class="mt-5 card rounded-2xl p-3 text-xs space-y-2">
          <div class="flex justify-between"><span class="text-slate-500">Rides</span><span class="mono">${fmt.n(state.dataset.meta.rides)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">Riding days</span><span class="mono">${fmt.n(state.dataset.meta.ridingDays)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">Distance</span><span class="mono">${fmt.km(state.dataset.meta.distanceKm)}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">Mean CFI</span><span class="mono">${fmt.cfi(state.dataset.meta.cfi)}</span></div>
        </div>` : ""}
      </aside>
    </div>
  `;
}

function nav(page: AppState["page"], title: string, sub: string): string {
  const active = state.page === page ? "bg-violet-500/15 border-violet-400/30" : "border-transparent";
  return `<button data-nav="${page}" class="w-full text-left rounded-xl border px-3 py-3 text-sm transition ${active}"><div class="font-semibold">${title}</div><div class="text-[11px] text-slate-500 mt-0.5">${sub}</div></button>`;
}

function yearControl(years: number[]): string {
  return `<select id="yearSelect" class="bg-slate-950/80 border border-white/[.10] rounded-xl px-3 py-2 text-sm outline-none">${years.map(y => `<option value="${y}" ${y === state.year ? "selected" : ""}>${y}</option>`).join("")}</select>`;
}

function loadingView(): string {
  return `<div class="min-h-[70vh] grid place-items-center"><div class="card rounded-3xl p-8 text-center max-w-md"><div class="text-3xl mb-2">↻</div><div class="font-semibold">Connecting to Google Sheets</div><div class="text-sm text-slate-500 mt-2">Fetching and normalizing your Strava rides.</div></div></div>`;
}

function loginView(): string {
  return `<div class="min-h-[70vh] grid place-items-center"><div class="card rounded-3xl p-8 max-w-lg text-center"><div class="text-[10px] mono uppercase tracking-[.2em] text-cyan-300/80">PRIVATE DATA SOURCE</div><h2 class="text-3xl font-black mt-2">Connect Google Sheets</h2><p class="text-sm leading-6 text-slate-400 mt-3">Your Strava sheet stays private. The server requests read-only Sheets access, fetches the current values, and computes the analytics.</p><button id="connectBtn" class="mt-6 rounded-xl bg-white text-slate-950 px-5 py-3 font-semibold hover:bg-slate-200">Continue with Google</button><div class="text-[11px] text-slate-600 mt-4">Scope: spreadsheets.readonly</div></div></div>`;
}

function errorView(): string {
  return `<div class="min-h-[70vh] grid place-items-center"><div class="card rounded-3xl p-8 max-w-lg text-center"><div class="text-rose-300 text-3xl">!</div><h2 class="text-xl font-bold mt-2">Could not load the Sheet</h2><p class="text-sm leading-6 text-slate-400 mt-3">${state.error}</p><button id="retryBtn" class="mt-5 rounded-xl border border-white/10 px-4 py-2 text-sm hover:bg-white/[.04]">Retry</button></div></div>`;
}

function calendarView(): string {
  const ds = state.dataset!;
  const year = state.year!;
  const rides = ds.rides.filter(r => r.year === year);
  const byDate = new Map<string, typeof rides>();
  rides.forEach(r => { const a = byDate.get(r.date) ?? []; a.push(r); byDate.set(r.date, a); });
  const max = Math.max(1, ...[...byDate.values()].map(x => x.length));

  let months = "";
  for (let m=0;m<12;m++) {
    const first = new Date(year,m,1);
    const days = new Date(year,m+1,0).getDate();
    const start = (first.getDay()+6)%7;
    let cells = "";
    for(let i=0;i<start;i++) cells += `<div class="cal-cell opacity-0"></div>`;
    for(let d=1;d<=days;d++){
      const key = `${year}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const rs = byDate.get(key) ?? [];
      const intensity = rs.length/max;
      const bg = rs.length ? `rgba(34,211,238,${0.10+0.78*intensity})` : "rgba(255,255,255,.025)";
      const distance = rs.reduce((s,r)=>s+(r.distance??0),0);
      const elevation = rs.reduce((s,r)=>s+(r.elevation??0),0);
      const speedVals = rs.map(r=>r.avgSpeed).filter((x):x is number=>x!==null);
      const sp = speedVals.length ? speedVals.reduce((a,b)=>a+b,0)/speedVals.length : null;
      const hrVals = rs.map(r=>r.hrMean).filter((x):x is number=>x!==null);
      const hr = hrVals.length ? hrVals.reduce((a,b)=>a+b,0)/hrVals.length : null;
      const tooltipData = JSON.stringify(`<b>${new Date(year,m,d).toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</b><br><br>${rs.length?`🚴 ${rs.length} ride(s)<br>📏 ${distance.toFixed(2)} km<br>⛰ ${elevation.toFixed(0)} m<br>⚡ ${sp===null?"—":sp.toFixed(1)+" km/h"}<br>❤️ ${hr===null?"not recorded":hr.toFixed(0)+" bpm"}`:"🚫 No ride"}`).replace(/"/g,"&quot;");
      cells += `<div class="cal-cell" data-tip="${tooltipData}" style="background:${bg}"><span class="cal-day">${d}</span>${rs.length?`<span class="cal-value">${rs.length}</span>`:""}</div>`;
    }
    months += `<div><div class="text-sm font-semibold mb-2">${new Date(2000,m,1).toLocaleString(undefined,{month:"long"})}</div><div class="grid grid-cols-7 gap-1 text-[8px] text-slate-600 mb-1">${["M","T","W","T","F","S","S"].map(x=>`<div class="text-center">${x}</div>`).join("")}</div><div class="calendar">${cells}</div></div>`;
  }
  return `<div class="h-full card rounded-3xl p-5 overflow-y-auto scroll-thin"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">${year} riding calendar</div><div class="text-xs text-slate-500 mt-1">${rides.length} rides · ${byDate.size} riding days</div></div><div class="text-[10px] mono text-slate-500">darker = more rides</div></div><div class="grid xl:grid-cols-3 md:grid-cols-2 gap-5">${months}</div></div>`;
}

function overviewView(): string {
  const ds = state.dataset!;
  const y = ds.yearly.find(v=>v.year===state.year)!;
  const cards = [
    ["Distance",fmt.km(ds.meta.distanceKm),"ALL-TIME","text-cyan-300"],
    ["Riding days",fmt.n(ds.meta.ridingDays),"UNIQUE DAYS","text-lime-300"],
    ["Longest ride",fmt.km(ds.meta.longestRideKm),"PERSONAL PEAK","text-amber-300"],
    ["Mean CFI",fmt.cfi(ds.meta.cfi),"5-FACTOR INDEX","text-violet-300"]
  ];
  const spark = ds.rides.slice(-18).map(r=>r.cfi??0);
  const min=Math.min(...spark),max=Math.max(...spark);
  const points=spark.map((v,i)=>`${(i/Math.max(1,spark.length-1))*100},${92-((v-min)/Math.max(1,max-min))*78}`).join(" ");

  return `<div class="h-full overflow-y-auto scroll-thin">
    <div class="grid xl:grid-cols-4 md:grid-cols-2 gap-3">
      ${cards.map(c=>`<div class="kpi card rounded-2xl p-4" data-physics><div class="text-[10px] uppercase tracking-[.18em] text-slate-500">${c[0]}</div><div class="text-3xl font-black mt-2 ${c[3]}">${c[1]}</div><div class="text-[10px] mono text-slate-500 mt-2">${c[2]}</div></div>`).join("")}
    </div>
    <div class="grid xl:grid-cols-[1.4fr_.8fr] gap-4 mt-4">
      <div class="card rounded-2xl p-5"><div class="flex justify-between"><div><div class="font-semibold">Recent CFI trajectory</div><div class="text-xs text-slate-500 mt-1">latest ${spark.length} rides</div></div><span class="text-[10px] mono text-violet-300">CFI</span></div><svg viewBox="0 0 100 95" preserveAspectRatio="none" class="w-full h-44 mt-4"><defs><linearGradient id="sg"><stop stop-color="#8b5cf6"/><stop offset="1" stop-color="#22d3ee"/></linearGradient></defs><polyline points="${points}" fill="none" stroke="url(#sg)" stroke-width="1.7" vector-effect="non-scaling-stroke"/></svg></div>
      <div class="card rounded-2xl p-5"><div class="text-[10px] uppercase tracking-[.18em] text-slate-500">Selected year</div><div class="flex items-end justify-between mt-3"><div><div class="text-3xl font-black">${state.year}</div><div class="text-xs text-slate-500 mt-1">${y.rides} rides</div></div><div class="text-right"><div class="text-2xl font-black text-cyan-300">${fmt.speed(y.weightedSpeed)}</div><div class="text-[10px] text-slate-500">distance-weighted</div></div></div><div class="grid grid-cols-2 gap-2 mt-6 text-xs">${[
        ["Distance",fmt.km(y.distanceKm)],["Elevation",`${fmt.n(y.elevationM)} m`],["Longest",fmt.km(y.longestRideKm)],["CFI",fmt.cfi(y.cfi)]
      ].map(a=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500">${a[0]}</div><div class="mono mt-1">${a[1]}</div></div>`).join("")}</div></div>
    </div>
  </div>`;
}

function performanceView(): string {
  const years = state.dataset!.yearly;
  const min = Math.min(...years.map(x=>x.cfi)), max = Math.max(...years.map(x=>x.cfi));
  const bars = years.map(y=>`<div class="flex-1 h-56 flex flex-col justify-end items-center gap-2"><div class="text-[10px] mono text-slate-400">${y.cfi.toFixed(1)}</div><div class="w-full rounded-t-xl bg-gradient-to-t from-violet-500/80 to-cyan-300/80" style="height:${15+((y.cfi-min)/Math.max(1,max-min))*85}%"></div><div class="text-[10px] text-slate-500">${y.year}</div></div>`).join("");
  return `<div class="h-full overflow-y-auto scroll-thin"><div class="grid xl:grid-cols-[1.2fr_.8fr] gap-4"><div class="card rounded-2xl p-5"><div class="flex justify-between"><div><div class="font-semibold">Cycling Fitness Index</div><div class="text-xs text-slate-500 mt-1">Speed 30 · Distance 20 · Elevation 15 · Duration 15 · HR efficiency 20</div></div><div class="text-3xl font-black text-violet-300">${state.dataset!.meta.cfi.toFixed(1)}</div></div><div class="flex gap-4 items-end mt-4">${bars}</div></div><div class="card rounded-2xl p-5"><div class="text-[10px] uppercase tracking-[.18em] text-slate-500">Interpretation</div><div class="text-xl font-black mt-2">Your performance profile</div><p class="text-sm leading-6 text-slate-400 mt-3">CFI is a personal relative index. It combines speed, endurance, climbing, moving duration and HR efficiency; it is not a clinical fitness score.</p><div class="grid grid-cols-2 gap-2 mt-5">${years.map(y=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500 text-xs">${y.year}</div><div class="mono font-bold mt-1">${y.cfi.toFixed(1)}</div></div>`).join("")}</div></div></div></div>`;
}

function bikesView(): string {
  const bikes = state.dataset!.bikes;
  return `<div class="h-full overflow-y-auto scroll-thin"><div class="grid md:grid-cols-2 gap-3">${bikes.map((b,i)=>`<div class="card rounded-2xl p-4"><div class="flex justify-between"><div><div class="text-[10px] mono text-slate-500">0${i+1}</div><div class="font-bold mt-1">${b.bike}</div></div><div class="text-right"><div class="text-xl font-black text-cyan-300">${b.distanceKm.toFixed(1)} km</div><div class="text-[10px] text-slate-500">${b.rides} rides</div></div></div><div class="grid grid-cols-3 gap-2 mt-4 text-xs">${[["Speed",b.avgSpeed.toFixed(1)],["CFI",b.cfi.toFixed(1)],["Longest",b.longestRideKm.toFixed(1)]].map(x=>`<div class="rounded-lg bg-white/[.025] p-2"><div class="text-slate-500">${x[0]}</div><div class="mono mt-1">${x[1]}</div></div>`).join("")}</div></div>`).join("")}</div></div>`;
}

function streaksView(): string {
  const ss = state.dataset!.streaks;
  if (!ss.length) return `<div class="card rounded-3xl p-8 text-center">No 3+ day streaks found.</div>`;
  const top=ss[0];
  return `<div class="h-full overflow-y-auto scroll-thin"><div class="grid xl:grid-cols-[1.25fr_.75fr] gap-4"><div class="card rounded-2xl p-5"><div class="flex justify-between"><div><div class="font-semibold">All streaks ≥ 3 days</div><div class="text-xs text-slate-500 mt-1">${ss.length} streaks</div></div><div class="text-3xl font-black text-lime-300">${top.days}d</div></div><div class="space-y-2 mt-4">${ss.map((s,i)=>`<div class="rounded-xl border border-white/[.05] bg-white/[.02] p-3 flex items-center gap-3"><div class="w-9 h-9 rounded-xl bg-lime-400/10 text-lime-300 flex items-center justify-center font-black">${i+1}</div><div class="flex-1"><div class="text-sm font-semibold">${s.start} → ${s.end}</div><div class="text-[11px] text-slate-500">${s.rides} rides · ${s.distanceKm.toFixed(1)} km · ${s.elevationM.toFixed(0)} m</div></div><div class="text-right mono">${s.days}d<div class="text-[10px] text-slate-500">${s.avgSpeed.toFixed(1)} km/h</div></div></div>`).join("")}</div></div><div class="card rounded-2xl p-5"><div class="text-[10px] uppercase tracking-[.18em] text-slate-500">Strongest block</div><div class="text-2xl font-black mt-2">${top.start} → ${top.end}</div><div class="text-5xl font-black text-lime-300 mt-4">${top.distanceKm.toFixed(0)} km</div><div class="text-sm text-slate-400 mt-1">${top.days} consecutive days · ${top.rides} rides</div></div></div></div>`;
}

function dayOfWeekView(): string {
  const patterns = computeDayOfWeekPatterns(state.dataset!.rides);
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">Riding Patterns by Day</div><div class="text-xs text-slate-500 mt-1">Day-of-week analysis</div></div></div><div class="grid grid-cols-2 gap-2 mt-4">${patterns.map(p=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500 text-xs">${p.dayName}</div><div class="mono font-bold mt-1">${p.rides} rides</div><div class="text-[10px] text-slate-500 mt-1">${p.distanceKm.toFixed(1)} km</div><div class="text-[10px] ${p.avgSpeed !== null ? 'text-cyan-300' : 'text-slate-500'}">${p.avgSpeed !== null ? p.avgSpeed.toFixed(1) : '—'} km/h</div></div>`).join("")}</div></div>`;
}

function hourOfDayView(): string {
  const patterns = computeHourOfDayPatterns(state.dataset!.rides);
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">Riding Patterns by Hour</div><div class="text-xs text-slate-500 mt-1">Hour-of-day analysis (24-hour clock)</div></div></div><div class="grid grid-cols-3 gap-2 mt-4">${patterns.map(p=>`<div class="rounded-xl bg-white/[.025] p-2 text-center"><div class="text-slate-500 text-xs">${p.hour}:00</div><div class="mono font-bold mt-2">${p.rides}</div><div class="text-[10px] text-slate-500">${p.distanceKm.toFixed(1)} km</div><div class="text-[10px] ${p.avgSpeed !== null ? 'text-cyan-300' : 'text-slate-500'} mt-1">${p.avgSpeed !== null ? p.avgSpeed.toFixed(1) : '—'} km/h</div></div>`).join("")}</div></div>`;
}

function monthlyTrendsView(): string {
  const trends = computeMonthlyTrends(state.dataset!.rides);
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">Monthly Seasonal Trends</div><div class="text-xs text-slate-500 mt-1">Performance by month</div></div></div><div class="grid grid-cols-2 gap-3 mt-4">${trends.map(t=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500 text-xs">${t.monthName}</div><div class="mono font-bold mt-1">${t.rides} rides</div><div class="text-[10px] text-slate-500 mt-1">${t.distanceKm.toFixed(1)} km</div><div class="text-[10px] text-slate-500 mt-1">${t.elevationM.toFixed(0)} m</div><div class="text-[10px] ${t.avgSpeed !== null ? 'text-cyan-300' : 'text-slate-500'} mt-1">${t.avgSpeed !== null ? t.avgSpeed.toFixed(1) : '—'} km/h</div><div class="text-[10px] ${t.cfI !== null ? 'text-violet-300' : 'text-slate-500'} mt-1">${t.cfI !== null ? t.cfI.toFixed(1) : '—'} CFI</div></div>`).join("")}</div></div>`;
}

function speedElevationView(): string {
  const bins = computeSpeedElevationBins(state.dataset!.rides);
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">Speed-Elevation Profile</div><div class="text-xs text-slate-500 mt-1">Climbing vs. speed analysis</div></div></div><div class="grid grid-cols-2 gap-3 mt-4">${bins.map(b=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500 text-xs">Speed: ${b.avgSpeed.toFixed(1)} km/h</div><div class="mono font-bold mt-1">${b.avgElevation.toFixed(0)} m elevation</div><div class="text-[10px] text-slate-500 mt-1">${b.rideCount} rides</div></div>`).join("")}</div></div>`;
}

function hrZoneView(): string {
  const zones = computeHRZoneDistribution(state.dataset!.rides);
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">HR Zone Distribution</div><div class="text-xs text-slate-500 mt-1">Heart rate intensity analysis</div></div></div><div class="space-y-2 mt-4">${zones.map(z=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500 text-xs">${z.label}</div><div class="mono font-bold mt-1">${z.rides} rides</div><div class="text-[10px] text-slate-500 mt-1">${z.distanceKm.toFixed(1)} km</div><div class="text-[10px] ${z.avgCFI !== null ? 'text-violet-300' : 'text-slate-500'} mt-1">${z.avgCFI !== null ? z.avgCFI.toFixed(1) : '—'} CFI</div></div>`).join("")}</div></div>`;
}

function progressiveMetricsView(): string {
  const metrics = computeProgressiveMetrics(state.dataset!.rides);
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">Progressive Metrics / Trend Lines</div><div class="text-xs text-slate-500 mt-1">Moving averages across all rides</div></div></div><div class="grid grid-cols-2 gap-3 mt-4">${metrics.map(m=>`<div class="rounded-xl bg-white/[.025] p-3"><div class="text-slate-500 text-xs">Ride #${m.index + 1}</div><div class="mono font-bold mt-1">${m.distanceKm.toFixed(1)} km</div><div class="text-[10px] ${m.avgSpeed !== null ? 'text-cyan-300' : 'text-slate-500'} mt-1">${m.avgSpeed !== null ? m.avgSpeed.toFixed(1) : '—'} km/h</div><div class="text-[10px] ${m.cfI !== null ? 'text-violet-300' : 'text-slate-500'} mt-1">${m.cfI !== null ? m.cfI.toFixed(1) : '—'} CFI</div><div class="text-[10px] text-slate-500 mt-1">${m.movingHours !== null ? (m.movingHours*60).toFixed(0) + ' min' : '—'} moving</div></div>`).join("")}</div></div>`;
}

function ridesView(): string {
  const rides = state.dataset!.rides.filter(r=>r.year===state.year).slice().reverse();
  return `<div class="h-full card rounded-2xl p-5 overflow-y-auto scroll-thin"><div class="flex justify-between items-center mb-4"><div><div class="font-semibold">Ride explorer</div><div class="text-xs text-slate-500">${state.year} · ${rides.length} rides</div></div><input id="rideSearch" class="bg-black/20 border border-white/[.08] rounded-lg px-3 py-2 text-xs outline-none" placeholder="Search bike/date"></div><div class="overflow-auto max-h-[70vh]"><table class="w-full text-xs"><thead><tr class="text-left text-slate-500"><th class="p-2">Date</th><th class="p-2">Bike</th><th class="p-2">Distance</th><th class="p-2">Speed</th><th class="p-2">HR</th><th class="p-2">CFI</th></tr></thead><tbody id="rideBody">${rides.map(r=>rideRow(r)).join("")}</tbody></table></div></div>`;
}

function rideRow(r: any): string {
  return `<tr class="border-t border-white/[.045] hover:bg-white/[.02]"><td class="p-2 mono">${r.date}</td><td class="p-2">${r.bike}</td><td class="p-2 mono">${(r.distance??0).toFixed(2)} km</td><td class="p-2 mono">${(r.avgSpeed??0).toFixed(1)}</td><td class="p-2 mono">${r.hrMean===null?"—":r.hrMean.toFixed(0)}</td><td class="p-2 mono text-violet-300">${(r.cfi??0).toFixed(1)}</td></tr>`;
}

function renderContent(): string {
  if (!state.dataset) return "";
  if (state.page==="overview") return overviewView();
  if (state.page==="calendar") return calendarView();
  if (state.page==="performance") return performanceView();
  if (state.page==="bikes") return bikesView();
  if (state.page==="streaks") return streaksView();
  if (state.page==="day-of-week") return dayOfWeekView();
  if (state.page==="hour-of-day") return hourOfDayView();
  if (state.page==="monthly-trends") return monthlyTrendsView();
  if (state.page==="speed-elevation") return speedElevationView();
  if (state.page==="hr-zones") return hrZoneView();
  if (state.page==="progressive-metrics") return progressiveMetricsView();
  return ridesView();
}

function titleForPage(): string {
  const pages = {overview:"Strava Overview",calendar:"Ride Calendar",performance:"Performance / CFI",bikes:"Cycle Analysis",streaks:"Consistency",dayofweek:"Day of Week",hoursofday:"Hours of Day",monthlytrends:"Monthly Trends",speedelevation:"Speed/Elevation",hrzones:"HR Zones",progressivemetrics:"Progressive Metrics",rides:"Ride Explorer"};
  return (pages as any)[state.page];
}

function mountShell(): void {
  const content = state.loading ? loadingView() : !state.connected ? loginView() : state.error ? errorView() : renderContent();
  app.innerHTML = shell(content);

  if (state.connected && state.dataset) {
    document.querySelector("#pageTitle")!.textContent = titleForPage();
    const ys = document.querySelector<HTMLSelectElement>("#yearSelect");
    ys?.addEventListener("change", e => { state.year = Number((e.target as HTMLSelectElement).value); mountShell(); });
    document.querySelector("#syncBtn")?.addEventListener("click", loadData);
    document.querySelector("#logoutBtn")?.addEventListener("click", async () => { await logoutGoogle(); location.reload(); });
    document.querySelectorAll<HTMLElement>("[data-nav]").forEach(b => b.addEventListener("click", () => {
      const next = b.dataset.nav as AppState["page"];
      const fn=()=>{state.page=next;mountShell();};
      document.startViewTransition ? document.startViewTransition(fn) : fn();
    }));

    bindPhysics();
    bindCalendarTips();

    const search=document.querySelector<HTMLInputElement>("#rideSearch");
    search?.addEventListener("input",()=>{
      const q=search.value.toLowerCase();
      const body=document.querySelector("#rideBody");
      if(!body)return;
      body.innerHTML=state.dataset!.rides.filter(r=>r.year===state.year).slice().reverse()
        .filter(r=>(r.bike+" "+r.date).toLowerCase().includes(q))
        .map(rideRow).join("");
    });
  } else {
    document.querySelector("#connectBtn")?.addEventListener("click", connectGoogle);
    document.querySelector("#retryBtn")?.addEventListener("click", loadData);
  }
}

function bindCalendarTips(): void {
  const tip=document.querySelector<HTMLDivElement>("#tooltip");
  if(!tip)return;
  document.querySelectorAll<HTMLElement>(".cal-cell[data-tip]").forEach(cell=>{
    cell.addEventListener("mouseenter",e=>{
      tip.innerHTML=cell.dataset.tip||"";
      tip.classList.add("show");
      moveTip(e as MouseEvent,tip);
    });
    cell.addEventListener("mousemove",e=>moveTip(e as MouseEvent,tip));
    cell.addEventListener("mouseleave",()=>tip.classList.remove("show"));
  });
}

function moveTip(e: MouseEvent,tip:HTMLElement){
  const pad=12;
  tip.style.left=Math.min(window.innerWidth-tip.offsetWidth-pad,e.clientX+pad)+"px";
  tip.style.top=Math.min(window.innerHeight-tip.offsetHeight-pad,e.clientY+pad)+"px";
}

function bindPhysics(): void {
  document.querySelectorAll<HTMLElement>("[data-physics]").forEach(card=>{
    let x=0,y=0,tx=0,ty=0,vx=0,vy=0;
    card.addEventListener("pointermove",e=>{
      const r=card.getBoundingClientRect();
      tx=((e.clientX-(r.left+r.width/2))/r.width)*7;
      ty=((e.clientY-(r.top+r.height/2))/r.height)*7;
    });
    card.addEventListener("pointerleave",()=>{tx=0;ty=0});
    const tick=()=>{
      vx=(vx+(tx-x)*.08)*.80;vy=(vy+(ty-y)*.08)*.80;x+=vx;y+=vy;
      card.style.transform=`translate3d(${x}px,${y}px,0)`;
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function loadData(): Promise<void> {
  state.loading=true;state.error=null;mountShell();
  try{
    const auth=await getAuthStatus();
    state.connected=auth.connected;
    if(!auth.connected){state.loading=false;mountShell();return;}
    state.dataset=await fetchDataset();
    state.year=state.year && state.dataset.years.includes(state.year) ? state.year : state.dataset.years.at(-1)!;
  }catch(err){
    state.error=err instanceof Error && err.message==="NOT_CONNECTED"
      ? "Google access is not connected for this app."
      : err instanceof Error ? err.message : "Unknown error";
  }finally{
    state.loading=false;mountShell();
  }
}

// WebGPU decorative background.
async function initWebGPU(): Promise<void>{
  const badge=document.querySelector("#gpuBadge");
  const stateEl=document.querySelector("#gpuState");
  if(!(navigator as any).gpu){ if(badge)badge.textContent="FALLBACK"; if(stateEl)stateEl.textContent="fallback";return; }
  try{
    const adapter=await (navigator as any).gpu.requestAdapter();
    if(!adapter)throw Error("No adapter");
    const device=await adapter.requestDevice();
    const canvas=document.createElement("canvas");
    canvas.style.cssText="position:fixed;inset:0;width:100%;height:100%;pointer-events:none;opacity:.28;z-index:-2";
    document.body.prepend(canvas);
    const context=canvas.getContext("webgpu") as GPUCanvasContext;
    const format=(navigator as any).gpu.getPreferredCanvasFormat();
    context.configure({device,format,alphaMode:"premultiplied"});
    const shader=device.createShaderModule({code:`
      struct P{res:vec2f;time:f32;pad:f32;mouse:vec2f;}
      @group(0)@binding(0)var<uniform>p:P;
      struct O{@builtin(position)pos:vec4f;}
      @vertex fn vs(@builtin(vertex_index)i:u32)->O{var a=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:O;o.pos=vec4f(a[i],0,1);return o;}
      @fragment fn fs(@builtin(position)f:vec4f)->@location(0)vec4f{
        let uv=f.xy/p.res;let q=(uv-.5)*vec2f(p.res.x/max(p.res.y,1.),1.)*2.;let m=(p.mouse-.5)*vec2f(p.res.x/max(p.res.y,1.),1.)*2.;var c=vec3f(.003,.004,.01);
        for(var i:u32=0u;i<36u;i++){let fi=f32(i);let a=fi*.57+p.time*(.035+fi*.002);let r=.12+fract(sin(fi*91.7)*13.1)*.9;var pos=vec2f(cos(a),sin(a))*r;pos+=(m-pos)*exp(-length(q-m)*2.)*.12;let g=exp(-length(q-pos)*72.);c+=g*mix(vec3f(.18,.62,1.),vec3f(.58,.25,1.),fract(fi*.19));}
        return vec4f(c,1);
      }
    `});
    const pipeline=device.createRenderPipeline({layout:"auto",vertex:{module:shader,entryPoint:"vs"},fragment:{module:shader,entryPoint:"fs",targets:[{format}]},primitive:{topology:"triangle-list"}});
    const buf=device.createBuffer({size:32,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
    const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:buf}}]});
    const mouse={x:.5,y:.5};addEventListener("pointermove",e=>{mouse.x=e.clientX/innerWidth;mouse.y=e.clientY/innerHeight});
    const resize=()=>{const d=Math.min(devicePixelRatio||1,1.6);canvas.width=innerWidth*d;canvas.height=innerHeight*d;context.configure({device,format,alphaMode:"premultiplied"})};resize();addEventListener("resize",resize);
    const start=performance.now();
    const loop=()=>{device.queue.writeBuffer(buf,0,new Float32Array([canvas.width,canvas.height,(performance.now()-start)/1000,0,mouse.x,mouse.y,0,0]));const enc=device.createCommandEncoder();const pass=enc.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();device.queue.submit([enc.finish()]);requestAnimationFrame(loop)};loop();
    if(badge)badge.textContent="LIVE";if(stateEl)stateEl.textContent="WebGPU";
  }catch{if(badge)badge.textContent="FALLBACK";if(stateEl)stateEl.textContent="fallback";}
}

function initVTBadge(){
  const el=document.querySelector("#vtBadge");
if (el) {
  const supportsViewTransitions =
    typeof (document as unknown as { startViewTransition?: unknown })
      .startViewTransition === "function";

  el.textContent = supportsViewTransitions ? "NATIVE" : "FALLBACK";
}
}

void (async()=>{
  mountShell();
  if(state.connected===false){ /* auth check happens in loadData */ }
  await loadData();
  initVTBadge();
  await initWebGPU();
})();
