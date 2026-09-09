// 软化模型看到的 bash / pwsh / write / edit 提权描述.
// 官方原文把 sandbox_permissions 写成 "必须先被拒再一次性重试",
// 这里改成建议: 不确定就先试, 已经知道需要更宽权限时允许第一次就提权.

/** 带 sandbox_permissions / justification 的工具. */
const ESCALATION_TOOL_NAMES = new Set(['bash', 'pwsh', 'write', 'edit'])

/**
 * 官方 bash / pwsh 描述里 "必须先试再提权" 的整段原文.
 * 来源: @deepseek-ai/dsh-tool-bash 与 @deepseek-ai/dsh-tool-pwsh.
 */
export const HARD_ESCALATION_PARAGRAPH = 'Attempting a command the sandbox may deny is safe and expected: run it and read the marker rather than assuming the denial. When a command is denied and a wider mode would let it succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: retry the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) plus a one-sentence `justification`. Do not detour through chat to ask permission first — the approval prompt raised by that retry is how the user consents. If the session states approval prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. Never escalate speculatively: ground the request in a real denial — normally the one this command just hit; escalating up front is fine only when this session already denied the same access. A rejected escalation is final for that command — stop and explain, never work around it — but it does not forbid attempting or escalating other commands later.'

/** 对应的软化段落. */
export const SOFT_ESCALATION_PARAGRAPH = 'If you are unsure whether the sandbox will deny a command, try it first and read the marker rather than assuming the denial. When a command is denied and a wider mode would let it succeed, retry in the same turn with `sandbox_permissions` (the narrowest wider mode that suffices) plus a one-sentence `justification`. Do not detour through chat to ask permission first — the approval prompt raised by that retry is how the user consents. If the session states approval prompts are disabled, a denial is final — do not set `sandbox_permissions`. You may also escalate on the first attempt when you already know the command needs wider access, for example when this session already denied the same path, or when the user explicitly requested it. Prefer the narrowest wider mode. A rejected escalation is final for that command — stop and explain, never work around it — but it does not forbid attempting or escalating other commands later.'

const HARD_SPECULATIVE_BAN = 'Never escalate speculatively: ground the request in a real denial — normally the one this command just hit; escalating up front is fine only when this session already denied the same access.'
const SOFT_UPFRONT_ALLOWANCE = 'You may also escalate on the first attempt when you already know the command needs wider access, for example when this session already denied the same path, or when the user explicitly requested it. Prefer the narrowest wider mode.'
const HARD_SANCTIONED_RETRY = 'escalate immediately in the same turn — the one sanctioned exception to a denial: retry the exact same command once with'
const SOFT_SAME_TURN_RETRY = 'retry in the same turn with'
const HARD_COMMAND_RETRY = 'Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.'
const HARD_OPERATION_RETRY = 'Only valid as a one-shot retry of an operation the sandbox just denied; requires justification and user approval.'
const SOFT_PERMISSIONS_HINT = 'Prefer retrying after a sandbox denial; you may also set it on the first attempt when you already know wider access is required, for example when the user explicitly requested it. Requires justification and user approval.'

/**
 * 软化工具 description 中的硬性先试后提权说法.
 * @param {unknown} text
 * @returns {unknown}
 */
export function softenDescription(text) {
  if (typeof text !== 'string' || text === '') return text
  let next = text.replaceAll(HARD_ESCALATION_PARAGRAPH, SOFT_ESCALATION_PARAGRAPH)
  next = next.replaceAll(HARD_SPECULATIVE_BAN, SOFT_UPFRONT_ALLOWANCE)
  next = next.replaceAll(HARD_SANCTIONED_RETRY, SOFT_SAME_TURN_RETRY)
  return next
}

/**
 * 软化 sandbox_permissions 参数描述中的 one-shot retry 约束.
 * @param {unknown} text
 * @returns {unknown}
 */
export function softenPermissionsDescription(text) {
  if (typeof text !== 'string' || text === '') return text
  return text
    .replaceAll(HARD_COMMAND_RETRY, SOFT_PERMISSIONS_HINT)
    .replaceAll(HARD_OPERATION_RETRY, SOFT_PERMISSIONS_HINT)
}

/**
 * 只在 properties.sandbox_permissions.description 需要改写时克隆 parameters.
 * @param {unknown} parameters
 * @returns {unknown}
 */
function rewriteParameters(parameters) {
  if (parameters === undefined || parameters === null || typeof parameters !== 'object') return parameters
  const properties = /** @type {{ properties?: unknown }} */ (parameters).properties
  if (properties === undefined || properties === null || typeof properties !== 'object') return parameters
  const permission = /** @type {{ sandbox_permissions?: unknown }} */ (properties).sandbox_permissions
  if (permission === undefined || permission === null || typeof permission !== 'object') return parameters
  const current = /** @type {{ description?: unknown }} */ (permission)
  const description = softenPermissionsDescription(current.description)
  if (description === current.description) return parameters
  return {
    ...parameters,
    properties: {
      ...properties,
      sandbox_permissions: { ...permission, description },
    },
  }
}

/**
 * 改写单个工具 schema. 非提权工具或无需改写时返回原对象.
 * @param {unknown} tool
 * @returns {unknown}
 */
export function rewriteToolSchema(tool) {
  if (tool === undefined || tool === null || typeof tool !== 'object') return tool
  const current = /** @type {{ name?: unknown, description?: unknown, parameters?: unknown }} */ (tool)
  if (typeof current.name !== 'string' || !ESCALATION_TOOL_NAMES.has(current.name)) return tool
  const description = softenDescription(current.description)
  const parameters = rewriteParameters(current.parameters)
  if (description === current.description && parameters === current.parameters) return tool
  return { ...current, description, parameters }
}

/**
 * 改写组装结果里的 tools 列表. 无需改写时返回原数组.
 * @param {unknown} tools
 * @returns {unknown}
 */
export function rewriteAssemblyTools(tools) {
  if (!Array.isArray(tools)) return tools
  const next = tools.map(rewriteToolSchema)
  return next.some((tool, index) => tool !== tools[index]) ? next : tools
}
