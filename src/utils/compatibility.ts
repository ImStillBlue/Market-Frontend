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

  // 1. Match WIT package references like pumpkin:plugin/metadata@0.2.0, pumpkin:plugin/logging@0.1.0, or pumpkin:plugin@0.1.0
  const witRegex = /pumpkin:plugin(?:\/[a-z0-9_-]+)*@([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.+_-]+)?)/gi;
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

  // 5. Match "-Pumpkin-26.3" / "Pumpkin 26.3" or "-Pumpkin-26.2" / "Pumpkin 26.2" build shorthand
  if (/[-_\s]pumpkin[-_\s]+26\.3\b/i.test(notes)) {
    pumpkinSet.add('0.2.0+26.3-26.51');
  }
  if (/[-_\s]pumpkin[-_\s]+26\.2\b/i.test(notes)) {
    pumpkinSet.add('0.1.0-dev+26.2-26.45');
  }

  // 6. Cross-infer corresponding Pumpkin release / Plugin API version when one side is known
  syncPumpkinAndApiSets(pumpkinSet, apiSet);

  return {
    pumpkinVersions: Array.from(pumpkinSet),
    apiVersions: Array.from(apiSet),
    fromStructuredComment: false,
  };
}

/**
 * Ensures that when a known Pumpkin release is present we also know its corresponding Plugin API version,
 * and when a known Plugin API version is present we also know its corresponding Pumpkin release.
 */
function syncPumpkinAndApiSets(pumpkinSet: Set<string>, apiSet: Set<string>): void {
  if (apiSet.size === 0 && pumpkinSet.size > 0) {
    for (const pv of pumpkinSet) {
      if (pv.startsWith('0.2.')) {
        apiSet.add('0.2.0');
      } else if (pv.startsWith('0.1.')) {
        apiSet.add('0.1.0');
      }
    }
  }
  if (pumpkinSet.size === 0 && apiSet.size > 0) {
    for (const av of apiSet) {
      if (av.startsWith('0.2.')) {
        pumpkinSet.add('0.2.0+26.3-26.51');
      } else if (av.startsWith('0.1.')) {
        pumpkinSet.add('0.1.0-dev+26.2-26.45');
      }
    }
  }
}

/**
 * Extracts all description text from a Plugin object, including localized `translated_descriptions`.
 */
function getAllPluginDescriptionText(plugin?: Partial<Plugin> | null): string {
  if (!plugin) return '';
  const parts: string[] = [];
  if (plugin.short_description) parts.push(plugin.short_description);
  if (plugin.description) parts.push(plugin.description);

  if (plugin.translated_descriptions) {
    try {
      const translations =
        typeof plugin.translated_descriptions === 'string'
          ? JSON.parse(plugin.translated_descriptions)
          : plugin.translated_descriptions;
      if (translations && typeof translations === 'object') {
        for (const val of Object.values(translations)) {
          if (typeof val === 'string' && val.trim()) {
            parts.push(val);
          }
        }
      }
    } catch {
      // Ignore malformed JSON
    }
  }
  return parts.join('\n');
}

/**
 * Infers Pumpkin release and Plugin API compatibility from a release's publication timestamp
 * when older marketplace releases do not have explicit metadata stored in the database.
 *
 * Timeline of Pumpkin tagged releases on the marketplace:
 * - Pumpkin `0.2.0+26.3-26.51` (Plugin API `0.2.0`): released 2026-10-08
 * - Pumpkin `0.1.0-dev+26.2-26.45` (Plugin API `0.1.0`): initial release era prior to 2026-10-08
 */
function inferCompatibilityFromReleaseDate(createdAt?: string | null): ResolvedCompatibility {
  if (!createdAt) {
    return {
      pumpkinVersions: ['0.2.0+26.3-26.51'],
      apiVersions: ['0.2.0'],
      isInferred: true,
    };
  }

  const ts = new Date(createdAt).getTime();
  // Pumpkin 0.2.0+26.3-26.51 transition cutoff (2026-10-08T18:00:00Z)
  const pumpkin020Cutoff = Date.parse('2026-10-08T18:00:00Z');

  if (!Number.isNaN(ts) && ts < pumpkin020Cutoff) {
    return {
      pumpkinVersions: ['0.1.0-dev+26.2-26.45'],
      apiVersions: ['0.1.0'],
      isInferred: true,
    };
  }

  return {
    pumpkinVersions: ['0.2.0+26.3-26.51'],
    apiVersions: ['0.2.0'],
    isInferred: true,
  };
}

/**
 * Resolves supported Pumpkin releases and Plugin API versions for a given PluginVersion,
 * checking explicit fields first and falling back to release notes / plugin-level fields / release era.
 */
export function resolveVersionCompatibility(
  version?: Partial<PluginVersion> | null,
  plugin?: Partial<Plugin> | null,
  probedApiVersions?: string[]
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
    ...normalizeVersionList(probedApiVersions),
  ];

  const pumpkinSet = new Set(explicitPumpkin);
  const apiSet = new Set(explicitApi.map(normalizeApiVersionToken));

  if (pumpkinSet.size > 0 || apiSet.size > 0) {
    // Also merge any explicit mentions from this version's release notes before syncing
    const notesCompat = extractCompatibilityFromNotes(version?.release_notes);
    for (const pv of notesCompat.pumpkinVersions) pumpkinSet.add(pv);
    for (const av of notesCompat.apiVersions) apiSet.add(av);
    syncPumpkinAndApiSets(pumpkinSet, apiSet);
    return {
      pumpkinVersions: Array.from(pumpkinSet),
      apiVersions: Array.from(apiSet),
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
    const pSet = new Set(pluginLevelPumpkin);
    const aSet = new Set(pluginLevelApi.map(normalizeApiVersionToken));
    syncPumpkinAndApiSets(pSet, aSet);
    return {
      pumpkinVersions: Array.from(pSet),
      apiVersions: Array.from(aSet),
      isInferred: false,
    };
  }

  // Check plugin description / translated_descriptions (only when plugin reference is passed)
  const descText = getAllPluginDescriptionText(plugin);
  const fromDescription = extractCompatibilityFromNotes(descText);
  if (fromDescription.pumpkinVersions.length > 0 || fromDescription.apiVersions.length > 0) {
    return {
      pumpkinVersions: fromDescription.pumpkinVersions,
      apiVersions: fromDescription.apiVersions,
      isInferred: true,
    };
  }

  // Fallback for legacy marketplace releases that predated explicit compatibility metadata:
  // infer from the release's publication date relative to Pumpkin's tagged releases.
  return inferCompatibilityFromReleaseDate(version?.created_at || plugin?.updated_at || plugin?.created_at);
}

/**
 * Returns all published releases for a plugin ordered newest first,
 * with normalized compatibility metadata and a clear `isLatest` flag.
 */
export function getNormalizedPluginVersions(
  plugin: Plugin,
  probedLatestApiVersions?: string[]
): NormalizedPluginVersion[] {
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
    const rawVer = (v.version || '').trim();
    const cleanVer = rawVer ? rawVer.replace(/^v(?=\d)/i, '') : '0.1.0';
    const isLatest = idx === latestIndex;
    const compat = resolveVersionCompatibility(
      v,
      isLatest ? plugin : null,
      isLatest ? probedApiVersionsOrEmpty(probedLatestApiVersions) : undefined
    );
    return {
      ...v,
      version: rawVer || cleanVer,
      isLatest,
      displayVersion: /^\d/.test(cleanVer) ? `v${cleanVer}` : cleanVer,
      pumpkinVersions: compat.pumpkinVersions,
      apiVersions: compat.apiVersions,
      isCompatibilityInferred: compat.isInferred,
    };
  });
}

function probedApiVersionsOrEmpty(probed?: string[]): string[] | undefined {
  return probed && probed.length > 0 ? probed : undefined;
}

/**
 * Aggregates all unique supported Pumpkin releases and Plugin API versions across a plugin's releases
 * (prioritizing the latest release for summary displays).
 */
export function getPluginCompatibilitySummary(
  plugin: Plugin,
  probedLatestApiVersions?: string[]
): {
  latestPumpkinVersions: string[];
  latestApiVersions: string[];
  allPumpkinVersions: string[];
  allApiVersions: string[];
} {
  const versions = getNormalizedPluginVersions(plugin, probedLatestApiVersions);
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
