// Shared file size guardrails.
// Returns `true` if the file passes and processing should continue.
// Returns `false` if it exceeds the hard limit and the caller should bail out.
// Fires an informational toast for large-but-allowed files.

type ToastFn = (opts: { title: string; description?: string; variant?: "default" | "destructive" }) => void;

export const MAX_FILE_MB = 50;
export const WARN_FILE_MB = 20;

export function checkFileSize(file: File, toast: ToastFn): boolean {
  const fileSizeMB = file.size / (1024 * 1024);

  if (fileSizeMB > MAX_FILE_MB) {
    toast({
      title: "File too large",
      description: `${fileSizeMB.toFixed(1)} MB exceeds the ${MAX_FILE_MB} MB limit. Export a shorter date range from Amazon and try again.`,
      variant: "destructive",
    });
    return false;
  }

  if (fileSizeMB > WARN_FILE_MB) {
    toast({
      title: "Large file detected",
      description: `${fileSizeMB.toFixed(1)} MB — parsing may take a moment.`,
    });
  }

  return true;
}
