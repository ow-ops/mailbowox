// expo-print on web prints the page itself, so the document goes in a frame of its own and that frame prints.
export async function printHtml(html: string) {
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html;
  document.body.appendChild(frame);
  await new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }));
  frame.contentWindow?.print();
  // The print dialog blocks until it closes, so the frame can go once print returns.
  frame.remove();
}
