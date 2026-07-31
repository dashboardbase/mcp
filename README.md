
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo-light.png">
    <img src="logo-dark.png" width="180" alt="dashboardbase">
  </picture>
</p>

<h1 align="center">dashboardbase MCP</h1>

<p align="center">
  <strong>Stop guessing whether your dashboard JSON is right. Ask.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@dashboardbase/mcp"><img src="https://img.shields.io/npm/v/@dashboardbase/mcp?color=2563eb" alt="npm version"></a>
  <a href="https://registry.modelcontextprotocol.io"><img src="https://img.shields.io/badge/MCP%20Registry-com.dashboardbase%2Fmcp-2563eb" alt="MCP Registry"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License"></a>
  <a href="https://dashboardbase.com"><img src="https://img.shields.io/badge/dashboardbase.com-0a0a0a" alt="Dashboardbase"></a>
</p>

This is the official [MCP server](https://modelcontextprotocol.io) for [dashboardbase](https://dashboardbase.com). Add it to your AI tool and it can check a widget endpoint's response — or a whole dashboard setup file — against the contract dashboardbase actually enforces, before you ever open the app.

> The [dashboardbase skill](https://github.com/dashboardbase/skills) teaches your agent the JSON contract. This MCP lets it **check its own work**. Use both: the skill gets the shape right, the MCP proves it.

---

## What this MCP does

It gives your agent two tools:

| Tool | What it checks |
| --- | --- |
| `validate_setup_file` | A dashboardbase setup file — the JSON that provisions a whole dashboard's widgets and datasources. Reports errors and warnings with the field, line and column. |
| `validate_widget_response` | The JSON body a widget endpoint returns, against the widget contract. Reports the path and message for each problem. |

Both call the public dashboardbase validation API. **No account, no API key, nothing to configure.**

## Before / after

**Without it** — your agent writes an endpoint, you deploy it, you wire it into dashboardbase, the widget shows an error, you go read the docs, you fix it, you deploy again.

**With it** — your agent writes the endpoint, validates the response, fixes the two things that were wrong, and hands you something that renders the first time.

```
Invalid setup file — 2 errors, 1 warning

  mappings[0].type  14:9  Unknown widget type "guage"
  mappings[1].path  22:5  Path must start with "/"

  warning  mappings[2]  No refreshInterval set
```

---

## Install

### Claude Code

```bash
claude mcp add dashboardbase -- npx -y @dashboardbase/mcp
```

### One click

<a href="https://insiders.vscode.dev/redirect/mcp/install?name=dashboardbase&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40dashboardbase%2Fmcp%22%5D%7D"><img src="https://img.shields.io/badge/VS_Code-Install-0098FF?logo=visualstudiocode&logoColor=white" alt="Install in VS Code"></a>
<a href="cursor://anysphere.cursor-deeplink/mcp/install?name=dashboardbase&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBkYXNoYm9hcmRiYXNlL21jcCJdfQ=="><img src="https://img.shields.io/badge/Cursor-Install-000000?logo=cursor&logoColor=white" alt="Install in Cursor"></a>

### Claude Desktop

Download `dashboardbase-mcp.mcpb` from the [latest release](https://github.com/dashboardbase/mcp/releases/latest) and drag it into Claude Desktop's extensions settings. Nothing else to install — the bundle is self-contained.

### Any other MCP client

Add this to your client's MCP configuration:

```json
{
  "mcpServers": {
    "dashboardbase": {
      "command": "npx",
      "args": ["-y", "@dashboardbase/mcp"]
    }
  }
}
```

Common locations: `~/.cursor/mcp.json` (Cursor), `.vscode/mcp.json` (VS Code), `~/.codeium/windsurf/mcp_config.json` (Windsurf), `~/.gemini/settings.json` (Gemini CLI). Check your client's docs if it isn't listed.

Requires **Node.js 20 or newer**. That's the only prerequisite.

---

## Using it

Once installed, just ask:

- _"Validate my dashboardbase setup file"_
- _"Check this endpoint response against the dashboardbase KPI contract"_
- _"Is `.dashboardbase/revenue.json` valid?"_

Over stdio the tools can read files directly, so pointing at a path is usually the fastest route:

```
validate_setup_file(path: ".dashboardbase/revenue.json")
```

For `validate_widget_response`, pass the **full response body** your endpoint returns — the `title` / `actions` / `data` / `alert` envelope — not just the inner `data` payload.

### Configuration

Everything is optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DASHBOARDBASE_API_URL` | `https://api.dashboardbase.com` | Point at a different environment. |
| `DASHBOARDBASE_API_KEY` | _unset_ | Sent as `x-api-key`. Not needed for the public API. |
| `DASHBOARDBASE_TIMEOUT_MS` | `15000` | Request timeout in milliseconds. |

### Running it as an HTTP server

For containers or a shared internal deployment:

```bash
npx @dashboardbase/mcp --http --port 3000
# or
docker build -t dashboardbase-mcp . && docker run -p 3000:3000 dashboardbase-mcp
```

Serves Streamable HTTP at `/mcp` and a health check at `/health`. It's fully stateless, so it scales horizontally with no session affinity. Browser origins are refused unless you allowlist them with `--allowed-origin https://example.com`. The file-reading `path` parameter is **not** exposed in this mode.

---

## What's in the repo

```
mcp/
├── src/
│   ├── index.ts            # CLI entry — stdio by default, --http optional
│   ├── server.ts           # Registers the two tools
│   ├── api.ts              # Client for the dashboardbase Tools API
│   ├── format.ts           # Renders results as readable text
│   ├── http.ts             # Stateless Streamable HTTP handler
│   └── tools/              # One file per tool
├── test/                   # Unit tests, no network required
├── tools.json              # OpenAPI spec for the validation API
├── server.json             # MCP Registry manifest
├── manifest.json           # Claude Desktop bundle manifest
└── Dockerfile
```

## How validation works

The server doesn't carry a copy of the schemas — it calls the live dashboardbase validation API. So it **can't drift from what the platform accepts**, and error messages get better as the API does, with nothing to upgrade on your side.

## Related

- **[dashboardbase](https://dashboardbase.com)** — the product. Build, host, and share dashboards from your APIs.
- **[dashboardbase skill](https://github.com/dashboardbase/skills)** — teaches your agent the JSON contract so it writes correct endpoints in the first place. Pairs directly with this MCP.
- **[Documentation](https://app.dashboardbase.com/documentation)** — widget reference, JSON contract, webhook setup.

## Contributing

Found a gap or a confusing error? Open an issue. Note that the validation rules themselves live in the dashboardbase backend — if a *message* is unclear that's still worth reporting here, and we'll fix it upstream.

## License

MIT — see [LICENSE](LICENSE). Fork it, adapt it, ship it.

The MIT license covers the code in this repo. "dashboardbase" is a trademark of dashboardbase — see [dashboardbase.com](https://dashboardbase.com). You're free to use and adapt the server; please don't use the name or branding in a way that implies official affiliation.
