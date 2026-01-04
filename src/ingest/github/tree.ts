type TreeNode = { name: string; children: Map<string, TreeNode>; isDir: boolean };

export function buildRepoTree(paths: string[]): string {
  const root: TreeNode = { name: "", children: new Map(), isDir: true };
  for (const relPath of paths) {
    addPath(root, relPath);
  }
  return toPrettyString(root).trim();
}

function addPath(root: TreeNode, relPath: string) {
  const parts = relPath.split("/").filter(Boolean);
  let node = root;
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const key = isLast ? part : `${part}/`;
    let child = node.children.get(key);
    if (!child) {
      child = { name: part, children: new Map(), isDir: !isLast };
      node.children.set(key, child);
    }
    node = child;
  });
}

function toPrettyString(node: TreeNode, prefix = ""): string {
  const entries = Array.from(node.children.values()).sort((a, b) => {
    const aw = treeWeight(a);
    const bw = treeWeight(b);
    if (aw !== bw) return aw - bw;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  let out = "";
  entries.forEach((child, idx) => {
    const isLast = idx === entries.length - 1;
    const branch = isLast ? "└── " : "├── ";
    const nextPrefix = prefix + (isLast ? "    " : "│   ");
    out += `${prefix}${branch}${child.name}\n`;
    if (child.isDir) out += toPrettyString(child, nextPrefix);
  });
  return out;
}

const IMPORTANT_FILES = new Set([
  "agent.md",
  "agents.md",
  "claude.md",
  "warp.md",
  "contributing.md",
  "code_of_conduct.md",
  "code-of-conduct.md",
  "security.md",
  "license",
  "license.md",
]);

function fileWeight(relPath: string): number {
  const base = relPath.split("/").pop() ?? relPath;
  const lower = base.toLowerCase();
  if (base.startsWith(".")) return 0;
  if (lower === "readme.md" || lower === "readme" || lower.startsWith("readme.")) return 1;
  if (IMPORTANT_FILES.has(lower)) return 2;
  return 3;
}

function treeWeight(node: TreeNode): number {
  if (node.isDir) return 5;
  return fileWeight(node.name);
}
