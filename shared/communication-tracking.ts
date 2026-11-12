export const HERDR_SHIM_REVISION = 3;

/** Per-machine installation of optional Herdr CLI observations. */
export interface CommunicationTrackingStatus {
  state: "disabled" | "enabled" | "needs_attention" | "unsupported";
  /** The shell configured for new Herdr panes, when supported. */
  shell: string | null;
  /** Startup files the confirmation explains before any write. */
  profiles: string[];
  /** A setup problem; never shell output or environment contents. */
  detail: string | null;
  can_manage: boolean;
}

/** Confirmation precondition, never paths supplied as write targets. */
export type CommunicationTrackingSetupRequest = Pick<CommunicationTrackingStatus, "shell" | "profiles">;
