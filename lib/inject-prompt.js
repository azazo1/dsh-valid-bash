// 放宽模型看到的 bash / pwsh 提权说明.
//
// dsh 官方把 sandbox_permissions 描述成 "被沙箱拒绝之后的一次性重试", 于是
// 模型即使已经知道这次调用需要更宽权限, 也倾向先花一轮做沙箱试探, 拿一次注定
// 失败的调用换取提权资格. 这里做两件事:
//
// 1. 改写官方参数描述, 让模型在看参数时就知道第一次也可以带提权.
// 2. 提供一段独立段落文本, 由 index.js 注册进系统提示词, 不依赖官方文案的
//    逐字锚点, 官方改字后仍然成立.
//
// "哪些命令需要提权" 由 user 的 AGENTS 与任务本身决定, 这里不重复规定.

/** 会被改写的工具. write / edit 的提权说明保持官方原文. */
const ESCALATION_TOOL_NAMES = new Set(['bash', 'pwsh'])

/**
 * 官方 sandbox_permissions 参数描述, 逐字来源: @deepseek-ai/dsh-sandbox 的
 * sandboxPermissionsDescription('command'), bash 与 pwsh 都用这一份.
 */
const OFFICIAL_RETRY_ONLY = 'The narrowest wider sandbox mode for a one-shot retry of the exact command the sandbox just denied; the retry asks the user for approval.'

/** 放宽后的描述: 已知需要更宽权限时不必先试探, 第一次就可以提权. */
const RELAXED_PERMISSIONS = 'The narrowest wider sandbox mode. Normally for a one-shot retry of the exact command the sandbox just denied, but also valid on a first attempt when the wider access is already known to be required; the request asks the user for approval.'

/** 注册进系统提示词的独立段落. */
export const ESCALATION_SECTION_TEXT = 'Escalation is not limited to retrying a denial. When you already know the command needs wider access, pass sandbox_permissions together with justification on the first attempt instead of spending a call on a probe the sandbox will deny.'

/**
 * 放宽一段参数描述. 官方文案漂移时原样返回, 不做半截替换.
 * @param {unknown} text
 * @returns {unknown}
 */
export function relaxPermissionsDescription(text) {
  if (typeof text !== 'string' || text === '') return text
  return text.replaceAll(OFFICIAL_RETRY_ONLY, RELAXED_PERMISSIONS)
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
  const description = relaxPermissionsDescription(current.description)
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
  const current = /** @type {{ name?: unknown, parameters?: unknown }} */ (tool)
  if (typeof current.name !== 'string' || !ESCALATION_TOOL_NAMES.has(current.name)) return tool
  const parameters = rewriteParameters(current.parameters)
  if (parameters === current.parameters) return tool
  return { ...current, parameters }
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
