export function printSetupGuide(useGlobal: boolean): void {
  const cmd = useGlobal ? "librarian" : "./librarian";
  console.log("");
  console.log("Next steps:");
  console.log(`- Add a repo: ${cmd} source add github https://github.com/owner/repo --docs docs --ref main`);
  console.log(`- Ingest: ${cmd} ingest --embed`);
  console.log(`- Search: ${cmd} search "your words"`);
}
