import type { FlockCommand, FlockRegistry } from "../../shared/flock.ts";
import { apiFetch } from "./api-request-id.ts";
import { flockRegistryValue } from "../../shared/flock-schema.ts";
import { ApiError, errorFrom } from "./api.ts";

async function registryResponse(response: Response): Promise<FlockRegistry> {
  const value: unknown = await response.json().catch(() => null);
  if (!flockRegistryValue(value)) throw new ApiError("/api/flock", 503, "The work registry format cannot be read by this app. Update Ovis and reload.", "flock_unreadable");
  return value;
}

export async function fetchFlock(): Promise<FlockRegistry> {
  const response = await apiFetch("/api/flock");
  if (!response.ok) throw await errorFrom("/api/flock", response);
  return registryResponse(response);
}
export async function changeFlock(revision: number, command: FlockCommand): Promise<FlockRegistry> {
  const response = await apiFetch("/api/flock", { method: "POST", headers: { "content-type": "application/json", "x-herdr-machine": "1" }, body: JSON.stringify({ revision, command }) });
  if (!response.ok) throw await errorFrom("/api/flock", response);
  return registryResponse(response);
}
