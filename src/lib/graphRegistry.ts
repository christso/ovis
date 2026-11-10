import type { GraphCommand, GraphRead, GraphRegistry } from "../../shared/graph-registry.ts";
import { apiFetch } from "./api-request-id.ts";
import { graphRegistryValue } from "../../shared/graph-registry-schema.ts";
import { ApiError, errorFrom } from "./api.ts";

async function registryResponse(response: Response): Promise<GraphRegistry> {
  const value: unknown = await response.json().catch(() => null);
  if (!graphRegistryValue(value)) throw new ApiError("/api/flock", 503, "The work registry format cannot be read by this app. Update Ovis and reload.", "flock_unreadable");
  return value;
}

export async function fetchGraph(): Promise<GraphRead> {
  const response = await apiFetch("/api/flock?sources=1");
  if (!response.ok) throw await errorFrom("/api/flock", response);
  return registryResponse(response);
}
export async function changeGraph(revision: number, command: GraphCommand): Promise<GraphRegistry> {
  const response = await apiFetch("/api/flock", { method: "POST", headers: { "content-type": "application/json", "x-herdr-machine": "1" }, body: JSON.stringify({ revision, command }) });
  if (!response.ok) throw await errorFrom("/api/flock", response);
  return registryResponse(response);
}
