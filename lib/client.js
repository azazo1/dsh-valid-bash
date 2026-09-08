// Web Client 半区: 在 tool.call.toolview 上以更低 priority 覆盖
// bash / pwsh / write / edit, 展示前剥离非法提权配对, 让官方卡片可以展开.
// 不改会话日志原文. 逻辑与 lib/sanitize.js 保持一致.
window.__ModuleLoader__.load({
  id: 'dsh-valid-bash',
  factory: (require) => {
    const React = require('react')

    const SLOT = 'tool.call.toolview'
    const LOCALE = 'conversation'
    const WRAP_PRIORITY = -1
    const TOOL_KEYS = ['bash', 'pwsh', 'write', 'edit']

    function validEscalationFields(args) {
      const permission = args.sandbox_permissions
      const justification = args.justification
      if (permission === undefined && justification === undefined) return true
      if (permission !== 'workspace-write' && permission !== 'danger-full-access') return false
      return typeof justification === 'string' && justification.trim() !== ''
    }

    function sanitizeArgs(args) {
      if (validEscalationFields(args)) return args
      const next = { ...args }
      delete next.sandbox_permissions
      delete next.justification
      return next
    }

    function sanitizeArgsRaw(raw) {
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

    function sanitizeBlock(block) {
      if (block === undefined || block === null || typeof block !== 'object') return block

      let changed = false
      const next = { ...block }

      if (block.call !== undefined && block.call !== null && typeof block.call === 'object') {
        if (typeof block.call.argsRaw === 'string') {
          const argsRaw = sanitizeArgsRaw(block.call.argsRaw)
          if (argsRaw !== block.call.argsRaw) {
            next.call = { ...block.call, argsRaw }
            changed = true
          }
        }
      } else if (typeof block.argsRaw === 'string') {
        const argsRaw = sanitizeArgsRaw(block.argsRaw)
        if (argsRaw !== block.argsRaw) {
          next.argsRaw = argsRaw
          changed = true
        }
      }

      if (Array.isArray(block.subCalls) && block.subCalls.length > 0) {
        const subCalls = block.subCalls.map(sanitizeBlock)
        if (subCalls.some((item, index) => item !== block.subCalls[index])) {
          next.subCalls = subCalls
          changed = true
        }
      }

      return changed ? next : block
    }

    function findOriginal(ctx, key) {
      return ctx.slots.entries(SLOT).find((entry) => (
        entry.options.key === key && (entry.options.priority ?? 0) === 0
      ))
    }

    function createWrapper(ctx, key) {
      return function ValidBashToolview(props) {
        const block = React.useMemo(() => sanitizeBlock(props.block), [props.block])
        const original = findOriginal(ctx, key) ?? (key === 'pwsh' ? findOriginal(ctx, 'bash') : undefined)
        if (original === undefined) return null
        return React.createElement(original.component, { ...props, block })
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject(SLOT, function* () {
          for (const key of TOOL_KEYS) {
            yield ctx.slots.register(
              {
                name: SLOT,
                key,
                priority: WRAP_PRIORITY,
                locale: LOCALE,
                registrant: 'dsh-valid-bash',
              },
              createWrapper(ctx, key),
            )
          }
        })
      },
    }
  },
})
