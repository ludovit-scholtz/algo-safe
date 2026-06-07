import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
      },
    }),
  ],
  resolve: {
    alias: {
      'algo-safe': resolve(__dirname, '../algo-safe-contracts/dist/index.mjs'),
      'vite-plugin-node-polyfills/shims/buffer': resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js'),
      'vite-plugin-node-polyfills/shims/process': resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js'),
      'vite-plugin-node-polyfills/shims/global': resolve(__dirname, 'node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js'),
    },
    dedupe: ['algosdk'],
  },
  optimizeDeps: {
    include: ['@walletconnect/sign-client', '@walletconnect/modal', 'algosdk'],
  },
})
