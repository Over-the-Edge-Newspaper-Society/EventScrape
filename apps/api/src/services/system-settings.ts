import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { systemSettings, type SystemSettings } from '../db/schema.js'

export const SYSTEM_SETTINGS_ID = '00000000-0000-0000-0000-000000000100'

export type SystemSettingsUpdate = Partial<Pick<SystemSettings, 'posterImportEnabled'>>

export async function ensureSystemSettings(): Promise<SystemSettings> {
  const [settings] = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.id, SYSTEM_SETTINGS_ID))
    .limit(1)

  if (settings) {
    return settings
  }

  const [created] = await db
    .insert(systemSettings)
    .values({ id: SYSTEM_SETTINGS_ID })
    .returning()

  return created
}

export async function updateSystemSettings(updates: SystemSettingsUpdate): Promise<SystemSettings> {
  const settings = await ensureSystemSettings()

  if (Object.keys(updates).length === 0) {
    return settings
  }

  const [updated] = await db
    .update(systemSettings)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(systemSettings.id, settings.id))
    .returning()

  return updated
}
