import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptConfirm(question: string): Promise<boolean> {
  const answer = await promptLine(question);
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}
