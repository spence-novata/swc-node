/* eslint-disable @typescript-eslint/no-floating-promises */
const fs = require('fs')
const os = require('os')

const babel = require('@babel/core')
const envPreset = require('@babel/preset-env')
const tsPreset = require('@babel/preset-typescript')
const { transformSync: transformSyncNapi, transform: transformNapi } = require('@swc-node/core')
const { transformSync, transform } = require('@swc/core')
const { Suite } = require('benchmark')
const chalk = require('chalk')
const { transformSync: transformSyncEsbuild, startService } = require('esbuild')
const ts = require('typescript')

const cpuCount = os.cpus().length

const syncSuite = new Suite('Transform rxjs/AjaxObservable.ts benchmark')

const asyncSuite = new Suite('Transform rxjs/AjaxObservable.ts async benchmark')

const parallelSuite = new Suite('Transform rxjs/AjaxObservable.ts parallel benchmark')

const SOURCE_PATH = require.resolve('rxjs/src/internal/observable/dom/AjaxObservable.ts')
const SOURCE_CODE = fs.readFileSync(SOURCE_PATH, 'utf-8')

async function run() {
  const service = await startService()
  let defer
  const task = new Promise((resolve) => {
    defer = resolve
  })

  syncSuite
    .add('@swc-node/core', () => {
      transformSyncNapi(SOURCE_CODE, SOURCE_PATH, {
        target: 'es2016',
        module: 'commonjs',
        sourcemap: true,
      })
    })
    .add('@swc/core', () => {
      transformSync(SOURCE_CODE, {
        filename: SOURCE_PATH,
        jsc: {
          target: 'es2016',
          parser: {
            syntax: 'typescript',
          },
        },
        minify: false,
        isModule: true,
        module: {
          type: 'commonjs',
        },
        sourceMaps: true,
        swcrc: false,
      })
    })
    .add('esbuild', () => {
      transformSyncEsbuild(SOURCE_CODE, {
        sourcefile: SOURCE_PATH,
        loader: 'ts',
        sourcemap: true,
        minify: false,
        target: 'es2016',
      })
    })
    .add('typescript', () => {
      ts.transpileModule(SOURCE_CODE, {
        fileName: SOURCE_PATH,
        compilerOptions: {
          target: ts.ScriptTarget.ES2016,
          module: ts.ModuleKind.CommonJS,
          isolatedModules: true,
          sourceMap: true,
        },
      })
    })
    .add('babel', () => {
      babel.transform(SOURCE_CODE, {
        filename: SOURCE_PATH,
        presets: [tsPreset, [envPreset, { targets: { node: 'current' }, modules: 'commonjs' }]],
        configFile: false,
        babelrc: false,
        sourceMaps: true,
      })
    })
    .on('cycle', function (event) {
      console.info(String(event.target))
    })
    .on('complete', function () {
      console.info(`${this.name} bench suite: Fastest is ${chalk.green(this.filter('fastest').map('name'))}`)
      service.stop()
      defer()
    })
    .run()

  await task
}

async function runAsync(parallel = 1, suite = asyncSuite) {
  const service = await startService()
  let defer
  const task = new Promise((resolve) => {
    defer = resolve
  })
  suite
    .add({
      name: '@swc-node/core',
      fn: (deferred) => {
        Promise.all(
          Array.from({ length: parallel }).map(() => {
            return transformNapi(SOURCE_CODE, SOURCE_PATH, {
              target: 'es2016',
              module: 'commonjs',
              sourcemap: true,
            })
          }),
        )
          .then(() => {
            deferred.resolve()
          })
          .catch((e) => {
            console.error(e)
          })
      },
      defer: true,
      async: true,
      queued: true,
    })
    .add({
      name: '@swc/core',
      fn: (deferred) => {
        Promise.all(
          Array.from({ length: parallel }).map(() => {
            return transform(SOURCE_CODE, {
              filename: SOURCE_PATH,
              jsc: {
                target: 'es2016',
                parser: {
                  syntax: 'typescript',
                },
              },
              minify: false,
              isModule: true,
              module: {
                type: 'commonjs',
              },
              sourceMaps: true,
              swcrc: false,
            })
          }),
        ).then(() => {
          deferred.resolve()
        })
      },
      defer: true,
      async: true,
      queued: true,
    })
    .add({
      name: 'esbuild',
      fn: (deferred) => {
        Promise.all(
          Array.from({ length: parallel }).map(() =>
            service.transform(SOURCE_CODE, {
              sourcefile: SOURCE_PATH,
              loader: 'ts',
              sourcemap: true,
              minify: false,
              target: 'es2016',
            }),
          ),
        ).then(() => {
          deferred.resolve()
        })
      },
      defer: true,
      async: true,
      queued: true,
    })
    .on('cycle', function (event) {
      event.target.hz = event.target.hz * parallel
      console.info(String(event.target))
    })
    .on('complete', function () {
      console.info(`${this.name} bench suite: Fastest is ${chalk.green(this.filter('fastest').map('name'))}`)
      service.stop()
      defer()
    })
    .run()

  await task
}

run()
  .then(() => runAsync())
  .then(() => runAsync(cpuCount, parallelSuite))
  .catch(console.error)
