import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { callTool, TOOLS, type VaultContext } from './mcp-tools.js';
import {
  oauthProtectedResource,
  oauthAuthorizationServer,
  register,
  authorize,
  callback,
  selectRepo,
  token,
  loadSession,
  setSelfBaseUrl,
} from './oauth-handlers.js';

const SERVER_INFO = { name: 'obsidian-vault-mcp', version: '0.2.0' };

const SERVER_INSTRUCTIONS = `This server exposes a GitHub-backed Obsidian vault. \
Markdown notes live alongside images and other binary files in the same repo.

When the user shares an image, photo, screenshot, or any other binary file and asks to save, \
upload, attach, add, or store it in the vault, call write_file with encoding="base64" and the \
file's bytes base64-encoded into content. Pick a sensible path (e.g. images/<descriptive-name>.<ext>) \
and a clear commit message. Do not describe the image in markdown instead of saving the file itself \
unless the user specifically asks for a written description.

When reading files, image files come back as MCP image content automatically — you can view them \
directly.

Images larger than ~1MB are automatically downscaled server-side to fit within 2048x2048 before \
being committed to the vault, so you don't need to resize on your side. If the request payload is \
hitting transport limits (very large originals), tell the user to share a smaller copy.`;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): APIGatewayProxyResultV2 {
  return {
    statusCode: status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function unauthorized(baseUrl: string): APIGatewayProxyResultV2 {
  const resourceMetadata = `${baseUrl}/.well-known/oauth-protected-resource`;
  return {
    statusCode: 401,
    headers: {
      'www-authenticate': `Bearer resource_metadata="${resourceMetadata}"`,
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
    body: JSON.stringify({ error: 'invalid_token' }),
  };
}

async function handleMcp(event: APIGatewayProxyEventV2, baseUrl: string): Promise<APIGatewayProxyResultV2> {
  const auth = event.headers?.authorization || event.headers?.Authorization;
  if (!auth || !auth.startsWith('Bearer ')) return unauthorized(baseUrl);
  const accessToken = auth.slice('Bearer '.length).trim();
  const session = await loadSession(accessToken);
  if (!session) return unauthorized(baseUrl);

  if (event.requestContext.http.method === 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!event.body) return jsonResponse(400, { error: 'Missing body' });
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(event.body);
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON' });
  }

  const { id, method, params = {} } = req;
  const ctx: VaultContext = {
    token: session.github_token,
    owner: session.repo_owner,
    repo: session.repo_name,
    branch: session.repo_branch,
  };

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
            instructions: SERVER_INSTRUCTIONS,
          },
        });
      case 'tools/list':
        return jsonResponse(200, { jsonrpc: '2.0', id, result: { tools: TOOLS } });
      case 'tools/call': {
        const toolName = params.name as string;
        const toolArgs = (params.arguments as Record<string, unknown>) || {};
        const content = await callTool(toolName, toolArgs, ctx);
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
    return jsonResponse(200, { jsonrpc: '2.0', id, error: { code: -32000, message } });
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath.replace(/\/+$/, '') || '/';
  const baseUrl = `https://${event.requestContext.domainName}`;
  setSelfBaseUrl(baseUrl);

  try {
    if (path === '/.well-known/oauth-protected-resource' && method === 'GET') {
      return oauthProtectedResource();
    }
    if (path === '/.well-known/oauth-authorization-server' && method === 'GET') {
      return oauthAuthorizationServer();
    }
    if (path === '/register' && method === 'POST') {
      return await register(event);
    }
    if (path === '/authorize' && method === 'GET') {
      return await authorize(event);
    }
    if (path === '/callback' && method === 'GET') {
      return await callback(event);
    }
    if (path === '/select-repo' && method === 'POST') {
      return await selectRepo(event);
    }
    if (path === '/token' && method === 'POST') {
      return await token(event);
    }
    if (path === '/mcp' || path === '/') {
      return await handleMcp(event, baseUrl);
    }
    return { statusCode: 404, body: 'Not Found' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Unhandled error', err);
    return jsonResponse(500, { error: 'internal_error', message });
  }
};
