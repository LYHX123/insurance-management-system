import { TEMPLATE_CONFIG } from "./config";
import type { SectionConfig, TemplateSectionKind } from "./types";

const BY_KIND = new Map<TemplateSectionKind, SectionConfig>(
  TEMPLATE_CONFIG.sections.map((s) => [s.kind, s])
);

/** All 20 section registry entries, in the fixed 1-20 output order. */
export const SECTION_REGISTRY: SectionConfig[] = [...TEMPLATE_CONFIG.sections].sort(
  (a, b) => a.outputOrder - b.outputOrder
);

export function getSectionConfig(kind: TemplateSectionKind): SectionConfig {
  const config = BY_KIND.get(kind);
  if (!config) {
    throw new Error(`No template section registry entry for section kind "${kind}".`);
  }
  return config;
}

export function hasSectionConfig(kind: string): kind is TemplateSectionKind {
  return BY_KIND.has(kind as TemplateSectionKind);
}

/** Sections in original-template row order — the order row operations must be planned in. */
export const SECTIONS_BY_ROW_ORDER: SectionConfig[] = [...TEMPLATE_CONFIG.sections].sort(
  (a, b) => a.startRow - b.startRow
);
