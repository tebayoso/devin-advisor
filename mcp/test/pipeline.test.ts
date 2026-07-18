import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import type { JsonRpcResponse } from "../src/types.js";

let rpcId = 0;

async function rpc(
  method: string,
  params?: Record<string, unknown>,
): Promise<JsonRpcResponse> {
  const res = await SELF.fetch("https://example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as JsonRpcResponse;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ response: JsonRpcResponse; payload: unknown }> {
  const response = await rpc("tools/call", { name, arguments: args });
  let payload: unknown;
  if (response.result) {
    const result = response.result as { content: { type: string; text: string }[] };
    payload = JSON.parse(result.content[0].text);
  }
  return { response, payload };
}

describe("HTTP routing", () => {
  it("serves GET /health", async () => {
    const res = await SELF.fetch("https://example.com/health");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("returns 404 for unknown paths", async () => {
    const res = await SELF.fetch("https://example.com/unknown");
    expect(res.status).toBe(404);
  });

  it("returns 405 for non-POST /mcp", async () => {
    const res = await SELF.fetch("https://example.com/mcp", { method: "GET" });
    expect(res.status).toBe(405);
  });

  it("returns a JSON-RPC parse error (400) for invalid JSON", async () => {
    const res = await SELF.fetch("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as JsonRpcResponse;
    expect(body.error?.code).toBe(-32700);
  });
});

describe("JSON-RPC protocol", () => {
  it("responds to initialize with server info", async () => {
    const res = await rpc("initialize");
    const result = res.result as {
      protocolVersion: string;
      serverInfo: { name: string };
    };
    expect(result.serverInfo.name).toBe("devin-scope");
    expect(result.protocolVersion).toBeTruthy();
  });

  it("lists all tools via tools/list", async () => {
    const res = await rpc("tools/list");
    const result = res.result as { tools: { name: string }[] };
    const names = result.tools.map((t) => t.name);
    expect(names).toContain("decompose_task");
    expect(names).toContain("save_plan");
    expect(names.length).toBe(8);
  });

  it("returns method-not-found for an unknown method", async () => {
    const res = await rpc("does/notExist");
    expect(res.error?.code).toBe(-32601);
  });

  it("returns invalid-params when tool name is missing", async () => {
    const res = await rpc("tools/call", { arguments: {} });
    expect(res.error?.code).toBe(-32602);
  });

  it("surfaces tool errors as JSON-RPC -32000", async () => {
    const { response } = await callTool("decompose_task", {});
    expect(response.error?.code).toBe(-32000);
    expect(response.error?.message).toContain("`task` is required");
  });

  it("echoes back the request id", async () => {
    const res = await rpc("initialize");
    expect(typeof res.id === "number" || typeof res.id === "string").toBe(true);
  });
});

describe("full planning pipeline over HTTP", () => {
  it("decompose -> save_plan -> get_plan -> review -> save_memory -> query_memory", async () => {
    const decompose = await callTool("decompose_task", {
      task: "Introduce feature flags",
    });
    expect(decompose.response.error).toBeUndefined();
    const decomposition = decompose.payload;

    const save = await callTool("save_plan", {
      original_task: "Introduce feature flags",
      decomposition,
      workspace: "pipeline-ws",
    });
    const planId = (save.payload as { plan_id: string }).plan_id;
    expect(planId).toMatch(/[0-9a-f-]{36}/);

    const get = await callTool("get_plan", { plan_id: planId });
    expect((get.payload as { originalTask: string }).originalTask).toBe(
      "Introduce feature flags",
    );

    const review = await callTool("run_adversarial_review", {
      plan_id: planId,
      original_task: "Introduce feature flags",
    });
    expect(review.payload).toHaveProperty("risks");

    const mem = await callTool("save_memory", {
      key: "flags-lesson",
      value: "Roll out feature flags gradually",
      tags: ["rollout"],
      workspace: "pipeline-ws",
    });
    expect((mem.payload as { id: string }).id).toBeTruthy();

    const query = await callTool("query_memory", {
      query: "gradually",
      workspace: "pipeline-ws",
    });
    const results = (query.payload as { results: { key: string }[] }).results;
    expect(results).toHaveLength(1);
    expect(results[0].key).toBe("flags-lesson");
  });

  it("returns a JSON-RPC error when fetching a nonexistent plan", async () => {
    const { response } = await callTool("get_plan", { plan_id: "missing" });
    expect(response.error?.code).toBe(-32000);
    expect(response.error?.message).toContain("Plan not found");
  });
});
