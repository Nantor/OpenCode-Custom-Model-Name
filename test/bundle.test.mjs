import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import { test } from "node:test"
import plugin from "../dist/opencode-custom-model-name.js"

test("single-file build loads and registers a working V2 transform", async () => {
  assert.deepEqual(await readdir(new URL("../dist/", import.meta.url)), ["opencode-custom-model-name.js"])
  const model = {
    providerID: "demo", id: "effective", name: "Demo",
    limit: { context: 128000 }, cost: [{ input: 2.456 }],
    capabilities: { input: ["text", "image"] },
  }
  await plugin.setup({
    event: { subscribe: async function* () {} },
    model: {
      transform: async (callback) => {
        callback({
          provider: {
            list: () => [{ provider: { id: "demo", settings: {
              customModelName: "{{ name }} ({{ provider }}/{{ id }}){% if limit.context %} {{ limit.context | compact }}{% endif %} {{ cost[0].input | price }} {{ capabilities.input | json }}",
            } } }],
          },
          list: () => [model],
          update: (providerID, modelID, update) => {
            assert.equal(providerID, "demo")
            assert.equal(modelID, "effective")
            update(model)
          },
        })
        return { dispose: async () => {} }
      },
    },
  })
  assert.equal(model.name, 'Demo (demo/effective) 128K 2.46 ["text","image"]')
})
