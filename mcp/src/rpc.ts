import { callTool, TOOL_DEFINITIONS } from "./tools.js";
import { LATENCY_BUDGET_MS, log } from "./logger.js";
import type { Env, JsonRpcRequest, JsonRpcResponse } from "./types.js";

export const PROTOCOL_VERSION = "2024-11-05";

// Per-request correlation context used for structured logging. The stdio
// transport omits it (it must keep stdout free of anything but JSON-RPC).
export interface RequestContext {
  requestId: string;
  sessionId: string | null;
}

export function rpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

export function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// Transport-agnostic JSON-RPC dispatch shared by the Streamable HTTP Worker
// (src/index.ts) and the optional local stdio build (src/stdio.ts). When a
// RequestContext is supplied, per-tool latency/outcome metrics are logged;
// stdio callers omit it to keep stdout limited to JSON-RPC frames.
export async function handleRpc(
  env: Env,
  req: JsonRpcRequest,
  ctx?: RequestContext,
): Promise<JsonRpcResponse> {
  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "devin-scope", version: "0.1.0" },
      });

    case "tools/list":
      return rpcResult(req.id, { tools: TOOL_DEFINITIONS });

    case "tools/call": {
      const params = req.params ?? {};
      const name = params.name as string | undefined;
      const args = (params.arguments as Record<string, unknown> | undefined) ?? {};
      if (!name) return rpcError(req.id, -32602, "Missing tool name");

      const start = Date.now();
      try {
        const output = await callTool(env, name, args);
        if (ctx) {
          const durationMs = Date.now() - start;
          log(durationMs > LATENCY_BUDGET_MS ? "warn" : "info", "tool_call", {
            requestId: ctx.requestId,
            sessionId: ctx.sessionId,
            tool: name,
            status: "ok",
            durationMs,
            overBudget: durationMs > LATENCY_BUDGET_MS,
          });
        }
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(output) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool call failed";
        if (ctx) {
          log("error", "tool_call", {
            requestId: ctx.requestId,
            sessionId: ctx.sessionId,
            tool: name,
            status: "error",
            durationMs: Date.now() - start,
            error: message,
            args,
          });
        }
        return rpcError(req.id, -32000, message);
      }
    }

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}
