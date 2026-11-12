import { MAX_TAB_LABEL_LENGTH } from "./preferences.ts";

/** how many columns a tab shows of the line before it is cut with an ellipsis; a wide character (Hangul, CJK, an emoji) takes two */
export const SHORT_TAB_LABEL_COLUMNS = 24;
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u;

/** A line's characters as drawn: graphemes, or code points where the browser has no Intl.Segmenter (Safari 14). */
function characters(text: string): string[] {
  return typeof Intl.Segmenter === "function" ? [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(({ segment }) => segment) : Array.from(text);
}

/** A line that names nothing a tab could be told by: a slash command, a path, a code fence. */
const NOT_A_NAME = /^(?:\/|~\/|\.\.?\/|[A-Za-z]:[\\/]|```|~~~)/;

/**
 * An attached file's mention, `@` and its absolute path (lib/compose.ts imageMention), which names
 * nothing a tab could be told by (#2637). An upload's path may hold spaces (a folder under
 * ~/Library), so one in the shape an upload takes (server/paste.ts: `<name>-<YYYYMMDD>-<HHMMSS>-
 * <8 hex>.<ext>`, a name with no space) is taken whole up to the next path or mention, as
 * lib/chatImages.ts reads it; any other path ends at a space. Only one in an upload folder `.ovis` (or
 * the folder its PC's `OVIS_PASTE_DIR` names, uploadPattern) may run past a word ending in an image's
 * extension, so the words after another mention never read as an upload's path (#2682). A folder's " @" or " ~" followed by a space is part of it.
 */
const ATTACHMENT = /(^|\s)@(?:\/|~[\\/]|[A-Za-z]:[\\/])(?:(?:(?!\s(?:@\S|[\\/]|~[\\/]|[A-Za-z]:[\\/])).){0,1024}?[\\/]\.ovis[\\/][\p{L}\p{N}._-]*-\d{8}-\d{6}-[0-9a-f]{8}(?:\.[a-z0-9]{1,10})?(?=\s|$)|(?:(?!\s(?:@\S|[\\/]|~[\\/]|[A-Za-z]:[\\/])|\.(?:png|jpe?g|gif|webp)\s).){0,1024}?[\\/][\p{L}\p{N}._-]*-\d{8}-\d{6}-[0-9a-f]{8}(?:\.[a-z0-9]{1,10})?(?=\s|$)|\S*)/giu;

const uploadsUnder = new Map<string, RegExp>();

/**
 * An upload's mention right in the folder `OVIS_PASTE_DIR` names on the message's PC (lib/pasteFolders.ts),
 * taken whole even where that folder holds a word ending in an image's extension (#2771). The folder is
 * matched as its server wrote it, case and all: ATTACHMENT's `i` would let a different folder in.
 */
function uploadPattern(folder: string): RegExp {
  let pattern = uploadsUnder.get(folder);
  if (pattern === undefined) {
    pattern = new RegExp(String.raw`(^|\s)@${folder.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&")}[\\/][\p{L}\p{N}._-]*-\d{8}-\d{6}-[0-9a-f]{8}(?:\.[a-z0-9]{1,10})?(?=\s|$)`, "gu");
    uploadsUnder.set(folder, pattern);
  }
  return pattern;
}

/**
 * A label an Ovis before #2637 learned with an attachment's mention in it (a label learned now never
 * holds one): it is never shown, and a new one takes its place.
 */
export function attachmentTabLabel(label: string): boolean {
  return /(?:^|\s)@(?:\/|~[\\/]|[A-Za-z]:[\\/])/.test(label);
}

/**
 * What the tab shows of a message: its first line that says something (not a slash command, a path
 * or a code fence) once attached files' mentions are left out, its spaces collapsed, a few words of it cut at a word's end when one is near
 * the limit, else at the limit (a language written without spaces), with an ellipsis when anything
 * was cut; null for a message with nothing to name a tab by.
 */
export function shortTabLabel(text: string, uploadFolder?: string): string | null {
  const line = text.split(/\r\n|[\n\r\u2028\u2029]/).map((part) => (uploadFolder ? part.replace(uploadPattern(uploadFolder), "$1") : part).replace(ATTACHMENT, "$1").replace(/\s+/g, " ").trim()).find((part) => part !== "" && !NOT_A_NAME.test(part));
  if (line === undefined) return null;
  const head: string[] = [];
  let columns = 0;
  let space = -1;
  let spaceAt = 0;
  for (const segment of characters(line)) {
    const width = WIDE.test(segment) ? 2 : 1;
    if (columns + width > SHORT_TAB_LABEL_COLUMNS || head.join("").length + segment.length >= MAX_TAB_LABEL_LENGTH) {
      const kept = space >= 0 && spaceAt >= SHORT_TAB_LABEL_COLUMNS / 2 ? head.slice(0, space) : head;
      return `${kept.join("").trimEnd()}…`;
    }
    if (segment === " ") { space = head.length; spaceAt = columns; }
    head.push(segment);
    columns += width;
  }
  return line;
}

