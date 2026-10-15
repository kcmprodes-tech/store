/**
 * Entry Vercel Function: seluruh aplikasi Express sebagai satu handler (req, res).
 * Dibundel oleh scripts/vercel-build.mjs; untuk jalan lokal tetap pakai src/server.ts.
 */
import { createApp } from './app.js';

export default createApp();
