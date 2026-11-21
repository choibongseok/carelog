import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// GitHub Pages 의 /carelog/ 아래에 올라간다. 서버의 src/domain 을 그대로 가져다 쓰므로 상위 폴더 접근을 허용한다.
export default defineConfig({
  base: process.env.WEB_BASE ?? '/carelog/',
  plugins: [react()],
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true },
});
