import { handleRpc, rpcError } from "./rpc.js";
import type { Env, JsonRpcRequest } from "./types.js";

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

    let body: JsonRpcRequest;
    try {
      body = (await request.json()) as JsonRpcRequest;
    } catch {
      return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
    }

    const response = await handleRpc(env, body);
    return Response.json(response, { status: 200 });
  },
};
