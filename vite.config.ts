import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/hbase-06-delete-marker/',
  server: {
    port: 54306,
  },
})
