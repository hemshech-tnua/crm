import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Strict Content-Security-Policy: only this app's own scripts, no inline scripts, network only to Supabase.
function csp(supabaseUrl: string): Plugin {
  const origin = (() => {
    try {
      return new URL(supabaseUrl).origin;
    } catch {
      return '';
    }
  })();
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${origin}`.trim(),
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
  ].join('; ');
  return {
    name: 'csp-meta',
    transformIndexHtml: {
      order: 'post',
      handler: (html, ctx) =>
        ctx.server ? html : html.replace('<!--csp-->', `<meta http-equiv="Content-Security-Policy" content="${policy}" />`),
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react(), tailwindcss(), csp(env.VITE_SUPABASE_URL ?? '')],
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    server: { port: 3100, host: '127.0.0.1', strictPort: true },
    preview: { port: 4173, host: '127.0.0.1', strictPort: true },
    build: {
      sourcemap: false,
      target: 'es2022',
      chunkSizeWarningLimit: 900,
      // fonts are never inlined as data: URLs, so the CSP can keep font-src 'self'
      assetsInlineLimit: (file: string) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    },
  };
});
