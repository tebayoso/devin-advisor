/// <reference types="@cloudflare/vitest-pool-workers" />

declare module "cloudflare:test" {
  interface ProvidedEnv {
    DB: D1Database;
    // Statements from schema.sql, injected by vitest.config.ts and applied
    // to the isolated D1 database in test/setup.ts.
    SCHEMA_STATEMENTS: string[];
  }
}
