import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  build: {
    rollupOptions: {
      output: {
        // 무겁고 잘 안 바뀌는 라이브러리를 별도 청크로 분리.
        // → 앱 코드만 바뀌는 배포에서 vendor 청크는 캐시 재사용(immutable),
        //   초기 로드도 병렬 다운로드로 분산된다.
        manualChunks: {
          "vendor-react": ["react", "react-dom"],
          "vendor-search": [
            "instantsearch.js",
            "react-instantsearch",
            "algoliasearch",
            "typesense-instantsearch-adapter",
          ],
        },
      },
    },
  },
  server: {
    port: 8088,
    strictPort: false,
  },
});
