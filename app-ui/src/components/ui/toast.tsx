import { Toaster, toast } from "sonner";

export { toast };

export function PeasToaster() {
  return <Toaster position="top-right" richColors closeButton toastOptions={{ duration: 3600 }} />;
}
