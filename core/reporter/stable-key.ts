import { createHash } from 'crypto';

/**
 * A test's identity across runs. Built from layer + spec file name + describe path + title,
 * so history survives moving a spec between folders. When a title changes, add
 * { newTitle: oldTitle } to the client pack's title-renames map and the key stays the same.
 */
export function stableKey(input: {
  layer: string;
  specFile: string;
  describePath: string[];
  title: string;
  renames?: Record<string, string>;
}): string {
  const title = input.renames?.[input.title] ?? input.title;
  const specName = input.specFile.split(/[\\/]/).pop() ?? input.specFile;
  const basis = [input.layer, specName, ...input.describePath, title].join(' › ');
  const hash = createHash('sha1').update(basis).digest('hex').slice(0, 8);
  return `${input.layer.toUpperCase().slice(0, 3)}-${hash}`;
}
