import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${fileURLToPath(new URL(".", import.meta.url))}$1` },
      // `server-only` throws by design outside a React Server Component
      // runtime. Stub it so server modules can be unit tested directly.
      { find: /^server-only$/, replacement: fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)) },
      // next/cache needs a Next render context; the stub keeps call sites real
      // while making the cache a passthrough.
      { find: /^next\/cache$/, replacement: fileURLToPath(new URL("./tests/stubs/next-cache.ts", import.meta.url)) },
    ],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    pool: "forks",
    // Integration tests share one Postgres database.
    fileParallelism: false,
  },
});
