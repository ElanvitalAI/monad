/**
 * Migration entry point: SessionsService unit coverage lives in the canonical
 * source-adjacent suite below. Import it rather than maintaining a second copy,
 * so invoking this historical path executes the same current-store contract.
 *
 * Migrated coverage includes msgCount notifications, browser polling cadence,
 * idempotent release and disposal safety, delete-refresh, and path encoding.
 */
import '../apps/pwa/src/lib/sessions-service.test';
