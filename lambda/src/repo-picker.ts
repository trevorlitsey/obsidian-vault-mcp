import type { RepoChoice } from './github-oauth.js';

export function renderRepoPicker(pickerId: string, repos: RepoChoice[]): string {
  const options = repos
    .map(
      (r) =>
        `<option value="${escapeAttr(r.full_name)}">${escapeHtml(r.full_name)}${r.private ? ' (private)' : ''}</option>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Select your vault repo</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; }
    h1 { margin-bottom: .25rem; }
    p { color: color-mix(in srgb, currentColor 70%, transparent); }
    form { display: flex; flex-direction: column; gap: .75rem; margin-top: 1.5rem; }
    select, button { font: inherit; padding: .6rem .75rem; border-radius: .5rem; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; }
    button { cursor: pointer; font-weight: 600; }
    button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  </style>
</head>
<body>
  <h1>Select your vault repo</h1>
  <p>The MCP client will be able to read, write, and search files in the repo you pick. You can change this later by reconnecting.</p>
  <form method="POST" action="/select-repo">
    <input type="hidden" name="picker_id" value="${escapeAttr(pickerId)}">
    <select name="repo" required>
      ${options}
    </select>
    <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}
