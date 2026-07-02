import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/OffboardShooting/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});