import type { FlockBinding, FlockCheckout, FlockExecution, FlockRegistry, FlockSession, FlockWork } from "./flock.ts";
import type { Machine, PaneTarget } from "./machines.ts";
import type { HerdrPane } from "./protocol.ts";

export interface FlockRow {
  id: string;
  session: FlockSession | null;
  work: FlockWork | null;
  execution: FlockExecution | null;
  checkout: FlockCheckout | null;
  binding: FlockBinding | null;
  machine_id: string;
  machine_name: string;
  pane: HerdrPane | null;
  name: string;
  availability: "live" | "disconnected" | "unavailable" | "unsupported";
  status: string;
}

export function flockBinding(machine: Machine, pane: HerdrPane): FlockBinding | null {
  const session = pane.agent_session;
  if (!machine.snapshot?.herdr_lifetime || !pane.agent || !session?.value || session.kind !== "id" || session.agent !== pane.agent || pane.restore_error) return null;
  return { machine_id: machine.id, herdr_lifetime: machine.snapshot.herdr_lifetime, pane_id: pane.pane_id, agent: pane.agent, native_session_id: session.value };
}

export function sameFlockBinding(a: FlockBinding, b: FlockBinding): boolean {
  return a.machine_id === b.machine_id && a.herdr_lifetime === b.herdr_lifetime && a.pane_id === b.pane_id && a.agent === b.agent && a.native_session_id === b.native_session_id;
}

/** Roster metadata only: no filesystem discovery or inference about shared repositories. */
export function flockCheckout(machine: Machine, pane: HerdrPane): Omit<FlockCheckout, "id"> | null {
  const workspace = machine.snapshot?.workspaces.find((item) => item.workspace_id === pane.workspace_id);
  const path = workspace?.worktree?.checkout_path ?? pane.cwd;
  if (!path) return null;
  const branch = workspace?.tokens?.["branch"] ?? pane.tokens?.["branch"];
  return { machine_id: machine.id, path, repository: workspace?.worktree?.repo_root ?? null, branch: typeof branch === "string" && branch ? branch : null };
}

const paneName = (pane: HerdrPane): string => pane.label || pane.title || pane.terminal_title_stripped || pane.agent || pane.pane_id;

/** The one shared inventory for Table, Graph and intentional moves. Cached sources never authorize a target. */
export function flockInventory(registry: FlockRegistry, machines: readonly Machine[]): FlockRow[] {
  const rows: FlockRow[] = [];
  const represented = new Set<string>();
  for (const execution of registry.executions) {
    const session = registry.sessions.find((item) => item.id === execution.session_id)!;
    const machine = machines.find((item) => item.id === execution.machine_id);
    const pane = machine?.snapshot?.panes.find((item) => item.pane_id === execution.pane_id) ?? null;
    const binding = pane && machine ? flockBinding(machine, pane) : null;
    const matches = binding !== null && sameFlockBinding(execution, binding);
    const availability = !machine ? "unavailable" : machine.state !== "connected" ? "disconnected" : matches ? "live" : "unavailable";
    if (matches) represented.add(JSON.stringify([machine!.id, pane!.pane_id]));
    rows.push({ id: execution.id, session, work: registry.works.find((item) => item.id === session.work_id) ?? null, execution,
      checkout: registry.checkouts.find((item) => item.id === execution.checkout_id) ?? null, binding: execution,
      machine_id: execution.machine_id, machine_name: machine?.name ?? execution.machine_id, pane: matches ? pane : null,
      name: session.name, availability, status: availability === "live" ? pane!.agent_status : availability });
  }
  for (const machine of machines) {
    for (const pane of machine.snapshot?.panes ?? []) {
      if (!pane.agent || represented.has(JSON.stringify([machine.id, pane.pane_id]))) continue;
      const binding = flockBinding(machine, pane);
      const availability = machine.state !== "connected" ? "disconnected" : binding ? "live" : "unsupported";
      const checkout = flockCheckout(machine, pane);
      rows.push({ id: `pane:${JSON.stringify([machine.id, machine.snapshot?.herdr_lifetime ?? null, pane.pane_id])}`, session: null, work: null, execution: null,
        checkout: checkout ? { ...checkout, id: `pane:${JSON.stringify([machine.id, pane.pane_id])}` } : null, binding,
        machine_id: machine.id, machine_name: machine.name, pane, name: paneName(pane), availability, status: availability === "live" ? pane.agent_status : availability });
    }
  }
  for (const session of registry.sessions) {
    if (registry.executions.some((item) => item.session_id === session.id)) continue;
    rows.push({ id: session.id, session, work: registry.works.find((item) => item.id === session.work_id) ?? null, execution: null, checkout: null, binding: null,
      machine_id: "", machine_name: "", pane: null, name: session.name, availability: "unavailable", status: "unavailable" });
  }
  return rows;
}

export function flockTarget(row: FlockRow): PaneTarget | null {
  return row.availability === "live" && row.binding !== null ? { machine_id: row.binding.machine_id, pane_id: row.binding.pane_id } : null;
}
