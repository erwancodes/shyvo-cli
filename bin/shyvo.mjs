#!/usr/bin/env node
import { createHash, getRandomValues } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { callTool, listTools, publicRequest, ShyvoError } from "../lib/api.mjs";
import { list, parseArgs } from "../lib/args.mjs";
import {
  clearUserConfig,
  findProjectLink,
  readState,
  readUserConfig,
  resolveAuth,
  writeProjectLink,
  writeState,
  writeUserConfig,
} from "../lib/config.mjs";
import { installSkills } from "../lib/skills.mjs";
import { installWidget } from "../lib/widget.mjs";

const HELP = `shyvo: Shyvo from the terminal, for you and your coding agent.

Setup
  shyvo login [--url <site>]           Sign in from the browser; saves an agent token
  shyvo logout                         Forget the saved token
  shyvo status                         Who you are, which project this repo is linked to
  shyvo projects                       List the projects the token can see
  shyvo link <project>                 Link this repository to a project (writes shyvo.json)
  shyvo skills install [--target claude|agents|all]
                                       Install the Shyvo agent skills in this repository

Issues
  shyvo issues list [--status todo]    List issues of the linked project
  shyvo issues show <ref>              One issue (2, #2 or slug#2)
  shyvo issues create --title <t> [--description <d>] [--type bug] [--priority medium]
                      [--feedback <id,...>]
  shyvo issues approve|revoke|rework|cancel|reopen <ref>
  shyvo fix <ref>                      Everything an agent needs to fix an issue

Work on an issue
  shyvo work start <ref>               Claim an approved issue (moves to In Progress)
  shyvo work renew [<ref>]             Renew the run lease (every 5 min while working)
  shyvo pr link <ref> <pr>             Link the PR (number, #12 or GitHub URL)
  shyvo work complete <ref> --summary <s> [--tests <t>] [--risks <r>]
                                       Hand the issue to human review (moves to PR Review)
  shyvo work release <ref> --summary <s>
                                       Give the work up (back to Todo)
  shyvo comment <ref> <text>           Comment on an issue

Feedback
  shyvo feedback list [--state new] [--type bug]
  shyvo feedback show <id>
  shyvo feedback triage <id>           Ask the AI to triage a feedback
  shyvo feedback accept|dismiss <id>   Review the AI triage proposal
  shyvo feedback mark <id> <new|reviewed|processed>

Feedback widget
  shyvo widget setup [--origin <url>...]   Show (or create) the widget keys
  shyvo widget install [--origin <url>...] [--mode auto|npm|script] [--no-env] [--dry-run]
                                       Add the widget to this app

Anything else
  shyvo tools                          List every tool the token can call
  shyvo call <tool> [--input '<json>'] Call any tool directly

Global flags: --project <id|slug>, --url <site>, --json, --help
Env: SHYVO_AGENT_TOKEN, SHYVO_URL, SHYVO_CONFIG

Shyvo never merges, deploys or resolves: a human reviews, GitHub merges.`;

const BOOLEANS = ["json", "help", "dry-run", "env", "force"];

// ---------- output ----------

let jsonMode = false;

function out(value, human) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  if (human === undefined) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${typeof human === "function" ? human(value) : human}\n`);
}

const log = (line = "") => {
  if (!jsonMode) process.stderr.write(`${line}\n`);
};

const pad = (value, width) => String(value ?? "").padEnd(width);
const table = (rows, columns) => {
  if (rows.length === 0) return "(none)";
  const widths = columns.map(([label, get]) =>
    Math.min(
      60,
      Math.max(label.length, ...rows.map((row) => String(get(row) ?? "").length)),
    ),
  );
  const line = (cells) =>
    cells.map((cell, i) => pad(String(cell ?? "").slice(0, widths[i]), widths[i])).join("  ").trimEnd();
  return [
    line(columns.map(([label]) => label)),
    ...rows.map((row) => line(columns.map(([, get]) => get(row)))),
  ].join("\n");
};

const fail = (message) => {
  throw new ShyvoError(message);
};

// ---------- token (same format as the server's agent tokens) ----------

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
function generateToken() {
  const limit = 256 - (256 % ALPHABET.length);
  let body = "";
  while (body.length < 64) {
    for (const byte of getRandomValues(new Uint8Array(96))) {
      if (byte >= limit) continue;
      body += ALPHABET[byte % ALPHABET.length];
      if (body.length === 64) break;
    }
  }
  return `shy_${body}`;
}
const hashToken = (token) =>
  createHash("sha256").update(token).digest("base64url");

// ---------- project and issue resolution ----------

async function resolveProject(flags) {
  if (flags.project) {
    const wanted = String(flags.project);
    const { projects } = await callTool("list_projects", {}, flags);
    const match = projects.find(
      (project) => project.id === wanted || project.slug === wanted,
    );
    if (!match)
      fail(
        `No project "${wanted}". Known: ${projects.map((p) => p.slug).join(", ") || "(none)"}`,
      );
    return { projectId: match.id, slug: match.slug, root: process.cwd() };
  }
  const link = await findProjectLink();
  if (link?.projectId)
    return { projectId: link.projectId, slug: link.project, root: link.root };
  const { projects } = await callTool("list_projects", {}, flags);
  if (projects.length === 1)
    return { projectId: projects[0].id, slug: projects[0].slug, root: process.cwd() };
  fail(
    "No project linked. Run `shyvo link <project>` or pass --project <slug>. Projects: " +
      (projects.map((p) => p.slug).join(", ") || "(none)"),
  );
}

/** `2`, `#2` or `slug#2` → the issue summary. */
async function resolveIssue(ref, flags) {
  if (!ref) fail("Missing issue reference (2, #2 or project-slug#2).");
  const text = String(ref).trim();
  const bare = /^#?(\d+)$/u.exec(text);
  if (bare) {
    const project = await resolveProject(flags);
    const { issue } = await callTool(
      "get_issue",
      { projectId: project.projectId, number: Number(bare[1]) },
      flags,
    );
    return { issue, project };
  }
  const { issue } = await callTool("get_issue", { reference: text }, flags);
  const link = await findProjectLink();
  return {
    issue,
    project: {
      projectId: issue.projectId,
      root: link?.projectId === issue.projectId ? link.root : process.cwd(),
    },
  };
}

const issueLine = (issue) =>
  `${issue.reference}  [${issue.status}] ${issue.priority} ${issue.type}  ${issue.title}`;

// ---------- commands ----------

async function login(flags) {
  const { baseUrl } = await resolveAuth(flags);
  const token = generateToken();
  const tokenHash = hashToken(token);
  const deviceName = String(flags.name ?? `shyvo CLI on ${hostname()}`).slice(0, 80);
  const start = await publicRequest(baseUrl, "/api/v1/cli/login", {
    tokenHash,
    tokenStart: token.slice(0, 6),
    deviceName,
  });

  log(`Open this page and approve the sign-in:`);
  log(`  ${start.verifyUrl}`);
  log(`Code: ${start.userCode}`);
  log(`Waiting for approval...`);
  if (!jsonMode && flags.open !== false) openBrowser(start.verifyUrl);

  const deadline = Math.min(start.expiresAt ?? Infinity, Date.now() + 15 * 60_000);
  while (Date.now() < deadline) {
    await sleep(2000);
    const poll = await publicRequest(baseUrl, "/api/v1/cli/login/poll", {
      loginId: start.loginId,
      tokenHash,
    });
    if (poll.status === "pending") continue;
    if (poll.status !== "approved")
      fail(`Sign-in ${poll.status}. Run \`shyvo login\` again.`);
    const path = await writeUserConfig({
      baseUrl,
      token,
      organizationId: poll.organizationId,
      agentAccessId: poll.agentAccessId,
      tokenExpiresAt: poll.expiresAt,
      savedAt: new Date().toISOString(),
    });
    out(
      { status: "approved", baseUrl, config: path, organizationId: poll.organizationId },
      `Signed in. Token saved to ${path}. Next: \`shyvo link <project>\` in your repository.`,
    );
    return;
  }
  fail("Sign-in timed out. Run `shyvo login` again.");
}

function openBrowser(url) {
  import("node:child_process")
    .then(({ spawn }) => {
      const [cmd, args] =
        process.platform === "win32"
          ? ["cmd", ["/c", "start", "", url]]
          : process.platform === "darwin"
            ? ["open", [url]]
            : ["xdg-open", [url]];
      const child = spawn(cmd, args, { stdio: "ignore", detached: true });
      child.on("error", () => {});
      child.unref();
    })
    .catch(() => {});
}

async function status(flags) {
  const { baseUrl, token, config } = await resolveAuth(flags);
  const link = await findProjectLink();
  const source = process.env.SHYVO_AGENT_TOKEN ? "SHYVO_AGENT_TOKEN" : config.token ? "config" : null;
  let projects = null;
  let error = null;
  if (token) {
    try {
      ({ projects } = await callTool("list_projects", {}, flags));
    } catch (caught) {
      error = caught.message;
    }
  }
  const value = {
    baseUrl,
    loggedIn: Boolean(token) && !error,
    tokenSource: source,
    tokenExpiresAt: config.tokenExpiresAt ?? null,
    linkedProject: link ? { projectId: link.projectId, project: link.project, file: link.path } : null,
    projects: projects?.map((p) => p.slug) ?? null,
    error,
  };
  out(value, () =>
    [
      `Shyvo:    ${baseUrl}`,
      `Token:    ${token ? `${source}${error ? ` (rejected: ${error})` : ""}` : "none (run `shyvo login`)"}`,
      `Project:  ${link ? `${link.project ?? link.projectId} (${link.path})` : "not linked (run `shyvo link <project>`)"}`,
      projects ? `Visible:  ${projects.map((p) => p.slug).join(", ") || "(none)"}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function projects(flags) {
  const result = await callTool("list_projects", {}, flags);
  out(result, () =>
    table(result.projects, [
      ["SLUG", (p) => p.slug],
      ["NAME", (p) => p.name],
      ["ID", (p) => p.id],
    ]),
  );
}

async function link(positionals, flags) {
  const wanted = positionals[0] ?? flags.project;
  if (!wanted) fail("Usage: shyvo link <project-slug-or-id>");
  const { projects } = await callTool("list_projects", {}, flags);
  const project = projects.find((p) => p.id === wanted || p.slug === wanted);
  if (!project)
    fail(`No project "${wanted}". Known: ${projects.map((p) => p.slug).join(", ") || "(none)"}`);
  const path = await writeProjectLink(process.cwd(), project);
  out(
    { projectId: project.id, project: project.slug, file: path },
    `Linked to ${project.name} (${project.slug}). Wrote ${path}; commit it so every agent finds the project.`,
  );
}

const DECISIONS = {
  approve: "approve_issue",
  revoke: "revoke_issue_approval",
  rework: "request_issue_rework",
  cancel: "cancel_issue",
  reopen: "reopen_issue",
};

async function issues([sub = "list", ...rest], flags) {
  if (sub === "list" || sub === "ls") {
    const project = await resolveProject(flags);
    const result = await callTool(
      "list_issues",
      {
        projectId: project.projectId,
        status: flags.status,
        limit: Number(flags.limit ?? 50),
        cursor: flags.cursor,
      },
      flags,
    );
    const rows = result.issues ?? result.page ?? [];
    out(result, () => table(rows, [
      ["REF", (i) => i.reference],
      ["STATUS", (i) => i.status],
      ["PRIORITY", (i) => i.priority],
      ["TYPE", (i) => i.type],
      ["TITLE", (i) => i.title],
    ]));
    return;
  }
  if (sub === "show" || sub === "get") {
    const { issue } = await resolveIssue(rest[0], flags);
    out({ issue }, () => formatIssue(issue));
    return;
  }
  if (sub === "create") {
    const project = await resolveProject(flags);
    if (!flags.title) fail("Usage: shyvo issues create --title <title> [--description <text>]");
    const result = await callTool(
      "create_issue",
      {
        projectId: project.projectId,
        title: String(flags.title),
        description: flags.description ? String(flags.description) : "",
        type: flags.type,
        priority: flags.priority,
        labels: flags.label ? list(flags.label) : undefined,
        feedbackIds: flags.feedback ? list(flags.feedback) : undefined,
      },
      flags,
    );
    out(result, (value) =>
      `Created ${value.issue?.reference ?? value.reference ?? "the issue"} in Inbox. Approve it with \`shyvo issues approve <ref>\` before work starts.`,
    );
    return;
  }
  if (DECISIONS[sub]) {
    const { issue, project } = await resolveIssue(rest[0], flags);
    const input = { projectId: project.projectId, issueId: issue.id };
    if (sub === "approve") input.expectedRevision = issue.revision;
    const result = await callTool(DECISIONS[sub], input, flags);
    out(result, (value) =>
      `${issue.reference}: ${sub} done${value.status ? ` (now ${value.status})` : ""}.`,
    );
    return;
  }
  fail(`Unknown: shyvo issues ${sub}. See \`shyvo --help\`.`);
}

function formatIssue(issue) {
  return [
    issueLine(issue),
    issue.labels?.length ? `labels: ${issue.labels.join(", ")}` : null,
    issue.description ? `\n${issue.description}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function fix(ref, flags) {
  const { issue, project } = await resolveIssue(ref, flags);
  const [feedback, context] = await Promise.all([
    callTool("list_issue_feedback", { projectId: project.projectId, number: issue.number, limit: 20 }, flags).catch((error) => ({ error: error.message })),
    callTool("get_project_context", { projectId: project.projectId }, flags).catch((error) => ({ error: error.message })),
  ]);
  const state = await readState(project.root);
  const run = state.runs?.[issue.id];

  const next = [];
  if (issue.status === "inbox")
    next.push(`The issue is in Inbox (not approved). Read it, then \`shyvo issues approve ${issue.reference}\` if it is worth doing.`);
  if (issue.status === "inbox" || issue.status === "todo")
    next.push(`Claim it: \`shyvo work start ${issue.reference}\`.`);
  if (issue.status === "in_progress" && run)
    next.push(`Your run ${run.agentRunId} is open; renew it with \`shyvo work renew ${issue.reference}\` every 5 minutes.`);
  next.push(
    "Fix it on a new branch, run the project's checks, push and open a pull request.",
    `\`shyvo pr link ${issue.reference} <pr-number>\`, then \`shyvo work complete ${issue.reference} --summary "..." --tests "..."\`.`,
    "Never merge, deploy or resolve: a human reviews and merges.",
  );

  const value = { issue, feedback, context, run: run ?? null, nextSteps: next };
  out(value, () => {
    const feedbackItems = feedback.feedback ?? feedback.page ?? [];
    return [
      "# Issue",
      formatIssue(issue),
      "",
      "# Feedback from users",
      feedback.error
        ? `(unavailable: ${feedback.error})`
        : feedbackItems.length
          ? feedbackItems.map((item) => `- [${item.type ?? "feedback"}] ${item.message ?? item.body ?? item.title ?? JSON.stringify(item)}`).join("\n")
          : "(none linked)",
      "",
      "# Project context",
      context.error ? `(unavailable: ${context.error})` : JSON.stringify(context.context ?? context, null, 2),
      "",
      "# Next steps",
      ...next.map((step, i) => `${i + 1}. ${step}`),
    ].join("\n");
  });
}

async function work([sub, ref], flags) {
  const { issue, project } = await resolveIssue(ref, flags);
  const state = await readState(project.root);
  state.runs ??= {};
  const run = state.runs[issue.id];
  const needRun = () => {
    if (!run?.agentRunId)
      fail(`No run recorded for ${issue.reference} in ${project.root}/.shyvo/state.json. Run \`shyvo work start ${issue.reference}\` first.`);
    return run;
  };

  if (sub === "start") {
    const requestKey = run?.requestKey ?? `cli-${issue.id}-${Date.now()}`;
    const result = await callTool(
      "start_issue_work",
      { projectId: project.projectId, issueId: issue.id, requestKey },
      flags,
    );
    state.runs[issue.id] = {
      reference: issue.reference,
      projectId: project.projectId,
      agentRunId: result.agentRunId,
      requestKey,
      startedAt: new Date().toISOString(),
    };
    await writeState(project.root, state);
    out(result, `Started ${issue.reference} (run ${result.agentRunId}). Renew every 5 minutes with \`shyvo work renew ${issue.reference}\`.`);
    return;
  }
  if (sub === "renew") {
    const result = await callTool("renew_issue_work", { agentRunId: needRun().agentRunId }, flags);
    out(result, `Renewed the run on ${issue.reference}.`);
    return;
  }
  if (sub === "complete") {
    const current = needRun();
    if (!current.pullRequestLinkId)
      fail(`Link the pull request first: \`shyvo pr link ${issue.reference} <pr>\`.`);
    if (!flags.summary) fail('Pass --summary "what changed" (and --tests, --risks).');
    const result = await callTool(
      "complete_issue_work",
      {
        agentRunId: current.agentRunId,
        pullRequestLinkId: current.pullRequestLinkId,
        summary: String(flags.summary),
        tests: flags.tests ? String(flags.tests) : undefined,
        risks: flags.risks ? String(flags.risks) : undefined,
      },
      flags,
    );
    delete state.runs[issue.id];
    await writeState(project.root, state);
    out(result, `${issue.reference} is in PR Review. A human reviews and merges; the merge resolves it.`);
    return;
  }
  if (sub === "release") {
    if (!flags.summary) fail('Pass --summary "why the work stops".');
    const result = await callTool(
      "update_issue_status",
      { agentRunId: needRun().agentRunId, status: "todo", summary: String(flags.summary) },
      flags,
    );
    delete state.runs[issue.id];
    await writeState(project.root, state);
    out(result, `Released ${issue.reference}; it is back in Todo.`);
    return;
  }
  fail("Usage: shyvo work start|renew|complete|release <ref>");
}

async function pr([sub, ref, reference], flags) {
  if (sub !== "link") fail("Usage: shyvo pr link <issue-ref> <pr-number|#12|url>");
  if (!reference) fail("Missing the pull request (number, #12 or GitHub URL).");
  const { issue, project } = await resolveIssue(ref, flags);
  const state = await readState(project.root);
  const run = state.runs?.[issue.id];
  if (!run?.agentRunId)
    fail(`No run recorded for ${issue.reference}. Run \`shyvo work start ${issue.reference}\` first.`);
  const result = await callTool(
    "link_pull_request",
    { projectId: project.projectId, issueId: issue.id, agentRunId: run.agentRunId, reference: String(reference) },
    flags,
  );
  run.pullRequestLinkId = result.pullRequestLinkId;
  run.pullRequest = String(reference);
  await writeState(project.root, state);
  out(result, `Linked ${reference} to ${issue.reference}. Next: \`shyvo work complete ${issue.reference} --summary "..."\`.`);
}

async function comment([ref, ...words], flags) {
  const body = words.join(" ") || flags.body;
  if (!body) fail("Usage: shyvo comment <ref> <text>");
  const { issue, project } = await resolveIssue(ref, flags);
  const state = await readState(project.root);
  const result = await callTool(
    "add_issue_comment",
    {
      projectId: project.projectId,
      issueId: issue.id,
      body: String(body),
      requestKey: `cli-comment-${issue.id}-${hashToken(String(body)).slice(0, 16)}`,
      agentRunId: state.runs?.[issue.id]?.agentRunId,
    },
    flags,
  );
  out(result, `Commented on ${issue.reference}.`);
}

async function feedback([sub = "list", id, extra], flags) {
  const project = await resolveProject(flags);
  const base = { projectId: project.projectId };
  if (sub === "list" || sub === "ls") {
    const result = await callTool(
      "list_feedback",
      { ...base, state: flags.state, type: flags.type, limit: Number(flags.limit ?? 50), cursor: flags.cursor },
      flags,
    );
    const rows = result.feedback ?? result.page ?? [];
    out(result, () => table(rows, [
      ["ID", (f) => f.id],
      ["STATE", (f) => f.state],
      ["TYPE", (f) => f.type],
      ["MESSAGE", (f) => (f.message ?? f.title ?? "").replace(/\s+/gu, " ")],
    ]));
    return;
  }
  if (!id) fail(`Usage: shyvo feedback ${sub} <feedback-id>`);
  if (sub === "show" || sub === "get") {
    out(await callTool("get_feedback", { ...base, feedbackId: id }, flags));
    return;
  }
  if (sub === "triage") {
    const result = await callTool("request_feedback_triage", { ...base, feedbackId: id }, flags);
    out(result, "Triage requested. Check the proposal with `shyvo feedback show <id>`, then accept or dismiss it.");
    return;
  }
  if (sub === "accept" || sub === "dismiss") {
    const result = await callTool(
      "review_feedback_triage",
      { ...base, feedbackId: id, decision: sub === "accept" ? "accepted" : "dismissed" },
      flags,
    );
    out(result, `Triage ${sub === "accept" ? "accepted" : "dismissed"}.`);
    return;
  }
  if (sub === "mark") {
    if (!extra) fail("Usage: shyvo feedback mark <id> <new|reviewed|processed>");
    const result = await callTool("set_feedback_state", { ...base, feedbackId: id, state: extra }, flags);
    out(result, `Feedback marked ${extra}.`);
    return;
  }
  fail(`Unknown: shyvo feedback ${sub}. See \`shyvo --help\`.`);
}

async function widget([sub = "install"], flags) {
  const project = await resolveProject(flags);
  const origins = list(flags.origin);
  const setup = origins.length
    ? await callTool("setup_feedback_widget", { projectId: project.projectId, origins }, flags)
    : await callTool("get_feedback_widget_setup", { projectId: project.projectId }, flags);
  if (!setup.publicKey)
    fail("The widget is not set up yet for this project. Pass the app's origins: --origin https://myapp.com --origin http://localhost:3000");

  if (sub === "setup" || sub === "show") {
    out(setup, () =>
      [
        `Public key:  ${setup.publicKey}`,
        `Endpoint:    ${setup.endpoint}`,
        `Script:      ${setup.scriptUrl}`,
        `npm:         ${setup.npmPackage}`,
        `Origins:     ${setup.allowedOrigins?.join(", ") || "(none)"}`,
      ].join("\n"),
    );
    return;
  }
  if (sub !== "install") fail("Usage: shyvo widget setup|install");
  const result = await installWidget(setup, {
    root: project.root,
    mode: flags.mode ?? "auto",
    writeEnv: flags.env !== false,
    dryRun: flags.dryRun === true,
  });
  out(result, () =>
    [
      `Framework: ${result.framework} (${result.mode} mode)`,
      result.files.length
        ? `${flags.dryRun === true ? "Would write:" : "Wrote:     "} ${result.files.join(", ")}`
        : null,
      result.env.length ? `Env:       ${result.env.join(", ")} added to ${result.envFile}` : null,
      result.envValues ? `Env to set: ${Object.entries(result.envValues).map(([k, v]) => `${k}=${v}`).join("  ")}` : null,
      result.snippet ? `\nSnippet:\n${result.snippet}\n` : null,
      "Next:",
      ...result.nextSteps.map((step, i) => `  ${i + 1}. ${step}`),
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function skills([sub = "install"], flags) {
  if (sub !== "install") fail("Usage: shyvo skills install [--target claude|agents|all]");
  const result = await installSkills({ root: process.cwd(), target: flags.target ?? "all", force: flags.force === true });
  out(result, () =>
    [
      `Installed ${result.skills.join(", ")} in:`,
      ...result.directories.map((dir) => `  ${dir}`),
      result.skipped.length ? `Kept existing (use --force to overwrite): ${result.skipped.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

async function tools(flags) {
  const result = await listTools(flags);
  const rows = result.tools ?? result ?? [];
  out(result, () => table(Array.isArray(rows) ? rows : [], [
    ["TOOL", (t) => t.name],
    ["SCOPE", (t) => t.scope ?? ""],
    ["DESCRIPTION", (t) => t.description],
  ]));
}

async function call([name], flags) {
  if (!name) fail("Usage: shyvo call <tool> [--input '<json>']");
  let input = {};
  if (flags.input) {
    try {
      input = JSON.parse(String(flags.input));
    } catch {
      fail("--input must be valid JSON.");
    }
  }
  out(await callTool(name, input, flags));
}

// ---------- main ----------

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2), { booleans: BOOLEANS });
  jsonMode = flags.json === true;
  const [command, ...rest] = positionals;

  if (!command || flags.help || command === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (command === "--version" || command === "version" || flags.version) {
    process.stdout.write("0.1.0\n");
    return;
  }

  switch (command) {
    case "login":
      return login(flags);
    case "logout": {
      const config = await readUserConfig();
      await clearUserConfig();
      return out({ loggedOut: true }, config.token
        ? "Logged out locally. Revoke the token in Shyvo (Agents page) if it may have leaked."
        : "No saved token.");
    }
    case "status":
    case "whoami":
      return status(flags);
    case "projects":
      return projects(flags);
    case "link":
      return link(rest, flags);
    case "issues":
    case "issue":
      return issues(rest, flags);
    case "fix":
      return fix(rest[0], flags);
    case "work":
      return work(rest, flags);
    case "pr":
      return pr(rest, flags);
    case "comment":
      return comment(rest, flags);
    case "feedback":
      return feedback(rest, flags);
    case "widget":
      return widget(rest, flags);
    case "skills":
      return skills(rest, flags);
    case "tools":
      return tools(flags);
    case "call":
      return call(rest, flags);
    default:
      fail(`Unknown command "${command}". Run \`shyvo --help\`.`);
  }
}

main().catch((error) => {
  if (jsonMode)
    process.stdout.write(`${JSON.stringify({ error: error.message, status: error.status ?? null }, null, 2)}\n`);
  else process.stderr.write(`shyvo: ${error.message}\n`);
  process.exitCode = 1;
});
