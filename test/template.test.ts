import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
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

test("basic aliases, native nested paths, and array indexing", () => {
  assert.equal(compileTemplate("{{ name }} ({{ provider }}/{{ id }}) {{ family }} {{ providerID }} {{ settings.reasoningSummary }} {{ capabilities.input[0] }}")(model),
    "Gpt 4o (litellm/gpt-4o) gpt-4o litellm auto text")
})

test("JSON filter and missing values", () => {
  assert.equal(compileTemplate("{{ capabilities.input | json }} {{ limit | json }} [{{ missing }}] [{{ settings.missing }}] [{{ nothing }}]")({ ...model, nothing: null }),
    '["text","image"] {"context":128000,"output":1048576} [] [] []')
})

test("formatting is explicit and raw numbers stay available", () => {
  assert.equal(compileTemplate("{{ limit.context | compact }} {{ limit.output | compact }} {{ cost[0].input | price }} {{ cost[0].output | price }} {{ cost[0].cache.read | price }} {{ limit.context }}")(model),
    "128K 1.05M 2.46 10 0.13 128000")
  for (const [value, expected] of [[0, "0"], [999, "999"], [1_000, "1K"], [999_999, "1M"], [1_000_000_000, "1B"], [-128_000, "-128K"]] as const) {
    assert.equal(compileTemplate("{{ limit.context | compact }}")({ limit: { context: value } }), expected)
  }
  assert.equal(compileTemplate("[{{ missing | compact }}][{{ missing | price }}]")(model), "[][]")
  assert.equal(compileTemplate("{{ cost[0].cache.write | price }}")(model), "0")
})

test("conditions use JavaScript truthiness", () => {
  assert.equal(compileTemplate("{{ name }}{% if family %} ({{ family }}){% endif %}{% if limit.context %} - {{ limit.context | compact }} context{% endif %}{% if capabilities.tools %} [tools]{% endif %}")(model),
    "Gpt 4o (gpt-4o) - 128K context [tools]")
  for (const value of [undefined, null, false, 0, ""]) {
    assert.equal(compileTemplate("{% if field %}visible{% endif %}")({ field: value }), "")
  }
  assert.equal(compileTemplate("{% if field %}{{ field | json }}{% endif %}")({ field: [] }), "[]")
})

test("nested conditions, comparisons, and AND/OR", () => {
  assert.equal(compileTemplate("{% if name and family %}{{ name }} ({{ family }}){% endif %}")(model), "Gpt 4o (gpt-4o)")
  assert.equal(compileTemplate("{% if name and missing %}hidden{% elsif missing or name %}fallback{% endif %}")(model), "fallback")
  assert.equal(compileTemplate("{% if limit.context >= 128000 %}{% if capabilities.tools %}large/tools{% else %}large{% endif %}{% endif %}")(model), "large/tools")
  assert.equal(compileTemplate("{% if cost[0].cache.write == 0 %}free{% endif %}")(model), "free")
})

test("built-in filters, loops, assignments, and whitespace control", () => {
  assert.equal(compileTemplate("{% assign label = name | upcase %}{{ label }}: {{ capabilities.input | join: '/' }}")(model), "GPT 4O: text/image")
  assert.equal(compileTemplate("{% for item in capabilities.input -%}{{ item }}{% unless forloop.last %}/{% endunless %}{%- endfor %}")(model), "text/image")
  assert.equal(compileTemplate("{{ missing | default: 'unknown' }}")(model), "unknown")
})

test("plain text is not HTML-escaped and inserted text is never evaluated", () => {
  assert.equal(compileTemplate("{{ name }}")({ name: "<Model & 'Name'> {{ id }} {% include 'secret' %}" }), "<Model & 'Name'> {{ id }} {% include 'secret' %}")
  assert.equal(compileTemplate("{% raw %}{{ name }}{% endraw %}")(model), "{{ name }}")
  assert.equal(compileTemplate("{name}{?family:' ($0)'}")(model), "{name}{?family:' ($0)'}")
})

test("malformed templates and unknown filters fail compilation", () => {
  for (const template of ["{% if name %}unterminated", "{% unknown %}", "{{ name | unknown }}"]) {
    assert.throws(() => compileTemplate(template))
  }
})

test("file-loading tags are disabled, including inside liquid tags", () => {
  for (const tag of ["include", "render", "layout"]) {
    assert.throws(() => compileTemplate(`{% ${tag} 'secret' %}`))
    assert.throws(() => compileTemplate(`{% liquid\n ${tag} 'secret'\n %}`))
  }
})

test("inherited properties are unavailable", () => {
  assert.equal(compileTemplate("[{{ constructor }}][{{ __proto__ }}][{{ limit.toString }}]")(model), "[][][]")
  assert.equal(compileTemplate("[{{ field.secret }}]")({ field: Object.create({ secret: "hidden" }) }), "[]")
})

test("parsing and rendering have resource limits", () => {
  assert.throws(() => compileTemplate("x".repeat(16_385)))
  assert.throws(() => compileTemplate("{% for i in (1..1000000000) %}{{ i }}{% endfor %}")(model))
})

test("reusing a compiled template does not retain earlier values or assignments", () => {
  const render = compileTemplate("{{ name }} {{ limit.context | compact }}{% assign name = 'changed' %}")
  assert.equal(render(model), "Gpt 4o 128K")
  assert.equal(render({ name: "Other" }), "Other ")
  assert.equal(render(model), "Gpt 4o 128K")
  assert.equal(model.name, "Gpt 4o")
})

test("the README pricing/context example produces its documented names", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8")
  const example = readme.split("#### Example")[1]!.match(/```json\n([\s\S]*?)\n```/)![1]!
  const render = compileTemplate(JSON.parse(example).customModelName)
  assert.equal(render({ name: "Gpt 6.1 Sol", cost: [{ input: 2.4, output: 12 }], limit: { input: 922_000, output: 128_000 } }),
    "Gpt 6.1 Sol (2.4↓ 12↑💲)[922K↓ 128K↑📚]")
  assert.equal(render({ name: "Deepseek V4 Flash Local", limit: { input: 220_000, output: 16_000 } }),
    "Deepseek V4 Flash Local [220K↓ 16K↑📚]")
})
