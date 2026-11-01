import { Liquid } from "liquidjs"

type Metadata = Readonly<Record<string, unknown>>

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
  useGrouping: false,
})

const engine = new Liquid({
  jsTruthy: true,
  ownPropertyOnly: true,
  strictFilters: true,
  strictVariables: false,
  // No filesystem-backed templates, even if a loading tag is added later.
  templates: Object.create(null),
  parseLimit: 16_384,
  renderLimit: 50,
  memoryLimit: 1_000_000,
})

for (const tag of ["include", "render", "layout"]) delete engine.tags[tag]

engine.registerFilter("compact", (value: unknown) => {
  if (value === undefined || value === null) return ""
  return typeof value === "number" && Number.isFinite(value) ? compact.format(value) : String(value)
})
engine.registerFilter("price", (value: unknown) => {
  if (value === undefined || value === null) return ""
  return typeof value === "number" && Number.isFinite(value) ? String(Number(value.toFixed(2))) : String(value)
})

/** Parse once; inserted metadata is never reparsed as a template. */
export function compileTemplate(template: string): (model: Metadata) => string {
  const parsed = engine.parse(template)
  return (model) => engine.renderSync(parsed, { ...model, provider: model.providerID }, { templateLimit: 10_000 }) as string
}
