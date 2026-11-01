import { define } from "@opencode/plugin/promise/plugin"
import { compileTemplate } from "./template.js"

export default define({
  id: "opencode-custom-model-name",
  async setup(ctx) {
    const defaultTemplate: unknown = ctx.options?.customModelName
    const transform: Parameters<typeof ctx.model.transform>[0] = (editor) => {
      // Read current provider inputs on each replay, rather than caching startup state.
      for (const { provider } of editor.provider.list()) {
        const providerTemplate: unknown = provider.settings?.customModelName
        const template = typeof providerTemplate === "string" ? providerTemplate : defaultTemplate
        if (typeof template !== "string") continue
        let render: ReturnType<typeof compileTemplate>
        try {
          render = compileTemplate(template)
        } catch (error: unknown) {
          console.warn(`opencode-custom-model-name: invalid template for provider ${provider.id}:`, error)
          continue
        }
        let warned = false
        for (const model of editor.list(provider.id)) {
          let name: string
          try {
            name = render(model)
          } catch (error: unknown) {
            if (!warned) console.warn(`opencode-custom-model-name: rendering failed for provider ${provider.id}:`, error)
            warned = true
            continue
          }
          editor.update(String(model.providerID), String(model.id), (draft) => {
            draft.name = name
          })
        }
      }
    }
    let registration = await ctx.model.transform(transform)
    // V2.0.22 registers its configuration transforms after local plugins.
    // Move our transform behind them once the first model snapshot is committed.
    const controller = new AbortController()
    const settled = (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type !== "model.updated") continue
        await registration.dispose()
        registration = await ctx.model.transform(transform)
        break
      }
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) console.error("opencode-custom-model-name:", error)
    })
    return async () => {
      controller.abort()
      await settled
      await registration.dispose()
    }
  },
})
