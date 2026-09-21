export type Ride = {
  date: string;
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

// Day-of-week riding pattern (0=Sunday, 1=Monday, ..., 6=Saturday)
export type DayOfWeekPattern = {
  dayIndex: number;
  dayName: string;
  rides: number;
  distanceKm: number;
  avgSpeed: number | null;
};

// Hour-of-day riding pattern (0-23)
export type HourOfDayPattern = {
  hour: number;
  rides: number;
  distanceKm: number;
  avgSpeed: number | null;
};

// Monthly seasonal trend
export type MonthlyTrend = {
  month: number; // 1-12
  monthName: string;
  rides: number;
  distanceKm: number;
  elevationM: number;
  avgSpeed: number | null;
  cfI: number | null;
};

// Speed-elevation profile bin
export type SpeedElevationBin = {
  avgSpeed: number;
  avgElevation: number;
  rideCount: number;
};

// HR zone distribution
export type HRZone = {
  min: number;
  max: number;
  label: string;
  rides: number;
  distanceKm: number;
  avgCFI: number | null;
};

// Progressive metric snapshot
export type ProgressiveMetric = {
  index: number; // ride index
  distanceKm: number;
  avgSpeed: number | null;
  cfI: number | null;
  movingHours: number | null;
};

// Elevation-distance ratio analysis
export type ElevationRatioAnalysis = {
  avgElevationPerKm: number;
  totalElevationM: number;
  totalDistanceKm: number;
  hillinessScore: number; // elevation gain per km
  moderateHillPct: number; // % rides with 5-15 m/km
  steepHillPct: number; // % rides with >15 m/km
};

export type Dataset = {
  rides: Ride[];
  daily: DailyStat[];
  yearly: YearStat[];
  bikes: BikeStat[];
  streaks: Streak[];
  years: number[];
  meta: {
    rides: number;
    ridingDays: number;
    distanceKm: number;
    elevationM: number;
    longestRideKm: number;
    fastestAvgSpeed: number;
    weightedSpeed: number;
    cfi: number;
  };
};