import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Load the canonical D1 schema (single source of truth) and split it into
// individual statements so the test setup can apply it to the isolated,
// in-memory (miniflare) D1 database before each test file runs.
const schemaPath = fileURLToPath(new URL("./schema.sql", import.meta.url));
const schemaSql = readFileSync(schemaPath, "utf8");
const schemaStatements = schemaSql
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !/^(--.*\s*)+$/.test(s));

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/setup.ts"],
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2024-07-12",
          compatibilityFlags: ["nodejs_compat"],
          d1Databases: ["DB"],
          bindings: {
            SCHEMA_STATEMENTS: schemaStatements,
          },
        },
      },
    },
  },
});
