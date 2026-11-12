import { expect, test } from "bun:test";
import { canonicalGraphRemote, graphRepositoryValue, selectGraphRemote } from "./graph-repository.ts";

test("SSH and HTTPS identify the same host and repository without retaining credentials", () => {
  const expected = "https://github.com/team/orchard";
  for (const url of ["git@github.com:team/orchard.git", "ssh://git@GITHUB.com/team/orchard.git", "https://secret:token@github.com/team/orchard.git", "https://github.com:443/team/orchard/"]) expect(canonicalGraphRemote(url)).toBe(expected);
  for (const url of ["/local/repo", "file:///local/repo", "../repo", "https://github.com/team/repo?token=secret", "https://github.com/team/../repo", "ext::secret", "https://github.com/repo"]) expect(canonicalGraphRemote(url)).toBeNull();
  expect(canonicalGraphRemote("git@other.com:team/orchard.git")).not.toBe(expected);
  expect(canonicalGraphRemote("git@github.com:fork/orchard.git")).not.toBe(expected);
  expect(canonicalGraphRemote("ssh://git@github.com:2222/team/orchard.git")).not.toBe(expected);
});
test("origin wins; otherwise exactly one remote is required, never guessed upstream", () => {
  expect(selectGraphRemote([{ name: "upstream", url: "git@github.com:team/orchard.git" }, { name: "origin", url: "git@github.com:fork/orchard.git" }])).toBe("https://github.com/fork/orchard");
  expect(selectGraphRemote([{ name: "upstream", url: "git@github.com:team/orchard.git" }])).toBe("https://github.com/team/orchard");
  expect(selectGraphRemote([{ name: "origin", url: "/local" }, { name: "upstream", url: "git@github.com:team/orchard.git" }])).toBeNull();
  expect(selectGraphRemote([{ name: "one", url: "git@github.com:team/orchard.git" }, { name: "two", url: "git@github.com:team/orchard.git" }])).toBeNull();
});

test("malformed, credential-bearing and uncanonical peer entries never establish identity", () => {
  const proof = { pane_id: "p1", terminal_id: "t1", cwd: "/repo", common_directory: "/repo/.git", root: "/repo", remote: "https://github.com/team/repo" };
  expect(graphRepositoryValue(proof)).toBe(true);
  expect(graphRepositoryValue({ ...proof, remote: null })).toBe(true);
  for (const value of [null, [], {}, { ...proof, terminal_id: 3 }, { ...proof, remote: "https://token@github.com/team/repo" }, { ...proof, remote: "git@github.com:team/repo.git" }]) expect(graphRepositoryValue(value)).toBe(false);
});

test("generic SSH accounts and home-relative paths never collapse into another transport or account", () => {
  for (const user of ["alice", "bob"]) {
    expect(canonicalGraphRemote(`${user}@example.com:team/repo.git`)).toBeNull();
    expect(canonicalGraphRemote(`ssh://${user}@example.com/team/repo.git`)).toBeNull();
  }
  const relative = canonicalGraphRemote("git@example.com:team/repo.git");
  const absolute = canonicalGraphRemote("ssh://git@example.com/team/repo.git");
  expect(relative).toBe("ssh://git@example.com/~/team/repo.git");
  expect(absolute).toBe("ssh://git@example.com/team/repo.git");
  expect(relative).not.toBe(absolute);
  expect(absolute).not.toBe(canonicalGraphRemote("https://example.com/team/repo"));
  expect(canonicalGraphRemote(relative!)).toBe(relative);
  expect(canonicalGraphRemote("git@example.com:team/repo.git")).toBe(canonicalGraphRemote("ssh://git@example.com:22/~/team/repo.git"));
  expect(canonicalGraphRemote("ssh://git:secret@example.com/team/repo.git")).toBeNull();
});

test("generic .git suffixes are distinct paths and every supported canonical identity is idempotent", () => {
  for (const prefix of ["ssh://git@example.com/srv/", "https://example.com/team/", "git@example.com:team/", "ssh://git@github.com:2222/team/", "https://github.com:8443/team/"]) {
    const plain = canonicalGraphRemote(`${prefix}repo`), suffixed = canonicalGraphRemote(`${prefix}repo.git`);
    expect(plain).not.toBe(suffixed);
    expect(canonicalGraphRemote(plain!)).toBe(plain);
    expect(canonicalGraphRemote(suffixed!)).toBe(suffixed);
  }
  for (const host of ["github.com", "gitlab.com", "bitbucket.org"]) {
    const id = canonicalGraphRemote(`git@${host}:team/repo.git`);
    expect(canonicalGraphRemote(id!)).toBe(id);
    expect(canonicalGraphRemote(`git@${host}:team/repo.git.git`)).toBeNull();
  }
  expect(canonicalGraphRemote("https://example.com/~/team/repo")).toBeNull();
});

test("unknown-host HTTP credentials never silently merge account-dependent namespaces", () => {
  expect(canonicalGraphRemote("https://alice:secret@example.com/team/repo.git")).toBeNull();
  expect(canonicalGraphRemote("https://bob:secret@example.com/team/repo.git")).toBeNull();
});
