import type { PluginOption } from 'vite'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import vueJsx from '@vitejs/plugin-vue-jsx'
import { fileURLToPath, URL } from 'node:url'
import { visualizer } from 'rollup-plugin-visualizer'
import AutoImport from 'unplugin-auto-import/vite'
import Component from 'unplugin-vue-components/vite'
import { defineConfig, loadEnv } from 'vite'
import vueDevTools from 'vite-plugin-vue-devtools'
import Layouts from 'vite-plugin-vue-layouts'
import { VueRouterAutoImports } from 'vue-router/unplugin'
import VueRouter from 'vue-router/vite'

const RouteGenerateExclude = ['**/components/**', '**/layouts/**', '**/data/**', '**/types/**']

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const buildDate = new Date().toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  return {
    base: env.VITE_BASE || '/',
    define: {
      __APP_BUILD_DATE__: JSON.stringify(buildDate),
    },
    plugins: [
      VueRouter({
        exclude: RouteGenerateExclude,
        dts: 'src/types/route-map.d.ts',
      }),
      vue(),
      vueJsx(),
      vueDevTools(),
      tailwindcss(),
      visualizer({ gzipSize: true, brotliSize: true }) as PluginOption,
      Layouts({
        defaultLayout: 'default',
      }),
      AutoImport({
        include: [
          /\.[tj]sx?$/,
          /\.vue$/,
        ],
        imports: [
          'vue',
          VueRouterAutoImports,
        ],
        dirs: [
          'src/composables/**/*.ts',
          'src/constants/**/*.ts',
          'src/stores/**/*.ts',
        ],
        defaultExportByFilename: true,
        dts: 'src/types/auto-import.d.ts',
      }),
      Component({
        dirs: [
          'src/components',
        ],
        collapseSamePrefixes: true,
        directoryAsNamespace: true,
        dts: 'src/types/auto-import-components.d.ts',
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    build: {
      // Lightning CSS 会把手工编写的 backdrop-filter 降级重写为 -webkit- 前缀导致 Chromium 毛玻璃失效，用 esbuild 只压缩不改属性
      cssMinify: 'esbuild' as const,
      // 构建产物直接输出到 NECE 项目根目录的 public/（Express 静态托管根）
      outDir: fileURLToPath(new URL('../public', import.meta.url)),
      emptyOutDir: true,
    },
  }
})
