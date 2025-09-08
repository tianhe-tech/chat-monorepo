import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import vueRouter from 'unplugin-vue-router/vite'
import tailwindcss from '@tailwindcss/vite'
import ui from '@nuxt/ui/vite'
import { VueRouterAutoImports } from 'unplugin-vue-router'
import icons from 'unplugin-icons/vite'
import jsx from '@vitejs/plugin-vue-jsx'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vueRouter(),
    vue(),
    vueDevTools(),
    tailwindcss(),
    ui({
      autoImport: { imports: [VueRouterAutoImports, 'vue', '@vueuse/core'] },
      components: { directoryAsNamespace: true },
    }),
    icons({ compiler: 'vue3' }),
    jsx(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
