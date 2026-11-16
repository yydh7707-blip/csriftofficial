import { copyFileSync, createReadStream, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function desktopArtworkPlugin(): Plugin {
  const desktopRoot = fileURLToPath(new URL('.', import.meta.url))
  const publicRoot = resolve(desktopRoot, '..', 'public')
  const artwork = new Map([
    ['/images/csrift-eyes-cutout.png', resolve(publicRoot, 'images', 'csrift-eyes-cutout.png')],
    ['/assets/cs2-cover.png', resolve(publicRoot, 'assets', 'cs2-cover.png')],
  ])
  return {
    name: 'copy-csrift-desktop-artwork',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const source = artwork.get(request.url?.split('?')[0] ?? '')
        if (!source || !existsSync(source)) {
          next()
          return
        }
        response.setHeader('Content-Type', 'image/png')
        createReadStream(source).pipe(response)
      })
    },
    writeBundle() {
      const eyesSource = resolve(publicRoot, 'images', 'csrift-eyes-cutout.png')
      if (!existsSync(eyesSource)) throw new Error('CSRIFT eye artwork is missing from public/images.')
      const eyesTarget = resolve(desktopRoot, 'dist', 'images')
      mkdirSync(eyesTarget, { recursive: true })
      copyFileSync(eyesSource, resolve(eyesTarget, 'csrift-eyes-cutout.png'))
      const coverSource = resolve(publicRoot, 'assets', 'cs2-cover.png')
      if (existsSync(coverSource)) {
        const coverTarget = resolve(desktopRoot, 'dist', 'assets')
        mkdirSync(coverTarget, { recursive: true })
        copyFileSync(coverSource, resolve(coverTarget, 'cs2-cover.png'))
      }
    },
  }
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  publicDir: false,
  plugins: [react(), tailwindcss(), desktopArtworkPlugin()],
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
