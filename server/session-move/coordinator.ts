import type { SessionMovePlan, SessionMoveRequest } from "../../shared/session-move.ts";
import type { FlockExecution } from "../../shared/flock.ts";
import { sameFlockBinding } from "../../shared/flock-inventory.ts";
import type { SessionSnapshot } from "../../shared/protocol.ts";
import type { MachineManager } from "../machines.ts";
import type { FlockStore } from "../flock.ts";
import { readFlockSource } from "../flock-source.ts";
import { codexCompatibility, type CodexMoveRuntime } from "./codex.ts";
import { digest, MoveRefused } from "./files.ts";
import { MoveJournal } from "./journal.ts";
import { SessionMoves, type MovePorts } from "./move.ts";
import { MoveNode, type TransferBundle } from "./node.ts";
import { operationId } from "./spool.ts";
import { MOVE_CHUNK_BYTES, MoveTransport } from "./transport.ts";

export class MoveCoordinator {
  readonly moves: SessionMoves;
  private readonly transport: MoveTransport;
  constructor(stateDir: string, private readonly flock: FlockStore, private readonly machines: MachineManager, private readonly localSnapshot: () => Promise<SessionSnapshot>, readonly node: MoveNode, private readonly codexHome?: string) {
    this.transport = new MoveTransport(machines, (request) => node.call(request));
    this.moves = new SessionMoves(new MoveJournal(stateDir), this.ports());
  }
  private source(request: SessionMoveRequest): FlockExecution {
    const registry = this.flock.read(), session = registry.sessions.find((item) => item.id === request.session_id);
    const execution = registry.executions.find((item) => item.id === request.source_execution_id && item.session_id === session?.id);
    if (!session || !execution || session.current_execution_id !== execution.id || execution.agent !== "codex") throw new MoveRefused("source_changed", "The logical session no longer selects this Codex execution");
    if (!registry.checkouts.some((checkout) => checkout.id === execution.checkout_id)) throw new MoveRefused("source_checkout_unknown", "The source execution has no recorded checkout");
    if (request.destination_machine_id === execution.machine_id) throw new MoveRefused("destination_conflict", "Choose a different configured PC");
    return execution;
  }
  private call(machine: string, id: string, action: Parameters<MoveNode["call"]>[0]["action"], payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.transport.call(machine, { operation_id: operationId(id), action, payload });
  }
  private async bundle(plan: SessionMovePlan): Promise<TransferBundle> {
    const execution = this.source(plan.request);
    const bundle = await this.call(execution.machine_id, operationId(plan.operation_id), "source", { pane_id: execution.pane_id, thread_id: execution.native_session_id, lifetime: execution.herdr_lifetime, untracked_files: plan.request.untracked_files, current: true }) as TransferBundle;
    if (bundle.fingerprint !== plan.snapshot_fingerprint) throw new MoveRefused("source_changed", "The source snapshot differs from the confirmed preview; refresh it");
    return bundle;
  }
  private ports(): MovePorts {
    return {
      preview: async (request, id) => {
        const source = this.source(request);
        const bundle = await this.call(source.machine_id, id, "source", { pane_id: source.pane_id, thread_id: source.native_session_id, lifetime: source.herdr_lifetime, untracked_files: request.untracked_files }) as TransferBundle;
        const capabilities = await Promise.all([this.call(source.machine_id, id, "capabilities"), this.call(request.destination_machine_id, id, "capabilities")]);
        codexCompatibility(capabilities[0] as CodexMoveRuntime, capabilities[1] as CodexMoveRuntime);
        const checkout = this.flock.read().checkouts.find((item) => item.id === source.checkout_id)!;
        if (checkout.path !== bundle.codex.cwd) throw new MoveRefused("source_changed", "The native session checkout differs from its recorded execution");
        await this.call(request.destination_machine_id, id, "destination", { checkout: request.destination_checkout, bundle });
        const fingerprint = digest(Buffer.from(JSON.stringify({ operation: id, request, source, snapshot: bundle.fingerprint })));
        return { operation_id: id, snapshot_fingerprint: bundle.fingerprint, request, source_machine_id: source.machine_id, native_thread_id: source.native_session_id, source_checkout: bundle.codex.cwd,
          files: bundle.files.map((file) => ({ path: file.path, bytes: file.bytes, kind: file.path.startsWith("codex/") || file.path === "history-index.json" ? "codex" as const : file.path.startsWith("untracked/") ? "untracked" as const : "tracked" as const })),
          exclusions: ["Credentials, native configuration, hooks and Git remotes", "Unselected and ignored untracked files", "Full referenced native files can include discarded history beyond a fork or revert"],
          untracked_candidates: bundle.untracked_candidates, fingerprint };
      },
      preflight: async (plan) => {
        const execution = this.source(plan.request), id = operationId(plan.operation_id);
        const sources = await readFlockSource(this.machines, execution.machine_id, this.localSnapshot, this.codexHome);
        if (sources[0]?.snapshot?.herdr_lifetime !== execution.herdr_lifetime) throw new MoveRefused("source_changed", "The source herdr lifetime changed");
        const capabilities = await Promise.all([this.call(execution.machine_id, id, "capabilities"), this.call(plan.request.destination_machine_id, id, "capabilities")]);
        codexCompatibility(capabilities[0] as CodexMoveRuntime, capabilities[1] as CodexMoveRuntime);
        await this.call(plan.request.destination_machine_id, id, "destination", { checkout: plan.request.destination_checkout, bundle: await this.bundle(plan) });
      },
      quiesce: async (plan) => {
        const id = operationId(plan.operation_id);
        await this.call(plan.source_machine_id, id, "hold", { capture: true, expected: plan.snapshot_fingerprint });
        return { thread_id: plan.native_thread_id,
          assertHeld: async () => { await this.call(plan.source_machine_id, id, "hold"); },
          release: async () => { try { await this.call(plan.source_machine_id, id, "release"); } catch { /* source bridge retains the lock; reconnect/cancel can release it safely */ } } };
      },
      snapshot: async (id, plan) => { const bundle = await this.call(plan.source_machine_id, id, "snapshot", { expected: plan.snapshot_fingerprint }) as TransferBundle; return { id, sha256: bundle.history }; },
      restore: async (id, plan) => {
        const bundle = await this.call(plan.source_machine_id, id, "snapshot", { expected: plan.snapshot_fingerprint }) as TransferBundle;
        const prepared = await this.call(plan.request.destination_machine_id, id, "prepare", { checkout: plan.request.destination_checkout, bundle }) as { offsets: number[] };
        if (!Array.isArray(prepared.offsets) || prepared.offsets.length !== bundle.files.length) throw new MoveRefused("invalid_chunk_receipt", "Destination transfer offsets are invalid");
        for (const [index, file] of bundle.files.entries()) {
          let offset = prepared.offsets[index]!;
          if (!Number.isSafeInteger(offset) || offset < 0 || offset > file.bytes) throw new MoveRefused("invalid_chunk_receipt", "Destination transfer offset is invalid");
          if (file.bytes === 0) await this.call(plan.request.destination_machine_id, id, "write-chunk", { index, offset: 0, data: "" });
          while (offset < file.bytes) {
            const chunk = await this.call(plan.source_machine_id, id, "read-chunk", { index, offset }) as { data: string };
            if (typeof chunk.data !== "string" || Buffer.from(chunk.data, "base64").length !== Math.min(MOVE_CHUNK_BYTES, file.bytes - offset)) throw new MoveRefused("invalid_chunk", "Source transfer chunk is incomplete");
            const received = await this.call(plan.request.destination_machine_id, id, "write-chunk", { index, offset, data: chunk.data }) as { offset: number };
            const expected = offset + Buffer.from(chunk.data, "base64").length;
            if (received.offset !== expected) throw new MoveRefused("invalid_chunk_receipt", "Destination did not acknowledge the transferred chunk");
            offset = received.offset;
          }
        }
        await this.call(plan.request.destination_machine_id, id, "restore");
      },
      launch: async (id, plan) => { await this.call(plan.request.destination_machine_id, id, "launch"); },
      inspect: async (id, plan) => {
        const deadline = Date.now() + 20_000;
        while (true) {
          const result = await this.call(plan.request.destination_machine_id, id, "verify", { machine_id: plan.request.destination_machine_id }) as Awaited<ReturnType<MovePorts["inspect"]>>;
          if (result.state !== "pending" || Date.now() >= deadline) return result;
          await Bun.sleep(100);
        }
      },
      bind: async (_id, plan, destination) => {
        const registry = this.flock.read(), session = registry.sessions.find((item) => item.id === plan.request.session_id);
        const binding = { machine_id: destination.machine_id, herdr_lifetime: destination.herdr_lifetime, pane_id: destination.pane_id, agent: "codex", native_session_id: destination.native_session_id };
        const current = registry.executions.find((execution) => execution.id === session?.current_execution_id);
        if (current && sameFlockBinding(current, binding)) return;
        if (session?.current_execution_id !== plan.request.source_execution_id) throw new MoveRefused("source_changed", "The logical session changed while its move was being verified");
        const sources = await readFlockSource(this.machines, destination.machine_id, this.localSnapshot, this.codexHome);
        this.flock.change(registry.revision, { type: "adopt", binding, session_id: plan.request.session_id, expected_execution_id: plan.request.source_execution_id }, sources);
      },
    };
  }
  async cancel(id: string) {
    const prior = this.moves.list().find((item) => item.id === id);
    const result = this.moves.cancel(id);
    if (prior) await this.call(prior.plan.source_machine_id, id, "release");
    return result;
  }
}
