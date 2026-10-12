import assert from "node:assert/strict"
import { test } from "node:test"
import { compileTemplate } from "../src/template.js"

const model = {
  name: "Gpt 4o",
  id: "gpt-4o",
  providerID: "litellm",
  family: "gpt-4o",
  limit: { context: 128_000, output: 1_048_576 },
  cost: [{ input: 2.456, output: 10, cache: { read: 0.125, write: 0 } }],
  capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
  settings: { reasoningSummary: "auto" },
}

test("basic aliases and native nested paths", () => {
  assert.equal(compileTemplate("{name} ({provider}/{id}) {family} {providerID} {settings.reasoningSummary}")(model),
    "Gpt 4o (litellm/gpt-4o) gpt-4o litellm auto")
})

test("arrays and objects serialize as JSON; unavailable values are empty", () => {
  assert.equal(compileTemplate("{capabilities.input} {limit} [{missing}] [{settings.missing}] [{nil}]")({ ...model, nil: null }),
    '["text","image"] {"context":128000,"output":1048576} [] [] []')
})

test("limits use three significant digits and costs round to two decimal places", () => {
  assert.equal(compileTemplate("{limit.context} {limit.output} {cost.0.input} {cost.0.output} {cost.0.cache.read}")(model),
    "128K 1.05M 2.46 10 0.13")
  for (const [value, expected] of [[0, "0"], [999, "999"], [1_000, "1K"], [999_999, "1M"], [1_000_000_000, "1B"], [-128_000, "-128K"]] as const) {
    assert.equal(compileTemplate("{limit.context}")({ limit: { context: value } }), expected)
  }
})

test("truthy conditionals and formatting in positional values", () => {
  assert.equal(compileTemplate("{name}{?family:' ($0)'}{?limit.context:' - $0 context'}{?capabilities.tools:' [tools]'}")(model),
    "Gpt 4o (gpt-4o) - 128K context [tools]")
  for (const value of [undefined, null, false, 0, ""]) {
    assert.equal(compileTemplate("{?field:'visible'}")({ field: value }), "")
  }
  assert.equal(compileTemplate("{?field:'$0'}")({ field: [] }), "[]")
})

test("AND requires all values; OR keeps the original reference positions", () => {
  assert.equal(compileTemplate("{?name&family:'$0 ($1)'}")(model), "Gpt 4o (gpt-4o)")
  assert.equal(compileTemplate("{?name&missing:'$0 ($1)'}")(model), "")
  assert.equal(compileTemplate("{?missing|name:'[$0][$1][$2]'}")(model), "[][Gpt 4o][]")
  assert.equal(compileTemplate("{?missing|other:'visible'}")(model), "")
  assert.equal(compileTemplate("{?off|name:'$0 $1'}")({ ...model, off: false }), "false Gpt 4o")
})

test("multi-digit references, escaped quotes, backslashes, and braces", () => {
  const paths = Array.from({ length: 11 }, (_, index) => `v${index}`).join("&")
  const values = Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`v${index}`, index + 1]))
  assert.equal(compileTemplate(`{?${paths}:'$10/$1/$0'}`)(values), "11/2/1")
  assert.equal(compileTemplate(String.raw`{?name:'it\'s $0 {literal} \\ end'}`)(model), "it's Gpt 4o {literal} \\ end")
})

test("malformed conditionals remain literal; inserted text is not evaluated", () => {
  for (const template of ["{?name&family|id:'bad'}", "{?name&:'bad'}", "{?name:'unterminated}", "{?name:no-quotes}"]) {
    assert.equal(compileTemplate(template)(model), template)
  }
  assert.equal(compileTemplate("{name}{?name:'$0'}")({ name: "{id}$1" }), "{id}$1{id}$1")
})

test("inherited properties are unavailable", () => {
  assert.equal(compileTemplate("[{constructor}][{__proto__}][{limit.toString}]")(model), "[][][]")
})

test("reusing a compiled template does not retain earlier values", () => {
  const render = compileTemplate("{name} {limit.context}")
  assert.equal(render(model), "Gpt 4o 128K")
  assert.equal(render({ name: "Other" }), "Other ")
  assert.equal(render(model), "Gpt 4o 128K")
})
