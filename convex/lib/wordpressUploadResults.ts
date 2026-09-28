export interface WordPressMediaResult {
  status: 'not_requested' | 'not_attempted' | 'imported' | 'failed' | 'skipped';
  error_code?: string;
  attachment_id?: number;
}

export interface WordPressUploadResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
  action?: 'created' | 'updated' | 'skipped';
  occurrencesCreated?: number;
  warnings?: string[];
  media?: WordPressMediaResult;
}

export interface WordPressUploadResponse {
  message: string;
  results: Array<{ event: { id: string; title: string }; result: WordPressUploadResult }>;
}

// Older plugin versions omit these fields. A failed image still needs a visible
// warning if a plugin returns the structured result without a message.
export function getUploadWarnings(result: WordPressUploadResult): string[] {
  const warnings = Array.isArray(result.warnings)
    ? result.warnings.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    : [];
  if (!warnings.length && result.media?.status === 'failed') {
    return ['The event was saved, but its featured image could not be imported.'];
  }
  if (!warnings.length && result.media?.status === 'skipped') {
    return ['The featured image was skipped because remote media imports were not permitted.'];
  }
  return warnings;
}

export function summarizeWordPressUpload(results: WordPressUploadResponse['results']) {
  const saved = results.filter(({ result }) => result.success && result.action !== 'skipped').length;
  const skipped = results.filter(({ result }) => result.success && result.action === 'skipped').length;
  const failed = results.filter(({ result }) => !result.success).length;
  const warned = results.filter(({ result }) => getUploadWarnings(result).length > 0).length;
  return {
    saved, skipped, failed, warned,
    // Keep the opening compatible with scheduled workers parsing older responses.
    message: `Uploaded ${saved} events, ${failed} failed, ${skipped} skipped, ${warned} with warnings`,
  };
}
