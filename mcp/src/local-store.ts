import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Local, file-backed fallback for the remote Cloudflare D1 binding used by the
// Streamable HTTP Worker. D1 is a *remote* database, so the optional local stdio
// build (src/stdio.ts) cannot reach it. This adapter implements the small subset
// of the D1 API that src/db.ts relies on, persisting to a JSON file so plans and
// memory survive across stdio invocations on the same machine.
//
// Limitation: unlike remote D1, this store is local-only — plans/memory are NOT
// shared across machines or Cloud sessions. See docs for details.

interface Row {
  [column: string]: string | null;
}

interface StoreData {
  plans: Row[];
  memory: Row[];
}

function emptyData(): StoreData {
  return { plans: [], memory: [] };
}

class LocalStore {
  private data: StoreData;

  constructor(private readonly filePath: string | null) {
    this.data = this.load();
  }

  private load(): StoreData {
    if (!this.filePath) return emptyData();
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoreData>;
      return { plans: parsed.plans ?? [], memory: parsed.memory ?? [] };
    } catch {
      return emptyData();
    }
  }

  private persist(): void {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }

  insert(table: "plans" | "memory", row: Row): void {
    this.data[table].push(row);
    this.persist();
  }

  findById(table: "plans" | "memory", id: string): Row | null {
    return this.data[table].find((r) => r.id === id) ?? null;
  }

  get(table: "plans" | "memory"): Row[] {
    return this.data[table];
  }
}

const PLAN_COLUMNS = [
  "id",
  "workspace",
  "original_task",
  "decomposition",
  "confidence_summary",
  "created_at",
];
const MEMORY_COLUMNS = ["id", "workspace", "key", "value", "tags", "created_at"];

function rowFromValues(columns: string[], values: unknown[]): Row {
  const row: Row = {};
  columns.forEach((col, i) => {
    const v = values[i];
    row[col] = v === null || v === undefined ? null : String(v);
  });
  return row;
}

// Minimal D1PreparedStatement-compatible implementation. It recognizes only the
// exact statements issued by src/db.ts (INSERT/SELECT on `plans` and `memory`)
// and throws for anything else so unsupported usage fails loudly.
class LocalPreparedStatement {
  private values: unknown[] = [];

  constructor(
    private readonly store: LocalStore,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): LocalPreparedStatement {
    this.values = values;
    return this;
  }

  private normalized(): string {
    return this.sql.replace(/\s+/g, " ").trim().toLowerCase();
  }

  async run(): Promise<{ success: true; results: Row[] }> {
    const sql = this.normalized();
    if (sql.startsWith("insert into plans")) {
      this.store.insert("plans", rowFromValues(PLAN_COLUMNS, this.values));
    } else if (sql.startsWith("insert into memory")) {
      this.store.insert("memory", rowFromValues(MEMORY_COLUMNS, this.values));
    } else {
      throw new Error(`LocalStore: unsupported statement for run(): ${this.sql}`);
    }
    return { success: true, results: [] };
  }

  async first<T = Row>(): Promise<T | null> {
    const sql = this.normalized();
    if (sql.startsWith("select") && sql.includes("from plans") && sql.includes("where id = ?")) {
      const id = String(this.values[0]);
      return this.store.findById("plans", id) as T | null;
    }
    throw new Error(`LocalStore: unsupported statement for first(): ${this.sql}`);
  }

  async all<T = Row>(): Promise<{ success: true; results: T[] }> {
    const sql = this.normalized();
    if (sql.startsWith("select") && sql.includes("from memory")) {
      // Mirrors the query in src/db.ts:
      //   WHERE (workspace IS ? OR ? IS NULL) AND (key LIKE ? OR value LIKE ? OR tags LIKE ?)
      //   ORDER BY created_at DESC LIMIT 25
      const workspace = this.values[0] as string | null;
      const like = String(this.values[2] ?? "").slice(1, -1).toLowerCase();
      const results = this.store
        .get("memory")
        .filter((r) => workspace === null || r.workspace === workspace)
        .filter(
          (r) =>
            (r.key ?? "").toLowerCase().includes(like) ||
            (r.value ?? "").toLowerCase().includes(like) ||
            (r.tags ?? "").toLowerCase().includes(like),
        )
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 25);
      return { success: true, results: results as T[] };
    }
    throw new Error(`LocalStore: unsupported statement for all(): ${this.sql}`);
  }
}

class LocalD1 {
  private readonly store: LocalStore;

  constructor(filePath: string | null) {
    this.store = new LocalStore(filePath);
  }

  prepare(sql: string): LocalPreparedStatement {
    return new LocalPreparedStatement(this.store, sql);
  }
}

// The adapter implements only the subset of D1Database that src/db.ts uses; the
// cast bridges it to the workers-types D1Database interface expected by Env.
export function createLocalD1(filePath: string | null): D1Database {
  return new LocalD1(filePath) as unknown as D1Database;
}
