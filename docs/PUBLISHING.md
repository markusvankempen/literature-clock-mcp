# Publishing — literature-clock-mcp

Same release shape as [mcp-ticket-demo](https://github.com/markusvankempen/mcp-ticket-demo): npm first, then the MCP Registry. The registry stores metadata only. The npm tarball is the artifact.

| Target | Where |
|---|---|
| npm | https://www.npmjs.com/package/literature-clock-mcp |
| MCP Registry | `io.github.markusvankempen/literature-clock-mcp` |
| github.com/mcp | Indexed from the registry (hours to days). Needs `title` in `server.json` |

`mcpName` in `package.json` must equal `name` in `server.json`, and must start with `io.github.markusvankempen/`.

## What ships

`files` in `package.json` limits the tarball to `src/`, `data/` (books and voices), `README.md`, `docs/screenshots/`, `docs/icon.png`, `docs/icon.svg`, `server.json`, `clients/` (HTML setup pages), `LICENSE`, and `NOTICE`.

`npm run prepack` copies `../chrome/books` and `../chrome/voices` into `data/` before the tarball is built. Do not publish without that Chrome corpus beside this folder.

## Checklist

Versions must match in all of these:

| File | Field |
|---|---|
| `package.json` | `version` |
| `server.json` | `version` and `packages[0].version` |
| `src/version.js` | `VERSION` |

```bash
cd mcp
npm test
npm pack --dry-run
npm whoami || npm login
npm publish --access public
```

Wait about a minute, then:

```bash
mcp-publisher login github
mcp-publisher publish
```

`server.json` `description` must be 100 characters or fewer. This machine's `mcp-publisher` build has `init`, `login`, and `publish` (no `validate` subcommand). Check the three version fields and the description length before `publish`.

Verify:

```bash
npm view literature-clock-mcp version
curl -s "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.markusvankempen/literature-clock-mcp"
```

npm publish stays manual. A version tag `v*` can run `.github/workflows/publish-literature-clock-mcp.yml` for the registry only, and only after that version is already on npm.

## Registry errors

| Error | Fix |
|---|---|
| `mcpName` mismatch | `package.json` `mcpName` and `server.json` `name` must be identical, and the published tarball must contain `mcpName` |
| expired JWT | `mcp-publisher login github` |
| permission | `name` must start with `io.github.markusvankempen/` |
| version 404 | npm has not propagated yet. Wait, then `mcp-publisher publish` again |
| duplicate version | Bump all three version locations and publish npm again |

## Author

[Markus van Kempen](https://markusvankempen.github.io/) · [github.com/markusvankempen](https://github.com/markusvankempen)

No bug too small, no syntax too weird.
