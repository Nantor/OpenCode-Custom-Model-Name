# OpenCode Custom Model Name

A TypeScript plugin for **OpenCode V2**, built into one self-contained JavaScript file with no runtime npm dependencies. It changes display names only; model IDs, routing, and other metadata remain unchanged.

## Build and install

Requires Node.js 22 or later and npm. From this project directory:

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

Run `npm run check` for type checking, tests, and a fresh build. The plugin is type-checked against `@opencode/plugin` 2.0.22.

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

Without a string `customModelKey`, the default name is used. Setting one is all it takes to enable renaming. An empty string produces an empty display name.

Set `customModelKey` on a provider's `settings` to customize that provider's display names:

```json
{
  "providers": {
    "litellm": {
      "settings": {
        "baseURL": "http://localhost:4000/v1",
        "customModelKey": "{name} ({provider}/{id})"
      }
    }
  }
}
```

To apply a default to every provider, set `customModelKey` in the plugin options. The key is resolved in this order: the provider's own `customModelKey`, then the plugin option, then the model's original name (no change).

```json
{
  "plugins": [
    { "package": "./", "options": { "customModelKey": "{name} ({provider})" } }
  ]
}
```

Supported placeholders:

- `{name}`: original model name
- `{id}`: effective model ID returned by the provider
- `{provider}`: OpenCode provider ID
- Any native V2 `Model.Info` field, using dot notation for nested values. Examples include `{family}`, `{capabilities.tools}`, `{limit.context}`, `{cost.0.input}`, `{capabilities.input}`, and `{settings.reasoningSummary}`.

V2 pricing is an array: `cost.0` selects the first pricing entry, `cost.1` the second, and so on. For example, `{cost.0.cache.read}` inserts the first entry's cache-read price. `{cost}` inserts the entire array as JSON. Numeric array indices also work in other paths, such as `{capabilities.input.0}`. Legacy fields such as `reasoning`, `modalities`, and `options` are not synthesized; unavailable fields resolve to an empty string.

Arrays and objects are inserted as JSON. Placeholders for fields that are not available on a model resolve to an empty string.
Numeric `{limit.*}` placeholders use compact three-significant-digit notation such as `128K` or `1.05M`. Numeric `{cost.*}` placeholders are rounded to two decimal places, without trailing zeros (for example, `2.46` or `10`). The same formatting applies to conditional references. Numbers inside JSON arrays and objects are not reformatted.

### Conditional Expressions

Use a conditional expression to include text only when model metadata is available:

```
{?path:'text using $0'}
```

The condition is one or more field paths, and the quoted body can reference their values by zero-based position (`$0`, `$1`, and so on). A conditional resolves to an empty string when its condition is not met.

```json
{
  "customModelKey": "{name}{?family:' ($0)'}{?limit.context:' - $0 context'}{?capabilities.tools:' [tools]'}"
}
```

The example might produce `Gpt 4o (gpt-4o) - 128K context [tools]`. Missing fields, `null`, `false`, `0`, and empty strings suppress their conditional text. Arrays and objects, including empty ones, are truthy.

- Use `&` when every path must be present and truthy: `{?name&family:'$0 ($1)'}`.
- Use `|` when any path may be present and truthy: `{?family|name:'$0$1'}`.
- `$0`, `$1`, and later references retain the position of each listed path. An unavailable value inserts an empty string.
- Escape a literal single quote in the body as `\'`: `{?name:'it\'s $0'}`.
- Do not mix `&` and `|` in one conditional expression.
- Escape a literal backslash in a conditional body as `\\`. In JSON, escape backslashes again: `"{?name:'it\\'s $0'}"`.
- Malformed expressions are left literal. Conditional bodies are not recursively parsed; use `$0` references rather than nested placeholders. Inserted metadata is never evaluated as a template or JavaScript.

Names are transformed from the current model metadata on each registry rebuild. Provider refreshes automatically reapply the transform; no polling, file editing, or cached model names are needed. The plugin re-registers its transform once after the first model update to run after OpenCode 2.0.22's late-registered configuration transforms. `{name}` is the name before this plugin's transform, including changes from earlier transforms.

## License

This project is licensed under the [MIT License](LICENSE).
