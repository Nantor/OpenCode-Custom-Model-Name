import assert from "node:assert/strict"
import { test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import plugin from "../src/index.js"

test("startup moves the name transform after late configuration transforms and cleans up", async () => {
  const operations: string[] = []
  let cancelled = false
  const ctx = {
    model: {
      transform: async () => {
        operations.push("register")
        return { dispose: async () => { operations.push("dispose") } }
      },
    },
    event: {
      subscribe: async function* ({ signal }: { signal: AbortSignal }) {
        signal.addEventListener("abort", () => { cancelled = true })
        yield { type: "provider.updated" }
        yield { type: "model.updated" }
        yield { type: "model.updated" }
      },
    },
  } as unknown as Plugin.Context
  const cleanup = await plugin.setup(ctx)
  assert.ok(cleanup)
  // Cleanup also waits for any in-flight re-registration.
  await cleanup()
  assert.deepEqual(operations, ["register", "dispose", "register", "dispose"])
  assert.equal(cancelled, true)
})
