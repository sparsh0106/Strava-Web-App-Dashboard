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
  YearStat,
  DistanceSummary,
  WeeklyDistance
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

function buildDataQuality(rides: Ride[]): DataQuality {
  const missing = {
    distance: rides.filter(r => r.distance === null).length,
    elevation: rides.filter(r => r.elevation === null).length,
    avgSpeed: rides.filter(r => r.avgSpeed === null).length,
    hrMean: rides.filter(r => r.hrMean === null).length,
    movingTime: rides.filter(r => r.movingHours === null).length,
    startTime: rides.filter(r => r.startTime === null).length
  };
  const ridesWithDistance = rides.filter(r => r.distance !== null).length;
  return { totalRides: rides.length, ridesWithDistance, missing };
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
      avgHr: avg(dayRides.map(r => r.hrMean))
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
        averageDistanceKm: avg(bikeRides.map(r => r.distance)) ?? 0,
        avgSpeed: avg(bikeRides.map(r => r.avgSpeed)) ?? 0,
        weightedSpeed: movingTime > 0 ? distance / movingTime : 0,
        elevationM: bikeRides.reduce((s, r) => s + (r.elevation ?? 0), 0),
        avgHr: avg(bikeRides.map(r => r.hrMean)),
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
      weightedSpeed: movingTime > 0 ? distance / movingTime : 0
    }
  };
}

export function rideDurationHours(ride: Ride): number | null {
  if (ride.movingHours !== null) return ride.movingHours;
  const elapsedSeconds = parseDuration(ride.elapsedTime);
  return elapsedSeconds === null ? null : elapsedSeconds / 3600;
}

function mondayFor(date: Date): Date {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

export function computeDistanceSummary(rides: Ride[], today = new Date()): DistanceSummary {
  const distances = rides
    .map(ride => ride.distance)
    .filter((value): value is number => value !== null && Number.isFinite(value))
    .sort((a, b) => a - b);
  const meanKm = distances.length
    ? distances.reduce((total, value) => total + value, 0) / distances.length
    : null;
  const middle = Math.floor(distances.length / 2);
  const medianKm = distances.length
    ? distances.length % 2
      ? distances[middle]
      : (distances[middle - 1] + distances[middle]) / 2
    : null;

  const frequencies = new Map<number, number>();
  distances.forEach(distance => {
    const rounded = Number(distance.toFixed(1));
    frequencies.set(rounded, (frequencies.get(rounded) ?? 0) + 1);
  });
  const highestFrequency = Math.max(0, ...frequencies.values());
  const modes = [...frequencies.entries()]
    .filter(([, frequency]) => frequency === highestFrequency && frequency > 1)
    .map(([distance]) => distance);
  const modeKm = modes.length === 1 ? modes[0] : null;

  const distanceRides = rides.filter(ride => ride.distance !== null);
  const activeWeeks = new Set<string>();
  const activeMonths = new Set<string>();
  distanceRides.forEach(ride => {
    activeWeeks.add(isoDate(mondayFor(localDateFromISO(ride.date))));
    activeMonths.add(ride.date.slice(0, 7));
  });

  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekAgo = new Date(todayStart);
  weekAgo.setDate(weekAgo.getDate() - 6);
  const lastSevenDaysDistance = rides.reduce((total, ride) => {
    const rideDate = localDateFromISO(ride.date);
    return rideDate >= weekAgo && rideDate <= todayStart
      ? total + (ride.distance ?? 0)
      : total;
  }, 0);

  return {
    meanKm,
    medianKm,
    modeKm,
    weeklyAverageKm: activeWeeks.size ? distances.reduce((a, b) => a + b, 0) / activeWeeks.size : null,
    monthlyAverageKm: activeMonths.size ? distances.reduce((a, b) => a + b, 0) / activeMonths.size : null,
    rolling7DayDailyAverageKm: lastSevenDaysDistance / 7
  };
}

export function computeWeeklyDistances(
  rides: Ride[],
  endDate: Date,
  weekCount = 16
): WeeklyDistance[] {
  const count = Math.max(1, weekCount);
  const lastWeek = mondayFor(endDate);
  const firstWeek = new Date(lastWeek);
  firstWeek.setDate(firstWeek.getDate() - (count - 1) * 7);
  const buckets = new Map<string, { distanceKm: number; rides: number }>();

  for (let index = 0; index < count; index++) {
    const start = new Date(firstWeek);
    start.setDate(start.getDate() + index * 7);
    buckets.set(isoDate(start), { distanceKm: 0, rides: 0 });
  }

  rides.forEach(ride => {
    const weekStart = isoDate(mondayFor(localDateFromISO(ride.date)));
    const bucket = buckets.get(weekStart);
    if (!bucket) return;
    bucket.distanceKm += ride.distance ?? 0;
    bucket.rides += 1;
  });

  return [...buckets.entries()].map(([weekStart, bucket]) => {
    const start = localDateFromISO(weekStart);
    return {
      weekStart,
      label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      distanceKm: bucket.distanceKm,
      rides: bucket.rides
    };
  });
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
    speedCount: 0
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
  });

  return buckets.map(bucket => ({
    month: bucket.month,
    monthName: bucket.monthName,
    rides: bucket.rides,
    distanceKm: bucket.distanceKm,
    elevationM: bucket.elevationM,
    avgSpeed: bucket.speedCount ? bucket.speedSum / bucket.speedCount : null
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
    { min: 0, max: 113, label: "Zone 1 · Recovery", rides: 0, distanceKm: 0 },
    { min: 113, max: 130, label: "Zone 2 · Endurance", rides: 0, distanceKm: 0 },
    { min: 130, max: 147, label: "Zone 3 · Tempo", rides: 0, distanceKm: 0 },
    { min: 147, max: 164, label: "Zone 4 · Threshold", rides: 0, distanceKm: 0 },
    { min: 164, max: 999, label: "Zone 5 · VO₂ max", rides: 0, distanceKm: 0 }
  ];

  rides.forEach(ride => {
    if (ride.hrMean === null) return;
    const index = zones.findIndex(
      zone => ride.hrMean !== null && ride.hrMean >= zone.min && ride.hrMean < zone.max
    );
    if (index < 0) return;
    const zone = zones[index];
    zone.rides += 1;
    zone.distanceKm += ride.distance ?? 0;
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
    const movingValues = window.map(r => r.movingHours);
    metrics.push({
      index,
      distanceKm: cumulativeDistance,
      avgSpeed: avg(speedValues),
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
