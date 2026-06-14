import type { RepoChoice } from './github-oauth.js';

export function renderRepoPicker(pickerId: string, repos: RepoChoice[]): string {
  const styles = `<style>
    :root { color-scheme: light dark; }
    body { font: 16px/1.5 -apple-system, system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; }
    h1 { margin-bottom: .25rem; }
    p { color: color-mix(in srgb, currentColor 70%, transparent); }
    form { display: flex; flex-direction: column; gap: .75rem; margin-top: 1.5rem; }
    select, button, a.button { font: inherit; padding: .6rem .75rem; border-radius: .5rem; border: 1px solid color-mix(in srgb, currentColor 25%, transparent); background: transparent; color: inherit; text-decoration: none; display: inline-block; text-align: center; }
    button, a.button { cursor: pointer; font-weight: 600; }
    button:hover, a.button:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
  </style>`;

  const header = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Select your vault repo</title>
  ${styles}
</head>
<body>`;

  if (repos.length === 0) {
    return `${header}
  <h1>No repos available</h1>
  <p>This MCP server uses a GitHub App, which must be installed on each repo you want to expose. You haven't installed the App on any repos yet.</p>
  <p>Open your GitHub Apps settings, find this App, click <strong>Install App</strong>, and grant it access to your vault repo. Then start the connection again from your MCP client.</p>
  <p><a class="button" href="https://github.com/settings/installations" target="_blank" rel="noopener">Open GitHub installations</a></p>
</body>
</html>`;
  }

  const options = repos
    .map(
      (r) =>
        `<option value="${escapeAttr(r.full_name)}">${escapeHtml(r.full_name)}${r.private ? ' (private)' : ''}</option>`,
    )
    .join('\n');

  return `${header}
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
