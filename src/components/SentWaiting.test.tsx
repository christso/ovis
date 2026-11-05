import { afterEach, beforeEach, describe, expect, jest, setSystemTime, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { SettingsProvider } from "../lib/settings.ts";
import { currentWaitingSends, forgetWaitingSends, rememberWaitingSend, settleWaitingSends, WAITING_HINT_MS, waitingBaseline, waitingKey, type WaitingSend } from "../lib/sentWaiting.ts";
import { SentWaitingList, useWaitingSends } from "./SentWaiting.tsx";

const at = Date.parse("2026-10-29T03:00:00Z");
const send: WaitingSend = { id: 1, pane: "local:p1", text: "fix the flaky test", at, after: { keys: new Set(), latest: null, takenAt: at - 100 } };

function withEnglish<T>(run: () => T): T {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  try { return run(); } finally {
    if (saved) Object.defineProperty(navigator, "languages", saved);
    else Reflect.deleteProperty(navigator, "languages");
  }
}

function render(now: number, sends: readonly WaitingSend[] = [send]): string {
  setSystemTime(new Date(now));
  return withEnglish(() => renderToStaticMarkup(createElement(SettingsProvider, { children: createElement(SentWaitingList, { sends }) })));
}
const textWithoutTags = (markup: string): string => markup.replace(/<[^>]*>/gu, "");

afterEach(() => { setSystemTime(); });

describe("SentWaitingList", () => {
  test("keeps a first-read clock discrepancy as compact sent status, without a second full bubble", () => {
    const key = waitingKey("local", "first-read-clock");
    const text = "fix the flaky test";
    const turn = { role: "user" as const, ts: new Date(at + 422).toISOString(), parts: [{ kind: "text" as const, text }] };
    try {
      // The browser submits before its initial conversation read answers, two seconds ahead of
      // the source clock. The real turn and answer arrive, but cannot safely identify this send.
      rememberWaitingSend(key, text, at + 2_000, waitingBaseline(key));
      settleWaitingSends(key, [turn, { ...turn, role: "assistant", parts: [{ kind: "text", text: "done" }] }], at + 3_000, true);
      const waiting = currentWaitingSends(key);
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.after).toBeNull();
      const markup = render(at + 3_000, waiting);
      expect(markup).not.toContain("chat-turn-waiting");
      expect(markup).not.toContain("chat-bubble");
      expect(markup).toContain("<summary>");
      expect(markup).toContain("Sent · waiting for transcript");
      expect(markup).toContain(text);
      expect(markup).not.toContain("<details open");
    } finally { forgetWaitingSends(key); }
  });

  test("keeps each unread send's full text recoverable beside a loaded-baseline send's bubble", () => {
    const first: WaitingSend = { ...send, id: 2, after: null, text: "first\n".repeat(30) };
    const second: WaitingSend = { ...send, id: 3, after: null, text: "second" };
    const markup = render(at, [first, second, send]);
    expect(markup.match(/<details\b/gu)).toHaveLength(2);
    expect(markup.match(/class="chat-turn chat-turn-user chat-turn-waiting"/gu)).toHaveLength(1);
    expect(markup).toContain(first.text);
    expect(markup).toContain(second.text);
  });

  test("shows only the sent words, with no caption, while the agent is about to take them", () => {
    for (const now of [at, at + WAITING_HINT_MS - 1]) {
      const markup = render(now);
      expect(textWithoutTags(markup)).toBe(send.text);
      expect(markup).not.toContain("chat-sent-late");
    }
  });

  test("adds a clock beside the bubble once the turn is late, still with no caption", () => {
    const markup = render(at + WAITING_HINT_MS);
    expect(markup).toContain("chat-sent-late");
    expect(textWithoutTags(markup)).toBe(send.text);
  });

  test("shows a long message whole, capped at the lines its turn's card shows, so the turn takes its place at its height", () => {
    const long: WaitingSend = { ...send, id: 2, text: Array.from({ length: 20 }, (_, index) => `Step ${index + 1}: run the flaky test again and keep its log`).join("\n") };
    const markup = render(at, [long, send]);
    expect(textWithoutTags(markup)).toBe(long.text + send.text);
    expect(markup.match(/class="chat-bubble(?: [^"]*)?"/gu)).toEqual(['class="chat-bubble is-capped"', 'class="chat-bubble"']);
  });

  test("is no live region of its own: the chat footer's one status region stays the only one", () => {
    for (const after of [send.after, null]) {
      expect(render(at + WAITING_HINT_MS, [{ ...send, after }])).not.toMatch(/role="(?:status|alert|log)"|aria-live/u);
    }
  });
});

describe("mounted", () => {
  let renderers: ReactTestRenderer[];
  const globals = ["IS_REACT_ACT_ENVIRONMENT", "window", "document", "getComputedStyle"];
  const saved = new Map<string, PropertyDescriptor | undefined>();
  beforeEach(() => {
    renderers = [];
    for (const name of globals) saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    // only what SettingsProvider reads and writes: no stored settings, a root it themes, no listeners that fire
    const style = { setProperty: () => {}, removeProperty: () => {}, getPropertyValue: () => "", backgroundColor: "" };
    const listen = { addEventListener: () => {}, removeEventListener: () => {} };
    const values: Record<string, unknown> = {
      IS_REACT_ACT_ENVIRONMENT: true,
      window: { ...listen, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {}, key: () => null, length: 0 } },
      document: { ...listen, documentElement: { lang: "", dataset: {}, style }, querySelector: () => null },
      getComputedStyle: () => style,
    };
    for (const name of globals) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: values[name] });
    jest.useFakeTimers();
    jest.setSystemTime(new Date(at));
  });
  afterEach(() => {
    act(() => { for (const renderer of renderers) renderer.unmount(); });
    jest.useRealTimers();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    saved.clear();
  });
  const mount = (element: ReturnType<typeof createElement>, settings = true): ReactTestRenderer => {
    let renderer!: ReactTestRenderer;
    withEnglish(() => act(() => { renderer = create(settings ? createElement(SettingsProvider, { children: element }) : element); }));
    renderers.push(renderer);
    return renderer;
  };
  const clocks = (renderer: ReactTestRenderer): number => renderer.root.findAll((node) => node.props.className === "chat-sent-late").length;

  test("brings the clock in at five seconds, on its own timer", () => {
    const renderer = mount(createElement(SentWaitingList, { sends: [send] }));
    act(() => { jest.advanceTimersByTime(WAITING_HINT_MS - 1); });
    expect(clocks(renderer)).toBe(0);
    act(() => { jest.advanceTimersByTime(1); });
    expect(clocks(renderer)).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("keeps an unread send compact without a bubble hint timer", () => {
    const renderer = mount(createElement(SentWaitingList, { sends: [{ ...send, after: null }] }));
    expect(renderer.root.findAllByType("details")).toHaveLength(1);
    expect(renderer.root.findAllByType("summary")[0]!.children).toEqual(["Sent · waiting for transcript"]);
    expect(jest.getTimerCount()).toBe(0);
    act(() => { jest.advanceTimersByTime(WAITING_HINT_MS); });
    expect(clocks(renderer)).toBe(0);
  });

  test("leaves no timer behind when the bubble goes before its clock", () => {
    const renderer = mount(createElement(SentWaitingList, { sends: [send] }));
    expect(jest.getTimerCount()).toBe(1);
    act(() => { renderer.update(createElement(SettingsProvider, { children: createElement(SentWaitingList, { sends: [] }) })); });
    expect(jest.getTimerCount()).toBe(0);
  });

  test("lets a waiting send go when the connection does, and does not bring it back on reconnect", () => {
    const key = waitingKey("local", "w1:p1");
    let shown: readonly WaitingSend[] = [];
    function Probe({ connected }: { connected: boolean }) {
      shown = useWaitingSends("local", "w1:p1", connected);
      return null;
    }
    try {
      rememberWaitingSend(key, "deploy it", at);
      const renderer = mount(createElement(Probe, { connected: true }), false);
      expect(shown.map((item) => item.text)).toEqual(["deploy it"]);
      act(() => { renderer.update(createElement(Probe, { connected: false })); });
      expect(shown).toEqual([]);
      act(() => { renderer.update(createElement(Probe, { connected: true })); });
      expect(shown).toEqual([]);
    } finally { forgetWaitingSends(key); }
  });

  test("a disconnected sibling pane preserves the baseline so a phone's send does not duplicate its transcript turn", () => {
    const key = waitingKey("local", "baseline-owner");
    const user = (text: string, ts: number) => ({ role: "user" as const, ts: new Date(ts).toISOString(), parts: [{ kind: "text" as const, text }] });
    // The phone is two seconds ahead of the PC. Its loaded chat already accounts for that skew.
    const earlier = user("earlier", at - 10_000);
    settleWaitingSends(key, [earlier], at, true);
    function Sibling() {
      useWaitingSends("local", "another-pane", false);
      return null;
    }
    try {
      mount(createElement(Sibling), false);
      rememberWaitingSend(key, "follow up while working", at + 2_000, waitingBaseline(key));
      settleWaitingSends(key, [earlier, user("follow up while working", at + 100)], at + 2_100, true);
      expect(currentWaitingSends(key)).toEqual([]);
    } finally { forgetWaitingSends(key); }
  });
});
