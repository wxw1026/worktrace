import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  site: 'https://worktrace.local',
  vite: {
    resolve: {
      alias: {
        '@': '/src',
      },
    },
  },
});
