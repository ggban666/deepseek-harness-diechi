import { Context } from "@deepseek-ai/cordis"
import { SettingsProvider } from "@deepseek-ai/dsh-settings"
import { SystemPrompt } from "@deepseek-ai/dsh-system-prompt"
import * as skillStore from "@deepseek-ai/dsh-web-app/skill-store"

class MemorySettings extends SettingsProvider {
  constructor(ctx, options) {
    super(ctx)
    this.doc = structuredClone(options?.doc ?? {})
  }
  get writable() {
    return true
  }
  load() {
    return Promise.resolve(structuredClone(this.doc))
  }
  persist(ns, section) {
    this.doc[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const builtins = [
  { formatVersion: 1, id: "sqe-8d", title: "SQE客诉处理", description: "用 8D 方法处理供应商质量问题和客户投诉。", whenToUse: "", kind: "text", enabled: false, invocation: { modelInvocable: true, userInvocable: true }, content: "", source: "builtin" },
  { formatVersion: 1, id: "legal-consult", title: "法律咨询顾问", description: "法律法规咨询、合同与风险分析。", whenToUse: "", kind: "text", enabled: false, invocation: { modelInvocable: true, userInvocable: true }, content: "", source: "builtin" },
  { formatVersion: 1, id: "customer-service", title: "客户服务专员", description: "客户接待、答疑与问题跟进。", whenToUse: "", kind: "text", enabled: false, invocation: { modelInvocable: true, userInvocable: true }, content: "", source: "builtin" },
  { formatVersion: 1, id: "hr-management", title: "人力资源专员", description: "招聘、绩效与人事制度咨询。", whenToUse: "", kind: "text", enabled: false, invocation: { modelInvocable: true, userInvocable: true }, content: "", source: "builtin" },
]

const enabledDoc = { "skill-store": { skills: builtins.map(e => e.id === "sqe-8d" ? { ...e, enabled: true } : { ...e }) } }

const ctx = new Context()
await ctx.plugin(MemorySettings, { doc: enabledDoc })
await ctx.plugin(SystemPrompt, { persona: "" })
ctx.provide("skills", { register: () => () => {} })
await ctx.plugin(skillStore)
await new Promise(resolve => setTimeout(resolve, 100))

function personaSection(assembly) {
  return assembly.sections.find(s => s.name === "skill-store:persona")
}

const a1 = await ctx.systemPrompt.assemble()
const p1 = personaSection(a1)
console.log("== initial (sqe-8d enabled in persisted doc) ==")
console.log("persona section present:", p1 !== undefined)
if (p1) console.log("text:", JSON.stringify(p1.text))
console.log("describe skill-store ns:", JSON.stringify(ctx.settings.describe().find(d => d.ns === "skill-store")?.value))

// disable all -> section must disappear
const disabledSkills = builtins.map(e => ({ ...e, enabled: false }))
await ctx.settings.update("skill-store", { skills: disabledSkills })
await new Promise(resolve => setTimeout(resolve, 100))
const a2 = await ctx.systemPrompt.assemble()
console.log("== after disabling all ==")
console.log("persona section gone:", personaSection(a2) === undefined)

// enable two -> both present
const twoEnabled = builtins.map(e => (e.id === "sqe-8d" || e.id === "hr-management") ? { ...e, enabled: true } : { ...e })
await ctx.settings.update("skill-store", { skills: twoEnabled })
await new Promise(resolve => setTimeout(resolve, 100))
const a3 = await ctx.systemPrompt.assemble()
const p3 = personaSection(a3)
console.log("== after enabling sqe + hr ==")
console.log("persona present:", p3 !== undefined, "| has sqe:", p3?.text.includes("sqe-8d"), "| has hr:", p3?.text.includes("hr-management"), "| tag:", p3?.text.includes("[text]"))

await ctx.fiber.dispose()
console.log("DONE")
