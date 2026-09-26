# 列出可用的 recipe.
[private]
default:
    @just --list

# 检查插件入口语法.
check:
    node --check lib/index.js
    node --check lib/sanitize.js
    node --check lib/client.js

# 运行单元测试.
test:
    node --test test/*.test.js

# 校验入口并运行测试.
verify: check test
