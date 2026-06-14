# obsidian-vault-mcp

Remote MCP server that exposes an Obsidian vault stored in a GitHub repository.
Designed to be hit from any MCP client (Claude iOS, Claude Code, Hermes, etc.)
so multiple Claude sessions can share the same knowledge base.

## Architecture

- **Vault:** plain markdown (+ images) in a GitHub repo you control
- **Server:** AWS Lambda behind a Function URL, deployed with CDK
- **Auth:** static bearer token on the endpoint; GitHub PAT for repo access
- **Reads/writes:** GitHub Contents API — no clone, no disk state

## Tools exposed

- `list_files` — list a directory in the vault
- `read_file` — read a markdown file (text) or image (returned as MCP image content)
- `write_file` — create or update a file; supports `utf-8` (default) and `base64` encodings for images
- `search` — GitHub code search scoped to the vault repo

## Deploy

```bash
npm install
cd lambda && npm install && cd ..

export VAULT_REPO_OWNER=your-github-username
export VAULT_REPO_NAME=your-vault-repo
export VAULT_BRANCH=main   # optional

npx cdk bootstrap   # first time only
npx cdk deploy
```

After deploy, populate the two secrets the stack created:

```bash
aws secretsmanager put-secret-value --secret-id <GitHubTokenArn> --secret-string 'ghp_...'
aws secretsmanager put-secret-value --secret-id <BearerTokenArn> --secret-string "$(openssl rand -hex 32)"
```

The Function URL is printed as a stack output. Add it as a remote MCP server in
your client with `Authorization: Bearer <bearer-token>`.

## GitHub PAT scopes

Fine-grained PAT scoped to the single vault repo with:
- Contents: read + write
- Metadata: read (auto)
