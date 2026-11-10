import type { GraphBinding, GraphCheckout, GraphExecution, GraphRegistry, GraphSession, GraphWork, HerdrCoordinationEndpoint } from "./graph-registry.ts";
import { graphCurrentHerdrEndpoint } from "./graph-relationships.ts";
import type { Machine, PaneTarget } from "./machines.ts";
import type { HerdrPane } from "./protocol.ts";

export interface GraphRegistryRow {
  id: string;
  session: GraphSession | null;
  work: GraphWork | null;
  execution: GraphExecution | null;
  checkout: GraphCheckout | null;
  binding: GraphBinding | null;
  machine_id: string;
  machine_name: string;
  pane: HerdrPane | null;
  name: string;
  availability: "live" | "disconnected" | "unavailable" | "unsupported";
  status: string;
  herdr_endpoint?: HerdrCoordinationEndpoint | null;
}

export function graphBinding(machine: Machine, pane: HerdrPane): GraphBinding | null {
  if (!machine.snapshot?.herdr_lifetime || !pane.agent || pane.restore_error) return null;
  const proofs = machine.snapshot.flock_bindings?.filter((proof) => proof.pane_id === pane.pane_id && proof.terminal_id === pane.terminal_id && proof.agent === pane.agent);
  if (proofs?.length !== 1 || !proofs[0]!.native_session_id) return null;
  return { machine_id: machine.id, herdr_lifetime: machine.snapshot.herdr_lifetime, pane_id: pane.pane_id, agent: pane.agent, native_session_id: proofs[0]!.native_session_id };
}

export function sameGraphBinding(a: GraphBinding, b: GraphBinding): boolean {
  return a.machine_id === b.machine_id && a.herdr_lifetime === b.herdr_lifetime && a.pane_id === b.pane_id && a.agent === b.agent && a.native_session_id === b.native_session_id;
}

/** Roster metadata only: no filesystem discovery or inference about shared repositories. */
export function graphCheckout(machine: Machine, pane: HerdrPane): Omit<GraphCheckout, "id"> | null {
  const workspace = machine.snapshot?.workspaces.find((item) => item.workspace_id === pane.workspace_id);
  const path = workspace?.worktree?.checkout_path ?? pane.cwd;
  if (!path) return null;
  const branch = workspace?.tokens?.["branch"] ?? pane.tokens?.["branch"];
  return { machine_id: machine.id, path, repository: workspace?.worktree?.repo_root ?? null, branch: typeof branch === "string" && branch ? branch : null };
}

const paneName = (pane: HerdrPane): string => pane.label || pane.title || pane.terminal_title_stripped || pane.agent || pane.pane_id;

/** The one shared inventory for Table, Graph and intentional moves. Cached sources never authorize a target. */
export function graphRegistryInventory(registry: GraphRegistry, machines: readonly Machine[]): GraphRegistryRow[] {
  const rows: GraphRegistryRow[] = [];
  const represented = new Set<string>();
  for (const execution of registry.executions) {
    const session = registry.sessions.find((item) => item.id === execution.session_id)!;
    const machine = machines.find((item) => item.id === execution.machine_id);
    const pane = machine?.snapshot?.panes.find((item) => item.pane_id === execution.pane_id) ?? null;
    const binding = pane && machine ? graphBinding(machine, pane) : null;
    const matches = binding !== null && sameGraphBinding(execution, binding);
    const availability = !machine ? "unavailable" : machine.state !== "connected" ? "disconnected" : matches ? "live" : "unavailable";
    if (matches) represented.add(JSON.stringify([machine!.id, pane!.pane_id]));
    rows.push({ id: execution.id, session, work: registry.works.find((item) => item.id === session.work_id) ?? null, execution,
      checkout: registry.checkouts.find((item) => item.id === execution.checkout_id) ?? null, binding: execution,
      machine_id: execution.machine_id, machine_name: machine?.name ?? execution.machine_id, pane: matches ? pane : null,
      name: session.name, availability, status: availability === "live" ? pane!.agent_status : availability,
      herdr_endpoint: matches && pane && machine ? graphCurrentHerdrEndpoint(machine, pane) : null });
  }
  for (const machine of machines) {
    for (const pane of machine.snapshot?.panes ?? []) {
      if (!pane.agent || represented.has(JSON.stringify([machine.id, pane.pane_id]))) continue;
      const binding = graphBinding(machine, pane);
      const availability = machine.state !== "connected" ? "disconnected" : binding ? "live" : "unsupported";
      const checkout = graphCheckout(machine, pane);
      rows.push({ id: `pane:${JSON.stringify([machine.id, machine.snapshot?.herdr_lifetime ?? null, pane.pane_id])}`, session: null, work: null, execution: null,
        checkout: checkout ? { ...checkout, id: `pane:${JSON.stringify([machine.id, pane.pane_id])}` } : null, binding,
        machine_id: machine.id, machine_name: machine.name, pane, name: paneName(pane), availability, status: availability === "live" ? pane.agent_status : availability,
        herdr_endpoint: graphCurrentHerdrEndpoint(machine, pane) });
    }
  }
  for (const session of registry.sessions) {
    if (registry.executions.some((item) => item.session_id === session.id)) continue;
    rows.push({ id: session.id, session, work: registry.works.find((item) => item.id === session.work_id) ?? null, execution: null, checkout: null, binding: null,
      machine_id: "", machine_name: "", pane: null, name: session.name, availability: "unavailable", status: "unavailable" });
  }
  return rows;
}

export function graphRowTarget(row: GraphRegistryRow): PaneTarget | null {
  return row.availability === "live" && row.binding !== null ? { machine_id: row.binding.machine_id, pane_id: row.binding.pane_id } : graphHerdrRowTarget(row);
}

/** A native session is needed for adoption/moving; opening a current Herdr occupant needs only its exact location proof. */
export function graphHerdrRowTarget(row: GraphRegistryRow): PaneTarget | null {
  const endpoint = row.herdr_endpoint, pane = row.pane;
  if ((row.availability !== "live" && row.availability !== "unsupported") || !endpoint || !pane || pane.restore_error || !row.machine_id) return null;
  return endpoint.terminal_id === pane.terminal_id && endpoint.pane_id === pane.pane_id && endpoint.agent === pane.agent
    ? { machine_id: row.machine_id, pane_id: pane.pane_id } : null;
}
