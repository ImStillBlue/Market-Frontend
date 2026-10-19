import type { Plugin, PluginVersion } from '../types/plugin';

/**
 * Known tagged Pumpkin releases and channels.
 */
export const KNOWN_PUMPKIN_RELEASES = [
  '0.2.0',
  '0.2.0+26.3-26.51',
  '0.1.0',
  '0.1.0-dev+26.2-26.45',
  'nightly',
  'canary',
] as const;

/**
 * Known Pumpkin Plugin API (WIT) versions.
 * Developers can also specify any custom semver for API versions between tagged Pumpkin releases.
 */
export const KNOWN_PLUGIN_API_VERSIONS = [
  '0.2.0',
  '0.1.0',
] as const;

export interface ResolvedCompatibility {
  pumpkinVersions: string[];
  apiVersions: string[];
  isInferred: boolean;
}

export interface NormalizedPluginVersion extends PluginVersion {
  isLatest: boolean;
  displayVersion: string;
  pumpkinVersions: string[];
  apiVersions: string[];
  isCompatibilityInferred: boolean;
}

/**
 * Normalizes a potentially mixed compatibility field (array, JSON string, or comma-separated string)
 * into a deduplicated array of clean version strings.
 */
export function normalizeVersionList(value: unknown): string[] {
  if (!value) return [];

  let rawList: string[] = [];

  if (Array.isArray(value)) {
    rawList = value
      .filter((item): item is string => typeof item === 'string')
      .flatMap((item) => item.split(/[,;]+/));
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          rawList = parsed.filter((item): item is string => typeof item === 'string');
        }
      } catch {
        rawList = trimmed.split(/[,;]+/);
      }
    } else {
      rawList = trimmed.split(/[,;]+/);
    }
  }

  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of rawList) {
    const cleaned = item.trim().replace(/^v(?=\d)/i, '');
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  }

  return result;
}

/**
 * Normalizes a shorthand API version (e.g. "2" -> "0.2.0", "0.2" -> "0.2.0") into full semver when appropriate.
 */
export function normalizeApiVersionToken(token: string): string {
  const cleaned = token.trim().replace(/^v(?=\d)/i, '');
  if (cleaned === '1' || cleaned === '0.1') return '0.1.0';
  if (cleaned === '2' || cleaned === '0.2') return '0.2.0';
  return cleaned;
}

const COMPAT_COMMENT_REGEX = /<!--\s*pumpkin-compat:\s*(\{[\s\S]*?\})\s*-->/i;

/**
 * Appends a structured compatibility comment to release notes so compatibility metadata
 * is preserved even if the backend only persists release_notes.
 */
export function appendCompatibilityToReleaseNotes(
  releaseNotes: string,
  pumpkinVersions: string[],
  apiVersions: string[]
): string {
  const cleanNotes = cleanReleaseNotes(releaseNotes);
  const cleanPumpkin = normalizeVersionList(pumpkinVersions);
  const cleanApi = normalizeVersionList(apiVersions).map(normalizeApiVersionToken);

  if (cleanPumpkin.length === 0 && cleanApi.length === 0) {
    return cleanNotes;
  }

  const payload = JSON.stringify({
    pumpkin: cleanPumpkin,
    api: cleanApi,
  });

  return cleanNotes
    ? `${cleanNotes}\n\n<!-- pumpkin-compat: ${payload} -->`
    : `<!-- pumpkin-compat: ${payload} -->`;
}

/**
 * Strips the embedded pumpkin-compat metadata comment from release notes before displaying.
 */
export function cleanReleaseNotes(notes?: string | null): string {
  if (!notes) return '';
  return notes.replace(COMPAT_COMMENT_REGEX, '').trim();
}

/**
 * Extracts Pumpkin release versions and Plugin API versions mentioned in release notes or descriptions
 * as a fallback when explicit structured fields are not present on older releases.
 */
export function extractCompatibilityFromNotes(notes?: string | null): {
  pumpkinVersions: string[];
  apiVersions: string[];
  fromStructuredComment?: boolean;
} {
  if (!notes) {
    return { pumpkinVersions: [], apiVersions: [] };
  }

  // 0. Check embedded structured compatibility comment first
  const commentMatch = COMPAT_COMMENT_REGEX.exec(notes);
  if (commentMatch && commentMatch[1]) {
    try {
      const parsed = JSON.parse(commentMatch[1]);
      const pumpkin = normalizeVersionList(parsed?.pumpkin);
      const api = normalizeVersionList(parsed?.api).map(normalizeApiVersionToken);
      if (pumpkin.length > 0 || api.length > 0) {
        return {
          pumpkinVersions: pumpkin,
          apiVersions: api,
          fromStructuredComment: true,
        };
      }
    } catch {
      // Ignore malformed comment and continue to regex extraction
    }
  }

  const pumpkinSet = new Set<string>();
  const apiSet = new Set<string>();

  // 1. Match WIT package references like pumpkin:plugin/metadata@0.2.0 or pumpkin:plugin@0.1.0
  const witRegex = /pumpkin:plugin(?:\/[a-z0-9-]+)?@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.+_-]+)?)/gi;
  let match: RegExpExecArray | null;
  while ((match = witRegex.exec(notes)) !== null) {
    if (match[1]) {
      apiSet.add(normalizeApiVersionToken(match[1]));
    }
  }

  // 2. Match explicit Plugin API mentions like "Plugin API 0.2.0", "Pumpkin API v2", "API version 0.1.0"
  const apiRegex = /(?:pumpkin\s+)?(?:plugin[-\s]+)?api(?:\s+version)?\s*[:=]?\s*v?([0-9]+(?:\.[0-9]+(?:\.[0-9]+)?)?(?:-[0-9A-Za-z.+_-]+)?)/gi;
  while ((match = apiRegex.exec(notes)) !== null) {
    if (match[1]) {
      apiSet.add(normalizeApiVersionToken(match[1]));
    }
  }

  // 3. Match Pumpkin-MC/Pumpkin@<version> or Pumpkin@<version>
  const repoTagRegex = /Pumpkin(?:-MC\/Pumpkin)?@([0-9]+\.[0-9]+\.[0-9]+(?:\+[0-9A-Za-z._-]+|-[0-9A-Za-z.+_-]+)?)/gi;
  while ((match = repoTagRegex.exec(notes)) !== null) {
    if (match[1]) {
      pumpkinSet.add(match[1]);
    }
  }

  // 4. Match "Pumpkin version 0.2.0+26.3-26.51", "Pumpkin v0.2.0", "Requires Pumpkin 0.2.0", "For Pumpkin 0.1.0-dev+26.2-26.45"
  const pumpkinVersionRegex = /pumpkin(?:\s+server|\s+release|\s+version)?\s+v?([0-9]+\.[0-9]+\.[0-9]+(?:\+[0-9A-Za-z._-]+|-[0-9A-Za-z.+_-]+)?)/gi;
  while ((match = pumpkinVersionRegex.exec(notes)) !== null) {
    // Avoid misclassifying "Pumpkin API 0.2.0" which was already captured
    const fullMatch = match[0].toLowerCase();
    if (!fullMatch.includes('api') && match[1]) {
      pumpkinSet.add(match[1]);
    }
  }

  // 5. If a known Pumpkin release with build metadata (like 0.2.0+26.3-26.51) was found, and no API version was explicitly found,
  // infer the corresponding base Plugin API version (0.2.0 or 0.1.0).
  if (apiSet.size === 0 && pumpkinSet.size > 0) {
    for (const pv of pumpkinSet) {
      if (pv.startsWith('0.2.')) {
        apiSet.add('0.2.0');
      } else if (pv.startsWith('0.1.')) {
        apiSet.add('0.1.0');
      }
    }
  }

  return {
    pumpkinVersions: Array.from(pumpkinSet),
    apiVersions: Array.from(apiSet),
    fromStructuredComment: false,
  };
}

/**
 * Resolves supported Pumpkin releases and Plugin API versions for a given PluginVersion,
 * checking explicit fields first and falling back to release notes / plugin-level fields.
 */
export function resolveVersionCompatibility(
  version?: Partial<PluginVersion> | null,
  plugin?: Partial<Plugin> | null
): ResolvedCompatibility {
  const explicitPumpkin = [
    ...normalizeVersionList(version?.pumpkin_versions),
    ...normalizeVersionList(version?.supported_pumpkin_versions),
    ...normalizeVersionList(version?.pumpkin_version),
  ];

  const explicitApi = [
    ...normalizeVersionList(version?.api_versions),
    ...normalizeVersionList(version?.supported_api_versions),
    ...normalizeVersionList(version?.plugin_api_versions),
    ...normalizeVersionList(version?.api_version),
    ...normalizeVersionList(version?.plugin_api_version),
  ];

  const dedupPumpkin = Array.from(new Set(explicitPumpkin));
  const dedupApi = Array.from(new Set(explicitApi.map(normalizeApiVersionToken)));

  if (dedupPumpkin.length > 0 || dedupApi.length > 0) {
    return {
      pumpkinVersions: dedupPumpkin,
      apiVersions: dedupApi,
      isInferred: false,
    };
  }

  // Check release notes for compatibility mentions or structured compatibility comment
  const fromNotes = extractCompatibilityFromNotes(version?.release_notes);
  if (fromNotes.pumpkinVersions.length > 0 || fromNotes.apiVersions.length > 0) {
    return {
      pumpkinVersions: fromNotes.pumpkinVersions,
      apiVersions: fromNotes.apiVersions,
      isInferred: !fromNotes.fromStructuredComment,
    };
  }

  // Check plugin-level fields if this version has no explicit fields
  const pluginLevelPumpkin = [
    ...normalizeVersionList(plugin?.pumpkin_versions),
    ...normalizeVersionList(plugin?.supported_pumpkin_versions),
    ...normalizeVersionList(plugin?.pumpkin_version),
  ];
  const pluginLevelApi = [
    ...normalizeVersionList(plugin?.api_versions),
    ...normalizeVersionList(plugin?.supported_api_versions),
    ...normalizeVersionList(plugin?.plugin_api_versions),
    ...normalizeVersionList(plugin?.api_version),
    ...normalizeVersionList(plugin?.plugin_api_version),
  ];

  if (pluginLevelPumpkin.length > 0 || pluginLevelApi.length > 0) {
    return {
      pumpkinVersions: Array.from(new Set(pluginLevelPumpkin)),
      apiVersions: Array.from(new Set(pluginLevelApi.map(normalizeApiVersionToken))),
      isInferred: false,
    };
  }

  // Last resort: check plugin description or short_description
  const fromDescription = extractCompatibilityFromNotes(
    [plugin?.short_description, plugin?.description].filter(Boolean).join('\n')
  );

  return {
    pumpkinVersions: fromDescription.pumpkinVersions,
    apiVersions: fromDescription.apiVersions,
    isInferred: fromDescription.pumpkinVersions.length > 0 || fromDescription.apiVersions.length > 0,
  };
}

/**
 * Returns all published releases for a plugin ordered newest first,
 * with normalized compatibility metadata and a clear `isLatest` flag.
 */
export function getNormalizedPluginVersions(plugin: Plugin): NormalizedPluginVersion[] {
  const rawVersions: PluginVersion[] =
    plugin.versions && plugin.versions.length > 0
      ? [...plugin.versions]
      : plugin.version
        ? [
            {
              id: 0,
              plugin_id: plugin.id,
              version: plugin.version,
              release_notes: 'Initial release.',
              track: 'stable',
              created_at: plugin.updated_at || plugin.created_at || '',
            },
          ]
        : [];

  // Sort newest first by created_at timestamp, then by id descending
  rawVersions.sort((a, b) => {
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return (b.id ?? 0) - (a.id ?? 0);
  });

  // Identify the latest release:
  // Either explicitly marked `is_latest`, or index 0 (newest release)
  const explicitLatestIndex = rawVersions.findIndex((v) => v.is_latest === true);
  const latestIndex = explicitLatestIndex >= 0 ? explicitLatestIndex : 0;

  return rawVersions.map((v, idx) => {
    const cleanVer = v.version.replace(/^v(?=\d)/i, '');
    const compat = resolveVersionCompatibility(v, idx === latestIndex ? plugin : null);
    return {
      ...v,
      isLatest: idx === latestIndex,
      displayVersion: `v${cleanVer}`,
      pumpkinVersions: compat.pumpkinVersions,
      apiVersions: compat.apiVersions,
      isCompatibilityInferred: compat.isInferred,
    };
  });
}

/**
 * Aggregates all unique supported Pumpkin releases and Plugin API versions across a plugin's releases
 * (prioritizing the latest release for summary displays).
 */
export function getPluginCompatibilitySummary(plugin: Plugin): {
  latestPumpkinVersions: string[];
  latestApiVersions: string[];
  allPumpkinVersions: string[];
  allApiVersions: string[];
} {
  const versions = getNormalizedPluginVersions(plugin);
  const latest = versions.find((v) => v.isLatest) ?? versions[0];

  const allPumpkin = new Set<string>();
  const allApi = new Set<string>();

  for (const v of versions) {
    for (const pv of v.pumpkinVersions) allPumpkin.add(pv);
    for (const av of v.apiVersions) allApi.add(av);
  }

  return {
    latestPumpkinVersions: latest?.pumpkinVersions ?? [],
    latestApiVersions: latest?.apiVersions ?? [],
    allPumpkinVersions: Array.from(allPumpkin),
    allApiVersions: Array.from(allApi),
  };
}
