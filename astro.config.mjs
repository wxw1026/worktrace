import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  site: 'https://wxw1026.github.io',
  base: '/worktrace',
  vite: {
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  },
});
