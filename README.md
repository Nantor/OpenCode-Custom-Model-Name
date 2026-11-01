# OpenCode Custom Model Name

A TypeScript plugin for **OpenCode V2** with **LiquidJS** templates, built into one self-contained JavaScript file with no runtime npm dependencies to install. It changes display names only; model IDs, routing, and other metadata remain unchanged.

## Build and install

Requires Node.js 24 or later and npm. Node.js 24 is the current latest LTS;
`.nvmrc` selects the latest available 24.x release for local development and CI.
If you use nvm, run `nvm install` and `nvm use` first. From this project directory:

```sh
npm ci
npm run build
```

The output is `dist/opencode-custom-model-name.js`. Load it in your project's `opencode.json(c)`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["./"]
}
```

The path above assumes `opencode.json(c)` is in this plugin project's root. In another project, point it to this plugin's directory. OpenCode 2.0.22 requires configured local plugin paths to be directories and uses the root `index.ts` loader, which re-exports the single compiled JavaScript file. npm package consumers use the package export.

Alternatively, copy just that JavaScript file into a project's `.opencode/plugins/` directory for automatic discovery. Use only one loading method to avoid registering the plugin twice.

Run `npm run check` for type checking, tests, and a fresh build. The plugin is type-checked against `@opencode/plugin` 2.2.5.

### Real OpenCode integration test

With OpenCode V2 installed and `opencode` on your `PATH`, run:

```sh
npm run test:integration
```

This builds the plugin, starts a private `opencode serve` process on a random localhost port, and uses `opencode api --server ... get /api/model` against `test/fixtures/opencode/opencode.json`. It waits for plugin startup and asserts that OpenCode returns this exact display name:

```text
Predefined Model (name-test/predefined-model) [test-family] 128K context / 1.05M output 2.46 input [tools]
```

The test uses a dummy credential and makes no generation request. It isolates OpenCode's configuration, database, and state under a throwaway directory in the system temp folder and cleans up its temporary run directory afterward. It does not use or restart your shared service. Integration tests run separately from `npm run check`, so normal checks do not require OpenCode to be installed.

## Model names

Without a string `customModelName`, the default name is used. Setting one is all it takes to enable renaming. An empty string produces an empty display name.

Set `customModelName` on a provider's `settings` to customize that provider's display names:

```json
{
  "providers": {
    "litellm": {
      "settings": {
        "baseURL": "http://localhost:4000/v1",
        "customModelName": "{{ name }} ({{ provider }}/{{ id }})"
      }
    }
  }
}
```

To apply a default to every provider, set `customModelName` in the plugin options. The name template is resolved in this order: the provider's own `customModelName`, then the plugin option, then the model's original name (no change).

```json
{
  "plugins": [
    { "package": "./", "options": { "customModelName": "{{ name }} ({{ provider }})" } }
  ]
}
```

### Liquid templates

Templates use [LiquidJS](https://liquidjs.com/tutorials/intro-to-liquid.html): `{{ expression }}` inserts a value, and `{% tag %}` controls conditional text, loops, and assignments.

- `{{ name }}`: original model name, including changes from earlier transforms
- `{{ id }}`: effective model ID returned by the provider
- `{{ provider }}`: OpenCode provider ID (alias for `providerID`)
- Any native V2 `Model.Info` field, using nested paths such as `family`, `capabilities.tools`, `limit.context`, and `settings.reasoningSummary`.
- Array indexing uses brackets: `{{ cost[0].input }}`, `{{ cost[0].cache.read }}`, or `{{ capabilities.input[0] }}`.

Missing fields and `null` render as empty strings. Legacy fields such as `reasoning`, `modalities`, and `options` are not synthesized. Output is plain text, without HTML escaping. Inserted metadata is never evaluated as a template or JavaScript.

#### Formatting filters

Metadata stays in its native form for comparisons and loops. Formatting is explicit:

| Filter | Example | Output |
| --- | --- | --- |
| `compact` | `{{ limit.context \| compact }}` | `128K` |
| `price` | `{{ cost[0].input \| price }}` | `2.46` |
| `json` | `{{ capabilities.input \| json }}` | `["text","image"]` |
| `join` | `{{ capabilities.input \| join: '/' }}` | `text/image` |
| `default` | `{{ family \| default: 'unknown' }}` | `unknown` when missing or falsy |

`compact` uses three significant digits (`128K`, `1.05M`). `price` rounds to two decimal places without trailing zeros (`2.46`, `10`); zero renders as `0`. Both return empty strings for missing or null values. Use `json` explicitly for JSON serialization of arrays and objects; their unfiltered output follows Liquid's native behavior. Other built-in LiquidJS filters are available as well.

#### Conditions

```json
{
  "customModelName": "{{ name }}{% if family %} ({{ family }}){% endif %}{% if limit.context %} - {{ limit.context | compact }} context{% endif %}{% if capabilities.tools %} [tools]{% endif %}"
}
```

This might produce `Gpt 4o (gpt-4o) - 128K context [tools]`. Conditions use **JavaScript truthiness**: missing fields, `null`, `false`, `0`, and empty strings are falsy; arrays and objects, including empty ones, are truthy. This differs from default Liquid truthiness.

Use `and`, `or`, comparisons, nested conditions, and `elsif`/`else` as needed:

```liquid
{% if capabilities.tools and limit.context >= 128000 %} [agent-ready]{% endif %}
{% if cost[0].input == 0 %} [free input]{% endif %}
```

Liquid evaluates mixed `and`/`or` expressions from right to left; use nested conditions for unambiguous grouping. Whitespace is preserved unless you use Liquid's whitespace-control delimiters (`{{-`, `-}}`, `{%-`, `-%}`).

Templates are parsed once per provider per registry rebuild, then rendered synchronously against current model metadata. Provider refreshes automatically reapply the transform; no polling, file editing, or cached model names are needed. The plugin re-registers its transform once after the first model update to run after OpenCode 2.0.22's late-registered configuration transforms.

#### Errors and limits

Malformed templates, unknown filters, and unavailable tags produce a warning and leave that provider's model names unchanged. Rendering errors leave the affected model's name unchanged and warn at most once per provider per rebuild.

The `include`, `render`, and `layout` tags are disabled, and template lookup is in-memory only; templates cannot load files. Only own metadata properties are exposed. Parsing is limited to 16,384 characters; each model render has cooperative limits of 50 ms, 10,000 template steps, and 1,000,000 memory-accounting units. These are safeguards, not a sandbox or hard CPU/heap limits. No custom JavaScript extensions or async filters are exposed.

#### Example

```json
{
  "customModelName": "{{ name }}{% if cost[0].input or cost[0].output or limit.input or limit.output %} {% endif %}{% if cost[0].input or cost[0].output %}({% if cost[0].input %}{{ cost[0].input | price }}↓{% endif %}{% if cost[0].input and cost[0].output %} {% endif %}{% if cost[0].output %}{{ cost[0].output | price }}↑{% endif %}💲){% endif %}{% if limit.input or limit.output %}[{% if limit.input %}{{ limit.input | compact }}↓{% endif %}{% if limit.input and limit.output %} {% endif %}{% if limit.output %}{{ limit.output | compact }}↑{% endif %}📚]{% endif %}"
}
```

creates names with the cost and context information needed:

```text
Gpt 6.1 Sol (2.4↓ 12↑💲)[922K↓ 128K↑📚]
Deepseek V4 Flash Local [220K↓ 16K↑📚]
```

## Releases

Pushes to `master` automatically release the version in `package.json` when its
`v<version>` Git tag does not already exist. The workflow runs `npm run check`
before creating the tag and GitHub release, with the built
`opencode-custom-model-name.js` attached. Existing tags or an unset version skip
the release. To publish a new release, update the package version (for example,
with `npm version patch --no-git-tag-version`) and push the change to `master`.

## License

This project is licensed under the [MIT License](LICENSE).
