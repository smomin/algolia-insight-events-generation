/**
 * POST /api/admin/migrate
 *
 * One-time migration from the old "industry" naming to the new "site" naming.
 *
 * What it does:
 *   1. Reads the `_index` from the old `industryConfigs` collection to discover
 *      all site IDs.
 *   2. Copies every site config doc from `industryConfigs` → `siteConfigs`
 *      (including rebuilding the `_index` in the new collection).
 *   3. For each site ID, reads the `personas` doc and renames every persona's
 *      `industry` field to `site`.
 *   4. For each site ID, migrates the ephemeral collections (sessions,
 *      eventLogs, schedulerRuns) renaming `industryId` → `siteId` inside each
 *      stored record.
 *   5. Migrates `agentData` guardrail + supervisor docs: `industryId` →
 *      `siteId`, `industryName` → `siteName`.
 *
 * The old `industryConfigs` collection documents are left in place so you can
 * verify the migration before removing them manually.
 *
 * Safe to run multiple times — all writes are upserts.
 *
 * CAUTION: Do not call this in production while the app is actively writing
 * new sessions / events.
 */

import { NextResponse } from 'next/server';
import { getCollection } from '@/lib/couchbase';
import type { AgentConfig, Persona, SentEvent, SessionRecord, SchedulerRun } from '@/types';

// ─────────────────────────────────────────────
// Low-level helpers — bypass the CollectionName type guard so we can
// still access the legacy `industryConfigs` collection which is no longer
// in the COLLECTIONS array.
// ─────────────────────────────────────────────

import { connect } from 'couchbase';

async function getLegacyCollection(name: string) {
  const url      = process.env.COUCHBASE_URL      ?? 'couchbase://localhost';
  const username = process.env.COUCHBASE_USERNAME ?? 'Administrator';
  const password = process.env.COUCHBASE_PASSWORD ?? 'password';
  const bucket   = process.env.COUCHBASE_BUCKET   ?? 'algolia-insights';

  const cluster = await connect(url, { username, password });
  return cluster.bucket(bucket).scope('_default').collection(name);
}

async function legacyGet<T>(collName: string, key: string): Promise<T | null> {
  try {
    const coll = await getLegacyCollection(collName);
    const result = await coll.get(key);
    return result.content as T;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Migration steps
// ─────────────────────────────────────────────

interface MigrationLog {
  step: string;
  status: 'ok' | 'skipped' | 'warn' | 'error';
  detail?: string;
}

export async function POST() {
  const log: MigrationLog[] = [];

  try {
    // ── Step 1: Read the old industryConfigs index ──────────────────────
    const oldIndex = await legacyGet<{ keys: string[] }>('industryConfigs', '_index');
    if (!oldIndex || oldIndex.keys.length === 0) {
      log.push({
        step: 'read industryConfigs index',
        status: 'warn',
        detail: 'No _index found in industryConfigs — collection may already be empty or was never created.',
      });
      return NextResponse.json({ ok: false, log }, { status: 200 });
    }

    const siteIds = oldIndex.keys;
    log.push({
      step: 'read industryConfigs index',
      status: 'ok',
      detail: `Found ${siteIds.length} site(s): ${siteIds.join(', ')}`,
    });

    // ── Step 2: Copy site config docs ────────────────────────────────────
    const siteConfigsColl = await getCollection('siteConfigs');
    let siteConfigsMigrated = 0;

    for (const id of siteIds) {
      const doc = await legacyGet<AgentConfig>('industryConfigs', id);
      if (!doc) {
        log.push({ step: `copy siteConfig:${id}`, status: 'warn', detail: 'Document not found in industryConfigs' });
        continue;
      }

      // The doc shape is already correct (SiteConfig) — just write it over.
      await siteConfigsColl.upsert(id, doc);
      siteConfigsMigrated++;
    }

    // Rebuild _index in siteConfigs
    await siteConfigsColl.upsert('_index', { keys: siteIds });

    log.push({
      step: 'copy siteConfigs',
      status: 'ok',
      detail: `Migrated ${siteConfigsMigrated}/${siteIds.length} site config docs + rebuilt _index`,
    });

    // ── Step 3: Migrate personas  (industry → site field) ───────────────
    const personasColl = await getCollection('personas');
    let personasMigrated = 0;
    let personasTotal = 0;

    for (const siteId of siteIds) {
      let personaDoc: { personas: Persona[] } | null = null;
      try {
        const result = await personasColl.get(siteId);
        personaDoc = result.content as { personas: Persona[] };
      } catch {
        // no persona doc for this site
      }

      if (!personaDoc) continue;

      const updated = personaDoc.personas.map((p) => {
        personasTotal++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyP = p as any;
        if ('industry' in anyP && !('site' in anyP)) {
          const { industry, ...rest } = anyP;
          personasMigrated++;
          return { ...rest, site: industry } as Persona;
        }
        return p;
      });

      await personasColl.upsert(siteId, { personas: updated });
    }

    log.push({
      step: 'migrate personas (industry → site)',
      status: 'ok',
      detail: `Renamed industry field on ${personasMigrated}/${personasTotal} persona(s) across ${siteIds.length} site(s)`,
    });

    // ── Step 4: Migrate sessions (industryId → siteId) ───────────────────
    const sessionsColl = await getCollection('sessions');
    let sessionsMigrated = 0;
    let sessionsTotal = 0;

    for (const siteId of siteIds) {
      let doc: { sessions: SessionRecord[] } | null = null;
      try {
        const result = await sessionsColl.get(siteId);
        doc = result.content as { sessions: SessionRecord[] };
      } catch { /* no doc */ }

      if (!doc) continue;

      const updated = doc.sessions.map((s) => {
        sessionsTotal++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyS = s as any;
        if ('industryId' in anyS && !('siteId' in anyS)) {
          const { industryId, ...rest } = anyS;
          sessionsMigrated++;
          return { ...rest, siteId: industryId } as SessionRecord;
        }
        return s;
      });

      await sessionsColl.upsert(siteId, { sessions: updated });
    }

    log.push({
      step: 'migrate sessions (industryId → siteId)',
      status: 'ok',
      detail: `Renamed industryId on ${sessionsMigrated}/${sessionsTotal} session record(s)`,
    });

    // ── Step 5: Migrate event logs (meta.industryId → meta.siteId) ────────
    const eventLogsColl = await getCollection('eventLogs');
    let eventsMigrated = 0;
    let eventsTotal = 0;

    for (const siteId of siteIds) {
      let doc: { events: SentEvent[] } | null = null;
      try {
        const result = await eventLogsColl.get(siteId);
        doc = result.content as { events: SentEvent[] };
      } catch { /* no doc */ }

      if (!doc) continue;

      const updated = doc.events.map((e) => {
        eventsTotal++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta = (e as any).meta;
        if (meta && 'industryId' in meta && !('siteId' in meta)) {
          const { industryId, ...restMeta } = meta;
          eventsMigrated++;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { ...e, meta: { ...restMeta, siteId: industryId } } as any;
        }
        return e;
      });

      await eventLogsColl.upsert(siteId, { events: updated });
    }

    log.push({
      step: 'migrate event logs (meta.industryId → meta.siteId)',
      status: 'ok',
      detail: `Renamed industryId on ${eventsMigrated}/${eventsTotal} event(s)`,
    });

    // ── Step 6: Migrate scheduler runs (industryId → siteId) ─────────────
    const schedulerRunsColl = await getCollection('schedulerRuns');
    let runsMigrated = 0;
    let runsTotal = 0;

    for (const siteId of siteIds) {
      let doc: { runs: SchedulerRun[] } | null = null;
      try {
        const result = await schedulerRunsColl.get(siteId);
        doc = result.content as { runs: SchedulerRun[] };
      } catch { /* no doc */ }

      if (!doc) continue;

      const updated = doc.runs.map((r) => {
        runsTotal++;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const anyR = r as any;
        if ('industryId' in anyR && !('siteId' in anyR)) {
          const { industryId, ...rest } = anyR;
          runsMigrated++;
          return { ...rest, siteId: industryId } as SchedulerRun;
        }
        return r;
      });

      await schedulerRunsColl.upsert(siteId, { runs: updated });
    }

    log.push({
      step: 'migrate schedulerRuns (industryId → siteId)',
      status: 'ok',
      detail: `Renamed industryId on ${runsMigrated}/${runsTotal} scheduler run(s)`,
    });

    // ── Step 7: Migrate agentData guardrail + supervisor docs ─────────────
    const agentDataColl = await getCollection('agentData');
    let agentDocsMigrated = 0;

    for (const siteId of siteIds) {
      // Guardrail violations: stored as guardrails_<siteId>
      for (const keyVariant of [`guardrails_${siteId}`, `guardrails_${siteId}`]) {
        let doc: { violations: unknown[] } | null = null;
        try {
          const result = await agentDataColl.get(keyVariant);
          doc = result.content as { violations: unknown[] };
        } catch { /* no doc */ }

        if (!doc) continue;

        const updated = doc.violations.map((v) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyV = v as any;
          if ('industryId' in anyV && !('siteId' in anyV)) {
            const { industryId, ...rest } = anyV;
            return { ...rest, siteId: industryId };
          }
          return v;
        });

        await agentDataColl.upsert(keyVariant, { violations: updated });
        agentDocsMigrated++;
      }

      // Supervisor decisions: stored as supervisor_decisions
      try {
        const result = await agentDataColl.get('supervisor_decisions');
        const doc = result.content as { decisions: unknown[] };
        const updated = doc.decisions.map((d) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const anyD = d as any;
          let migrated = { ...anyD };
          if ('industryId' in anyD && !('siteId' in anyD)) {
            const { industryId, ...rest } = migrated;
            migrated = { ...rest, siteId: industryId };
          }
          if ('industryName' in anyD && !('siteName' in anyD)) {
            const { industryName, ...rest } = migrated;
            migrated = { ...rest, siteName: industryName };
          }
          return migrated;
        });
        await agentDataColl.upsert('supervisor_decisions', { decisions: updated });
        agentDocsMigrated++;
      } catch { /* no supervisor_decisions doc */ }
    }

    log.push({
      step: 'migrate agentData (industryId → siteId, industryName → siteName)',
      status: 'ok',
      detail: `Updated ${agentDocsMigrated} agentData document(s)`,
    });

    // ── Done ─────────────────────────────────────────────────────────────
    return NextResponse.json({
      ok: true,
      message: `Migration complete. ${siteIds.length} site(s) migrated. The old 'industryConfigs' collection documents were left intact — you can delete them manually once verified.`,
      siteIds,
      log,
    });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push({ step: 'migration aborted', status: 'error', detail: message });
    return NextResponse.json({ ok: false, error: message, log }, { status: 500 });
  }
}
