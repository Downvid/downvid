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
        : name.startsWith('.') ? load(path.relative(root, path.resolve(path.dirname(absolute), `${name}.ts`)).replaceAll('\\', '/'))
          : require(name),
      ...globals,
    }, { filename: absolute })
    return module.exports
  }
  return load
}
