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
    ['/images/steam-logo-circle.png', resolve(publicRoot, 'images', 'steam-logo-circle.png')],
    ['/assets/cs2-cover.png', resolve(publicRoot, 'assets', 'cs2-cover.png')],
    ['/assets/cs2-banner.png', resolve(publicRoot, 'assets', 'cs2-banner.png')],
    ['/assets/pubg-banner.png', resolve(publicRoot, 'assets', 'pubg-banner.png')],
    ['/assets/valorant-banner.png', resolve(publicRoot, 'assets', 'valorant-banner.png')],
    ['/assets/fc-online-banner.png', resolve(publicRoot, 'assets', 'fc-online-banner.png')],
    ['/assets/fc-online-mark.png', resolve(publicRoot, 'assets', 'fc-online-mark.png')],
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
      const steamLogoSource = resolve(publicRoot, 'images', 'steam-logo-circle.png')
      if (!existsSync(steamLogoSource)) throw new Error('Steam logo artwork is missing from public/images.')
      copyFileSync(steamLogoSource, resolve(eyesTarget, 'steam-logo-circle.png'))
      const coverSource = resolve(publicRoot, 'assets', 'cs2-cover.png')
      if (existsSync(coverSource)) {
        const coverTarget = resolve(desktopRoot, 'dist', 'assets')
        mkdirSync(coverTarget, { recursive: true })
        copyFileSync(coverSource, resolve(coverTarget, 'cs2-cover.png'))
      }
      const banners = ['cs2-banner.png', 'pubg-banner.png', 'valorant-banner.png', 'fc-online-banner.png', 'fc-online-mark.png']
      const bannerTarget = resolve(desktopRoot, 'dist', 'assets')
      mkdirSync(bannerTarget, { recursive: true })
      for (const banner of banners) {
        const source = resolve(publicRoot, 'assets', banner)
        if (!existsSync(source)) throw new Error(`CSRIFT game banner is missing: ${banner}`)
        copyFileSync(source, resolve(bannerTarget, banner))
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
