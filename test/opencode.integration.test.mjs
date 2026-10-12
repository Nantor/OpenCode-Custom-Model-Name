import assert from "node:assert/strict"
import { execFile, spawn } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { test } from "node:test"
import { randomBytes } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"

const exec = promisify(execFile)
const fixture = fileURLToPath(new URL("./fixtures/opencode/", import.meta.url))

test("real OpenCode formats the predefined model to the predicted name", { timeout: 120_000 }, async (t) => {
  const state = await mkdtemp(join(tmpdir(), 'opencode-custom-model-name-'))
  t.after(() => rm(state, { recursive: true, force: true }))

  // Do not inherit OpenCode config injection, server URLs, credentials, or XDG paths.
  const env = {
    PATH: process.env.PATH,
    HOME: `${state}/home`,
    XDG_CONFIG_HOME: `${state}/config`,
    XDG_DATA_HOME: `${state}/data`,
    XDG_CACHE_HOME: `${state}/cache`,
    XDG_STATE_HOME: `${state}/state`,
    TMPDIR: state,
    OPENCODE_DB: ":memory:",
    OPENCODE_PASSWORD: randomBytes(24).toString("hex"),
    OPENCODE_NAME_TEST_API_KEY: "dummy-test-key-not-a-real-credential",
    NO_COLOR: "1",
  }

  // Model-list snapshots can precede plugin settlement. Keep a private server
  // alive while polling instead of starting a fresh server for every request.
  const server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", "0", "--print-logs", "--log-level", "warn"], { cwd: fixture, env })
  let logs = ""
  let launchError
  server.on("error", (error) => { launchError = error })
  server.stdout.on("data", (data) => { logs += data })
  server.stderr.on("data", (data) => { logs += data })
  t.after(async () => {
    if (server.exitCode !== null || launchError) return
    const stopped = new Promise((resolve) => server.once("exit", resolve))
    server.kill("SIGTERM")
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000)
    try { await stopped } finally { clearTimeout(timer) }
  })

  const deadline = Date.now() + 30_000
  let url
  while (Date.now() < deadline) {
    if (launchError) throw new Error("Install OpenCode V2 and ensure opencode is on PATH", { cause: launchError })
    assert.equal(server.exitCode, null, `Private OpenCode server exited: ${logs}`)
    url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]
    if (url) break
    await delay(100)
  }
  assert.ok(url, `OpenCode did not announce its private server URL: ${logs}`)

  const api = async (path) => {
    const { stdout } = await exec("opencode", ["api", "--server", url, "get", path], {
      cwd: fixture, env, timeout: 15_000, maxBuffer: 10 * 1024 * 1024,
    })
    return JSON.parse(stdout)
  }
  let model
  let custom
  while (Date.now() < deadline) {
    const response = await api("/api/model")
    assert.ok(Array.isArray(response.data), "Expected /api/model to return a model array in data")
    model = response.data.find((entry) => entry.providerID === "name-test" && entry.id === "predefined-model")
    const plugins = await api("/api/plugin")
    custom = plugins.data.find((entry) => entry.id === "opencode-custom-model-name")
    if (custom?.state?.status === "failed") assert.fail(`Plugin failed: ${JSON.stringify(custom)}`)
    if (model && model.name !== "Predefined Model" && custom?.state?.status === "active") break
    await delay(200)
  }
  assert.ok(model, `OpenCode must expose the predefined test model. Plugins: ${JSON.stringify(await api("/api/plugin"))}\n${logs}`)
  const expected = "Predefined Model (name-test/predefined-model) [test-family] 128K context / 1.05M output 2.46 input [tools]"
  assert.equal(custom?.state?.status, "active", "The real OpenCode plugin must be active")
  assert.equal(model.name, expected, `Plugin: ${JSON.stringify(custom)}\nServer: ${logs}`)
  assert.equal(model.limit.context, 128_000)
  assert.equal(model.cost[0].input, 2.456, "Formatting must not change pricing metadata")
  t.diagnostic(`OpenCode returned: ${model.name}`)
})
