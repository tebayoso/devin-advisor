# Research Report — Community Demands & Product Direction

This report distills the research that led to the `devin-scope` PRD. It summarizes historical
Devin/Cognition community demands, the space of ways to extend Devin, and the reasoning behind
choosing a Task Decomposition + Adversarial Review system delivered as a remote MCP + Playbook + Skill.

---

## 1. Historical Community Demands (2024–2026)

The Devin/Cognition community (Discord, r/CognitionLabs, X, Ambassadors, internal feedback channels)
has consistently pushed on the following themes. Cognition has publicly acknowledged many of these
as "most requested" / "highly requested" in its product updates.

1. **Control & recoverability** — Rollback / Checkpoints (Sept 2024, called "one of our most
   requested features"), Session Insights, sleep/wake sessions, more timeline transparency.
2. **Planning, scoping & prompts** — Underspecified prompts waste ACUs/time. Responses: Interactive
   Planning (Devin 2.0), Confidence Scores (🟢🟡🔴 in 2.1). Persistent demand for better handling of
   mid-task scope changes and ambiguous requirements.
3. **Reliability, autonomy & less hand-holding** — Loops/stalls, low real success on non-trivial
   tasks, too much supervision needed. Improvements: fewer loops, speed, self-verification, computer
   use, autofix of review/CI/lint comments, higher merge rates.
4. **Parallelism & scale** — Large backlogs, migrations, QA, refactors in parallel. Responses:
   MultiDevin / Managed Devins / Agent Fan Out, Scheduled Devins, batch edits.
5. **Pricing & accessibility** — Historically expensive; evolved toward more accessible tiers and
   usage-based pricing. Community still asks for intermediate plans and cost/ACU transparency.
6. **Integrations, collaboration & UX** — Slack, PR auto-responses, Linear/Jira, GitLab, IDE/Desktop
   (Windsurf → Devin Desktop), CLI + local↔cloud handoff, browser copy/paste, Knowledge/Playbooks
   auto-generation.
7. **Verification & "proof of work"** — Better self-testing, full computer use, screenshots/recordings,
   closing the write → review → autofix loop. Responses: Devin Review + Autofix, screen recordings.
8. **Other recurring demands** — Better context in large codebases, long-term memory, local/hybrid/
   self-hosted options, cheaper/faster models + model choice, better support for ambiguous/architectural
   tasks.

**Trend:** Early demand centered on control (checkpoints), reliability, and pricing. Current demand
skews toward more real autonomy (less supervision), better handling of ambiguity/scope changes, cost
efficiency, and multi-agent orchestration.

---

## 2. Ways to Extend Devin (Approaches Considered)

Recent (2025–2026) integration surfaces:

- **MCP (Model Context Protocol)** — Devin is fully MCP-compatible (MCP Marketplace, July 2025).
  Supports enabling official MCPs and adding custom MCP servers (stdio, SSE, HTTP). Devin also exposes
  its own server at `https://mcp.devin.ai/` for controlling sessions, playbooks, knowledge, schedules.
- **Skills + Plugins** — `SKILL.md` files teaching reusable workflows, invoked via `/name` or used
  autonomously. Plugins package skills, installable from GitHub/git URL/local folder. Typical paths:
  `.devin/skills/<name>/SKILL.md`, `.agents/skills/`.
- **ACP (Agent Client Protocol)** — Plug custom agents into Devin Desktop's Agent Command Center.
- **GitHub App / Agent Runners** — Heavier, out of scope for a fast demo.

**Ranking for a 90-minute, Cloud-first, high-impact build:**

| Rank | Approach | Integration depth | Comment |
| --- | --- | --- | --- |
| 1 | Custom Skill (`SKILL.md`) | Excellent | Cleanest, most native |
| 2 | Playbook (web app) | Very good | Reusable flows |
| 3 | Skill + minimal MCP | Excellent | If time allows |
| 4 | Official Devin MCP (`mcp.devin.ai`) | High | Powerful, more setup |
| 5 | Custom Subagent (`AGENT.md`) | Good | More advanced |
| 6 | ACP Custom Agent (Desktop) | Very high | Too much for 1 hour |
| 7 | Browser extension | Fragile | Not recommended |
| 8 | GitHub App / Agent Runner | Medium | Out of scope |

---

## 3. Which Demand to Target

Two demands are the strongest MCP targets:

1. **Observability / Error Triage** (production context, Sentry/Datadog) — highest real-world usage;
   heavily promoted by Cognition. (Explored via the `eventforge` repo, then set aside.)
2. **Scoping / decomposition of ambiguous tasks + multi-agent + self-verification** — directly attacks
   the #1 historical pain (underspecified prompts) and aligns with what Cognition is actively building
   (multi-agent that works, long-horizon reliability, self-verification, tool engineering).

**Chosen direction:** Task Decomposer + Confidence Router + Adversarial Review + Self-Verification.
It demonstrates product thinking and agent design that map directly onto Cognition's priorities, and it
can be built as MCP + Skill + Playbook.

---

## 4. Delivery Strategy (Cloud-first, closest-to-1-click)

Constraints: everything must run inside Devin **Cloud** agents; minimum configuration; open source;
anyone can try it during a demo.

- A true public "1-click" install does not exist for custom MCPs today (only official Marketplace MCPs
  have an "Enable" button). The closest feasible flow is:
  - **Remote MCP** (Streamable HTTP on Cloudflare Workers) — added once in
    Settings → Connections → MCP servers.
  - **Playbook** (primary distribution) — a minimal Playbook that forces the agent to call
    `get_scope_instructions` first and follow the returned workflow. Attached in 1 click per session.
  - **Skill** (`.agents/skills/scope/SKILL.md`) — secondary/power-user path, auto-discovered when the
    repo is connected to the org.
- **Serving the Skill from the MCP:** the MCP cannot *register* a real Devin Skill (with `/scope`,
  auto-discovery, triggers), but it **can** serve the Skill's content via a `get_scope_instructions`
  tool. Combined with a tiny Playbook, this is the closest to "just configure the MCP".
- **Memory must be remote** (Cloudflare D1) so different Cloud sessions share plan/review history.
- **Adversarial review (MVP, Modo A):** the tool returns a strong structured prompt and the same Devin
  agent performs the critique. Spawning a separate critic Devin session via the Devin API (Modo B) is
  deferred.

---

## 5. Outcome

The research converges on the `devin-scope` MVP defined in [`PRD.md`](./PRD.md): a remote MCP server
(Cloudflare Workers + D1) exposing decomposition, adversarial review, memory, and verification tools;
a minimal Playbook as the primary distribution method; and a native Skill for repo-connected users.
