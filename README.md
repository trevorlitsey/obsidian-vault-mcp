# obsidian-vault-mcp

Multi-tenant remote MCP server that exposes any GitHub-backed Obsidian vault
to any MCP client (Claude iOS, Claude Code, Hermes, etc.). Users authenticate
with their own GitHub account via OAuth and pick which repo to use as their
vault — no per-user secrets are baked into the server.

## How it works

1. User adds the server URL to their MCP client.
2. First request returns `401` with a `WWW-Authenticate` pointing at
   `/.well-known/oauth-protected-resource`.
3. Client discovers the OAuth Authorization Server metadata, registers itself
   (Dynamic Client Registration, RFC 7591), and starts an Authorization Code
   flow with PKCE.
4. The Lambda redirects the user to GitHub's OAuth consent screen.
5. After GitHub callback, the Lambda renders a small page where the user picks
   which of their repos to use as the vault.
6. The Lambda issues an MCP access + refresh token; the GitHub user token and
   repo selection are stored in DynamoDB keyed by the access token.
7. MCP calls then operate against that repo using the user's GitHub token.

Token lifetimes: access 1h, refresh 30d, auth codes 10m, repo picker 30m.

## Tools exposed

- `list_files` — list a directory in the vault
- `read_file` — read a markdown file (text) or image (MCP image content)
- `write_file` — create or update a file; `encoding: "utf-8" | "base64"`
- `search` — GitHub code search scoped to the user's selected vault repo

## One-time setup: GitHub OAuth App

1. github.com → Settings → Developer settings → **OAuth Apps** → New OAuth App.
2. Homepage URL: anything (e.g. the repo URL).
3. Authorization callback URL: leave as a placeholder for now; you'll set the
   real value after the first `cdk deploy` (it's printed as a stack output).
4. Save. Note the **Client ID** (public) and generate a new **Client secret**
   (treat as sensitive).

## Deploy

```bash
npm install
cd lambda && npm install && cd ..

export GITHUB_OAUTH_CLIENT_ID=Iv1.xxxxxxxxxxxx
npx cdk bootstrap   # first time per account/region
npx cdk deploy
```

The stack prints:

- `McpEndpoint` — the URL clients connect to
- `GitHubCallbackUrl` — paste this back into the OAuth App's "Authorization
  callback URL" field
- `GitHubOAuthClientSecretArn` — where to store the OAuth App's client secret
- `SessionTableName` — the DynamoDB table holding sessions, codes, and tokens

Set the OAuth App client secret:

```bash
aws secretsmanager put-secret-value \
  --secret-id "$(aws cloudformation describe-stacks \
      --stack-name ObsidianVaultMcpStack \
      --query 'Stacks[0].Outputs[?OutputKey==`GitHubOAuthClientSecretArn`].OutputValue' \
      --output text)" \
  --secret-string 'your_oauth_app_client_secret'
```

## Client setup

In any MCP client that supports remote MCP + OAuth, add the `McpEndpoint` URL
(or its `/mcp` sub-path) as a server. The client handles the rest of the OAuth
dance and pops a browser for GitHub login and repo selection.

## Repo permissions

The OAuth flow requests the `repo` scope so users can pick public or private
repos. Tokens are stored encrypted at rest in DynamoDB (AWS-managed KMS). Each
user only ever sees their own data; the server has no global vault.
