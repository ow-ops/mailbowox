import { useEffect, useEffectEvent, useState } from 'react';

const carriesFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');

// True while a drag holding files is over the window.
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false);
  const deliver = useEffectEvent(onFiles);

  useEffect(() => {
    // dragenter and dragleave fire for every element crossed, so only the count says the drag has left.
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setOver(true);
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth -= 1;
      if (depth === 0) setOver(false);
    };
    // Without this the browser refuses the drop and opens the file instead.
    const allow = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setOver(false);
      deliver([...(event.dataTransfer?.files ?? [])]);
    };
    // Text copied from a spreadsheet or a document comes with a picture of itself: that is a paste of text.
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length === 0 || event.clipboardData?.types.includes('text/plain')) return;
      event.preventDefault();
      deliver(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', allow);
    window.addEventListener('drop', drop);
    window.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', allow);
      window.removeEventListener('drop', drop);
      window.removeEventListener('paste', paste);
    };
  }, []);

  return over;
}
