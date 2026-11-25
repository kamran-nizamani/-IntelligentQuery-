export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [
  ".pdf",
  ".docx",
  ".txt",
  ".md",
  ".py",
  ".java",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
] as const;

export type UploadValidation = { valid: File[]; rejected: Array<{ name: string; reason: string }> };

/**
 * Sanitizes a user-supplied filename for safe use in Supabase Storage keys.
 * Strips directory components, control characters, and unsafe path characters.
 */
export function sanitizeFileName(rawName: string): string {
  const base = rawName.split(/[\\/]/).pop() || "file";
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "file";
}

/**
 * Client-side upload validation; Supabase Storage bucket policies enforce
 * matching size and MIME-type limits server-side.
 */
export function validateUploads(files: File[]): UploadValidation {
  const valid: File[] = [];
  const rejected: UploadValidation["rejected"] = [];

  for (const file of files) {
    const dot = file.name.lastIndexOf(".");
    const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
    if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
      rejected.push({ name: file.name, reason: "unsupported file type" });
    } else if (file.size === 0) {
      rejected.push({ name: file.name, reason: "file is empty" });
    } else if (file.size > MAX_UPLOAD_BYTES) {
      rejected.push({ name: file.name, reason: "larger than 20 MB" });
    } else {
      valid.push(file);
    }
  }
  return { valid, rejected };
}
