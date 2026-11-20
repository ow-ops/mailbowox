import { toast } from 'sonner';

export function showToast(message: string, action?: { label: string; onClick: () => void }, duration?: number) {
  return toast(message, action && { action, duration });
}

export const dismissToast = (id: string | number) => toast.dismiss(id);

export function showError(title: string, description?: string) {
  toast.error(title, { description });
}
