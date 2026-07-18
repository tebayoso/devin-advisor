import { env } from "cloudflare:test";
import { beforeAll } from "vitest";

// Apply the D1 schema to the isolated test database once per test file. With
// vitest-pool-workers isolated storage, this seeds the schema for every test in
// the file while each test's own writes are rolled back afterwards.
beforeAll(async () => {
  await env.DB.batch(env.SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
});
