/**
 * Deterministic DOM canonicalization for region-level content attestations.
 *
 * A "region" is a DOM subtree the publisher declares as the canonical body
 * of an attestation. Both publisher (compute time) and verifier (browser at
 * view time) call `canonicalizeDom` on the same element to derive identical
 * bytes, regardless of surrounding markup, formatting, attribute changes,
 * or third-party DOM injections.
 *
 * The rules are frozen and versioned via `FIDEMARK_DOM_VERSION`. Any change
 * that would alter the canonical bytes for existing attestations requires a
 * version bump and a parallel migration; silent rule changes break trust.
 *
 * Rules (v1):
 *   1. Walk the subtree depth-first, producing a stream of "text" and "break"
 *      segments.
 *   2. Skip entirely: <script>, <style>, <noscript>, <template>, comments,
 *      and any element with [data-fidemark-ignore] (and its descendants).
 *   3. Text nodes contribute their raw nodeValue as a "text" segment.
 *   4. After exiting any block-level element (BLOCK_TAGS), emit one "break".
 *   5. Build the canonical string:
 *        a. For each text segment, replace runs of ASCII whitespace
 *           (space, tab, CR, LF, FF) with a single space.
 *        b. For each break segment, emit a literal "\n".
 *        c. Concatenate, then collapse runs of "\n" to a single "\n".
 *        d. Trim each line of leading/trailing spaces.
 *        e. Drop leading and trailing blank lines.
 *        f. NFC-normalize the result.
 *
 * The output is a deterministic plain-text representation of the region.
 * It ignores attribute and class changes, presentational wrapper churn,
 * source-formatting whitespace, and third-party script injections (when
 * authors mark ad slots with [data-fidemark-ignore]).
 */

export const FIDEMARK_DOM_VERSION = 1;

const BLOCK_TAGS = new Set([
  "BR",
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "ARTICLE",
  "SECTION",
  "HEADER",
  "FOOTER",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "TR",
]);

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);

const COMMENT_NODE = 8;
const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

interface DomNode {
  nodeType: number;
  nodeValue: string | null;
  childNodes: ArrayLike<DomNode>;
}

interface DomElement extends DomNode {
  tagName: string;
  hasAttribute(name: string): boolean;
}

type Segment = { kind: "text"; value: string } | { kind: "break" };

function isElement(n: DomNode): n is DomElement {
  return n.nodeType === ELEMENT_NODE;
}

function walk(node: DomNode, out: Segment[]): void {
  if (node.nodeType === COMMENT_NODE) return;

  if (node.nodeType === TEXT_NODE) {
    if (node.nodeValue) out.push({ kind: "text", value: node.nodeValue });
    return;
  }

  if (!isElement(node)) {
    for (let i = 0; i < node.childNodes.length; i++) {
      walk(node.childNodes[i]!, out);
    }
    return;
  }

  const tag = node.tagName.toUpperCase();
  if (SKIP_TAGS.has(tag)) return;
  if (node.hasAttribute("data-fidemark-ignore")) return;

  for (let i = 0; i < node.childNodes.length; i++) {
    walk(node.childNodes[i]!, out);
  }

  if (BLOCK_TAGS.has(tag)) out.push({ kind: "break" });
}

const WS_RUN = /[\t\n\r\f ]+/g;

function buildString(segments: Segment[]): string {
  const parts: string[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      parts.push(seg.value.replace(WS_RUN, " "));
    } else {
      parts.push("\n");
    }
  }
  const joined = parts.join("");
  const collapsed = joined.replace(/\n+/g, "\n");
  const lines = collapsed.split("\n").map((l) => l.replace(/^ +| +$/g, ""));
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === "") start++;
  while (end > start && lines[end - 1] === "") end--;
  return lines.slice(start, end).join("\n").normalize("NFC");
}

/**
 * Canonicalize a DOM subtree to a deterministic UTF-8 string. Pass any
 * `Element` (browser DOM, jsdom, happy-dom). The function does not mutate
 * the tree.
 */
export function canonicalizeDom(root: Element): string {
  const segments: Segment[] = [];
  walk(root as unknown as DomNode, segments);
  return buildString(segments);
}

/**
 * Compute the canonical content hash of a DOM subtree. SHA-256 of the
 * UTF-8 bytes of `canonicalizeDom(root)`. Returns a 0x-prefixed 32-byte
 * hex digest, ready for the `bytes32` schema field.
 */
export async function hashRegion(root: Element): Promise<string> {
  const text = canonicalizeDom(root);
  const bytes = new TextEncoder().encode(text);
  const subtle = getSubtle();
  const digest = await subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex;
}

function getSubtle(): SubtleCrypto {
  const g = globalThis as { crypto?: { subtle?: SubtleCrypto } };
  if (!g.crypto?.subtle) {
    throw new Error(
      "Web Crypto SubtleCrypto is unavailable. Use Node 20+ or a modern browser.",
    );
  }
  return g.crypto.subtle;
}
