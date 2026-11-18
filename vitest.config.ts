import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  // A3's regeneration-determinism test needs ~6.5 s on a loaded machine (default 5 s timed out at HEAD).
  // The model-building hooks (beforeAll) share the CPU with every other test file that builds the model; 10 s was too tight in a full run.
  test: { environment: "node", testTimeout: 30_000, hookTimeout: 60_000 },
});
