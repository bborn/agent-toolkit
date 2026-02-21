# Linear CLI

Command-line tool for interacting with the InfluenceKit Linear workspace.

## Commands

### Create an issue

```bash
linear issue create --title "Issue title" --body "Description" --label "Agent Handoff" --state Todo
```

- `--title` (required): Issue title
- `--body`: Issue description (markdown supported)
- `--label`: Apply a label (e.g. "Agent Handoff")
- `--state`: Set initial state (e.g. "Todo")

### List issues

```bash
linear issue list
linear issue list --limit 20
```

### Show issue details

```bash
linear issue show IK-93
```

Shows title, state, labels, description, and all comments.

### Add a comment

```bash
linear comment add IK-93 "Your comment here"
```

By default, comments are posted as **InfluenceKit Agents**. To post as the main user:

```bash
linear comment add IK-93 "Comment" --as-user
```

### List comments

```bash
linear comment list IK-93
```

## Options

- `--json` — Output machine-readable JSON (works with all commands)
- `--as-user` — Use main token for comments instead of agents token

## Configuration

API tokens are in `/home/agents/tools/linear-cli/.env`. Do not modify.
