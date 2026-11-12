import { expect, it } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsProvider } from "../lib/settings.ts";
import { MessageSourceMarker } from "./MessageSourceMarker.tsx";

const render = (sender: Parameters<typeof MessageSourceMarker>[0]["sender"], language = "en"): string => {
  const saved = Object.getOwnPropertyDescriptor(navigator, "languages");
  Object.defineProperty(navigator, "languages", { configurable: true, value: [language] });
  try { return renderToStaticMarkup(createElement(SettingsProvider, { children: createElement(MessageSourceMarker, { sender }) })); }
  finally { if (saved) Object.defineProperty(navigator, "languages", saved); else Reflect.deleteProperty(navigator, "languages"); }
};

it("puts the authenticated source mark between from and the escaped historical display name", () => {
  for (const agent of ["codex", "omp", "claude"]) {
    const html = render({ id: "fixture", name: "Graph <projection>", agent });
    expect(html).toContain("Message from ");
    expect(html).toContain(`agent-mark ${agent}`);
    expect(html.indexOf("Message from ")).toBeLessThan(html.indexOf("agent-mark"));
    expect(html.indexOf("agent-mark")).toBeLessThan(html.indexOf("Graph &lt;projection&gt;"));
  }
  const legacy = render({ id: "fixture", name: "Legacy source" });
  expect(legacy).toContain("Message from ");
  expect(legacy).toContain("Legacy source");
  expect(legacy).not.toContain("agent-mark");
});

it("keeps the icon with the sender when a translation puts the sender before the phrase", () => {
  const html = render({ id: "fixture", name: "Graph projection", agent: "codex" }, "ja");
  expect(html.indexOf("agent-mark")).toBeLessThan(html.indexOf("Graph projection"));
  expect(html.indexOf("Graph projection")).toBeLessThan(html.indexOf("からのメッセージ"));
});
