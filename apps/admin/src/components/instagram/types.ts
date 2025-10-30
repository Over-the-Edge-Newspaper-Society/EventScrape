export interface InstagramSettings {
  defaultScraperType: 'apify' | 'instagram-private-api'
  allowPerAccountOverride: boolean
  autoClassifyWithAi?: boolean
}

export interface InstagramScrapeOptions {
  accountLimit?: number
  postsPerAccount: number
  batchSize: number
}

export interface InstagramAccountPreview {
  id: string
  username: string
  name: string
}
