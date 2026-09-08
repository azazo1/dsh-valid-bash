// Web 卡片展示用的提权字段归一化.
// Host 执行期已经放行空 justification / 同模式提权, 但 ui-tool 的
// validEscalationFields 仍会把这些调用判为 malformed 并保持折叠.
// 卡片模型并不展示这两个字段, 展示前剥离非法配对即可让卡片展开.

/**
 * 与 dsh-client-ui-tool validEscalationFields 相同的判定.
 * @param {Record<string, unknown>} args
 * @returns {boolean}
 */
export function validEscalationFields(args) {
  const permission = args.sandbox_permissions
  const justification = args.justification
  if (permission === undefined && justification === undefined) return true
  if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
  return typeof justification === 'string' && justification.trim() !== ''
}

/**
 * 丢掉会卡住卡片展开的非法提权配对. 合法配对或两者都缺的调用保持原样.
 * @param {Record<string, unknown>} args
 * @returns {Record<string, unknown>}
 */
export function sanitizeArgs(args) {
  if (validEscalationFields(args)) return args
  const next = { ...args }
  delete next.sandbox_permissions
  delete next.justification
  return next
}

/**
 * 重写会让卡片 gate 失败的 argsRaw. 不完整或非对象 JSON 保持原样.
 * @param {string} raw
 * @returns {string}
 */
export function sanitizeArgsRaw(raw) {
  if (typeof raw !== 'string' || raw === '') return raw
  let value
  try {
    value = JSON.parse(raw)
  } catch {
    return raw
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return raw
  const sanitized = sanitizeArgs(value)
  if (sanitized === value) return raw
  return JSON.stringify(sanitized)
}

/**
 * 仅在 argsRaw 需要重写时克隆 running / settled Tool block.
 * @param {unknown} block
 * @returns {unknown}
 */
export function sanitizeBlock(block) {
  if (block === undefined || block === null || typeof block !== 'object') return block
  const current = /** @type {Record<string, unknown>} */ (block)

  let changed = false
  const next = { ...current }

  if (current.call !== undefined && current.call !== null && typeof current.call === 'object') {
    const call = /** @type {Record<string, unknown>} */ (current.call)
    if (typeof call.argsRaw === 'string') {
      const argsRaw = sanitizeArgsRaw(call.argsRaw)
      if (argsRaw !== call.argsRaw) {
        next.call = { ...call, argsRaw }
        changed = true
      }
    }
  } else if (typeof current.argsRaw === 'string') {
    const argsRaw = sanitizeArgsRaw(current.argsRaw)
    if (argsRaw !== current.argsRaw) {
      next.argsRaw = argsRaw
      changed = true
    }
  }

  if (Array.isArray(current.subCalls) && current.subCalls.length > 0) {
    const subCalls = current.subCalls.map(sanitizeBlock)
    if (subCalls.some((item, index) => item !== current.subCalls[index])) {
      next.subCalls = subCalls
      changed = true
    }
  }

  return changed ? next : block
}
