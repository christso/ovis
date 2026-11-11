import { join } from "node:path";
import { shellQuote } from "../machine-security.ts";

/** Paths name the published installation, including when its bundle is built in staging. */
export function herdrCliLauncher(runtime: string, directory: string): string {
  return `#!/bin/sh\n# Ovis Herdr CLI shim\nexec ${shellQuote(runtime)} ${shellQuote(join(directory, "observe.js"))} --shim ${shellQuote(join(directory, "config.json"))} -- "$@"\n`;
}
