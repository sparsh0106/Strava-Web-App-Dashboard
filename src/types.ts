export type Ride = {
  /** Stable row key for favorites and detail views. */
  id: string;
  /** ISO calendar date, normalized from the Sheet. */
  date: string;
  /** Optional local clock time when the source row contains one. */
  startTime: string | null;
  elapsedTime: string;
  movingTime: string;
  distance: number | null;
  elevation: number | null;
  avgSpeed: number | null;
  maxSpeed: number | null;
  device: string | null;
  hrMax: number | null;
  hrMean: number | null;
  bike: string;
  year: number;
  month: number;
  movingHours: number | null;
  cfi?: number | null;
};

export type DailyStat = {
  date: string;
  rides: number;
  distanceKm: number;
  elevationM: number;
  avgSpeed: number | null;
  avgHr: number | null;
  cfi: number | null;
};

export type YearStat = {
  year: number;
  rides: number;
  distanceKm: number;
  elevationM: number;
  avgSpeed: number;
  weightedSpeed: number;
  movingTimeH: number;
  avgHr: number | null;
  cfi: number;
  longestRideKm: number;
};

export type BikeStat = {
  bike: string;
  rides: number;
  distanceKm: number;
  avgSpeed: number;
  weightedSpeed: number;
  elevationM: number;
  avgHr: number | null;
  cfi: number;
  longestRideKm: number;
};

export type Streak = {
  start: string;
  end: string;
  days: number;
  rides: number;
  distanceKm: number;
  elevationM: number;
  avgSpeed: number;
};

export type DayOfWeekPattern = {
  dayIndex: number;
  dayName: string;
  rides: number;
  distanceKm: number;
  avgSpeed: number | null;
};

export type HourOfDayPattern = {
  hour: number;
  rides: number;
  distanceKm: number;
  avgSpeed: number | null;
};

export type MonthlyTrend = {
  month: number;
  monthName: string;
  rides: number;
  distanceKm: number;
  elevationM: number;
  avgSpeed: number | null;
  cfI: number | null;
};

export type SpeedElevationBin = {
  avgSpeed: number;
  avgElevation: number;
  rideCount: number;
};

export type HRZone = {
  min: number;
  max: number;
  label: string;
  rides: number;
  distanceKm: number;
  avgCFI: number | null;
};

export type ProgressiveMetric = {
  index: number;
  distanceKm: number;
  avgSpeed: number | null;
  cfI: number | null;
  movingHours: number | null;
};

export type ElevationRatioAnalysis = {
  avgElevationPerKm: number;
  totalElevationM: number;
  totalDistanceKm: number;
  hillinessScore: number;
  moderateHillPct: number;
  steepHillPct: number;
};

export type DataQuality = {
  totalRides: number;
  completeRides: number;
  missing: {
    distance: number;
    elevation: number;
    avgSpeed: number;
    hrMean: number;
    movingTime: number;
    startTime: number;
  };
};

export type Dataset = {
  rides: Ride[];
  daily: DailyStat[];
  yearly: YearStat[];
  bikes: BikeStat[];
  streaks: Streak[];
  years: number[];
  dataQuality: DataQuality;
  meta: {
    rides: number;
    ridingDays: number;
    distanceKm: number;
    elevationM: number;
    movingTimeH: number;
    longestRideKm: number;
    fastestAvgSpeed: number;
    weightedSpeed: number;
    cfi: number;
  };
};
