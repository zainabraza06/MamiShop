import { Router } from 'express';
import { AppError } from '../lib/errors';
import { requireUser } from '../auth/current-user';
import { rateLimit } from '../http/request';
import {
  ALLOWED_FORMATS,
  ATTACHMENT_FOLDER,
  cloudinarySignature,
  uploadsConfigured,
} from '../services/custom-requests';

/**
 * Photo uploads.
 *
 * The browser uploads straight to Cloudinary, so photos never pass through
 * (or fill up) this API. What the API hands out is a short-lived signature
 * for one folder and image formats only; without it Cloudinary refuses the
 * upload, and the secret that makes signatures stays on the server.
 */
export const uploadsRouter = Router();

uploadsRouter.post('/uploads/signature', async (req, res) => {
  const user = await requireUser(req);
  await rateLimit(req, 'upload', user.id);

  if (!uploadsConfigured()) {
    throw new AppError('Photo uploads are not set up yet. Describe the piece in words for now.', {
      status: 503,
      code: 'UPLOADS_DISABLED',
      expose: true,
    });
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const params = { allowed_formats: ALLOWED_FORMATS, folder: ATTACHMENT_FOLDER, timestamp };

  res.json({
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    timestamp,
    folder: ATTACHMENT_FOLDER,
    allowedFormats: ALLOWED_FORMATS,
    signature: cloudinarySignature(params, process.env.CLOUDINARY_API_SECRET as string),
  });
});
