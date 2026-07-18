import { callTool, TOOL_DEFINITIONS } from "./tools.js";
import type { Env, JsonRpcRequest, JsonRpcResponse } from "./types.js";

export const PROTOCOL_VERSION = "2024-11-05";

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
// (src/index.ts) and the optional local stdio build (src/stdio.ts).
export async function handleRpc(env: Env, req: JsonRpcRequest): Promise<JsonRpcResponse> {
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
      try {
        const output = await callTool(env, name, args);
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(output) }],
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Tool call failed";
        return rpcError(req.id, -32000, message);
      }
    }

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}
