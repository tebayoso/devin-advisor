import assert from "node:assert/strict";
import { test } from "node:test";

import { callTool } from "../src/tools.js";
import {
  adfToText,
  createTicketClient,
  formatPlanComment,
  parseTicketRef,
  ticketToTask,
} from "../src/tickets.js";
import type { Env, Plan, TicketData } from "../src/types.js";

const noopEnv = {} as Env;

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  } as unknown as Response;
}

test("parseTicketRef extracts id from a Linear URL", () => {
  const ref = parseTicketRef("https://linear.app/acme/issue/ENG-123/some-slug");
  assert.deepEqual(ref, { provider: "linear", id: "ENG-123" });
});

test("parseTicketRef extracts key from a Jira URL", () => {
  const ref = parseTicketRef("https://acme.atlassian.net/browse/PROJ-42");
  assert.deepEqual(ref, { provider: "jira", id: "PROJ-42" });
});

test("parseTicketRef uses the provider hint for a bare id", () => {
  assert.deepEqual(parseTicketRef("ENG-9", "linear"), { provider: "linear", id: "ENG-9" });
});

test("parseTicketRef rejects an ambiguous bare id", () => {
  assert.throws(() => parseTicketRef("ENG-9"), /Ambiguous/);
});

test("adfToText flattens an ADF document", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      { type: "paragraph", content: [{ type: "text", text: "World" }] },
    ],
  };
  assert.equal(adfToText(doc).trim(), "Hello\nWorld");
});

test("adfToText separates headings and list items with newlines", () => {
  const doc = {
    type: "doc",
    content: [
      { type: "heading", content: [{ type: "text", text: "Goals" }] },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }] },
        ],
      },
    ],
  };
  const lines = adfToText(doc).split("\n").filter(Boolean);
  assert.deepEqual(lines, ["Goals", "- First", "- Second"]);
});

test("Linear client fetches a ticket via GraphQL", async () => {
  const calls: RequestInit[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    calls.push(init);
    return jsonResponse({
      data: {
        issue: {
          id: "uuid-1",
          identifier: "ENG-123",
          title: "Fix login",
          description: "Users cannot log in.",
          url: "https://linear.app/acme/issue/ENG-123",
        },
      },
    });
  }) as unknown as typeof fetch;

  const client = createTicketClient("linear", { LINEAR_API_KEY: "k" } as Env, fetchImpl);
  const ticket = await client.fetchTicket("ENG-123");
  assert.equal(ticket.title, "Fix login");
  assert.equal(ticket.id, "ENG-123");
  assert.equal((calls[0].headers as Record<string, string>).Authorization, "k");
});

test("Jira client posts a comment as ADF", async () => {
  let body: unknown;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    body = JSON.parse(init.body as string);
    return jsonResponse({ id: "10001" });
  }) as unknown as typeof fetch;

  const env = {
    JIRA_BASE_URL: "https://acme.atlassian.net",
    JIRA_EMAIL: "me@acme.com",
    JIRA_API_TOKEN: "t",
  } as Env;
  const client = createTicketClient("jira", env, fetchImpl);
  const res = await client.postComment("PROJ-42", "hello\nworld");
  assert.match(res.url ?? "", /focusedCommentId=10001/);
  assert.equal((body as { body: { type: string } }).body.type, "doc");
});

test("createTicketClient throws when credentials are missing", () => {
  assert.throws(() => createTicketClient("linear", noopEnv), /LINEAR_API_KEY/);
  assert.throws(() => createTicketClient("jira", noopEnv), /JIRA_BASE_URL/);
});

test("ticketToTask combines id, title and description", () => {
  const ticket: TicketData = {
    provider: "linear",
    id: "ENG-1",
    title: "Add search",
    description: "Support fuzzy matching.",
    url: "https://linear.app/x/issue/ENG-1",
  };
  assert.equal(ticketToTask(ticket), "[ENG-1] Add search\n\nSupport fuzzy matching.");
});

test("scope_ticket drives decomposition end-to-end from a ticket", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      data: {
        issue: {
          id: "uuid-1",
          identifier: "ENG-7",
          title: "Rate limiting",
          description: "Add per-user rate limits.",
          url: "https://linear.app/acme/issue/ENG-7",
        },
      },
    })) as unknown as typeof fetch;

  const result = (await callTool(
    { LINEAR_API_KEY: "k" } as Env,
    "scope_ticket",
    { ticket: "https://linear.app/acme/issue/ENG-7/rate-limiting" },
    fetchImpl,
  )) as { ticket: TicketData; task: string; decomposition: { subtasks: unknown[] } };

  assert.equal(result.ticket.id, "ENG-7");
  assert.match(result.task, /Rate limiting/);
  assert.ok(result.decomposition.subtasks.length > 0);
});

test("formatPlanComment renders a Markdown summary", () => {
  const plan: Plan = {
    id: "plan-1",
    workspace: null,
    originalTask: "Do the thing",
    confidenceSummary: "medium overall",
    createdAt: "2026-01-01T00:00:00.000Z",
    decomposition: {
      subtasks: [
        {
          id: "s1",
          title: "Step one",
          description: "Details",
          confidence: "high",
          justification: "clear",
          dependsOn: [],
        },
      ],
      executionStrategy: "sequential",
      estimatedComplexity: "medium",
      confidenceSummary: "medium overall",
    },
  };
  const md = formatPlanComment(plan);
  assert.match(md, /## devin-scope plan/);
  assert.match(md, /Step one/);
  assert.match(md, /plan-1/);
});
