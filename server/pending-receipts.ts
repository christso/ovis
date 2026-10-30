import type { PendingRemoval } from "../shared/protocol.ts";

type Disposition = { id: string; outcome: "sent" | "discarded" };

/** Bounded presentation history. A receipt restores no input lease and contains no message text. */
export class PendingReceipts {
  private entries = new Map<string, { pane: string; owner: string; receipt: Disposition; at: number }>();
  constructor(private now: () => number = Date.now, private retentionMs = 10 * 60_000, private limit = 1024) {}

  remember(pane: string, owner: string, receipts: readonly Disposition[]): void {
    this.prune();
    for (const receipt of receipts) {
      const key = JSON.stringify([pane, owner, receipt.id]);
      this.entries.delete(key);
      this.entries.set(key, { pane, owner, receipt: { id: receipt.id, outcome: receipt.outcome }, at: this.now() });
      while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    }
  }

  read(pane: string, owner: string): PendingRemoval[] {
    this.prune();
    return [...this.entries.values()].filter(entry => entry.pane === pane && entry.owner === owner)
      .map(entry => ({ ...entry.receipt, resumed: true }));
  }

  forget(pane: string): void {
    for (const [key, entry] of this.entries) if (entry.pane === pane) this.entries.delete(key);
  }

  private prune(): void {
    const before = this.now() - this.retentionMs;
    for (const [key, entry] of this.entries) if (entry.at <= before) this.entries.delete(key);
  }
}
