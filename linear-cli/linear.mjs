#!/usr/bin/env node

// Linear CLI — thin wrapper around Linear's GraphQL API
// No dependencies, just fetch.

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_FILE = join(__dirname, '.env');

// ── Config ──────────────────────────────────────────────────────────────────

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const env = loadEnv();
const TOKEN_USER = env.LINEAR_TOKEN || process.env.LINEAR_TOKEN;
const TOKEN_AGENTS = env.LINEAR_TOKEN_AGENTS || process.env.LINEAR_TOKEN_AGENTS;

const API = 'https://api.linear.app/graphql';
const TEAM_KEY = 'IK';

// Well-known IDs (IK workspace)
const KNOWN = {
  team: 'da0118dc-08c3-4196-a964-b57e20887327',
  labels: { 'agent handoff': '7e6c2289-0320-4b0d-8d89-92f0429ea1a7' },
  states: { 'todo': 'ef14e92f-39f7-415c-a05c-4600491aae7f' },
};

// ── GraphQL helper ──────────────────────────────────────────────────────────

async function gql(query, variables = {}, token = TOKEN_USER) {
  if (!token) {
    console.error('Error: No Linear API token configured. Set LINEAR_TOKEN in .env or environment.');
    process.exit(1);
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Linear API error ${res.status}: ${text}`);
    process.exit(1);
  }
  const json = await res.json();
  if (json.errors) {
    console.error(`GraphQL errors: ${JSON.stringify(json.errors, null, 2)}`);
    process.exit(1);
  }
  return json.data;
}

// ── Resolvers ───────────────────────────────────────────────────────────────

async function resolveIssueId(identifier) {
  // identifier like "IK-93"
  const data = await gql(
    `query($id: String!) { issue(id: $id) { id identifier title } }`,
    { id: identifier }
  );
  if (!data.issue) {
    console.error(`Issue ${identifier} not found`);
    process.exit(1);
  }
  return data.issue;
}

function resolveLabelId(name) {
  const key = name.toLowerCase();
  if (KNOWN.labels[key]) return KNOWN.labels[key];
  console.error(`Unknown label: "${name}". Known labels: ${Object.keys(KNOWN.labels).join(', ')}`);
  process.exit(1);
}

function resolveStateId(name) {
  const key = name.toLowerCase();
  if (KNOWN.states[key]) return KNOWN.states[key];
  console.error(`Unknown state: "${name}". Known states: ${Object.keys(KNOWN.states).join(', ')}`);
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function readStdin() {
  return readFileSync('/dev/stdin', 'utf8');
}

// ── Commands ────────────────────────────────────────────────────────────────

async function issueCreate(args) {
  const title = args.title;
  let body = args.body || '';
  if (args['body-file']) body = readFileSync(args['body-file'], 'utf8');
  if (!title) { console.error('Error: --title is required'); process.exit(1); }

  const input = {
    teamId: KNOWN.team,
    title,
    description: body,
  };

  if (args.label) input.labelIds = [resolveLabelId(args.label)];
  if (args.state) input.stateId = resolveStateId(args.state);

  const data = await gql(
    `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { id identifier title url }
      }
    }`,
    { input }
  );

  const issue = data.issueCreate.issue;
  if (args.json) {
    console.log(JSON.stringify(issue, null, 2));
  } else {
    console.log(`Created ${issue.identifier}: ${issue.title}`);
    console.log(issue.url);
  }
}

async function issueList(args) {
  const limit = parseInt(args.limit || '10', 10);
  const data = await gql(
    `query($teamKey: String!, $limit: Int!) {
      team(id: $teamKey) {
        issues(first: $limit, orderBy: createdAt) {
          nodes { identifier title state { name } createdAt url }
        }
      }
    }`,
    { teamKey: TEAM_KEY, limit }
  );

  const issues = data.team.issues.nodes;
  if (args.json) {
    console.log(JSON.stringify(issues, null, 2));
  } else {
    if (issues.length === 0) { console.log('No issues found.'); return; }
    for (const i of issues) {
      const state = i.state?.name || '?';
      console.log(`${i.identifier}  [${state}]  ${i.title}`);
    }
  }
}

async function issueShow(args) {
  const identifier = args._positional[0];
  if (!identifier) { console.error('Error: issue identifier required (e.g. IK-93)'); process.exit(1); }

  const data = await gql(
    `query($id: String!) {
      issue(id: $id) {
        id identifier title description url
        state { name }
        labels { nodes { name } }
        assignee { name }
        createdAt updatedAt
        comments { nodes { body createdAt user { name } } }
      }
    }`,
    { id: identifier }
  );

  const issue = data.issue;
  if (!issue) { console.error(`Issue ${identifier} not found`); process.exit(1); }

  if (args.json) {
    console.log(JSON.stringify(issue, null, 2));
  } else {
    const labels = issue.labels.nodes.map(l => l.name).join(', ') || 'none';
    console.log(`${issue.identifier}: ${issue.title}`);
    console.log(`State: ${issue.state?.name || '?'}  |  Labels: ${labels}  |  Assignee: ${issue.assignee?.name || 'unassigned'}`);
    console.log(`URL: ${issue.url}`);
    if (issue.description) {
      console.log(`\n--- Description ---\n${issue.description}`);
    }
    if (issue.comments.nodes.length > 0) {
      console.log(`\n--- Comments (${issue.comments.nodes.length}) ---`);
      for (const c of issue.comments.nodes) {
        const date = new Date(c.createdAt).toLocaleDateString();
        console.log(`\n[${c.user?.name || 'Unknown'} — ${date}]`);
        console.log(c.body);
      }
    }
  }
}

async function commentAdd(args) {
  const identifier = args._positional[0];
  let body = args._positional[1];

  // Support --body-file or piped stdin (body arg is "-" or missing)
  if (args['body-file']) {
    body = readFileSync(args['body-file'], 'utf8');
  } else if (!body || body === '-') {
    try { body = readStdin(); } catch { body = null; }
  }

  if (!identifier || !body) {
    console.error('Usage: linear comment add <identifier> "comment body"');
    console.error('       linear comment add <identifier> --body-file /path/to/file');
    console.error('       echo "body" | linear comment add <identifier> -');
    process.exit(1);
  }

  const issue = await resolveIssueId(identifier);
  const token = args['as-user'] ? TOKEN_USER : TOKEN_AGENTS;

  const data = await gql(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
        comment { id }
      }
    }`,
    { issueId: issue.id, body },
    token
  );

  if (args.json) {
    console.log(JSON.stringify({ success: data.commentCreate.success, issueId: issue.id, commentId: data.commentCreate.comment?.id }));
  } else {
    console.log(`Comment added to ${issue.identifier}`);
  }
}

async function commentList(args) {
  const identifier = args._positional[0];
  if (!identifier) {
    console.error('Usage: linear comment list <identifier>');
    process.exit(1);
  }

  const data = await gql(
    `query($id: String!) {
      issue(id: $id) {
        identifier title
        comments(orderBy: createdAt) {
          nodes { id body createdAt user { name } }
        }
      }
    }`,
    { id: identifier }
  );

  const issue = data.issue;
  if (!issue) { console.error(`Issue ${identifier} not found`); process.exit(1); }

  if (args.json) {
    console.log(JSON.stringify(issue.comments.nodes, null, 2));
  } else {
    const comments = issue.comments.nodes;
    if (comments.length === 0) { console.log(`No comments on ${issue.identifier}`); return; }
    console.log(`Comments on ${issue.identifier}: ${issue.title}\n`);
    for (const c of comments) {
      const date = new Date(c.createdAt).toLocaleDateString();
      console.log(`[${c.user?.name || 'Unknown'} — ${date}]`);
      console.log(c.body);
      console.log('');
    }
  }
}

// ── Arg parser ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { _positional: [] };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      // Flags with no value
      if (key === 'json' || key === 'as-user') {
        args[key] = true;
      } else {
        i++;
        args[key] = argv[i];
      }
    } else {
      args._positional.push(a);
    }
    i++;
  }
  return args;
}

// ── Main ────────────────────────────────────────────────────────────────────

function usage() {
  console.log(`Usage: linear <resource> <action> [options]

Commands:
  issue create  --title "..." --body "..." [--label "Agent Handoff"] [--state Todo] [--json]
  issue list    [--limit 10] [--json]
  issue show    <identifier>  [--json]

  comment add   <identifier> "comment body" [--as-user] [--json]
  comment list  <identifier>  [--json]

Options:
  --json       Machine-readable JSON output
  --as-user    Use main token instead of agents token (for comments)

Examples:
  linear issue list
  linear issue create --title "New campaign" --body "Details here" --label "Agent Handoff"
  linear issue show IK-93
  linear comment add IK-93 "Revision complete. Here's the updated content."
  linear comment list IK-93`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    usage();
    process.exit(0);
  }

  const resource = argv[0];
  const action = argv[1];
  const args = parseArgs(argv.slice(2));

  const commands = {
    issue: { create: issueCreate, list: issueList, show: issueShow },
    comment: { add: commentAdd, list: commentList },
  };

  const resourceCmds = commands[resource];
  if (!resourceCmds) {
    console.error(`Unknown resource: ${resource}. Use "issue" or "comment".`);
    process.exit(1);
  }

  const handler = resourceCmds[action];
  if (!handler) {
    console.error(`Unknown action: ${resource} ${action}. Actions: ${Object.keys(resourceCmds).join(', ')}`);
    process.exit(1);
  }

  await handler(args);
}

main().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
