import type { Env, Plan, TicketData, TicketProvider, TicketRef } from "./types.js";

type FetchLike = typeof fetch;

const LINEAR_ID_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const JIRA_ID_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/**
 * Parse a ticket reference (bare id or URL) into a provider + id pair.
 *
 * Supported URL shapes:
 *   Linear: https://linear.app/<workspace>/issue/<TEAM-123>/<slug>
 *   Jira:   https://<site>.atlassian.net/browse/<PROJ-123>
 *
 * A bare id (e.g. "ENG-123") is ambiguous, so an explicit `providerHint`
 * (from the tool argument or configured default) is required in that case.
 */
export function parseTicketRef(
  input: string,
  providerHint?: TicketProvider,
): TicketRef {
  const value = input.trim();
  if (!value) throw new Error("`ticket` must be a non-empty id or URL");

  if (/^https?:\/\//i.test(value)) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`Invalid ticket URL: ${value}`);
    }
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split("/").filter(Boolean);

    if (host === "linear.app" || host.endsWith(".linear.app")) {
      const idx = segments.indexOf("issue");
      const id = idx >= 0 ? segments[idx + 1] : undefined;
      if (!id) throw new Error(`Could not extract a Linear issue id from: ${value}`);
      return { provider: "linear", id };
    }

    if (host.endsWith(".atlassian.net") || providerHint === "jira") {
      const idx = segments.indexOf("browse");
      const id = idx >= 0 ? segments[idx + 1] : segments[segments.length - 1];
      if (!id) throw new Error(`Could not extract a Jira issue key from: ${value}`);
      return { provider: "jira", id };
    }

    throw new Error(
      `Unrecognized ticket URL host "${host}". Pass \`provider\` explicitly.`,
    );
  }

  const provider = providerHint;
  if (!provider) {
    throw new Error(
      `Ambiguous ticket id "${value}"; pass \`provider\` ("linear" or "jira") or use a full URL.`,
    );
  }
  const re = provider === "linear" ? LINEAR_ID_RE : JIRA_ID_RE;
  if (!re.test(value)) {
    throw new Error(`"${value}" does not look like a ${provider} ticket id.`);
  }
  return { provider, id: value };
}

export interface TicketClient {
  readonly provider: TicketProvider;
  fetchTicket(id: string): Promise<TicketData>;
  postComment(id: string, body: string): Promise<{ url?: string }>;
}

/** Flatten Atlassian Document Format (or a plain string) into readable text. */
export function adfToText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join("");
  if (typeof node === "object") {
    const n = node as { type?: string; text?: string; content?: unknown };
    const inner = adfToText(n.content);
    if (n.type === "paragraph") return `${inner}\n`;
    if (n.type === "hardBreak") return "\n";
    if (typeof n.text === "string") return n.text;
    return inner;
  }
  return "";
}

/** Wrap plain text into a minimal ADF document (required by Jira REST v3). */
function textToAdf(text: string): unknown {
  return {
    type: "doc",
    version: 1,
    content: text.split("\n").map((line) => ({
      type: "paragraph",
      content: line ? [{ type: "text", text: line }] : [],
    })),
  };
}

class LinearClient implements TicketClient {
  readonly provider: TicketProvider = "linear";
  private readonly endpoint = "https://api.linear.app/graphql";

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
  ) {}

  private async graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: this.apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) {
      throw new Error(`Linear API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`Linear API error: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    if (!json.data) throw new Error("Linear API returned no data");
    return json.data;
  }

  async fetchTicket(id: string): Promise<TicketData> {
    const data = await this.graphql<{
      issue: { id: string; identifier: string; title: string; description: string | null; url: string } | null;
    }>(
      `query($id: String!) { issue(id: $id) { id identifier title description url } }`,
      { id },
    );
    const issue = data.issue;
    if (!issue) throw new Error(`Linear issue not found: ${id}`);
    return {
      provider: "linear",
      id: issue.identifier,
      title: issue.title,
      description: issue.description ?? "",
      url: issue.url,
    };
  }

  async postComment(id: string, body: string): Promise<{ url?: string }> {
    const lookup = await this.graphql<{ issue: { id: string } | null }>(
      `query($id: String!) { issue(id: $id) { id } }`,
      { id },
    );
    if (!lookup.issue) throw new Error(`Linear issue not found: ${id}`);
    const data = await this.graphql<{
      commentCreate: { success: boolean; comment: { url: string } | null };
    }>(
      `mutation($issueId: String!, $body: String!) {
        commentCreate(input: { issueId: $issueId, body: $body }) { success comment { url } }
      }`,
      { issueId: lookup.issue.id, body },
    );
    if (!data.commentCreate.success) throw new Error("Linear commentCreate failed");
    return { url: data.commentCreate.comment?.url };
  }
}

class JiraClient implements TicketClient {
  readonly provider: TicketProvider = "jira";
  private readonly authHeader: string;
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    email: string,
    apiToken: string,
    private readonly fetchImpl: FetchLike,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.authHeader = `Basic ${btoa(`${email}:${apiToken}`)}`;
  }

  async fetchTicket(id: string): Promise<TicketData> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(id)}?fields=summary,description`,
      { headers: { Authorization: this.authHeader, Accept: "application/json" } },
    );
    if (!res.ok) {
      throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      key: string;
      fields: { summary: string; description: unknown };
    };
    return {
      provider: "jira",
      id: json.key,
      title: json.fields.summary,
      description: adfToText(json.fields.description).trim(),
      url: `${this.baseUrl}/browse/${json.key}`,
    };
  }

  async postComment(id: string, body: string): Promise<{ url?: string }> {
    const res = await this.fetchImpl(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(id)}/comment`,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ body: textToAdf(body) }),
      },
    );
    if (!res.ok) {
      throw new Error(`Jira API error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { id?: string };
    return { url: json.id ? `${this.baseUrl}/browse/${id}?focusedCommentId=${json.id}` : undefined };
  }
}

/** Build a ticket client for the given provider from configured env credentials. */
export function createTicketClient(
  provider: TicketProvider,
  env: Env,
  fetchImpl: FetchLike = fetch,
): TicketClient {
  if (provider === "linear") {
    if (!env.LINEAR_API_KEY) {
      throw new Error("LINEAR_API_KEY is not configured for this worker.");
    }
    return new LinearClient(env.LINEAR_API_KEY, fetchImpl);
  }
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) {
    throw new Error(
      "Jira requires JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN to be configured.",
    );
  }
  return new JiraClient(env.JIRA_BASE_URL, env.JIRA_EMAIL, env.JIRA_API_TOKEN, fetchImpl);
}

/** Turn a fetched ticket into the free-text task fed to decompose_task. */
export function ticketToTask(ticket: TicketData): string {
  const header = `[${ticket.id}] ${ticket.title}`.trim();
  const desc = ticket.description.trim();
  return desc ? `${header}\n\n${desc}` : header;
}

/** Render a saved plan as a Markdown comment to post back to the ticket. */
export function formatPlanComment(plan: Plan): string {
  const lines: string[] = [];
  lines.push("## devin-scope plan");
  lines.push("");
  lines.push(`**Task:** ${plan.originalTask}`);
  if (plan.confidenceSummary) {
    lines.push("");
    lines.push(`**Confidence:** ${plan.confidenceSummary}`);
  }
  lines.push("");
  lines.push(
    `**Strategy:** ${plan.decomposition.executionStrategy} · **Complexity:** ${plan.decomposition.estimatedComplexity}`,
  );
  lines.push("");
  lines.push("### Subtasks");
  for (const s of plan.decomposition.subtasks) {
    const deps = s.dependsOn.length ? ` (depends on: ${s.dependsOn.join(", ")})` : "";
    lines.push(`- **${s.title}** — _${s.confidence}_${deps}`);
    if (s.description) lines.push(`  - ${s.description}`);
  }
  lines.push("");
  lines.push(`_Plan id: ${plan.id}_`);
  return lines.join("\n");
}
