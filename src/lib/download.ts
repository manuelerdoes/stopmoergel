/** Triggers a browser download for a Blob. Tiny on purpose: importing it must not pull in the video encoder. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  // Revoke after a tick so the browser has started the download.
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
