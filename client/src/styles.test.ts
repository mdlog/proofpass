import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf-8");

/**
 * PRD §11 and §10 require every non-essential motion to stop under
 * `prefers-reduced-motion: reduce`. That is a stylesheet guarantee, so it is
 * asserted against the stylesheet rather than through a DOM that cannot
 * evaluate media queries.
 */
describe("reduced motion (PRD §10, §11)", () => {
  const blocks = css.match(/@media \(prefers-reduced-motion: reduce\)[^@]*/g) ?? [];

  it("declares a reduced-motion block", () => {
    expect(blocks.length).toBeGreaterThan(0);
  });

  it("neutralises animation and transition globally, not just per component", () => {
    const global = blocks.find(b => /\*,\s*\*::before,\s*\*::after/.test(b));
    expect(global).toBeDefined();
    expect(global).toMatch(/animation-duration:\s*\.01ms\s*!important/);
    expect(global).toMatch(/transition-duration:\s*\.01ms\s*!important/);
  });

  it("also silences the staged consent-modal sequence", () => {
    const consent = blocks.find(b => b.includes(".approval-modal"));
    expect(consent).toBeDefined();
    expect(consent).toMatch(/animation:\s*none\s*!important/);
  });
});
