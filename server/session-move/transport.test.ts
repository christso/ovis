import { expect, it } from "bun:test";
import { MoveTransport, MOVE_NODE_PATH, type MoveNodeRequest } from "./transport.ts";
const request: MoveNodeRequest = { operation_id: "019a5a00-0000-7000-8000-000000000001", action: "capabilities", payload: {} };
const local = { id: "local", enabled: true, state: "connected" as const, kind: "local" as const };
const remote = { ...local, id: "configured", kind: "ssh" as const };
const endpoint = { url: "http://127.0.0.1:12345", token: "owned-fixture-token" };
it("uses only the configured authenticated endpoint and a fixed transfer route", async () => {
  const calls: { url: string; options: RequestInit }[] = [];
  const fetcher = (async (url: string, options: RequestInit) => { calls.push({ url, options }); return new Response('{"protocol":1}'); });
  const transport = new MoveTransport({ list: () => [remote], endpoint: () => endpoint }, async () => { throw new Error("not local"); }, fetcher);
  expect(await transport.call("configured", request)).toEqual({ protocol: 1 });
  expect(calls[0]!.url).toBe(endpoint.url + MOVE_NODE_PATH);
  expect(calls[0]!.options.redirect).toBe("error");
  expect(calls[0]!.options.headers).toEqual({ authorization: "Bearer owned-fixture-token", "content-type": "application/json" });
  await expect(transport.call("unconfigured", request)).rejects.toThrow("configured PC");
  expect(calls).toHaveLength(1);
});
it("checks current connectivity on every call and never treats a source URL as a destination", async () => {
  let connected = true, calls = 0;
  const transport = new MoveTransport({ list: () => [{ ...local, enabled: connected }], endpoint: () => undefined }, async () => { calls++; return { owned: true }; });
  expect(await transport.call("local", request)).toEqual({ owned: true });
  connected = false;
  await expect(transport.call("local", request)).rejects.toThrow("connected");
  await expect(transport.call("http://example.invalid", request)).rejects.toThrow("configured PC");
  expect(calls).toBe(1);
});
it("refuses oversized chunks and keeps transport errors and response bodies private", async () => {
  const transport = new MoveTransport({ list: () => [remote], endpoint: () => endpoint }, async () => null,
    (async () => { throw new Error("private diagnostic owned-fixture-token"); }));
  await expect(transport.call("configured", request)).rejects.toThrow("reconcile");
  try { await transport.call("configured", request); } catch (error) { expect(String(error)).not.toContain(endpoint.token); }
  await expect(transport.call("configured", { ...request, payload: { data: "x".repeat(1024 * 1024) } })).rejects.toThrow("request size");
});
it("requires the installed remote capability rather than updating the machine", async () => {
  const transport = new MoveTransport({ list: () => [remote], endpoint: () => endpoint }, async () => null,
    (async () => new Response("owned-fixture-token", { status: 404 })));
  await expect(transport.call("configured", request)).rejects.toMatchObject({ code: "move_unsupported" });
});

it("preserves actionable unsupported-scope codes while replacing remote diagnostics with fixed text", async () => {
  for (const code of ["unsupported_checkout", "unsupported_runtime", "unsupported_filesystem", "artifact_path_conflict", "unsupported_history_index", "source_store_unknown"]) {
    const transport = new MoveTransport({ list: () => [remote], endpoint: () => endpoint }, async () => null,
      async () => Response.json({ error: { code, message: `private native output ${endpoint.token}` } }, { status: 409 }));
    try { await transport.call("configured", request); throw new Error("Expected owned refusal"); }
    catch (error) { expect(error).toMatchObject({ code }); expect(String(error)).not.toContain(endpoint.token); expect(String(error)).not.toContain("private native output"); }
  }
});
