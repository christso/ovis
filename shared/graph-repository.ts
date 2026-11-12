/** Ephemeral Git evidence from the bridge that owns this pane; never a terminal action proof. */
export interface GraphRepository {
  pane_id: string;
  terminal_id: string;
  cwd: string;
  common_directory: string;
  root: string;
  remote: string | null;
}

/** Conservative transport equivalence only. Host aliases and path case are never guessed. */
export function canonicalGraphRemote(raw: string): string | null {
  if (!raw || raw.length > 4096 || /[\s\\?#%]/.test(raw)) return null;
  const scp = !raw.includes("://") ? /^(?:([^/@:]+)@)?([^/:]+):([^/].*)$/.exec(raw) : null;
  const value = scp ? `ssh://${scp[1] ?? ""}${scp[1] ? "@" : ""}${scp[2]}/${scp[3]}` : raw;
  if (!/^(https|ssh):\/\//i.test(value)) return null;
  if (value.split("/").some((part) => part === "." || part === "..")) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/+$/, "").replace(/^\//, "");
    const ssh = url.protocol === "ssh:";
    const port = url.port && !(ssh && url.port === "22") ? url.port : "";
    const forge = !port && ["github.com", "gitlab.com", "bitbucket.org"].includes(host);
    if (!ssh && !forge && (url.username || url.password)) return null;
    // SSH login names can select different repositories or chroots; only the conventional git
    // service account has a supported global identity here. HTTPS credentials never enter identity.
    if (ssh && (url.username !== "git" || url.password)) return null;
    const relative = !!scp || ssh && path.startsWith("~/");
    let repository = ssh && path.startsWith("~/") ? path.slice(2) : path;
    if (forge && /\.git\.git$/.test(repository)) return null;
    if (forge) repository = repository.replace(/\.git$/, "");
    if (!host || !/^[a-z0-9.-]+$/i.test(host) || !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(repository)) return null;
    // These public forges document git@host:owner/repo as the HTTPS repository namespace.
    if (!ssh || forge) return `https://${host}${port ? `:${port}` : ""}/${repository}`;
    return `ssh://git@${host}${port ? `:${port}` : ""}/${relative ? "~/" : ""}${repository}`;
  } catch { return null; }
}

/** Fetch origin when configured; with no origin only a sole remote is unambiguous. */
export function selectGraphRemote(remotes: readonly { name: string; url: string }[]): string | null {
  const origins = remotes.filter((remote) => remote.name === "origin");
  const candidates = origins.length ? origins : remotes;
  return candidates.length === 1 ? canonicalGraphRemote(candidates[0]!.url) : null;
}

/** Older and future peers may omit this evidence; malformed entries cannot group nodes. */
export function graphRepositoryValue(value: unknown): value is GraphRepository {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ["pane_id", "terminal_id", "cwd", "common_directory", "root"].every((key) => typeof item[key] === "string" && !!item[key])
    && (item.remote === null || typeof item.remote === "string" && canonicalGraphRemote(item.remote) === item.remote);
}
