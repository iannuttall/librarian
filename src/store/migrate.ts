import { Kysely, SqliteDialect } from "kysely";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Database } from "bun:sqlite";

const baseDir = path.dirname(fileURLToPath(import.meta.url));

export async function runIndexMigrations(db: Database): Promise<void> {
  const folder = path.join(baseDir, "migrations", "index");
  await runMigrations(db, folder);
}

export async function runLibraryMigrations(db: Database): Promise<void> {
  const folder = path.join(baseDir, "migrations", "library");
  await runMigrations(db, folder);
}

async function runMigrations(db: Database, folder: string): Promise<void> {
  ensureMigrationTable(db);
  const applied = new Set<string>();
  const rows = db.prepare("SELECT name FROM kysely_migration").all() as Array<{ name: string }>;
  for (const row of rows) applied.add(row.name);

  const files = (await fs.readdir(folder))
    .filter((file) => file.endsWith(".ts") || file.endsWith(".js"))
    .sort((a, b) => a.localeCompare(b));
  if (files.length === 0) return;

  const kysely = new Kysely({
    dialect: new SqliteDialect({ database: db }),
  });

  for (const file of files) {
    const name = file.replace(/\.(ts|js)$/, "");
    if (applied.has(name)) continue;

    const fileUrl = pathToFileURL(path.join(folder, file)).href;
    const mod = await import(fileUrl);
    if (typeof mod.up !== "function") {
      throw new Error(`Migration ${name} is missing an up() export`);
    }
    db.exec("BEGIN");
    try {
      await mod.up(kysely);
      db.prepare("INSERT INTO kysely_migration (name, timestamp) VALUES (?, ?)").run(
        name,
        new Date().toISOString(),
      );
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

function ensureMigrationTable(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS kysely_migration (
      name TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL
    )`,
  );
}
