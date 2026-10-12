type Metadata = Readonly<Record<string, unknown>>
type Part = string | { path: string } | { paths: string[]; every: boolean; body: string }

const pathPattern = /^[\w-]+(?:\.[\w-]+)*$/
const tokenPattern = /\{\?([^:{}]*):'((?:\\.|[^'\\])*)'\}|\{([\w-]+(?:\.[\w-]+)*)\}/g
const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumSignificantDigits: 3,
  useGrouping: false,
})

function resolve(model: Metadata, path: string): unknown {
  if (path === "provider") return model.providerID
  let value: unknown = model
  for (const key of path.split(".")) {
    // Never expose inherited properties (including Object.prototype).
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined
    value = (value as Metadata)[key]
  }
  return value
}

function format(value: unknown, path: string): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "number" && Number.isFinite(value)) {
    if (path.startsWith("limit.")) return compact.format(value)
    if (path.startsWith("cost.")) return String(Number(value.toFixed(2)))
  }
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

/** Parse once; rendering is non-evaluating and never reparses inserted values. */
export function compileTemplate(template: string): (model: Metadata) => string {
  const parts: Part[] = []
  let end = 0
  for (const match of template.matchAll(tokenPattern)) {
    parts.push(template.slice(end, match.index))
    if (match[3] !== undefined) {
      parts.push({ path: match[3] })
    } else {
      const condition = match[1]!
      const paths = condition.split(/[&|]/).map((path) => path.trim())
      if ((condition.includes("&") && condition.includes("|")) || !paths.every((path) => pathPattern.test(path))) {
        parts.push(match[0])
      } else {
        parts.push({
          paths,
          every: !condition.includes("|"),
          body: match[2]!.replace(/\\(['\\])/g, "$1"),
        })
      }
    }
    end = match.index + match[0].length
  }
  parts.push(template.slice(end))

  return (model) => parts.map((part) => {
    if (typeof part === "string") return part
    if ("path" in part) return format(resolve(model, part.path), part.path)
    const values = part.paths.map((path) => resolve(model, path))
    const passes = part.every ? values.every(Boolean) : values.some(Boolean)
    if (!passes) return ""
    return part.body.replace(/\$(\d+)/g, (_, index: string) => {
      const position = Number(index)
      const path = part.paths[position]
      return path === undefined ? "" : format(values[position], path)
    })
  }).join("")
}
