/** Planned transfer receipts. Logical sessions and executions remain owned by shared/flock.ts. */
export interface SessionMoveRequest {
  session_id: string;
  source_execution_id: string;
  destination_machine_id: string;
  destination_checkout: string;
  untracked_files: string[];
}
export type SessionMovePhase = "preview" | "quiescing" | "snapshotting" | "snapshotted" | "restoring" | "restored" | "launching" | "verifying" | "binding" | "complete" | "cancelled";
export interface SessionMovePlan {
  request: SessionMoveRequest;
  operation_id?: string;
  snapshot_fingerprint?: string;
  source_machine_id: string;
  native_thread_id: string;
  source_checkout: string;
  files: { path: string; bytes: number; kind: "tracked" | "untracked" | "codex" }[];
  exclusions: string[];
  untracked_candidates?: string[];
  required_untracked?: string[];
  fingerprint: string;
}
export interface SessionMoveSnapshot { id: string; sha256: string }
export interface SessionMoveDestination {
  machine_id: string;
  herdr_lifetime: string;
  pane_id: string;
  native_session_id: string;
  checkout: string;
  history_sha256: string;
}
export interface SessionMoveRecord {
  id: string;
  phase: SessionMovePhase;
  plan: SessionMovePlan;
  snapshot: SessionMoveSnapshot | null;
  destination: SessionMoveDestination | null;
  /** A stable public code. Never raw transport errors, credentials or conversation text. */
  error: string | null;
}

export interface SessionMoveState { record: SessionMoveRecord; running: boolean }
