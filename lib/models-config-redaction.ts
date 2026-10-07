/**
 * Redaction and merge helpers for ~/.pi/agent/models.json access.
 *
 * The file can hold literal provider API keys. GET must never ship those back
 * to the client; PUT must not drop a stored literal key just because the
 * client (which never saw it) omitted the field while editing other settings.
 * The editor learns a key exists via `apiKeyConfigured` (never the value).
 */

/** Shell (`!cmd`) and environment (`$ENV`) references are configuration, not secrets. */
export function isSecretReference(value: unknown): boolean {
  return typeof value === "string" && (value.startsWith("!") || value.startsWith("$"));
}

/** Client-only; must never be written into models.json. */
const CLIENT_ONLY_PROVIDER_KEYS = ["apiKeyConfigured"] as const;

/** Drop literal apiKey values from a models.json payload; keep !/$ references. */
export function redactModelsJson(data: Record<string, unknown>): Record<string, unknown> {
  const providers = (data.providers ?? {}) as Record<string, Record<string, unknown>>;
  const redactedProviders: Record<string, Record<string, unknown>> = {};
  for (const [name, provider] of Object.entries(providers)) {
    const copy = { ...provider };
    if ("apiKey" in copy && !isSecretReference(copy.apiKey)) {
      const hadKey = typeof copy.apiKey === "string" && copy.apiKey.length > 0;
      delete copy.apiKey;
      if (hadKey) copy.apiKeyConfigured = true;
    }
    redactedProviders[name] = copy;
  }
  return { ...data, providers: redactedProviders };
}

/**
 * Merge stored literal apiKeys back into an incoming provider map.
 *
 * A provider entry that omits apiKey keeps the stored literal value (the
 * client cannot see it and may have edited unrelated fields). An explicit
 * apiKey — including "" to clear — replaces it. Stored !/$ references are
 * visible to the client already, so they need no merge.
 */
export function mergeStoredLiteralApiKeys(
  incoming: Record<string, Record<string, unknown>>,
  existing: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const merged = { ...incoming };
  for (const [name, provider] of Object.entries(incoming)) {
    if (!("apiKey" in provider)) {
      const stored = existing[name]?.apiKey;
      if (typeof stored === "string" && !isSecretReference(stored)) {
        merged[name] = { ...provider, apiKey: stored };
      }
    }
  }
  return merged;
}

/** Remove flags the GET path adds for the editor before writing models.json. */
export function stripClientOnlyProviderFields(
  providers: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const cleaned: Record<string, Record<string, unknown>> = {};
  for (const [name, provider] of Object.entries(providers)) {
    let next = provider;
    for (const key of CLIENT_ONLY_PROVIDER_KEYS) {
      if (key in next) {
        const { [key]: _removed, ...rest } = next;
        next = rest;
      }
    }
    cleaned[name] = next;
  }
  return cleaned;
}

/**
 * For test/discover: put a stored literal apiKey onto a draft provider that
 * omitted it (after GET redaction), and drop client-only flags before the
 * value is written into a temporary models.json.
 */
export function resolveProviderDraftForAuth(
  providerName: string,
  provider: Record<string, unknown>,
  existingProviders: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const merged = mergeStoredLiteralApiKeys(
    { [providerName]: { ...provider } },
    existingProviders,
  );
  return stripClientOnlyProviderFields(merged)[providerName] ?? { ...provider };
}
