import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the static build can be served from a subpath
  // (e.g. https://host/live/) on any static host without rewrites.
  base: './',
  plugins: [react(), tailwindcss()],
})
