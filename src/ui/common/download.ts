export function downloadText(filename: string, text: string, type = 'application/json') {
  const safe = filename.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBlob(filename: string, blob: Blob) {
  const safe = filename.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
