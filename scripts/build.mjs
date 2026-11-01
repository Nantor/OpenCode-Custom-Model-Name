import { build } from "esbuild"

const result = await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/opencode-custom-model-name.js",
  bundle: true,
  // The browser engine supports synchronous string rendering without Node imports.
  alias: { liquidjs: "liquidjs/dist/liquid.browser.mjs" },
  format: "esm",
  platform: "node",
  target: "es2022",
  legalComments: "none",
  sourcemap: false,
  metafile: true,
})

for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.length > 0) throw new Error("The bundle must have no external runtime imports")
}
