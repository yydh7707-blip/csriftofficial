import { copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tauriConfig = JSON.parse(
  await readFile(join(repositoryRoot, 'desktop', 'src-tauri', 'tauri.conf.json'), 'utf8'),
)
const targetDirectory = process.env.CARGO_TARGET_DIR
  ? resolve(process.cwd(), process.env.CARGO_TARGET_DIR)
  : join(repositoryRoot, 'desktop', 'src-tauri', 'target')
const installerName = `CSRIFT_${tauriConfig.version}_x64-setup.exe`
const installerPath = join(targetDirectory, 'release', 'bundle', 'nsis', installerName)
const destinations = [
  join(repositoryRoot, 'public', 'downloads', installerName),
  join(homedir(), 'Downloads', installerName),
]

const installerInfo = await stat(installerPath).catch((error) => {
  throw new Error(`Tauri installer was not found at ${installerPath}: ${error.message}`)
})
if (!installerInfo.isFile()) {
  throw new Error(`Tauri installer path is not a file: ${installerPath}`)
}

for (const destination of destinations) {
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(installerPath, destination)
  console.log(`Copied ${installerName} to ${destination}`)
}
