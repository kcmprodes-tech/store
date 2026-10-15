/**
 * Upload gambar dari CMS: satu file per request (body mentah), dipanggil lewat fetch dengan header X-CSRF-Token.
 * Token CSRF sudah diperiksa sebelum body dibaca (middleware csrfProtect hanya melihat header).
 */
import express, { Router } from 'express';
import { MAX_IMAGE_BYTES, saveImage, sniffImage } from '../../../adapters/storage/local.js';
import { can } from '../../permissions.js';
import { handle, HttpError } from '../../http.js';

export const uploadRouter = Router();

uploadRouter.post(
  '/upload',
  (req, _res, next) => {
    const roles = req.admin?.roles ?? [];
    if (can(roles, 'produk', 'edit') || can(roles, 'tampilan', 'edit') || can(roles, 'menu', 'edit')) return next();
    next(new HttpError(403, 'Anda tidak punya akses untuk mengunggah gambar.'));
  },
  express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_IMAGE_BYTES }),
  handle(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      throw new HttpError(415, 'Format foto harus JPG, PNG, atau WebP.');
    }
    const type = sniffImage(req.body);
    if (!type) throw new HttpError(415, 'File ini bukan foto JPG, PNG, atau WebP.');
    const url = await saveImage(req.body, type);
    res.status(201).json({ url });
  }),
);
