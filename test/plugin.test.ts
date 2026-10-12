import assert from "node:assert/strict"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index.js"

type Editor = Parameters<Parameters<Plugin.Context["model"]["transform"]>[0]>[0]

function harness(settings: unknown, options?: Record<string, unknown>) {
  const provider = { id: "litellm", settings: settings as Record<string, unknown> }
  const source = [
    { providerID: "litellm", id: "effective-id", name: "Original", limit: { context: 128_000 } },
    { providerID: "other", id: "other-id", name: "Untouched" },
  ]
  let models = structuredClone(source)
  let transform: ((editor: Editor) => void) | undefined
  const editor = {
    provider: { list: () => [{ provider }] },
    list: (id: string) => models.filter((model) => model.providerID === id),
    update: (providerID: string, modelID: string, update: (model: typeof models[number]) => void) => {
      const model = models.find((model) => model.providerID === providerID && model.id === modelID)
      assert.ok(model)
      update(model)
    },
  } as unknown as Editor
  const ctx = {
    options,
    event: { subscribe: async function* () {} },
    model: {
      transform: async (callback: (editor: Editor) => void) => {
        transform = callback
        return { dispose: async () => {} }
      },
    },
  } as unknown as Plugin.Context
  return {
    ctx,
    provider,
    source,
    replay() {
      assert.ok(transform)
      models = structuredClone(source)
      transform(editor)
      return models
    },
  }
}

test("V2 plugin changes only the configured provider's display names", async () => {
  const h = harness({ customModelKey: "{name} ({provider}/{id}) {limit.context}" })
  await plugin.setup(h.ctx)
  const models = h.replay()
  assert.equal(plugin.id, "opencode-custom-model-name")
  assert.equal(models[0]!.name, "Original (litellm/effective-id) 128K")
  assert.deepEqual({ ...models[0], name: "Original" }, h.source[0])
  assert.deepEqual(models[1], h.source[1])
})

test("missing or invalid keys preserve names", async () => {
  for (const settings of [undefined, {}, { customModelKey: 123 }, { customModelKey: null }]) {
    const h = harness(settings)
    await plugin.setup(h.ctx)
    assert.deepEqual(h.replay(), h.source)
  }
  const h = harness({}, { customModelKey: 123 })
  await plugin.setup(h.ctx)
  assert.deepEqual(h.replay(), h.source)
})

test("an empty string key is supported", async () => {
  const h = harness({ customModelKey: "" })
  await plugin.setup(h.ctx)
  assert.equal(h.replay()[0]!.name, "")
})

test("the plugin option is the default and provider settings override it", async () => {
  const defaulted = harness({}, { customModelKey: "{name}#" })
  await plugin.setup(defaulted.ctx)
  assert.equal(defaulted.replay()[0]!.name, "Original#")

  const overridden = harness({ customModelKey: "{id}" }, { customModelKey: "{name}#" })
  await plugin.setup(overridden.ctx)
  assert.equal(overridden.replay()[0]!.name, "effective-id")
})

test("rebuilds are repeatable and observe refreshed models and settings", async () => {
  const h = harness({ customModelKey: "{name}!" })
  await plugin.setup(h.ctx)
  assert.equal(h.replay()[0]!.name, "Original!")
  assert.equal(h.replay()[0]!.name, "Original!")
  h.source[0]!.name = "Refreshed"
  h.provider.settings = { customModelKey: "{name} {id}" }
  assert.equal(h.replay()[0]!.name, "Refreshed effective-id")
  h.provider.settings = {}
  assert.equal(h.replay()[0]!.name, "Refreshed")
})
