import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  
  // Configuración del servidor de desarrollo
  server: {
    port: 3000,
    host: true, // Permite conexiones desde cualquier IP
    proxy: {
      // Proxy para las llamadas a la API
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true, // Para WebSockets si los necesitas en el futuro
      }
    }
  },

  // Configuración del build
  build: {
    outDir: 'dist',
    sourcemap: true,
    // Optimización del bundle
    rollupOptions: {
      output: {
        manualChunks: {
          // Separar dependencias grandes en chunks separados
          vendor: ['react', 'react-dom'],
          ui: ['lucide-react', 'react-hot-toast'],
          utils: ['axios']
        }
      }
    },
    // Aumentar el límite de advertencia para chunks grandes
    chunkSizeWarningLimit: 1000
  },

  // Resolución de módulos
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@services': path.resolve(__dirname, './src/services'),
      '@types': path.resolve(__dirname, './src/types'),
      '@hooks': path.resolve(__dirname, './src/hooks'),
      '@utils': path.resolve(__dirname, './src/utils')
    }
  },

  // Variables de entorno
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },


  // Optimización de dependencias
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'axios',
      'react-hot-toast',
      'lucide-react'
    ]
  },

  // Configuración para preview (producción local)
  preview: {
    port: 4173,
    host: true
  }
})