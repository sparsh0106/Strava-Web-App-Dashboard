import type { BikeStat, DailyStat, Dataset, Ride, Streak, YearStat, DayOfWeekPattern, HourOfDayPattern, MonthlyTrend, SpeedElevationBin, HRZone, ProgressiveMetric, ElevationRatioAnalysis } from "./types";

const FIREFOX = "Firefox Road Runner Pro D";

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: string): Date | null {
  const raw = String(value ?? "").trim();
  const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(d.getTime()) ? null : d;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDuration(value: string): number | null {
  const raw = String(value ?? "").trim();
  const parts = raw.split(":").map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2 && parts.every(Number.isFinite)) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

function percentile(values: number[]): Map<number, number> {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  const out = new Map<number, number>();
  const n = valid.length;
  valid.forEach((v, i) => {
    if (!out.has(v)) out.set(v, ((i + 1) / n) * 100);
  });
  return out;
}

function avg(values: Array<number | null>): number | null {
  const v = values.filter((x): x is number => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function ridgePredict(
  xRows: number[][],
  yValues: number[],
  row: number[],
  alpha = 10
): number {
  const p = row.length;
  const n = p + 1;
  const A = Array.from({ length: n }, () => Array(n).fill(0));
  const b = Array(n).fill(0);

  for (let i = 0; i < xRows.length; i++) {
    const x = [1, ...xRows[i]];
    for (let r = 0; r < n; r++) {
      b[r] += x[r] * yValues[i];
      for (let c = 0; c < n; c++) A[r][c] += x[r] * x[c];
    }
  }
  for (let i = 1; i < n; i++) A[i][i] += alpha;

  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    }
    [A[i], A[pivot]] = [A[pivot], A[i]];
    const div = A[i][i] || 1e-12;
    for (let c = i; c < n; c++) A[i][c] /= div;
    b[i] /= div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = A[r][i];
      if (!f) continue;
      for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
      b[r] -= f * b[i];
    }
  }

  const x = [1, ...row];
  return x.reduce((s, v, i) => s + v * b[i], 0);
}

export function normalizeRows(rows: string[][]): Ride[] {
  const data = rows.slice(1).map(r => {
    const date = parseDate(r[0]);
    if (!date) return null;
    const movingSeconds = parseDuration(r[2]);
    let bike = String(r[10] ?? "").trim();
    if (!bike) bike = FIREFOX;
    if (bike === "Fireforx MTB") bike = "Firefox MTB";

    return {
      date: isoDate(date),
      elapsedTime: String(r[1] ?? ""),
      movingTime: String(r[2] ?? ""),
      distance: num(r[3]),
      elevation: num(r[4]),
      avgSpeed: num(r[5]),
      maxSpeed: num(r[6]),
      device: String(r[7] ?? "").trim() || null,
      hrMax: num(r[8]),
      hrMean: num(r[9]),
      bike,
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      movingHours: movingSeconds === null ? null : movingSeconds / 3600
    } satisfies Ride;
  }).filter((x): x is Ride => x !== null);

  return data.sort((a, b) => a.date.localeCompare(b.date));
}

function addCFI(rides: Ride[]): void {
  const speedMap = percentile(rides.map(r => r.avgSpeed ?? NaN));
  const distanceMap = percentile(rides.map(r => r.distance ?? NaN));
  const elevationMap = percentile(rides.map(r => r.elevation ?? NaN));
  const durationMap = percentile(rides.map(r => r.movingHours ?? NaN));

  const efficiencies = rides.map(r =>
    r.avgSpeed !== null && r.hrMean !== null && r.hrMean > 0
      ? r.avgSpeed / r.hrMean
      : NaN
  );
  const hrMap = percentile(efficiencies);

  const featureRows: number[][] = [];
  const yRows: number[] = [];
  rides.forEach(r => {
    const features = [
      speedMap.get(r.avgSpeed ?? NaN) ?? NaN,
      distanceMap.get(r.distance ?? NaN) ?? NaN,
      elevationMap.get(r.elevation ?? NaN) ?? NaN,
      durationMap.get(r.movingHours ?? NaN) ?? NaN
    ];
    const hrScore = hrMap.get(
      r.avgSpeed !== null && r.hrMean !== null && r.hrMean > 0
        ? r.avgSpeed / r.hrMean
        : NaN
    );
    if (hrScore !== undefined && features.every(Number.isFinite)) {
      featureRows.push(features);
      yRows.push(hrScore);
    }
  });

  rides.forEach(r => {
    const speedScore = speedMap.get(r.avgSpeed ?? NaN) ?? 50;
    const distanceScore = distanceMap.get(r.distance ?? NaN) ?? 50;
    const elevationScore = elevationMap.get(r.elevation ?? NaN) ?? 50;
    const durationScore = durationMap.get(r.movingHours ?? NaN) ?? 50;

    let hrScore = hrMap.get(
      r.avgSpeed !== null && r.hrMean !== null && r.hrMean > 0
        ? r.avgSpeed / r.hrMean
        : NaN
    );

    if (hrScore === undefined && featureRows.length) {
      hrScore = Math.max(
        0,
        Math.min(
          100,
          ridgePredict(
            featureRows,
            yRows,
            [speedScore, distanceScore, elevationScore, durationScore]
          )
        )
      );
    }
    if (hrScore === undefined) hrScore = 50;

    r.cfi =
      0.30 * speedScore +
      0.20 * distanceScore +
      0.15 * elevationScore +
      0.15 * durationScore +
      0.20 * hrScore;
  });
}

export function buildDataset(rides: Ride[]): Dataset {
  addCFI(rides);

  const dailyMap = new Map<string, Ride[]>();
  rides.forEach(r => {
    const arr = dailyMap.get(r.date) ?? [];
    arr.push(r);
    dailyMap.set(r.date, arr);
  });

  const daily: DailyStat[] = [...dailyMap.entries()].map(([date, rs]) => ({
    date,
    rides: rs.length,
    distanceKm: rs.reduce((s, r) => s + (r.distance ?? 0), 0),
    elevationM: rs.reduce((s, r) => s + (r.elevation ?? 0), 0),
    avgSpeed: avg(rs.map(r => r.avgSpeed)),
    avgHr: avg(rs.map(r => r.hrMean)),
    cfi: avg(rs.map(r => r.cfi ?? null))
  })).sort((a, b) => a.date.localeCompare(b.date));

  const years = [...new Set(rides.map(r => r.year))].sort((a, b) => a - b);

  const yearly: YearStat[] = years.map(year => {
    const rs = rides.filter(r => r.year === year);
    const dist = rs.reduce((s, r) => s + (r.distance ?? 0), 0);
    const time = rs.reduce((s, r) => s + (r.movingHours ?? 0), 0);
    return {
      year,
      rides: rs.length,
      distanceKm: dist,
      elevationM: rs.reduce((s, r) => s + (r.elevation ?? 0), 0),
      avgSpeed: avg(rs.map(r => r.avgSpeed)) ?? 0,
      weightedSpeed: time > 0 ? dist / time : 0,
      movingTimeH: time,
      avgHr: avg(rs.map(r => r.hrMean)),
      cfi: avg(rs.map(r => r.cfi ?? null)) ?? 0,
      longestRideKm: Math.max(...rs.map(r => r.distance ?? 0))
    };
  });

  const bikeNames = [...new Set(rides.map(r => r.bike))];
  const bikes: BikeStat[] = bikeNames.map(bike => {
    const rs = rides.filter(r => r.bike === bike);
    const dist = rs.reduce((s, r) => s + (r.distance ?? 0), 0);
    const time = rs.reduce((s, r) => s + (r.movingHours ?? 0), 0);
    return {
      bike,
      rides: rs.length,
      distanceKm: dist,
      avgSpeed: avg(rs.map(r => r.avgSpeed)) ?? 0,
      weightedSpeed: time > 0 ? dist / time : 0,
      elevationM: rs.reduce((s, r) => s + (r.elevation ?? 0), 0),
      avgHr: avg(rs.map(r => r.hrMean)),
      cfi: avg(rs.map(r => r.cfi ?? null)) ?? 0,
      longestRideKm: Math.max(...rs.map(r => r.distance ?? 0))
    };
  }).sort((a, b) => b.distanceKm - a.distanceKm);

  const dates = [...new Set(rides.map(r => r.date))].sort();
  const streaks: Streak[] = [];
  let start = 0;
  for (let i = 1; i <= dates.length; i++) {
    const prev = i - 1 < dates.length ? new Date(`${dates[i - 1]}T00:00:00`) : null;
    const cur = i < dates.length ? new Date(`${dates[i]}T00:00:00`) : null;
    const consecutive = cur && prev
      ? Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1
      : false;

    if (!consecutive) {
      const block = dates.slice(start, i);
      if (block.length >= 3) {
        const blockRides = rides.filter(r => r.date >= block[0] && r.date <= block.at(-1)!);
        streaks.push({
          start: block[0],
          end: block.at(-1)!,
          days: block.length,
          rides: blockRides.length,
          distanceKm: blockRides.reduce((s, r) => s + (r.distance ?? 0), 0),
          elevationM: blockRides.reduce((s, r) => s + (r.elevation ?? 0), 0),
          avgSpeed: avg(blockRides.map(r => r.avgSpeed)) ?? 0
        });
      }
      start = i;
    }
  }
  streaks.sort((a, b) => b.days - a.days || a.start.localeCompare(b.start));

  return {
    rides,
    daily,
    yearly,
    bikes,
    streaks,
    years,
    meta: {
      rides: rides.length,
      ridingDays: daily.length,
      distanceKm: rides.reduce((s, r) => s + (r.distance ?? 0), 0),
      elevationM: rides.reduce((s, r) => s + (r.elevation ?? 0), 0),
      longestRideKm: Math.max(...rides.map(r => r.distance ?? 0)),
      fastestAvgSpeed: Math.max(...rides.map(r => r.avgSpeed ?? 0)),
      weightedSpeed: rides.reduce((s, r) => s + (r.distance ?? 0), 0) /
        Math.max(0.001, rides.reduce((s, r) => s + (r.movingHours ?? 0), 0)),
      cfi: avg(rides.map(r => r.cfi ?? null)) ?? 0
    }
  };
}

export { parseDate };

// Compute day-of-week riding patterns
export function computeDayOfWeekPatterns(rides: Ride[]): DayOfWeekPattern[] {
  const dayData: Map<number, { rides: number; distanceKm: number; speedSum: number }> = new Map();

  rides.forEach(r => {
    const dayIndex = r.date ? new Date(r.date).getDay() : 0; // 0=Sunday
    if (!dayData.has(dayIndex)) {
      dayData.set(dayIndex, { rides: 0, distanceKm: 0, speedSum: 0 });
    }
    const d = dayData.get(dayIndex)!;
    d.rides++;
    d.distanceKm += r.distance ?? 0;
    if (r.avgSpeed !== null) d.speedSum += r.avgSpeed;
  });

  const patterns: DayOfWeekPattern[] = [];
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  dayData.forEach((d, dayIndex) => {
    patterns.push({
      dayIndex,
      dayName: dayNames[dayIndex],
      rides: d.rides,
      distanceKm: d.distanceKm,
      avgSpeed: d.rides > 0 ? d.speedSum / d.rides : null,
    });
  });

  return patterns.sort((a, b) => a.dayIndex - b.dayIndex);
}

// Compute hour-of-day riding patterns
export function computeHourOfDayPatterns(rides: Ride[]): HourOfDayPattern[] {
  const hourData: Map<number, { rides: number; distanceKm: number; speedSum: number }> = new Map();

  rides.forEach(r => {
    if (!r.date) return;
    const hour = new Date(r.date).getHours(); // 0-23
    if (!hourData.has(hour)) {
      hourData.set(hour, { rides: 0, distanceKm: 0, speedSum: 0 });
    }
    const h = hourData.get(hour)!;
    h.rides++;
    h.distanceKm += r.distance ?? 0;
    if (r.avgSpeed !== null) h.speedSum += r.avgSpeed;
  });

  const patterns: HourOfDayPattern[] = [];
  for (let h = 0; h < 24; h++) {
    const hd = hourData.get(h) || { rides: 0, distanceKm: 0, speedSum: 0 };
    patterns.push({
      hour: h,
      rides: hd.rides,
      distanceKm: hd.distanceKm,
      avgSpeed: hd.rides > 0 ? hd.speedSum / hd.rides : null,
    });
  }

  return patterns;
}

// Compute monthly seasonal trends
export function computeMonthlyTrends(rides: Ride[]): MonthlyTrend[] {
  const monthData: Map<number, { rides: number; distanceKm: number; elevationM: number; speedSum: number; cfSum: number }> = new Map();

  rides.forEach(r => {
    if (!r.date) return;
    const month = new Date(r.date).getMonth() + 1; // 1-12
    if (!monthData.has(month)) {
      monthData.set(month, { rides: 0, distanceKm: 0, elevationM: 0, speedSum: 0, cfSum: 0 });
    }
    const m = monthData.get(month)!;
    m.rides++;
    m.distanceKm += r.distance ?? 0;
    m.elevationM += r.elevation ?? 0;
    if (r.avgSpeed !== null) m.speedSum += r.avgSpeed;
    if (r.cfi !== null) m.cfSum += (r.cfi as number);
  });

  const trends: MonthlyTrend[] = [];
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  for (let m = 1; m <= 12; m++) {
    const md = monthData.get(m) || { rides: 0, distanceKm: 0, elevationM: 0, speedSum: 0, cfSum: 0 };
    trends.push({
      month: m,
      monthName: monthNames[m - 1],
      rides: md.rides,
      distanceKm: md.distanceKm,
      elevationM: md.elevationM,
      avgSpeed: md.rides > 0 ? md.speedSum / md.rides : null,
      cfI: md.rides > 0 ? md.cfSum / md.rides : null,
    });
  }

  return trends;
}

// Compute speed-elevation profile bins
export function computeSpeedElevationBins(rides: Ride[], binCount = 10): SpeedElevationBin[] {
  // Sort rides by avgSpeed
  const sorted = [...rides].sort((a, b) => (a.avgSpeed ?? 0) - (b.avgSpeed ?? 0));

  // Calculate speed range
  const minSpeed = sorted[0]?.avgSpeed ?? 0;
  const maxSpeed = sorted[sorted.length - 1]?.avgSpeed ?? 0;
  const speedRange = maxSpeed - minSpeed || 1;

  // Group by speed bins, track elevation
  const bins: Map<string, { avgSpeed: number; elevationSum: number; count: number }> = new Map();

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const binIndex = Math.min(
      Math.floor((((r.avgSpeed ?? 0) - minSpeed) / speedRange) * binCount),
      binCount - 1
    );
    const key = `${binIndex}`;
    if (!bins.has(key)) {
      bins.set(key, { avgSpeed: 0, elevationSum: 0, count: 0 });
    }
    const b = bins.get(key)!;
    b.avgSpeed += r.avgSpeed ?? 0;
    b.elevationSum += r.elevation ?? 0;
    b.count++;
  }

  const results: SpeedElevationBin[] = [];
  bins.forEach((b, key) => {
    results.push({
      avgSpeed: b.count > 0 ? b.avgSpeed / b.count : 0,
      avgElevation: b.count > 0 ? b.elevationSum / b.count : 0,
      rideCount: b.count,
    });
  });

  return results.sort((a, b) => a.avgSpeed - b.avgSpeed);
}

// Compute HR zone distribution
export function computeHRZoneDistribution(rides: Ride[]): HRZone[] {
  // Define HR zones (typical cycling zones)
  const zones: HRZone[] = [
    { min: 0, max: 113, label: "Zone 1 - Recovery", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 113, max: 130, label: "Zone 2 - Endurance", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 130, max: 147, label: "Zone 3 - Tempo", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 147, max: 164, label: "Zone 4 - Threshold", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 164, max: 200, label: "Zone 5 - VO2 Max", rides: 0, distanceKm: 0, avgCFI: null },
  ];

  // Track CFI sums per zone using a separate map
  const zoneCfSums: Map<number, number> = new Map();
  const zoneCfCounts: Map<number, number> = new Map();

  rides.forEach(r => {
    if (r.hrMean === null) return;

    // Find which zone this HR falls into
    for (let i = 0; i < 5; i++) {
      const zone = zones[i];
      if (r.hrMean >= zone.min && r.hrMean < zone.max) {
        zone.rides++;
        zone.distanceKm += r.distance ?? 0;
        if (r.cfi !== null) {
          zoneCfSums.set(i, (zoneCfSums.get(i) ?? 0) + (r.cfi as number));
          zoneCfCounts.set(i, (zoneCfCounts.get(i) ?? 0) + 1);
        }
        break;
      }
    }
  });

  // Calculate average CFI per zone
  zones.forEach((zone, i) => {
    const cfSum = zoneCfSums.get(i) ?? 0;
    const cfCount = zoneCfCounts.get(i) ?? 0;
    zone.avgCFI = cfCount > 0 ? cfSum / cfCount : null;
  });

  return zones;
}

// Compute progressive metrics (moving averages/trends)
export function computeProgressiveMetrics(rides: Ride[]): ProgressiveMetric[] {
  // Sort rides by date (already sorted in buildDataset, but ensure)
  const sorted = [...rides].sort((a, b) => a.date.localeCompare(b.date));

  const metrics: ProgressiveMetric[] = [];
  let cumDistance = 0;
  let cumSpeedSum = 0;
  let cumCFISum = 0;
  let cumMovingHours = 0;
  let speedCount = 0;
  let cfCount = 0;

  sorted.forEach((r, i) => {
    cumDistance += r.distance ?? 0;
    if (r.avgSpeed !== null) {
      cumSpeedSum += r.avgSpeed;
      speedCount++;
    }
    if (r.cfi !== null) {
      cumCFISum += (r.cfi as number);
      cfCount++;
    }
    if (r.movingHours !== null) {
      cumMovingHours += r.movingHours;
    }

    metrics.push({
      index: i,
      distanceKm: cumDistance,
      avgSpeed: speedCount > 0 ? cumSpeedSum / speedCount : null,
      cfI: cfCount > 0 ? cumCFISum / cfCount : null,
      movingHours: cumMovingHours,
    });
  });

  return metrics;
}

// Compute elevation-distance ratio analysis
export function computeElevationRatioAnalysis(rides: Ride[]): ElevationRatioAnalysis {
  let totalElevation = 0;
  let totalDistance = 0;
  let hillCountModerate = 0; // 5-15 m/km
  let hillCountSteep = 0; // >15 m/km
  let totalRidesWithElevation = 0;

  rides.forEach(r => {
    if (r.distance === null || r.distance === 0 || r.elevation === null) return;
    totalDistance += r.distance;
    totalElevation += r.elevation;
    totalRidesWithElevation++;

    const elevationPerKm = (r.elevation / r.distance) * 1000; // m per km

    if (elevationPerKm >= 5 && elevationPerKm <= 15) {
      hillCountModerate++;
    } else if (elevationPerKm > 15) {
      hillCountSteep++;
    }
  });

  const avgElevationPerKm = totalRidesWithElevation > 0 ? totalElevation / totalDistance * 1000 : 0;
  const moderatePct = totalRidesWithElevation > 0 ? (hillCountModerate / totalRidesWithElevation) * 100 : 0;
  const steepPct = totalRidesWithElevation > 0 ? (hillCountSteep / totalRidesWithElevation) * 100 : 0;

  return {
    avgElevationPerKm,
    totalElevationM: totalElevation,
    totalDistanceKm: totalDistance,
    hillinessScore: avgElevationPerKm,
    moderateHillPct: moderatePct,
    steepHillPct: steepPct,
  };
}
