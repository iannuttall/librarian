import { promptLine } from "../core/prompt";

export async function promptFromList(label: string, options: string[], fallback: string): Promise<string> {
  if (options.length === 0) {
    const manual = await promptLine(`${label} (default ${fallback}): `);
    return manual || fallback;
  }
  const limit = Math.min(30, options.length);
  console.log(`${label} options:`);
  for (let i = 0; i < limit; i += 1) {
    console.log(`${i + 1}. ${options[i]}`);
  }
  if (options.length > limit) {
    console.log(`...and ${options.length - limit} more`);
  }
  const input = await promptLine(`${label} number or name (default ${fallback}): `);
  if (!input) return fallback;
  const maybeIndex = Number(input);
  if (!Number.isNaN(maybeIndex) && maybeIndex >= 1 && maybeIndex <= options.length) {
    return options[maybeIndex - 1] ?? fallback;
  }
  return input;
}
