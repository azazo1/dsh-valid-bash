// dsh-valid-bash host half: 放宽 bash / pwsh / fs 工具的沙箱提权参数校验,
// 并软化模型看到的 "必须先尝试再提权" 描述.
//
// 三个目标:
// 1. 当请求的模式并不比当前有效模式更宽时 (例如请求 workspace-write,
//    但当前已经是 workspace-write), 剥离提权参数, 让调用直接以当前
//    模式正常执行, 不再抛出 "not strictly wider" 错误.
// 2. 当 justification 缺失或为空时, 不再直接拒绝: 对合法升级请求补
//    一个默认说明, 对无需升级的请求直接剥离参数.
// 3. 在 system-prompt/assemble 里改写 bash / pwsh / write / edit 的描述,
//    把 "必须先被拒再一次性重试" 改成建议语气, 允许已知需要更宽权限时
//    第一次就提权.
//
// Web 卡片展开由 client 半区处理: 执行成功但空 justification 仍会让
// ui-tool 把调用判为 malformed 并保持折叠.

import { rewriteAssemblyTools } from './rewrite-description.js';

export const name = 'dsh-valid-bash';

// 带 sandbox_permissions / justification 参数的工具名集合.
const ESCALATION_TOOL_NAMES = new Set(['bash', 'pwsh', 'write', 'edit']);

// 与 @deepseek-ai/dsh-sandbox 的严格更宽阶梯保持一致: 某个有效模式下,
// 仅当请求模式出现在该表对应列表里, 才需要走真实提权审批.
const WIDER_MODES = {
  'read-only': ['workspace-write', 'danger-full-access'],
  'workspace-write': ['danger-full-access'],
};

// justification 缺失或为空时的兜底说明, 用于满足审批提示的非空要求.
const FALLBACK_JUSTIFICATION = 'User-authorized escalation without an explicit justification.';

export function apply(ctx) {
  // prepend 后在 next() 返回时改写, 保证最终交给模型的 tools 描述被软化.
  ctx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const result = await next();
    if (result === undefined || result === null || typeof result !== 'object') return result;
    const tools = rewriteAssemblyTools(result.tools);
    return tools === result.tools ? result : { ...result, tools };
  }, { prepend: true });

  ctx.on('tools/execute', async (exec, next) => {
    const args = exec && exec.arguments;
    if (args === undefined || args === null || typeof args !== 'object') return next();
    if (!ESCALATION_TOOL_NAMES.has(exec.name)) return next();
    const { sandbox_permissions: sp, justification: just } = args;
    if (sp === undefined && just === undefined) return next();

    // 解析调用所属会话的当前有效沙箱模式; 任何解析失败都按无沙箱对待,
    // 即剥离提权参数, 保证调用能继续执行而不是报错.
    let effectiveMode;
    try {
      const policy = ctx.get('sandboxPolicy');
      effectiveMode = policy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session }).mode;
    } catch {
      effectiveMode = undefined;
    }

    const newArgs = { ...args };
    if (sp !== undefined) {
      const wider = effectiveMode === undefined ? [] : (WIDER_MODES[effectiveMode] ?? []);
      const isWider = typeof sp === 'string' && wider.includes(sp);
      if (isWider) {
        // 合法升级: 保留提权流程, 但补全空的 justification.
        if (typeof just !== 'string' || just.trim() === '') newArgs.justification = FALLBACK_JUSTIFICATION;
      } else {
        // 不严格更宽 (同模式或更窄) 或模式不可解析: 剥离参数, 以当前模式执行.
        delete newArgs.sandbox_permissions;
        delete newArgs.justification;
      }
    } else {
      // 只有 justification 没有 sandbox_permissions: 剥离 justification.
      delete newArgs.justification;
    }

    exec.arguments = newArgs;
    return next();
  });
}
