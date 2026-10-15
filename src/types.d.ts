import type { Platform } from './lib/device.js';
import type { AdminContext } from './admin/auth/session.js';

declare global {
  namespace Express {
    interface Request {
      platform: Platform;
      /** Akun CMS yang sedang login (hanya di route /admin). */
      admin?: AdminContext;
    }
    interface Response {
      /** Render halaman store dengan set template sesuai req.platform. */
      renderPage(view: string, data?: Record<string, unknown>, status?: number): Promise<void>;
      /** Render halaman CMS (views/admin/pages). */
      renderAdmin(view: string, data?: Record<string, unknown>, status?: number): Promise<void>;
    }
  }
}

export {};
