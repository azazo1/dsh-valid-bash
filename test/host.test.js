import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

function createCtx({ provideSystemPrompt = true } = {}) {
  const sections = []
  const events = []
  const ctx = {
    inject(dependencies, callback) {
      if (!dependencies.includes('systemPrompt')) return
      callback({
        inject: ctx.inject,
        on: ctx.on,
        get: ctx.get,
        systemPrompt: provideSystemPrompt
          ? {
            section(section) {
              sections.push(section)
              return () => {}
            },
            getSectionOrder(name) {
              return name === 'TOOL_PWSH' ? 200 : 0
            },
          }
          : undefined,
      })
    },
    on(event, listener) {
      events.push(event)
      return () => {}
    },
    get() {
      return undefined
    },
    get systemPrompt() {
      throw new Error('cannot get property "systemPrompt" without inject')
    },
  }
  return { ctx, sections, events }
}

test('apply 不直接读 ctx.systemPrompt, 避免 without inject 抛错', () => {
  const { ctx, sections, events } = createCtx({ provideSystemPrompt: false })
  apply(ctx)
  assert.deepEqual(sections, [])
  assert.deepEqual(events, ['system-prompt/assemble', 'tools/execute'])
})

test('有 systemPrompt 时把提权段落挂到 TOOL_PWSH 后面', () => {
  const { ctx, sections } = createCtx()
  apply(ctx)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'dsh-valid-bash:escalation')
  assert.equal(sections[0].order, 201)
})
