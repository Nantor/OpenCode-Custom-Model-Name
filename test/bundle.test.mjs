import assert from "node:assert/strict"
import { readdir } from "node:fs/promises"
import { test } from "node:test"
import plugin from "../dist/opencode-custom-model-name.js"

test("single-file build loads and registers a working V2 transform", async () => {
  assert.deepEqual(await readdir(new URL("../dist/", import.meta.url)), ["opencode-custom-model-name.js"])
  const model = { providerID: "demo", id: "effective", name: "Demo" }
  await plugin.setup({
    event: { subscribe: async function* () {} },
    model: {
      transform: async (callback) => {
        callback({
          provider: {
            list: () => [{ provider: { id: "demo", settings: {
              customModelKey: "{name} ({provider}/{id})",
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
  assert.equal(model.name, "Demo (demo/effective)")
})
