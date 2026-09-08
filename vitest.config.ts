import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);
const generatedContractPath = path.resolve(templateRoot, "contracts/managed/proofpass/contract/index.js");
const generatedContract = fs.existsSync(generatedContractPath) ? generatedContractPath : null;

export default defineConfig({
  root: templateRoot,
  // Component tests are compiled by vitest's own esbuild, which defaults to the
  // classic runtime and would need React in scope.
  esbuild: { jsx: "automatic" },
  define: {
    __COMPACT_CONTRACT_PRESENT__: JSON.stringify(Boolean(generatedContract)),
  },
  resolve: {
    alias: {
      // Mirrors vite.config.ts: without the fallback a checkout with no build
      // output fails with "Cannot find module" instead of the explicit
      // artifact-missing error the app is designed to raise.
      "@compact/proofpass": generatedContract
        ? generatedContract
        : path.resolve(templateRoot, "client/src/lib/compactArtifactMissing.ts"),
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    // Only the component tests pay for a DOM; the rest stay on node.
    environmentMatchGlobs: [["client/src/**/*.test.tsx", "jsdom"]],
    setupFiles: ["client/src/test-setup.ts"],
    include: [
      "server/**/*.test.{ts,tsx}",
      "server/**/*.spec.{ts,tsx}",
      "client/src/**/*.test.{ts,tsx}",
      "client/src/**/*.spec.{ts,tsx}",
      "shared/**/*.test.ts",
      "contracts/*.test.ts",
    ],
  },
});
