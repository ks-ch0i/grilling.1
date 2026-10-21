import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        authPopup: fileURLToPath(new URL('./auth-popup.html', import.meta.url)),
      },
    },
  },
});
