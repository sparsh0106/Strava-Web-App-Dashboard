export type Ride = {
  /** Stable row key for favorites and detail views. */
  id: string;
  /** Neon primary key used for private analysis endpoints. */
  databaseId: string | null;
  /** Source workout duration, when supplied independently of elapsed time. */
  durationSeconds: number | null;
  caloriesKcal: number | null;
  sourceSystem: string | null;
  activityType: string | null;
  title: string | null;
  /** ISO calendar date, normalized from the database record. */
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
};

export type DailyStat = {
  date: string;
  rides: number;
  distanceKm: number;
  elevationM: number;
  avgSpeed: number | null;
  avgHr: number | null;
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
  longestRideKm: number;
};

export type BikeStat = {
  bike: string;
  rides: number;
  distanceKm: number;
  averageDistanceKm: number;
  avgSpeed: number;
  weightedSpeed: number;
  elevationM: number;
  avgHr: number | null;
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
};

export type ProgressiveMetric = {
  index: number;
  distanceKm: number;
  avgSpeed: number | null;
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
  ridesWithDistance: number;
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
  };
};

export type DistanceSummary = {
  meanKm: number | null;
  medianKm: number | null;
  modeKm: number | null;
  weeklyAverageKm: number | null;
  monthlyAverageKm: number | null;
  rolling7DayDailyAverageKm: number;
};

export type WeeklyDistance = {
  weekStart: string;
  label: string;
  distanceKm: number;
  rides: number;
};
