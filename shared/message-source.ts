import type { HerdrCoordinationEndpoint } from "./graph-registry.ts";

/** Authenticated peer content, not human authorization or proof of a new delivery on replay. */
export interface MessageSender { id: string; name: string }
/** Private lookup response; never included in a conversation proxied to a watching device. */
export interface MessageSourceProof { id: string; source: HerdrCoordinationEndpoint }
export const MESSAGE_SOURCE_ID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
export const messageSourceUri = (id: string): string => `ovis-source://${id}`;
export function messageSourceId(uri: string): string | null {
  const id = uri.startsWith("ovis-source://") ? uri.slice(14) : "";
  return MESSAGE_SOURCE_ID.test(id) ? id : null;
}

export const messageSourceLabel = (value: string): string => value.replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ").slice(0, 100);
