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