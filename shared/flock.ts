import type { Machine } from "./machines.ts";

/** Manager-owned logical work. Names never establish equality with another record. */
export interface FlockWork { id: string; name: string }
export interface FlockSession { id: string; name: string; work_id: string | null; current_execution_id: string | null }
/** A physical checkout, recorded explicitly on adoption; paths are not logical identities. */
export interface FlockCheckout { id: string; machine_id: string; path: string; repository: string | null; branch: string | null }
/** Only native `id` sessions can be bound. A native transcript path is not an ID. */
export interface FlockBinding { machine_id: string; herdr_lifetime: string; pane_id: string; agent: string; native_session_id: string }
export interface FlockExecution extends FlockBinding { id: string; session_id: string; checkout_id: string | null; created_at: string }
/** Metadata from successful native tool receipts; never a browser-supplied relationship. */
export interface FlockObservation { id: string; kind: "delegation" | "communication"; source_native_session_id: string; target_native_session_id: string; occurred_at: string; source: "codex" }
export interface FlockStoredObservation extends FlockObservation { machine_id: string }
export interface FlockRegistry { version: 1; revision: number; works: FlockWork[]; sessions: FlockSession[]; checkouts: FlockCheckout[]; executions: FlockExecution[]; observations?: FlockStoredObservation[] }
/** Optional verified inventory is response-only; never part of the persistent registry. */
export interface FlockRead extends FlockRegistry { sources?: Machine[] }

export type FlockCommand =
  | { type: "create-work"; name: string }
  | { type: "rename-work"; id: string; name: string }
  | { type: "rename-session"; id: string; name: string; work_id: string | null }
  | { type: "adopt"; binding: FlockBinding; session_id?: string; name?: string; work_id?: string | null; expected_execution_id?: string | null };
