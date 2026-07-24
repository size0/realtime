import Database from "better-sqlite3";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const databaseFile = path.resolve(
  process.env.APP_DATABASE_FILE ||
    path.join(path.dirname(process.env.APP_DATA_FILE || ".data/users.json"), "app.sqlite"),
);
const databaseDirectory = path.dirname(databaseFile);
const backupDirectory = path.resolve(
  process.env.APP_BACKUP_DIRECTORY ||
    path.join(databaseDirectory, "backups"),
);

await mkdir(backupDirectory, { recursive: true });
const db = new Database(databaseFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const now = Date.now();
const messageCutoff = now - 30 * 24 * 60 * 60 * 1000;
const staleSessionCutoff = now - 60 * 60 * 1000;
const result = db.transaction(() => {
  const deletedMessages = db
    .prepare("DELETE FROM messages WHERE created_at < ?")
    .run(messageCutoff).changes;
  const deletedOauth = db
    .prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?")
    .run(now).changes;
  const releasedSessions = db.prepare(`
    UPDATE voice_sessions SET status = 'cancelled', finished_at = ?
    WHERE status = 'active' AND started_at < ?
  `).run(now, staleSessionCutoff).changes;
  return { deletedMessages, deletedOauth, releasedSessions };
})();

const stamp = new Date(now).toISOString().slice(0, 10);
const backupFile = path.join(backupDirectory, `app-${stamp}.sqlite`);
await db.backup(backupFile);
db.close();

const retentionCutoff = now - 7 * 24 * 60 * 60 * 1000;
let deletedBackups = 0;
for (const name of await readdir(backupDirectory)) {
  if (!/^app-\d{4}-\d{2}-\d{2}\.sqlite$/.test(name)) continue;
  const file = path.join(backupDirectory, name);
  if ((await stat(file)).mtimeMs < retentionCutoff) {
    await rm(file, { force: true });
    deletedBackups += 1;
  }
}

process.stdout.write(JSON.stringify({
  ok: true,
  backupFile,
  deletedBackups,
  ...result,
}) + "\n");
