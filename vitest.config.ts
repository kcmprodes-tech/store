import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Tes route memakai database dev yang sudah di-seed; jalankan berurutan.
    fileParallelism: false,
  },
});
