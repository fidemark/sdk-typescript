import { describe, it, expect } from "vitest";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  canonicalizeDom,
  hashRegion,
  FIDEMARK_DOM_VERSION,
} from "../../src/dom.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_PATH = resolve(__dirname, "../../../_fixtures/dom-canonicalization.json");

interface FixtureCase {
  name: string;
  html: string;
  selector: string;
  canonical: string;
  hash: string;
}

interface FixtureFile {
  version: number;
  cases: FixtureCase[];
}

const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, "utf8")) as FixtureFile;

function parseRegion(html: string, selector: string): Element {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const el = dom.window.document.querySelector(selector);
  if (!el) throw new Error(`fixture selector not found: ${selector}`);
  return el;
}

describe("FIDEMARK_DOM_VERSION", () => {
  it("matches the version in the shared fixture file", () => {
    expect(FIDEMARK_DOM_VERSION).toBe(fixtures.version);
  });
});

describe("canonicalizeDom shared fixtures", () => {
  for (const c of fixtures.cases) {
    it(`canonicalizes ${c.name}`, () => {
      const region = parseRegion(c.html, c.selector);
      expect(canonicalizeDom(region)).toBe(c.canonical);
    });
  }
});

describe("hashRegion shared fixtures", () => {
  for (const c of fixtures.cases) {
    it(`hashes ${c.name}`, async () => {
      const region = parseRegion(c.html, c.selector);
      expect(await hashRegion(region)).toBe(c.hash);
    });
  }
});

describe("canonicalizeDom invariants", () => {
  it("ignores attribute and class changes when content is identical", () => {
    const a = parseRegion(
      "<article id=\"r\"><p class=\"prose\">A line.</p><p class=\"text-sm\">Another line.</p></article>",
      "#r",
    );
    const b = parseRegion(
      "<article id=\"r\" data-build=\"42\"><p>A line.</p><p style=\"color:red\">Another line.</p></article>",
      "#r",
    );
    expect(canonicalizeDom(a)).toEqual(canonicalizeDom(b));
  });

  it("differs when content differs", () => {
    const a = parseRegion("<p id=\"r\">Hello.</p>", "#r");
    const b = parseRegion("<p id=\"r\">Goodbye.</p>", "#r");
    expect(canonicalizeDom(a)).not.toEqual(canonicalizeDom(b));
  });

  it("excludes nodes inside [data-fidemark-ignore]", () => {
    const region = parseRegion(
      "<article id=\"r\"><p>Keep.</p><div data-fidemark-ignore><p>Drop me.</p></div><p>Keep too.</p></article>",
      "#r",
    );
    const text = canonicalizeDom(region);
    expect(text).not.toContain("Drop me");
    expect(text).toContain("Keep");
    expect(text).toContain("Keep too");
  });

  it("excludes script, style, noscript, template subtrees", () => {
    const region = parseRegion(
      "<article id=\"r\"><script>alert('x')</script><style>p{}</style><noscript>nope</noscript><template><p>tmpl</p></template><p>only this</p></article>",
      "#r",
    );
    expect(canonicalizeDom(region)).toBe("only this");
  });

  it("collapses runs of internal whitespace and trims edges", () => {
    const region = parseRegion(
      "<p id=\"r\">  a   \t b  \n  c  </p>",
      "#r",
    );
    expect(canonicalizeDom(region)).toBe("a b c");
  });

  it("NFC-normalizes composed vs decomposed unicode", () => {
    // "café" composed (4 chars) vs decomposed (5 chars) must hash the same.
    const composed = parseRegion("<p id=\"r\">café</p>", "#r");
    const decomposed = parseRegion("<p id=\"r\">café</p>", "#r");
    expect(canonicalizeDom(composed)).toEqual(canonicalizeDom(decomposed));
  });
});

describe("hashRegion", () => {
  it("returns a 0x-prefixed 32-byte hex digest", async () => {
    const region = parseRegion("<p id=\"r\">anything</p>", "#r");
    const out = await hashRegion(region);
    expect(out).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("is deterministic across calls", async () => {
    const region = parseRegion("<p id=\"r\">stable</p>", "#r");
    expect(await hashRegion(region)).toEqual(await hashRegion(region));
  });
});
