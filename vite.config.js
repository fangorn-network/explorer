export default {
    root: "app",
    base: "./",
    build: { outDir: "../dist", emptyOutDir: true, target: "es2022" },   // es2022: top-level await
    // Pre-bundling breaks embed.js's `new URL(worker, import.meta.url)`: ranking would quietly drop to words.
    optimizeDeps: { exclude: ["@fangorn-network/westmarch"] },
    worker: { format: "es" },
};
