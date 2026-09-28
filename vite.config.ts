import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths: the app is served from GitHub Pages under
  // /Trimaco-Route/ and routes live in the #hash, so the page URL never changes.
  base: './',
  plugins: [react()],
});
