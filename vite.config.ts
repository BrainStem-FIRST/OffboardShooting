import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/ProjectileTrajectorySimulator/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});