import { callTool, TOOL_DEFINITIONS } from "./tools.js";
import { LATENCY_BUDGET_MS, log } from "./logger.js";
import type { Env, JsonRpcRequest, JsonRpcResponse } from "./types.js";

const PROTOCOL_VERSION = "2024-11-05";

interface RequestContext {
  requestId: string;
  sessionId: string | null;
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

// Constant-time string comparison to avoid leaking the token via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Returns true when the request is authorized. Auth is optional: when
// AUTH_TOKEN is unset (or empty), every request is allowed (public demo).
function isAuthorized(env: Env, request: Request): boolean {
  const expected = env.AUTH_TOKEN;
  if (!expected) return true;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;
  return timingSafeEqual(match[1], expected);
}

async function handleRpc(
  env: Env,
  req: JsonRpcRequest,
  ctx: RequestContext,
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
        const durationMs = Date.now() - start;
        log(durationMs > LATENCY_BUDGET_MS ? "warn" : "info", "tool_call", {
          requestId: ctx.requestId,
          sessionId: ctx.sessionId,
          tool: name,
          status: "ok",
          durationMs,
          overBudget: durationMs > LATENCY_BUDGET_MS,
        });
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(output) }],
        });
      } catch (err) {
        const durationMs = Date.now() - start;
        const message = err instanceof Error ? err.message : "Tool call failed";
        log("error", "tool_call", {
          requestId: ctx.requestId,
          sessionId: ctx.sessionId,
          tool: name,
          status: "error",
          durationMs,
          error: message,
          args,
        });
        return rpcError(req.id, -32000, message);
      }
    }

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname !== "/mcp") {
      return new Response("Not found", { status: 404 });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const ctx: RequestContext = {
      requestId: crypto.randomUUID(),
      sessionId: request.headers.get("mcp-session-id"),
    };
    const start = Date.now();

    if (!isAuthorized(env, request)) {
      log("warn", "unauthorized", {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        durationMs: Date.now() - start,
      });
      return Response.json(rpcError(null, -32001, "Unauthorized"), {
        status: 401,
        headers: { "WWW-Authenticate": "Bearer" },
      });
    }

    let body: JsonRpcRequest;
    try {
      body = (await request.json()) as JsonRpcRequest;
    } catch {
      log("warn", "request_parse_error", {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        durationMs: Date.now() - start,
      });
      return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
    }

    try {
      const response = await handleRpc(env, body, ctx);
      log("info", "request", {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        method: body.method,
        status: response.error ? "error" : "ok",
        durationMs: Date.now() - start,
      });
      return Response.json(response, { status: 200 });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Internal error";
      log("error", "request", {
        requestId: ctx.requestId,
        sessionId: ctx.sessionId,
        method: body.method,
        status: "error",
        durationMs: Date.now() - start,
        error: message,
      });
      return Response.json(rpcError(body.id ?? null, -32603, "Internal error"), {
        status: 200,
      });
    }
  },
};
