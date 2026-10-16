import { buildDataset, normalizeRows } from "./analytics";
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
  const payload: { values: string[][]; syncedAt?: string } = await res.json();
  return {
    dataset: buildDataset(normalizeRows(payload.values ?? [])),
    syncedAt: payload.syncedAt ?? null
  };
}
