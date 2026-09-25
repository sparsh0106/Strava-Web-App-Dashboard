import type {
  BikeStat,
  DailyStat,
  Dataset,
  DataQuality,
  DayOfWeekPattern,
  ElevationRatioAnalysis,
  HourOfDayPattern,
  HRZone,
  MonthlyTrend,
  ProgressiveMetric,
  Ride,
  SpeedElevationBin,
  Streak,
  YearStat
} from "./types";

const FIREFOX = "Firefox Road Runner Pro D";
const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
];

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : null;
}

type ParsedDate = { date: Date; time: string | null };

/** Parse the date formats commonly exported from Strava/Sheets without timezone drift. */
function parseDateParts(value: unknown): ParsedDate | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  // Prefer an unambiguous ISO-like prefix when present.
  const iso = raw.match(
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  const local = raw.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/
  );
  const match = iso ?? local;
  if (!match) return null;

  const year = iso ? Number(match[1]) : Number(match[3]);
  const month = iso ? Number(match[2]) : Number(match[2]);
  const day = iso ? Number(match[3]) : Number(match[1]);
  const hour = match[4] === undefined ? null : Number(match[4]);
  const minute = match[5] === undefined ? null : Number(match[5]);
  const second = match[6] === undefined ? null : Number(match[6]);

  if (hour !== null && (hour < 0 || hour > 23)) return null;
  if (minute !== null && (minute < 0 || minute > 59)) return null;
  if (second !== null && (second < 0 || second > 59)) return null;

  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  const time =
    hour === null || minute === null
      ? null
      : `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}${
          second === null ? "" : `:${String(second).padStart(2, "0")}`
        }`;
  return { date, time };
}

export function parseDate(value: string): Date | null {
  return parseDateParts(value)?.date ?? null;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDuration(value: unknown): number | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
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
  const valid = values.filter((x): x is number => Number.isFinite(x));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

function maxOrZero(values: Array<number | null>): number {
  return values.length ? Math.max(...values.map(v => v ?? 0)) : 0;
}

function localDateFromISO(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
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
      const factor = A[r][i];
      if (!factor) continue;
      for (let c = i; c < n; c++) A[r][c] -= factor * A[i][c];
      b[r] -= factor * b[i];
    }
  }

  const x = [1, ...row];
  return x.reduce((sum, value, index) => sum + value * b[index], 0);
}

export function normalizeRows(rows: string[][]): Ride[] {
  const data = rows.slice(1).map((row, index) => {
    const parsed = parseDateParts(row[0]);
    if (!parsed) return null;
    const movingSeconds = parseDuration(row[2]);
    const normalizedDate = isoDate(parsed.date);
    let bike = String(row[10] ?? "").trim();
    if (!bike) bike = FIREFOX;
    if (bike === "Fireforx MTB") bike = "Firefox MTB";

    return {
      id: `${normalizedDate}-${index + 1}`,
      date: normalizedDate,
      startTime: parsed.time,
      elapsedTime: String(row[1] ?? ""),
      movingTime: String(row[2] ?? ""),
      distance: num(row[3]),
      elevation: num(row[4]),
      avgSpeed: num(row[5]),
      maxSpeed: num(row[6]),
      device: String(row[7] ?? "").trim() || null,
      hrMax: num(row[8]),
      hrMean: num(row[9]),
      bike,
      year: parsed.date.getFullYear(),
      month: parsed.date.getMonth() + 1,
      movingHours: movingSeconds === null ? null : movingSeconds / 3600
    } satisfies Ride;
  }).filter((ride): ride is Ride => ride !== null);

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

function buildDataQuality(rides: Ride[]): DataQuality {
  const missing = {
    distance: rides.filter(r => r.distance === null).length,
    elevation: rides.filter(r => r.elevation === null).length,
    avgSpeed: rides.filter(r => r.avgSpeed === null).length,
    hrMean: rides.filter(r => r.hrMean === null).length,
    movingTime: rides.filter(r => r.movingHours === null).length,
    startTime: rides.filter(r => r.startTime === null).length
  };
  const completeRides = rides.filter(
    r =>
      r.distance !== null &&
      r.elevation !== null &&
      r.avgSpeed !== null &&
      r.hrMean !== null &&
      r.movingHours !== null
  ).length;
  return { totalRides: rides.length, completeRides, missing };
}

function buildStreaks(rides: Ride[]): Streak[] {
  const dates = [...new Set(rides.map(r => r.date))].sort();
  const streaks: Streak[] = [];
  let start = 0;

  for (let i = 1; i <= dates.length; i++) {
    const previous = i - 1 < dates.length ? localDateFromISO(dates[i - 1]) : null;
    const current = i < dates.length ? localDateFromISO(dates[i]) : null;
    const consecutive =
      current && previous
        ? Math.round((current.getTime() - previous.getTime()) / 86400000) === 1
        : false;

    if (!consecutive) {
      const block = dates.slice(start, i);
      if (block.length >= 3) {
        const blockDates = new Set(block);
        const blockRides = rides.filter(r => blockDates.has(r.date));
        streaks.push({
          start: block[0],
          end: block[block.length - 1],
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

  return streaks.sort((a, b) => b.days - a.days || a.start.localeCompare(b.start));
}

export function buildDataset(rides: Ride[]): Dataset {
  addCFI(rides);

  const dailyMap = new Map<string, Ride[]>();
  rides.forEach(r => {
    const day = dailyMap.get(r.date) ?? [];
    day.push(r);
    dailyMap.set(r.date, day);
  });

  const daily: DailyStat[] = [...dailyMap.entries()]
    .map(([date, dayRides]) => ({
      date,
      rides: dayRides.length,
      distanceKm: dayRides.reduce((s, r) => s + (r.distance ?? 0), 0),
      elevationM: dayRides.reduce((s, r) => s + (r.elevation ?? 0), 0),
      avgSpeed: avg(dayRides.map(r => r.avgSpeed)),
      avgHr: avg(dayRides.map(r => r.hrMean)),
      cfi: avg(dayRides.map(r => r.cfi ?? null))
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const years = [...new Set(rides.map(r => r.year))].sort((a, b) => a - b);
  const yearly: YearStat[] = years.map(year => {
    const yearRides = rides.filter(r => r.year === year);
    const distance = yearRides.reduce((s, r) => s + (r.distance ?? 0), 0);
    const movingTime = yearRides.reduce((s, r) => s + (r.movingHours ?? 0), 0);
    return {
      year,
      rides: yearRides.length,
      distanceKm: distance,
      elevationM: yearRides.reduce((s, r) => s + (r.elevation ?? 0), 0),
      avgSpeed: avg(yearRides.map(r => r.avgSpeed)) ?? 0,
      weightedSpeed: movingTime > 0 ? distance / movingTime : 0,
      movingTimeH: movingTime,
      avgHr: avg(yearRides.map(r => r.hrMean)),
      cfi: avg(yearRides.map(r => r.cfi ?? null)) ?? 0,
      longestRideKm: maxOrZero(yearRides.map(r => r.distance))
    };
  });

  const bikes: BikeStat[] = [...new Set(rides.map(r => r.bike))]
    .map(bike => {
      const bikeRides = rides.filter(r => r.bike === bike);
      const distance = bikeRides.reduce((s, r) => s + (r.distance ?? 0), 0);
      const movingTime = bikeRides.reduce((s, r) => s + (r.movingHours ?? 0), 0);
      return {
        bike,
        rides: bikeRides.length,
        distanceKm: distance,
        avgSpeed: avg(bikeRides.map(r => r.avgSpeed)) ?? 0,
        weightedSpeed: movingTime > 0 ? distance / movingTime : 0,
        elevationM: bikeRides.reduce((s, r) => s + (r.elevation ?? 0), 0),
        avgHr: avg(bikeRides.map(r => r.hrMean)),
        cfi: avg(bikeRides.map(r => r.cfi ?? null)) ?? 0,
        longestRideKm: maxOrZero(bikeRides.map(r => r.distance))
      };
    })
    .sort((a, b) => b.distanceKm - a.distanceKm);

  const distance = rides.reduce((s, r) => s + (r.distance ?? 0), 0);
  const movingTime = rides.reduce((s, r) => s + (r.movingHours ?? 0), 0);
  const elevation = rides.reduce((s, r) => s + (r.elevation ?? 0), 0);

  return {
    rides,
    daily,
    yearly,
    bikes,
    streaks: buildStreaks(rides),
    years,
    dataQuality: buildDataQuality(rides),
    meta: {
      rides: rides.length,
      ridingDays: daily.length,
      distanceKm: distance,
      elevationM: elevation,
      movingTimeH: movingTime,
      longestRideKm: maxOrZero(rides.map(r => r.distance)),
      fastestAvgSpeed: maxOrZero(rides.map(r => r.avgSpeed)),
      weightedSpeed: movingTime > 0 ? distance / movingTime : 0,
      cfi: avg(rides.map(r => r.cfi ?? null)) ?? 0
    }
  };
}

export function computeDayOfWeekPatterns(rides: Ride[]): DayOfWeekPattern[] {
  const buckets = DAY_NAMES.map((dayName, dayIndex) => ({
    dayIndex,
    dayName,
    rides: 0,
    distanceKm: 0,
    speedSum: 0,
    speedCount: 0
  }));

  rides.forEach(r => {
    const dayIndex = localDateFromISO(r.date).getDay();
    const bucket = buckets[dayIndex];
    bucket.rides += 1;
    bucket.distanceKm += r.distance ?? 0;
    if (r.avgSpeed !== null) {
      bucket.speedSum += r.avgSpeed;
      bucket.speedCount += 1;
    }
  });

  return buckets.map(bucket => ({
    dayIndex: bucket.dayIndex,
    dayName: bucket.dayName,
    rides: bucket.rides,
    distanceKm: bucket.distanceKm,
    avgSpeed: bucket.speedCount ? bucket.speedSum / bucket.speedCount : null
  }));
}

export function computeHourOfDayPatterns(rides: Ride[]): HourOfDayPattern[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    rides: 0,
    distanceKm: 0,
    speedSum: 0,
    speedCount: 0
  }));

  rides.forEach(r => {
    if (!r.startTime) return;
    const hour = Number(r.startTime.slice(0, 2));
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return;
    const bucket = buckets[hour];
    bucket.rides += 1;
    bucket.distanceKm += r.distance ?? 0;
    if (r.avgSpeed !== null) {
      bucket.speedSum += r.avgSpeed;
      bucket.speedCount += 1;
    }
  });

  return buckets.map(bucket => ({
    hour: bucket.hour,
    rides: bucket.rides,
    distanceKm: bucket.distanceKm,
    avgSpeed: bucket.speedCount ? bucket.speedSum / bucket.speedCount : null
  }));
}

export function computeMonthlyTrends(rides: Ride[]): MonthlyTrend[] {
  const buckets = MONTH_NAMES.map((monthName, index) => ({
    month: index + 1,
    monthName,
    rides: 0,
    distanceKm: 0,
    elevationM: 0,
    speedSum: 0,
    speedCount: 0,
    cfSum: 0,
    cfCount: 0
  }));

  rides.forEach(r => {
    const month = localDateFromISO(r.date).getMonth();
    const bucket = buckets[month];
    bucket.rides += 1;
    bucket.distanceKm += r.distance ?? 0;
    bucket.elevationM += r.elevation ?? 0;
    if (r.avgSpeed !== null) {
      bucket.speedSum += r.avgSpeed;
      bucket.speedCount += 1;
    }
    if (r.cfi !== null && r.cfi !== undefined) {
      bucket.cfSum += r.cfi;
      bucket.cfCount += 1;
    }
  });

  return buckets.map(bucket => ({
    month: bucket.month,
    monthName: bucket.monthName,
    rides: bucket.rides,
    distanceKm: bucket.distanceKm,
    elevationM: bucket.elevationM,
    avgSpeed: bucket.speedCount ? bucket.speedSum / bucket.speedCount : null,
    cfI: bucket.cfCount ? bucket.cfSum / bucket.cfCount : null
  }));
}

export function computeSpeedElevationBins(
  rides: Ride[],
  binCount = 10
): SpeedElevationBin[] {
  const sorted = rides
    .filter(r => r.avgSpeed !== null && r.elevation !== null)
    .sort((a, b) => (a.avgSpeed ?? 0) - (b.avgSpeed ?? 0));
  if (!sorted.length) return [];

  const minSpeed = sorted[0].avgSpeed ?? 0;
  const maxSpeed = sorted[sorted.length - 1].avgSpeed ?? 0;
  const speedRange = maxSpeed - minSpeed || 1;
  const buckets = new Map<number, { speed: number; elevation: number; count: number }>();

  sorted.forEach(r => {
    const binIndex = Math.min(
      Math.floor((((r.avgSpeed ?? 0) - minSpeed) / speedRange) * binCount),
      binCount - 1
    );
    const bucket = buckets.get(binIndex) ?? { speed: 0, elevation: 0, count: 0 };
    bucket.speed += r.avgSpeed ?? 0;
    bucket.elevation += r.elevation ?? 0;
    bucket.count += 1;
    buckets.set(binIndex, bucket);
  });

  return [...buckets.entries()]
    .map(([, bucket]) => ({
      avgSpeed: bucket.speed / bucket.count,
      avgElevation: bucket.elevation / bucket.count,
      rideCount: bucket.count
    }))
    .sort((a, b) => a.avgSpeed - b.avgSpeed);
}

export function computeHRZoneDistribution(rides: Ride[]): HRZone[] {
  const zones: HRZone[] = [
    { min: 0, max: 113, label: "Zone 1 · Recovery", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 113, max: 130, label: "Zone 2 · Endurance", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 130, max: 147, label: "Zone 3 · Tempo", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 147, max: 164, label: "Zone 4 · Threshold", rides: 0, distanceKm: 0, avgCFI: null },
    { min: 164, max: 999, label: "Zone 5 · VO₂ max", rides: 0, distanceKm: 0, avgCFI: null }
  ];
  const cfSums = new Map<number, number>();
  const cfCounts = new Map<number, number>();

  rides.forEach(ride => {
    if (ride.hrMean === null) return;
    const index = zones.findIndex(
      zone => ride.hrMean !== null && ride.hrMean >= zone.min && ride.hrMean < zone.max
    );
    if (index < 0) return;
    const zone = zones[index];
    zone.rides += 1;
    zone.distanceKm += ride.distance ?? 0;
    if (ride.cfi !== null && ride.cfi !== undefined) {
      cfSums.set(index, (cfSums.get(index) ?? 0) + ride.cfi);
      cfCounts.set(index, (cfCounts.get(index) ?? 0) + 1);
    }
  });

  zones.forEach((zone, index) => {
    const count = cfCounts.get(index) ?? 0;
    zone.avgCFI = count ? (cfSums.get(index) ?? 0) / count : null;
  });
  return zones;
}

/** Ten-ride rolling metrics plus cumulative distance for the progression chart. */
export function computeProgressiveMetrics(rides: Ride[], windowSize = 10): ProgressiveMetric[] {
  const sorted = [...rides].sort((a, b) => a.date.localeCompare(b.date));
  const metrics: ProgressiveMetric[] = [];
  let cumulativeDistance = 0;

  sorted.forEach((ride, index) => {
    cumulativeDistance += ride.distance ?? 0;
    const window = sorted.slice(Math.max(0, index - windowSize + 1), index + 1);
    const speedValues = window.map(r => r.avgSpeed);
    const cfiValues = window.map(r => r.cfi ?? null);
    const movingValues = window.map(r => r.movingHours);
    metrics.push({
      index,
      distanceKm: cumulativeDistance,
      avgSpeed: avg(speedValues),
      cfI: avg(cfiValues),
      movingHours: movingValues.some(value => value !== null)
        ? movingValues.reduce<number>((sum, value) => sum + (value ?? 0), 0)
        : null
    });
  });

  return metrics;
}

export function computeElevationRatioAnalysis(rides: Ride[]): ElevationRatioAnalysis {
  let totalElevation = 0;
  let totalDistance = 0;
  let moderate = 0;
  let steep = 0;
  let ridesWithElevation = 0;

  rides.forEach(ride => {
    if (ride.distance === null || ride.distance <= 0 || ride.elevation === null) return;
    totalDistance += ride.distance;
    totalElevation += ride.elevation;
    ridesWithElevation += 1;
    const metersPerKm = (ride.elevation / ride.distance) * 1000;
    if (metersPerKm >= 5 && metersPerKm <= 15) moderate += 1;
    else if (metersPerKm > 15) steep += 1;
  });

  const avgElevationPerKm = totalDistance
    ? (totalElevation / totalDistance) * 1000
    : 0;
  return {
    avgElevationPerKm,
    totalElevationM: totalElevation,
    totalDistanceKm: totalDistance,
    hillinessScore: avgElevationPerKm,
    moderateHillPct: ridesWithElevation ? (moderate / ridesWithElevation) * 100 : 0,
    steepHillPct: ridesWithElevation ? (steep / ridesWithElevation) * 100 : 0
  };
}
