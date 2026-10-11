import { readFile, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { parseEnv } from 'node:util'

const validKey = value => typeof value === 'string' && value.trim().length > 0 && !value.startsWith('REPLACE_')

/** Prepare private connection settings without printing credentials or replacing an existing file. */
export async function prepareAxisVerse(root, input = process.env) {
  let saved = {}
  try { saved = parseEnv((await readFile(join(root, '.env'), 'utf8')).replace(/^\uFEFF/, '')) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const environment = { ...saved, ...input }
  if (!validKey(environment.DEEPSEEK_API_KEY)) throw new Error('请在 .env 配置有效的 DEEPSEEK_API_KEY。')
  const connectionPath = environment.AXISVERSE_COURSE_MCP_CONFIG || join(root, 'axisverse-course-mcp.local.json')
  let connection
  try { connection = JSON.parse(await readFile(connectionPath, 'utf8')) }
  catch (error) {
    if (error.code !== 'ENOENT') throw error
    if (!validKey(environment.AXISVERSE_MCP_KEY)) throw new Error('请在 .env 配置 AXISVERSE_MCP_KEY，或提供已有 MCP 连接文件。')
    connection = { url: environment.AXISVERSE_MCP_URL || 'https://materials.for-fdd.xyz/mcp',
      headers: { Authorization: `Bearer ${environment.AXISVERSE_MCP_KEY}` } }
    await writeFile(connectionPath, JSON.stringify(connection, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  }
  if (new URL(connection.url).protocol !== 'https:' || !connection.headers?.Authorization?.startsWith('Bearer ')
    || !validKey(connection.headers.Authorization.slice(7))) throw new Error('MCP 连接文件无效。')
  if (!environment.AXISVERSE_COURSE_MCP_CONFIG && validKey(environment.AXISVERSE_MCP_KEY)) {
    connection = { url: environment.AXISVERSE_MCP_URL || 'https://materials.for-fdd.xyz/mcp',
      headers: { Authorization: `Bearer ${environment.AXISVERSE_MCP_KEY}` } }
    if (new URL(connection.url).protocol !== 'https:') throw new Error('MCP URL 必须使用 HTTPS。')
    await writeFile(connectionPath, JSON.stringify(connection, null, 2) + '\n', { mode: 0o600 })
  }
  environment.AXISVERSE_COURSE_MCP_CONFIG = connectionPath
  environment.AXISVERSE_ASSET_BASE_URL ||= `http://127.0.0.1:${environment.AXISVERSE_PORT || '3082'}/axisverse/diagrams`
  environment.AXISVERSE_MCP_PYTHON ||= join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
  return { environment, args: ['dsh', 'web', '--patch', 'apps/web/axisverse-study.patch.yml',
    '--patch', 'axisverse-team.patch.yml', '--port', environment.AXISVERSE_PORT || '3082', '--no-open'] }
}

async function main() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const { environment, args } = await prepareAxisVerse(root)
  await access(environment.AXISVERSE_MCP_PYTHON)
  await access(join(root, 'apps/web/dist/index.html'))
  await access(join(root, 'apps/cli/lib/bin.js'))
  const child = spawn(process.execPath, ['apps/cli/lib/bin.js', ...args.slice(1)],
    { cwd: root, env: environment, stdio: 'inherit' })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
