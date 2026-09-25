// 放宽模型看到的 bash / pwsh / write / edit 提权参数描述.
// rc.2 把工具 description 里 "必须先尝试再提权" 的整段说明删掉, 提权规则只剩
// sandbox_permissions 参数描述里的 "one-shot retry of the exact ... just
// denied"; 这里把该约束放宽为: 已经知道需要更宽权限时, 第一次调用也可以直接
// 带 sandbox_permissions.

/** 带 sandbox_permissions / justification 参数的工具. */
const ESCALATION_TOOL_NAMES = new Set(['bash', 'pwsh', 'write', 'edit'])

/**
 * rc.2 官方 sandbox_permissions 参数描述.
 * 来源: @deepseek-ai/dsh-sandbox 的 sandboxPermissionsDescription(subject),
 * bash / pwsh 传 command, write / edit 传 operation.
 */
const HARD_COMMAND_RETRY = 'The narrowest wider sandbox mode for a one-shot retry of the exact command the sandbox just denied; the retry asks the user for approval.'
const HARD_OPERATION_RETRY = 'The narrowest wider sandbox mode for a one-shot retry of the exact operation the sandbox just denied; the retry asks the user for approval.'

/** 对应的放宽描述, 不区分 command / operation. */
const SOFT_PERMISSIONS_HINT = 'The narrowest wider sandbox mode; normally for a one-shot retry of the action the sandbox just denied, but also valid on the first attempt when you already know wider access is required. The retry asks the user for approval.'

/**
 * 放宽 sandbox_permissions 参数描述里的 one-shot retry 约束.
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
