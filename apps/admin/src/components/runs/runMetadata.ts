export type PaginationType = 'page' | 'calendar' | 'none'

const paginationMap: Record<string, PaginationType> = {
  'tourismpg_com': 'calendar',
  'unbctimberwolves_com': 'calendar',
  'unbc_ca': 'page',
  'prince_george_ca': 'calendar',
  'downtownpg_com': 'calendar',
}

const integrationTagsMap: Record<string, string[]> = {
  'tourismpg_com': ['calendar'],
  'unbctimberwolves_com': ['calendar', 'csv'],
  'unbc_ca': ['page-navigation'],
  'prince_george_ca': ['calendar'],
  'downtownpg_com': ['calendar'],
  'ai_poster_import': ['csv'],
}

const uploadSupportMap: Record<string, boolean> = {
  'unbctimberwolves_com': true,
  'ai_poster_import': true,
}

const uploadInstructionsMap: Record<string, string> = {
  'unbctimberwolves_com': `To download events manually:
1. Go to https://unbctimberwolves.com/calendar
2. Click the "Sync/Download" button (calendar icon)
3. Select "Excel" as the export format
4. Click "Download Now"
5. Upload the downloaded CSV file below`,
  'ai_poster_import': `To import events from posters:
1. Use the Poster Import prompt (see repo: Poster Import/poster-import-prompt.md)
2. Run the prompt on your poster image with an LLM (Claude/GPT-4o etc.)
3. Copy the JSON output that matches the prompt schema
4. Upload a .json file below or paste the JSON into the text area`,
}

export const getSourcePaginationType = (moduleKey: string): PaginationType => {
  return paginationMap[moduleKey] || 'none'
}

export const getModuleIntegrationTags = (moduleKey: string): string[] => {
  return integrationTagsMap[moduleKey] || []
}

export const moduleSupportsUpload = (moduleKey: string): boolean => {
  return uploadSupportMap[moduleKey] || false
}

export const getUploadInstructions = (moduleKey: string): string => {
  return uploadInstructionsMap[moduleKey] || 'Upload instructions not available'
}
