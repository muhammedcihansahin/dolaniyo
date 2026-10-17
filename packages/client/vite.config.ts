import { defineConfig } from 'vite';

const SERVER = 'http://localhost:8080';

export default defineConfig({
  server: {
    host: true, // aynı ağdaki cihazlar (telefon vb.) da bağlanabilsin
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/health': SERVER,
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
