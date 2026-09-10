import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(path.resolve(import.meta.dirname, "..", "index.html"), "utf-8");

/**
 * Vite substitutes `%VITE_*%` in index.html from the environment, and leaves the
 * literal text behind when the variable is unset. The analytics tag did exactly
 * that, so every page load fetched `%VITE_ANALYTICS_ENDPOINT%/umami` and got a
 * 400 — noise in the console of anyone opening the app, and one more red line
 * to rule out while debugging something real.
 */
describe("index.html", () => {
  it("leaves no %VITE_% placeholder that would become a request", () => {
    const placeholders = html.match(/%VITE_[A-Z0-9_]+%/g) ?? [];
    expect(placeholders).toEqual([]);
  });

  it("still loads the app entry", () => {
    expect(html).toMatch(/<script type="module" src="\/src\/main\.tsx">/);
  });
});
