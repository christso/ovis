/** Build the migration dialog in an owned harness, independently of product navigation. */
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "vite";
export async function buildSessionMoveFixture(root: string, output: string): Promise<void> {
  const fixture = join(root, "move-fixture"); mkdirSync(fixture);
  symlinkSync(join(import.meta.dir, "../node_modules"), join(fixture, "node_modules"), "dir");
  symlinkSync(join(import.meta.dir, "session-move-fixture.tsx"), join(fixture, "fixture.tsx"));
  writeFileSync(join(fixture, "index.html"), '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/fixture.tsx"></script></body></html>');
  await build({ configFile: join(import.meta.dir, "../vite.config.ts"), root: fixture, base: "./", publicDir: false, logLevel: "warn", build: { outDir: output, emptyOutDir: true } });
}
