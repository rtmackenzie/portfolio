import { execute } from '../db/database.ts'

type EntityType = 'property' | 'tenant' | 'mortgage' | 'expense' | 'maintenance' |
  'certificate' | 'document' | 'acquisition' | 'scenario' | 'payment'

export function logActivity(
  eventType: string,
  entityType: EntityType,
  entityId: number | null,
  description: string
) {
  try {
    execute(
      'INSERT INTO activity_log (event_type, entity_type, entity_id, description) VALUES (?, ?, ?, ?)',
      [eventType, entityType, entityId, description]
    )
  } catch (err) {
    console.error('[ActivityLogger] Failed to log activity:', err)
  }
}
