import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const jsonImportPattern = /^import\s+(\w+)\s+from\s+(['"])([^'"]+\.json)\2\s+assert\s+\{\s*type\s*:\s*(['"])json\4\s*\};?$/gm
const fsImport = 'import { readFileSync } from \'node:fs\';'

let files = []
try {
  const output = execSync('rg -l -uu "(with|assert)\\\\s*\\\\{\\\\s*type\\\\s*:\\\\s*[\\\'"]json[\\\'"]\\\\s*\\\\}" node_modules/.pnpm', {
    encoding: 'utf8',
    shell: true
  })

  files = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
} catch (error) {
  console.error(`Failed to locate files with 'with' import assertions: ${error.message}`)
}

for (const filePath of files) {
  try {
    const content = readFileSync(filePath, 'utf8')
    if (!jsonImportPattern.test(content)) {
      continue
    }

    jsonImportPattern.lastIndex = 0
    let patched = content.replace(jsonImportPattern, (_match, varName, _quote, jsonPath) => {
      return `const ${varName} = JSON.parse(readFileSync(new URL('${jsonPath}', import.meta.url), 'utf8'));`
    })

    if (!patched.includes(fsImport)) {
      patched = `${fsImport}\n${patched}`
    }

    writeFileSync(filePath, patched)
    console.log(`Patched ${filePath} to load JSON via readFileSync.`)
  } catch (error) {
    console.error(`Unable to patch ${filePath}: ${error.message}`)
  }
}
