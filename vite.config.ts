import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { viteGeminiMiddleware } from './server/viteGeminiMiddleware';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    process.env.GEMINI_API_KEY ||= env.GEMINI_API_KEY;
    process.env.TURNSTILE_SECRET_KEY ||= env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_SITE_KEY ||= env.TURNSTILE_SITE_KEY;

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        {
          name: 'vite-gemini-api',
          apply: 'serve',
          configureServer(server) {
            server.middlewares.use('/api/gemini', async (req, res, next) => {
              try {
                await viteGeminiMiddleware(req, res);
              } catch (error) {
                next(error as Error);
              }
            });
          }
        }
      ],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
