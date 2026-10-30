import type { ScreenConfig } from '../config/client-config';

/**
 * Resolves the screen a test belongs to, most specific first:
 *   1. meta({ screen }) in the test
 *   2. any describe title that matches a screen title or alias
 *   3. the spec file name against each screen's specPatterns
 *   4. "UNMAPPED: <first describe>" — the report lists these so the map gets fixed
 */
export function resolveScreen(
  screens: Record<string, ScreenConfig>,
  input: { metaScreen?: string; describePath: string[]; specFile: string },
): string {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const entries = Object.entries(screens);

  if (input.metaScreen) {
    const byKey = screens[input.metaScreen];
    if (byKey) return byKey.title;
    const m = norm(input.metaScreen);
    const hit = entries.find(([, s]) => norm(s.title) === m || s.aliases.some((a) => norm(a) === m));
    return hit ? hit[1].title : input.metaScreen;
  }

  for (const d of input.describePath) {
    const nd = norm(d);
    const hit = entries.find(
      ([, s]) => nd === norm(s.title) || nd.startsWith(norm(s.title) + ' ') || s.aliases.some((a) => nd === norm(a) || nd.startsWith(norm(a) + ' ')),
    );
    if (hit) return hit[1].title;
  }

  const specName = (input.specFile.split(/[\\/]/).pop() ?? '').toLowerCase();
  const bySpec = entries.find(([, s]) => s.specPatterns.some((p) => specName.includes(p.toLowerCase())));
  if (bySpec) return bySpec[1].title;

  return `UNMAPPED: ${input.describePath[0] ?? specName}`;
}
