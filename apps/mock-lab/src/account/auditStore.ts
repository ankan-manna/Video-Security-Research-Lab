import { randomUUID } from "node:crypto";
import { JsonStore } from "./jsonStore.js";
import type { AuditEvent, AuditEventType, AuditOutcome } from "./types.js";

export interface RecordAuditEventInput {
  type: AuditEventType;
  actorUserId: string | null;
  actorSessionFingerprint: string | null;
  channelId?: string | null;
  videoId?: string | null;
  outcome: AuditOutcome;
  detail: string;
}

export class AuditStore {
  private readonly store: JsonStore<AuditEvent>;

  constructor(
    filePath: string,
    private readonly maxEntries: number,
  ) {
    this.store = new JsonStore<AuditEvent>(filePath);
  }

  /**
   * The only way an audit event gets written. Takes structured fields
   * rather than a free-form object precisely so nothing resembling a raw
   * token/password/payment secret can accidentally be interpolated into
   * `detail` without a deliberate, visible string — see
   * docs/SECURITY_MODEL.md's audit-trail section.
   */
  async record(input: RecordAuditEventInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: randomUUID(),
      type: input.type,
      timestamp: new Date().toISOString(),
      actorUserId: input.actorUserId,
      actorSessionFingerprint: input.actorSessionFingerprint,
      channelId: input.channelId ?? null,
      videoId: input.videoId ?? null,
      outcome: input.outcome,
      detail: input.detail,
    };
    await this.store.appendCapped(event, this.maxEntries);
    return event;
  }

  list(): Promise<AuditEvent[]> {
    return this.store.list();
  }

  listForChannel(channelId: string): Promise<AuditEvent[]> {
    return this.store.find((event) => event.channelId === channelId);
  }
}
