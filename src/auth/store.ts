import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthRecord } from './types.js';

export class AuthStore {
  constructor(private readonly authDir: string) {}

  async loadAll(): Promise<AuthRecord[]> {
    await mkdir(this.authDir, { recursive: true });
    const files = await readdir(this.authDir);
    const records: AuthRecord[] = [];
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      const raw = await readFile(join(this.authDir, file), 'utf8');
      records.push(JSON.parse(raw) as AuthRecord);
    }
    return records;
  }

  async save(record: AuthRecord): Promise<void> {
    await mkdir(this.authDir, { recursive: true });
    await writeFile(this.pathFor(record.id), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  async delete(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }

  private pathFor(id: string): string {
    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      throw new Error(`Invalid auth id: ${id}`);
    }
    return join(this.authDir, `${id}.json`);
  }
}
