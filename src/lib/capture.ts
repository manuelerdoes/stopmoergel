export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * Grabs the current video frame as a JPEG. The result matches what the child sees
 * (if the preview is mirrored, so is the picture).
 */
export async function captureFrame(
  video: HTMLVideoElement,
  { mirror = false, maxWidth = 1280, quality = 0.9 } = {},
): Promise<CapturedImage> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error('Camera not ready');

  const scale = Math.min(1, maxWidth / vw);
  const width = Math.round(vw * scale);
  const height = Math.round(vh * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available');
  if (mirror) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('Could not encode picture');
  return { blob, width, height };
}

/** Converts an image file (e.g. from a file picker) to a normalized JPEG frame. */
export async function imageFileToFrame(file: Blob, maxWidth = 1280, quality = 0.9): Promise<CapturedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxWidth / bitmap.width);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not encode picture');
    return { blob, width, height };
  } finally {
    bitmap.close();
  }
}
