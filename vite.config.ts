import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": resolve(__dirname, "src") }, dedupe: ["three"] },
  // pre-bundle the post-processing modules with three itself, so the page never loads a second copy of three
  optimizeDeps: {
    include: [
      "three",
      "three/examples/jsm/postprocessing/EffectComposer.js",
      "three/examples/jsm/postprocessing/RenderPass.js",
      "three/examples/jsm/postprocessing/GTAOPass.js",
      "three/examples/jsm/postprocessing/OutputPass.js",
    ],
  },
});
