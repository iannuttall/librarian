const GITHUB_TOKEN_URL = "https://github.com/settings/tokens";
const HF_TOKEN_URL = "https://huggingface.co/settings/tokens";

export function printTokenSetupHelp(): void {
  console.log("");
  console.log("Token setup");
  console.log(`- GitHub token page: ${GITHUB_TOKEN_URL}`);
  console.log(`- Hugging Face token page: ${HF_TOKEN_URL}`);
  console.log("- Leave blank to skip");
  console.log("");
}

export async function applyHfToken(config: { hf?: { token?: string } }): Promise<void> {
  const token = config.hf?.token;
  if (!token) return;
  if (process.env.LIBRARIAN_HF_TOKEN || process.env.HUGGINGFACE_TOKEN) return;

  const ok = await verifyHfToken(token);
  if (!ok) {
    console.log("Hugging Face token is not valid. Query expansion will be skipped.");
    return;
  }
  process.env.LIBRARIAN_HF_TOKEN = token;
}

async function verifyHfToken(token: string): Promise<boolean> {
  try {
    const res = await fetch("https://huggingface.co/api/whoami-v2", {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}
