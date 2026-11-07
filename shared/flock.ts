/** Manager-owned logical work. Names never establish equality with another record. */
export interface FlockWork { id: string; name: string }
export interface FlockSession { id: string; name: string; work_id: string | null; current_execution_id: string | null }
/** A physical checkout, recorded explicitly on adoption; paths are not logical identities. */
export interface FlockCheckout { id: string; machine_id: string; path: string; repository: string | null; branch: string | null }
/** Only native `id` sessions can be bound. A native transcript path is not an ID. */
export interface FlockBinding { machine_id: string; herdr_lifetime: string; pane_id: string; agent: string; native_session_id: string }
export interface FlockExecution extends FlockBinding { id: string; session_id: string; checkout_id: string | null; created_at: string }
export interface FlockRegistry { version: 1; revision: number; works: FlockWork[]; sessions: FlockSession[]; checkouts: FlockCheckout[]; executions: FlockExecution[] }

export type FlockCommand =
  | { type: "create-work"; name: string }
  | { type: "rename-work"; id: string; name: string }
  | { type: "rename-session"; id: string; name: string; work_id: string | null }
  | { type: "adopt"; binding: FlockBinding; session_id?: string; name?: string; work_id?: string | null; expected_execution_id?: string | null };
