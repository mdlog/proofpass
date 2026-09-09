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

/**
 * Every workflow in the app gates its actions with `disabled`, and the
 * stylesheet had no rule for that state at all — a dead control looked exactly
 * like a live one, so clicking it read as an application that does not respond.
 */
describe("disabled controls", () => {
  const rule = css.match(/\.button:disabled\s*\{[^}]*\}/)?.[0] ?? "";

  it("styles a disabled button at all", () => {
    expect(rule).not.toBe("");
  });

  it("dims it, so the difference is visible before the click rather than after", () => {
    expect(rule).toMatch(/opacity:\s*\.?\d/);
  });

  it("changes the cursor, so a dead control does not invite a click", () => {
    expect(rule).toMatch(/cursor:\s*not-allowed/);
  });

  it("drops the lift and shadow that make an active button look pressable", () => {
    expect(rule).toMatch(/box-shadow:\s*none/);
  });

  it("carries the same treatment into dark mode", () => {
    expect(css).toMatch(/\.dark\s+\.button:disabled/);
  });
});
