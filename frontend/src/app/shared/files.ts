/** Saves a downloaded file under its name, as a link with the download attribute would. */
export function saveFile(blob: Blob, fileName: string): void {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Some browsers start the download after click() returns.
  setTimeout(() => window.URL.revokeObjectURL(url), 1000);
}
