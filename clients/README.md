# Clients

HTML pages that show how to connect a client to [literature-clock-mcp](https://github.com/markusvankempen/literature-clock-mcp).

| Page | What it shows |
|---|---|
| [index.html](index.html) | The set, and how to open it |
| [cursor.html](cursor.html) | Cursor `mcp.json`, hosted URL and local npx |
| [vscode.html](vscode.html) | VS Code `mcp.json` |
| [claude.html](claude.html) | Claude Desktop, including `mcp-remote` |
| [browser.html](browser.html) | A page that calls `get_quote` |

Open `index.html` in a browser. The browser client has to be served from localhost so its origin is allowed:

```bash
cd clients
python3 -m http.server 8765
```

Then open http://127.0.0.1:8765/browser.html.
