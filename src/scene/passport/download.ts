/** Save text as a file through the browser (no server). CSV gets a UTF-8 byte-order mark so spreadsheet programs read ₂ and ³ correctly. */
export function downloadText(name: string, mime: string, text: string): void {
  const body = mime.startsWith("text/csv") ? `﻿${text}` : text;
  const url = URL.createObjectURL(new Blob([body], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
