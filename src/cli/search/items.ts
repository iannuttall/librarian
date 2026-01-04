import { formatItems, formatTiming, type SearchItem } from "../../services/search-format";
export { type SearchItem, type SearchRow, toItems, formatItems, formatTiming } from "../../services/search-format";

export function printItems(items: SearchItem[]): void {
  console.log(formatItems(items));
}

export function printTiming(showTiming: boolean, startedAt: number): void {
  const line = formatTiming(showTiming, startedAt);
  if (line) console.log(line);
}
