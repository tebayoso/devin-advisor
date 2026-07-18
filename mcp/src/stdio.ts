import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { createLocalD1 } from "./local-store.js";
import { handleRpc, rpcError } from "./rpc.js";
import type { Env, JsonRpcRequest } from "./types.js";

// Optional local stdio transport for Devin Desktop / CLI power users. It reuses
// the exact same tools (src/tools.ts) as the primary Streamable HTTP Worker,
// speaking newline-delimited JSON-RPC 2.0 over stdin/stdout.
//
// D1 is remote and unreachable from a local process, so persistence falls back
// to a local file-backed store (src/local-store.ts). Set DEVIN_SCOPE_LOCAL_DB to
// override the path, or to ":memory:" for an ephemeral, non-persisted store.

function resolveDbPath(): string | null {
  const configured = process.env.DEVIN_SCOPE_LOCAL_DB;
  if (configured === ":memory:") return null;
  if (configured && configured.length > 0) return configured;
  return join(homedir(), ".devin-scope", "local-store.json");
}

function isNotification(req: JsonRpcRequest): boolean {
  return req.method.startsWith("notifications/") || req.id === undefined || req.id === null;
}

function parseRequest(line: string): JsonRpcRequest {
  const parsed = JSON.parse(line) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { method?: unknown }).method !== "string"
  ) {
    throw new Error("Invalid Request");
  }
  return parsed as JsonRpcRequest;
}

async function main(): Promise<void> {
  const env: Env = { DB: createLocalD1(resolveDbPath()) };
  const rl = createInterface({ input: process.stdin });

  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;

    let req: JsonRpcRequest;
    try {
      req = parseRequest(line);
    } catch {
      process.stdout.write(`${JSON.stringify(rpcError(null, -32700, "Parse error"))}\n`);
      continue;
    }

    // Guard each request so one bad message cannot terminate the long-lived server.
    try {
      const response = await handleRpc(env, req);
      // JSON-RPC notifications (no id) must not receive a response.
      if (isNotification(req)) continue;
      process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      const id = req.id ?? null;
      process.stdout.write(`${JSON.stringify(rpcError(id, -32603, message))}\n`);
    }
  }
}

main().catch((err) => {
  process.stderr.write(`devin-scope stdio fatal error: ${String(err)}\n`);
  process.exit(1);
});
