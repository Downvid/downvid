import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, '../..')

/** 测试生产源码，替换平台边界；sources 仅供前后版本基准对照。 */
export function loader(mocks = {}, globals = {}, sources = {}) {
  const cache = new Map()
  /** 解析相对导入：先试 `<name>.ts`，再试 `<name>/index.ts`（与 TS/Node 一致） */
  function resolveRelative(fromAbsolute, name) {
    const base = path.resolve(path.dirname(fromAbsolute), name)
    for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
      if (fs.existsSync(candidate)) return path.relative(root, candidate).replaceAll('\\', '/')
    }
    // 都找不到时返回第一个候选，让 readFileSync 抛出带路径的错误（比静默失败好排查）
    return path.relative(root, `${base}.ts`).replaceAll('\\', '/')
  }

  function load(file) {
    const absolute = path.resolve(root, file)
    if (Object.hasOwn(mocks, file)) return mocks[file]
    if (cache.has(absolute)) return cache.get(absolute).exports
    const module = { exports: {} }
    cache.set(absolute, module)
    const code = ts.transpileModule(sources[file] ?? fs.readFileSync(absolute, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText
    vm.runInNewContext(code, {
      module, exports: module.exports, console, process, Buffer, fetch, setTimeout, clearTimeout, AbortController,
      require: name => Object.hasOwn(mocks, name) ? mocks[name]
        : name.startsWith('.') ? load(resolveRelative(absolute, name))
          : require(name),
      ...globals,
    }, { filename: absolute })
    return module.exports
  }
  return load
}
