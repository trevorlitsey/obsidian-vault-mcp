import { Octokit } from '@octokit/rest';

const IMAGE_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
};

export type McpContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string };

export interface VaultContext {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

function imageMimeType(filePath: string): string | undefined {
  const ext = filePath.toLowerCase().match(/\.[^.]+$/)?.[0];
  return ext ? IMAGE_EXTENSIONS[ext] : undefined;
}

export const TOOLS = [
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
      'Create or update a file in the vault. For markdown or other text, pass the text in `content` and leave encoding as utf-8. For images or other binary files (png, jpg, jpeg, gif, webp, svg, bmp, pdf, etc.), base64-encode the bytes and pass them in `content` with encoding="base64". When the user shares a photo or image and asks to save, attach, or upload it, call this tool with encoding="base64" — do not try to write the image as text or describe it instead of saving it.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path within the vault (e.g. "images/cat.jpg" or "notes/meeting.md").' },
        content: { type: 'string', description: 'File contents — raw UTF-8 text or base64-encoded bytes depending on `encoding`.' },
        message: { type: 'string', description: 'Git commit message describing the change.' },
        encoding: {
          type: 'string',
          enum: ['utf-8', 'base64'],
          description: 'Encoding of `content`. Use "base64" for images and any other binary file. Defaults to "utf-8".',
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

async function listFiles(octokit: Octokit, ctx: VaultContext, dirPath: string): Promise<McpContent[]> {
  const { data } = await octokit.repos.getContent({
    owner: ctx.owner,
    repo: ctx.repo,
    path: dirPath,
    ref: ctx.branch,
  });
  if (!Array.isArray(data)) throw new Error(`${dirPath} is not a directory`);
  const entries = data.map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
  return [{ type: 'text', text: JSON.stringify(entries, null, 2) }];
}

async function readFile(octokit: Octokit, ctx: VaultContext, filePath: string): Promise<McpContent[]> {
  const { data } = await octokit.repos.getContent({
    owner: ctx.owner,
    repo: ctx.repo,
    path: filePath,
    ref: ctx.branch,
  });
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
  octokit: Octokit,
  ctx: VaultContext,
  filePath: string,
  content: string,
  message: string,
  encoding: 'utf-8' | 'base64',
): Promise<McpContent[]> {
  let sha: string | undefined;
  try {
    const { data } = await octokit.repos.getContent({
      owner: ctx.owner,
      repo: ctx.repo,
      path: filePath,
      ref: ctx.branch,
    });
    if (!Array.isArray(data) && data.type === 'file') sha = data.sha;
  } catch (err: unknown) {
    if ((err as { status?: number }).status !== 404) throw err;
  }

  const base64Content =
    encoding === 'base64' ? content : Buffer.from(content, 'utf-8').toString('base64');

  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner: ctx.owner,
    repo: ctx.repo,
    path: filePath,
    message,
    content: base64Content,
    branch: ctx.branch,
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

async function search(octokit: Octokit, ctx: VaultContext, query: string): Promise<McpContent[]> {
  const { data } = await octokit.search.code({ q: `${query} repo:${ctx.owner}/${ctx.repo}` });
  const hits = data.items.map((item) => ({ path: item.path, name: item.name }));
  return [{ type: 'text', text: JSON.stringify(hits, null, 2) }];
}

export async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: VaultContext,
): Promise<McpContent[]> {
  const octokit = new Octokit({ auth: ctx.token });
  switch (name) {
    case 'list_files':
      return listFiles(octokit, ctx, (args.path as string) ?? '');
    case 'read_file':
      return readFile(octokit, ctx, args.path as string);
    case 'write_file':
      return writeFile(
        octokit,
        ctx,
        args.path as string,
        args.content as string,
        args.message as string,
        (args.encoding as 'utf-8' | 'base64' | undefined) ?? 'utf-8',
      );
    case 'search':
      return search(octokit, ctx, args.query as string);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
