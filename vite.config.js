import { defineConfig } from 'vite';

// The client lives in ./client; build output goes to ./dist which the
// Node server serves in production.
export default defineConfig({
  root: 'client',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    // Local dev: `npm run dev:server` (port 3000) + `npm run dev:client`.
    // Vite proxies API + websocket to the game server.
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
