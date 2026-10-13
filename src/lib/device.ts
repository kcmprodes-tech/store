import type { NextFunction, Request, Response } from 'express';

export type Platform = 'desktop' | 'mobile';

const MOBILE_UA = /Mobi|Android|iPhone|iPod|IEMobile|Opera Mini|BlackBerry/i;
const COOKIE = 'device';

export function platformFromUserAgent(ua: string | undefined): Platform {
  return MOBILE_UA.test(ua ?? '') ? 'mobile' : 'desktop';
}

/**
 * Pilih set template desktop/mobile dari User-Agent, sama seperti kompas.com.
 * Untuk pengujian: ?device=mobile|desktop menyimpan pilihan di cookie, ?device=auto menghapusnya.
 */
export function deviceMiddleware(req: Request, res: Response, next: NextFunction) {
  const forced = typeof req.query.device === 'string' ? req.query.device : undefined;
  if (forced === 'mobile' || forced === 'desktop') {
    res.cookie(COOKIE, forced, { httpOnly: true, sameSite: 'lax' });
    req.platform = forced;
  } else if (forced === 'auto') {
    res.clearCookie(COOKIE);
    req.platform = platformFromUserAgent(req.get('user-agent'));
  } else {
    const saved = req.cookies?.[COOKIE];
    req.platform = saved === 'mobile' || saved === 'desktop' ? saved : platformFromUserAgent(req.get('user-agent'));
  }
  res.vary('User-Agent');
  next();
}
