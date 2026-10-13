import type { Platform } from './lib/device.js';

declare global {
  namespace Express {
    interface Request {
      platform: Platform;
    }
    interface Response {
      /** Render halaman store dengan set template sesuai req.platform. */
      renderPage(view: string, data?: Record<string, unknown>, status?: number): Promise<void>;
    }
  }
}

export {};
