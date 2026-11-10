import type { Machine } from "./machines.ts";

/** Manager-owned logical work. Names never establish equality with another record. */
export interface GraphWork { id: string; name: string }
export interface GraphSession { id: string; name: string; work_id: string | null; current_execution_id: string | null }
/** A physical checkout, recorded explicitly on adoption; paths are not logical identities. */
export interface GraphCheckout { id: string; machine_id: string; path: string; repository: string | null; branch: string | null }
/** Only native `id` sessions can be bound. A native transcript path is not an ID. */
export interface GraphBinding { machine_id: string; herdr_lifetime: string; pane_id: string; agent: string; native_session_id: string }
export interface GraphExecution extends GraphBinding { id: string; session_id: string; checkout_id: string | null; created_at: string }
/** Metadata from successful native tool receipts; never a browser-supplied relationship. */
export interface GraphCodexObservation { id: string; kind: "delegation" | "communication"; source_native_session_id: string; target_native_session_id: string; occurred_at: string; source: "codex" }
/** Daemon-owned occupancy, independent of display name, pane location and native-session hints. */
export interface HerdrCoordinationEndpoint { server_id: string; boot_id: string; terminal_id: string; agent_instance_id: string; agent: string; pane_id: string; name: string | null }
export interface HerdrCoordinationReceipt { id: string; kind: "delegation" | "communication"; source: HerdrCoordinationEndpoint; target: HerdrCoordinationEndpoint; occurred_at: string }
export interface HerdrCoordinationPage { version: 1; server_id: string; boot_id: string; agents: HerdrCoordinationEndpoint[]; receipts: HerdrCoordinationReceipt[]; cursor: string | null }
export interface GraphHerdrObservation { id: string; kind: "delegation" | "communication"; source_endpoint: HerdrCoordinationEndpoint; target_endpoint: HerdrCoordinationEndpoint; occurred_at: string; source: "herdr" }
export type GraphObservation = GraphCodexObservation | GraphHerdrObservation;
export type GraphStoredObservation = GraphObservation & { machine_id: string };
/** Only a current bridge proof may associate an occupancy with a native session. Null records machine provenance alone. */
export interface GraphHerdrAssociation { endpoint: HerdrCoordinationEndpoint; machine_id: string; native_session_id: string | null }
export interface GraphRegistry { version: 1; revision: number; works: GraphWork[]; sessions: GraphSession[]; checkouts: GraphCheckout[]; executions: GraphExecution[]; observations?: GraphStoredObservation[]; herdr_associations?: GraphHerdrAssociation[] }
/** Optional verified inventory is response-only; never part of the persistent registry. */
export interface GraphRead extends GraphRegistry { sources?: Machine[] }

export type GraphCommand =
  | { type: "create-work"; name: string }
  | { type: "rename-work"; id: string; name: string }
  | { type: "rename-session"; id: string; name: string; work_id: string | null }
  | { type: "adopt"; binding: GraphBinding; session_id?: string; name?: string; work_id?: string | null; expected_execution_id?: string | null };
