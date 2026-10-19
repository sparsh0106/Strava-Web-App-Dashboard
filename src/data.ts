import { buildDataset, normalizeRows, type RideMetadata } from "./analytics";
import type { Dataset } from "./types";

export type DatasetResult = {
  dataset: Dataset;
  syncedAt: string | null;
};

export async function fetchDataset(): Promise<DatasetResult> {
  const res = await fetch("/api/rides");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Data request failed: ${res.status}`);
  }
  const payload: { values: string[][]; rides?: RideMetadata[]; syncedAt?: string } = await res.json();
  return {
    dataset: buildDataset(normalizeRows(payload.values ?? [], payload.rides ?? [])),
    syncedAt: payload.syncedAt ?? null
  };
}
