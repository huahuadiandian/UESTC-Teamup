#!/usr/bin/env node
/**
 * 生产迁移守卫（Issue 9）：破坏性迁移阻断 + 迁移前后关键表行数快照。
 *
 * 背景：`prisma/migrations/20261011080000_drop_legacy_competition` 等迁移包含
 * DROP TABLE / DELETE 等破坏性操作（用于测试数据重置），`prisma migrate deploy`
 * 会在任何环境无差别执行。本脚本在部署链路中充当「阻断检查」：
 *
 *   node scripts/safe-migrate.mjs            # 仅检查 + 打印行数快照（不改数据）
 *   node scripts/safe-migrate.mjs --deploy   # 检查通过后执行 prisma migrate deploy
 *
 * 存在待执行的破坏性迁移时，必须同时满足：
 *   1. 已按 docs/DEPLOY_DB.md 完成备份（pg_dump），并保留备份文件路径；
 *   2. 显式设置 MIGRATIONS_CONFIRM_DESTRUCTIVE=yes（确认人 + 备份路径写入
 *      MIGRATIONS_CONFIRM_NOTE，留痕于执行日志）。
 *
 * 运行环境：apps/api 目录（依赖 @prisma/client 与 DATABASE_URL）。
 * 本地开发 / CI 测试库不需要本脚本 —— 测试库数据可随时重建。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(apiRoot, 'prisma', 'migrations');
const DEPLOY = process.argv.includes('--deploy');

/** 破坏性 SQL 特征：命中任意一条即视为破坏性迁移 */
const DESTRUCTIVE_PATTERNS = [
  /^\s*DROP\s+TABLE\b/im,
  /^\s*DROP\s+TYPE\b/im,
  /^\s*DROP\s+SCHEMA\b/im,
  /^\s*DROP\s+DATABASE\b/im,
  /^\s*TRUNCATE\b/im,
  /^\s*DELETE\s+FROM\b/im,
  /^\s*ALTER\s+TABLE\s+\S+\s+DROP\s+COLUMN\b/im,
];

/** 迁移前后行数对比的关键业务表 */
const SNAPSHOT_TABLES = [
  'User',
  'Competition',
  'CompetitionStage',
  'CompetitionEvent',
  'Team',
  'TeamMember',
  'TeamIntent',
  'Comment',
  'Notification',
  'CompetitionRevision',
  'CorrectionReport',
  'MailLog',
];

function listMigrationDirs() {
  return readdirSync(migrationsDir)
    .filter((name) => !name.startsWith('.') && name !== 'migration_lock.toml')
    .sort();
}

function isDestructive(migrationName) {
  try {
    const sql = readFileSync(join(migrationsDir, migrationName, 'migration.sql'), 'utf8');
    return DESTRUCTIVE_PATTERNS.some((re) => re.test(sql));
  } catch {
    return false;
  }
}

async function appliedMigrations(prisma) {
  try {
    const rows = await prisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations"');
    return new Set(rows.map((r) => r.migration_name));
  } catch {
    // _prisma_migrations 不存在 = 全新库，所有迁移都待执行
    return new Set();
  }
}

async function snapshot(prisma, label) {
  console.log(`\n===== 关键表行数（${label}）=====`);
  for (const table of SNAPSHOT_TABLES) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint AS n FROM "${table}"`);
      console.log(`${table.padEnd(24)} ${rows[0].n}`);
    } catch {
      console.log(`${table.padEnd(24)} （表不存在）`);
    }
  }
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const applied = await appliedMigrations(prisma);
    const pending = listMigrationDirs().filter((name) => !applied.has(name));

    if (!pending.length) {
      console.log('✅ 无待执行迁移，数据库已与 migration 历史一致。');
      await snapshot(prisma, '当前');
      return;
    }

    console.log(`待执行迁移 ${pending.length} 个：`);
    const destructive = [];
    for (const name of pending) {
      const bad = isDestructive(name);
      if (bad) destructive.push(name);
      console.log(`  ${bad ? '⚠️  [破坏性]' : '    [常规]  '} ${name}`);
    }

    if (destructive.length) {
      console.log(`
⛔ 检测到破坏性迁移（含 DROP TABLE / DELETE 等），将在真实数据环境造成不可恢复的数据丢失：
${destructive.map((n) => `   - ${n}`).join('\n')}

执行前必须完成（见 docs/DEPLOY_DB.md）：
  1. 备份：docker compose -f deploy/docker-compose.yml exec db \\
       pg_dump -U teamup -d teamup -Fc -f /var/lib/postgresql/data/backup_$(date +%Y%m%d_%H%M).dump
     并把备份文件从 pgdata 卷中拷出主机妥善保存；
  2. 确认备份文件可用（pg_restore --list 校验）；
  3. 设置环境变量确认执行：
       MIGRATIONS_CONFIRM_DESTRUCTIVE=yes
       MIGRATIONS_CONFIRM_NOTE="执行人 / 工单 / 备份文件路径"`);
      if (process.env.MIGRATIONS_CONFIRM_DESTRUCTIVE !== 'yes') {
        console.log('\n未设置 MIGRATIONS_CONFIRM_DESTRUCTIVE=yes，已阻断。');
        process.exitCode = 1;
        return;
      }
      console.log(`\n✅ 已确认执行（备注：${process.env.MIGRATIONS_CONFIRM_NOTE ?? '未填写'}）`);
    }

    await snapshot(prisma, '迁移前');

    if (!DEPLOY) {
      console.log('\n（未带 --deploy，仅检查未实际执行迁移）');
      return;
    }

    console.log('\n执行 prisma migrate deploy …');
    const bin = join(apiRoot, 'node_modules', '.bin', 'prisma') + (process.platform === 'win32' ? '.cmd' : '');
    execFileSync(bin, ['migrate', 'deploy'], { cwd: apiRoot, stdio: 'inherit' });

    await snapshot(prisma, '迁移后');
    console.log('\n✔ 迁移完成。请对比迁移前后行数；如关键表意外清零，立即用备份恢复（见 docs/DEPLOY_DB.md）。');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
