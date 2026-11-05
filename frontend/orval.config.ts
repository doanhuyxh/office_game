import { defineConfig } from 'orval';

// Sinh TYPE từ OpenAPI của OfficeHub.Api vào src/types/generated.
// Cần Api đang chạy rồi:  bun run api:generate
// Hàm gọi API vẫn viết tay trong src/features/<x>/api/*.api.ts (dùng type sinh ra).
export default defineConfig({
  officehub: {
    input: process.env.OPENAPI_URL ?? 'http://localhost:5080/openapi/v1.json',
    output: { target: 'src/types/generated/index.ts', client: 'fetch', mode: 'single', schemas: 'src/types/generated/model' },
  },
});
