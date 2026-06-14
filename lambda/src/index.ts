import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { Octokit } from '@octokit/rest';

const secretsClient = new SecretsManagerClient({});

const owner = requireEnv('VAULT_REPO_OWNER');
const repo = requireEnv('VAULT_REPO_NAME');
const branch = process.env.VAULT_BRANCH || 'main';

let cachedGithubToken: string | undefined;
let cachedBearerToken: string | undefined;
let cachedOctokit: Octokit | undefined;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

async function getSecret(arn: string): Promise<string> {
  const result = await secretsClient.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!result.SecretString) throw new Error(`Secret ${arn} has no SecretString`);
  return result.SecretString;
}

async function getOctokit(): Promise<Octokit> {
  if (cachedOctokit) return cachedOctokit;
  if (!cachedGithubToken) {
    cachedGithubToken = await getSecret(requireEnv('GITHUB_TOKEN_SECRET_ARN'));
  }
  cachedOctokit = new Octokit({ auth: cachedGithubToken });
  return cachedOctokit;
}

async function getBearerToken(): Promise<string> {
  if (cachedBearerToken) return cachedBearerToken;
  cachedBearerToken = await getSecret(requireEnv('BEARER_TOKEN_SECRET_ARN'));
  return cachedBearerToken;
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

function imageMimeType(filePath: string): string | undefined {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? IMAGE_EXTENSIONS[ext] : undefined;
}

const SERVER_INFO = { name: 'obsidian-vault-mcp', version: '0.1.0' };

const TOOLS = [
  {
    name: 'list_files',
    description: 'List files and folders in a vault directory.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path within the vault (empty string for root).' },
      },
    },
  },
  {
    name: 'read_file',
    description:
      'Read a file from the vault. Markdown and text files come back as text; images (png, jpg, jpeg, gif, webp, svg, bmp) come back as MCP image content.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within the vault.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Create or update a file in the vault. Use encoding="utf-8" (default) for text or encoding="base64" for binary content like images.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within the vault.' },
        content: { type: 'string', description: 'File contents (raw text or base64-encoded binary).' },
        message: { type: 'string', description: 'Git commit message.' },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64'],
          description: 'Encoding of the content field. Defaults to utf-8.',
        },
      },
      required: ['path', 'content', 'message'],
    },
  },
  {
    name: 'search',
    description: 'Search file contents in the vault using GitHub code search.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
      },
      required: ['query'],
    },
  },
];

type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

async function listFiles(dirPath: string): Promise<McpContent[]> {
  const octokit = await getOctokit();
  const { data } = await octokit.repos.getContent({ owner, repo, path: dirPath, ref: branch });
  if (!Array.isArray(data)) throw new Error(`${dirPath} is not a directory`);
  const entries = data.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
  return [{ type: 'text', text: JSON.stringify(entries, null, 2) }];
}

async function readFile(filePath: string): Promise<McpContent[]> {
  const octokit = await getOctokit();
  const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
  if (Array.isArray(data) || data.type !== 'file') throw new Error(`${filePath} is not a file`);

  const mimeType = imageMimeType(filePath);
  if (mimeType) {
    const base64 = data.content.replace(/\n/g, '');
    return [{ type: 'image', data: base64, mimeType }];
  }

  const text = Buffer.from(data.content, 'base64').toString('utf-8');
  return [{ type: 'text', text }];
}

async function writeFile(
  filePath: string,
  content: string,
  message: string,
  encoding: 'utf-8' | 'base64' = 'utf-8',
): Promise<McpContent[]> {
  const octokit = await getOctokit();
  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
    if (!Array.isArray(data) && data.type === 'file') sha = data.sha;
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 404) throw err;
  }

  const base64Content =
    encoding === 'base64' ? content : Buffer.from(content, 'utf-8').toString('base64');

  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path: filePath,
    message,
    content: base64Content,
    branch,
    sha,
  });

  return [
    {
      type: 'text',
      text: JSON.stringify(
        { path: filePath, commit: data.commit.sha, updated: Boolean(sha) },
        null,
        2,
      ),
    },
  ];
}

async function search(query: string): Promise<McpContent[]> {
  const octokit = await getOctokit();
  const { data } = await octokit.search.code({ q: `${query} repo:${owner}/${repo}` });
  const hits = data.items.map((item) => ({ path: item.path, name: item.name }));
  return [{ type: 'text', text: JSON.stringify(hits, null, 2) }];
}

async function handleToolCall(name: string, args: Record<string, unknown>): Promise<McpContent[]> {
  switch (name) {
    case 'list_files':
      return listFiles((args.path as string) ?? '');
    case 'read_file':
      return readFile(args.path as string);
    case 'write_file':
      return writeFile(
        args.path as string,
        args.content as string,
        args.message as string,
        ((args.encoding as 'utf-8' | 'base64' | undefined) ?? 'utf-8'),
      );
    case 'search':
      return search(args.query as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function jsonResponse(status: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  const expectedToken = await getBearerToken();
  if (authHeader !== `Bearer ${expectedToken}`) {
    return { statusCode: 401, body: 'Unauthorized' };
  }

  if (!event.body) return { statusCode: 400, body: 'Missing body' };

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const { id, method, params = {} } = req;

  try {
    switch (method) {
      case 'initialize':
        return jsonResponse(200, {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: SERVER_INFO,
          },
        });

      case 'tools/list':
        return jsonResponse(200, { jsonrpc: '2.0', id, result: { tools: TOOLS } });

      case 'tools/call': {
        const toolName = params.name as string;
        const toolArgs = (params.arguments as Record<string, unknown>) || {};
        const content = await handleToolCall(toolName, toolArgs);
        return jsonResponse(200, { jsonrpc: '2.0', id, result: { content } });
      }

      case 'notifications/initialized':
        return { statusCode: 204, body: '' };

      default:
        return jsonResponse(200, {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse(200, {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message },
    });
  }
};
