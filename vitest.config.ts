import { defineConfig } from "vitest/config";
import fs from "node:fs";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  define: {
    __COMPACT_CONTRACT_PRESENT__: JSON.stringify(fs.existsSync(path.resolve(templateRoot, "contracts/managed/proofpass/contract/index.js"))),
  },
  resolve: {
    alias: {
      "@compact/proofpass": path.resolve(templateRoot, "contracts/managed/proofpass/contract/index.js"),
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts", "client/src/**/*.test.ts"],
  },
});
