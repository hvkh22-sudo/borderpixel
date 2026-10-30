/**
 * AI Script Studio client. Talks only to Promptly's own proxy; no provider
 * key ever ships in the app. Scripts are sent only when the user taps an AI
 * action (disclosed in the Studio UI and privacy policy).
 */
import { StudioRequest, StudioResponse, validateStudioRequest } from '../features/ai-script-studio/studio';
import { config, flags } from './config';
import { integrityHeadersEnabled } from './diagnosticsOverrides';
import { integrity, type IntegrityTransport } from './integrity';
import { appUserId } from './purchases';

export type AiErrorCode =
  | 'not_configured'
  | 'invalid_request'
  | 'script_too_long'
  | 'refused'
  | 'aborted'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'unauthorized'
  | 'offline'
  | 'timeout'
  | 'server_error';

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message?: string,
  ) {
    super(message ?? code);
  }
}

const TIMEOUT_MS = 45_000;

function integrityTransport(userId: string): IntegrityTransport {
  return {
    async challenge() {
      try {
        const res = await fetch(`${config.aiBaseUrl}/v1/integrity/challenge`, { method: 'POST', headers: { 'x-app-user-id': userId } });
        if (!res.ok) return null;
        const body = (await res.json()) as { challenge?: unknown };
        return typeof body.challenge === 'string' ? body.challenge : null;
      } catch {
        return null;
      }
    },
    async attest(keyId, attestation, challenge) {
      try {
        const res = await fetch(`${config.aiBaseUrl}/v1/integrity/attest`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-app-user-id': userId },
          body: JSON.stringify({ keyId, attestation, challenge }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export function aiAvailable(): boolean {
  return flags.aiStudio && config.aiBaseUrl.length > 0;
}

export async function runStudio(req: StudioRequest, signal?: AbortSignal): Promise<StudioResponse> {
  if (!aiAvailable()) throw new AiError('not_configured');
  const invalid = validateStudioRequest(req);
  if (invalid) throw new AiError(invalid === 'script_too_long' ? 'script_too_long' : 'invalid_request', invalid);
  const userId = await appUserId();
  if (!userId) throw new AiError('not_configured', 'purchases not configured');

  // The exact body string is what the integrity assertion / request hash covers.
  const body = JSON.stringify(req);
  // Diagnostics can switch integrity headers off to test the server's report/enforce modes.
  const sendIntegrity = integrityHeadersEnabled();
  const integrityHeaders = sendIntegrity ? await integrity.headersFor(body, integrityTransport(userId)) : {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  signal?.addEventListener('abort', () => controller.abort());
  let res: Response;
  try {
    res = await fetch(`${config.aiBaseUrl}/v1/studio`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-app-user-id': userId, ...integrityHeaders },
      body,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === 'AbortError') throw new AiError(signal?.aborted ? 'aborted' : 'timeout');
    throw new AiError('offline');
  }
  clearTimeout(timer);
  if (res.ok) return (await res.json()) as StudioResponse;
  const err = (await res.json().catch(() => ({}))) as { error?: string };
  switch (res.status) {
    case 400:
      throw new AiError(err.error === 'script_too_long' ? 'script_too_long' : 'invalid_request', err.error);
    case 403:
      // Server could not verify this install: re-attest from scratch on the next attempt. Not when
      // the diagnostics override withheld the headers: the stored key is fine and must be kept.
      if (err.error === 'integrity_required' && sendIntegrity) await integrity.reset();
      throw new AiError('unauthorized');
    case 401:
      throw new AiError('unauthorized');
    case 402:
      throw new AiError('quota_exceeded');
    case 429:
      throw new AiError('rate_limited');
    case 422:
      // The model declined. The request was still charged, so retrying the same text won't help.
      if (err.error === 'refused') throw new AiError('refused');
      throw new AiError('server_error', err.error);
    default:
      throw new AiError('server_error', err.error);
  }
}

export async function fetchAiBalance(): Promise<{ remaining: number; resetsAt: string | null } | null> {
  if (!aiAvailable()) return null;
  const userId = await appUserId();
  if (!userId) return null;
  try {
    const res = await fetch(`${config.aiBaseUrl}/v1/balance`, { headers: { 'x-app-user-id': userId } });
    return res.ok ? ((await res.json()) as { remaining: number; resetsAt: string | null }) : null;
  } catch {
    return null;
  }
}
