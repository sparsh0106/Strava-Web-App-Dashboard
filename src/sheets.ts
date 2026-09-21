import { buildDataset, normalizeRows } from "./analytics";
import type { Dataset } from "./types";

type AuthStatus = {
  connected: boolean;
  email?: string;
};

export async function getAuthStatus(): Promise<AuthStatus> {
  const res = await fetch("/api/auth/status", { credentials: "include" });
  if (!res.ok) throw new Error(`Auth status failed: ${res.status}`);
  return res.json();
}

export async function fetchDataset(): Promise<Dataset> {
  const res = await fetch("/api/rides", { credentials: "include" });
  if (res.status === 401) throw new Error("NOT_CONNECTED");
  if (!res.ok) {
    const body = await res.text();
    throw new Error(body || `Data request failed: ${res.status}`);
  }
  const payload: { values: string[][] } = await res.json();
  const rides = normalizeRows(payload.values);
  return buildDataset(rides);
}

export function connectGoogle(): void {
  window.location.href = "/auth/google";
}

export async function logoutGoogle(): Promise<void> {
  await fetch("/logout", { method: "POST", credentials: "include" });
}
