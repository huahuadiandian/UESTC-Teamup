# 数据库迁移安全手册（Issue 9）

> 背景：仓库中存在**破坏性迁移**（如 `20261011080000_drop_legacy_competition`，含 13 张表
> `DROP TABLE ... CASCADE` 与 `DELETE` 清理）。这类迁移服务于「竞赛模型 V2」切换期的测试
> 数据重置，**不能直接用于存在真实业务数据的环境**。`prisma migrate deploy` 会把所有未执行
> 的迁移在任何环境无差别跑完，因此生产部署必须走本手册的守卫流程。

## 1. 迁移分区：测试环境 vs 生产环境

| 环境 | 数据特征 | 执行方式 | 破坏性迁移 |
| --- | --- | --- | --- |
| 本地开发库 `teamup` | 可随时重建 | `pnpm db:migrate`（migrate dev） | 允许 |
| CI / 测试库 `teamup_test` | 每次流水线重建 | `prisma migrate deploy`（helpers.ts 自动执行） | 允许 |
| 生产库（deploy compose 的 `teamup`） | **真实业务数据** | `node scripts/safe-migrate.mjs --deploy`（守卫） | **默认阻断** |

## 2. 生产迁移标准流程

```bash
# ① 预检：列出待执行迁移并标注是否破坏性，打印关键表行数快照（不改数据）
docker compose -f deploy/docker-compose.yml exec api node scripts/safe-migrate.mjs

# ② 备份（出现破坏性迁移时为强制项）
docker compose -f deploy/docker-compose.yml exec db \
  pg_dump -U teamup -d teamup -Fc -f /var/lib/postgresql/data/backup_$(date +%Y%m%d_%H%M).dump
# 备份落在 pgdata 卷内，务必拷贝到宿主机并异机保存：
docker compose -f deploy/docker-compose.yml exec db ls /var/lib/postgresql/data/
docker cp $(docker compose -f deploy/docker-compose.yml ps -q db):/var/lib/postgresql/data/backup_*.dump ./backups/

# ③ 校验备份可用（能列出目录即结构完整）
pg_restore --list ./backups/backup_XXXX.dump > /dev/null && echo OK

# ④ 确认后执行迁移（守卫会复核破坏性迁移 + 打印前后行数对比）
docker compose -f deploy/docker-compose.yml run --rm \
  -e MIGRATIONS_CONFIRM_DESTRUCTIVE=yes \
  -e MIGRATIONS_CONFIRM_NOTE="执行人：xxx；工单：#xxx；备份：backup_XXXX.dump" \
  api node scripts/safe-migrate.mjs --deploy
```

守卫的阻断条件：待执行迁移命中 `DROP TABLE / DROP TYPE / DELETE FROM / TRUNCATE /
ALTER TABLE … DROP COLUMN` 任一特征，且未设置 `MIGRATIONS_CONFIRM_DESTRUCTIVE=yes`。

## 3. 行数校验清单

迁移前后 `safe-migrate.mjs` 会输出以下表的行数，人工核对：

- 用户与账号：`User`（不应减少）
- 竞赛域：`Competition` / `CompetitionStage` / `CompetitionEvent`
- 组队域：`Team` / `TeamMember` / `TeamIntent`
- 互动域：`Comment` / `Notification`
- 留痕域：`CompetitionRevision` / `CorrectionReport` / `MailLog`

预期差异需能被迁移内容解释（例如迁移明示删除某类数据）；**任何关键表意外清零都视为事故**。

## 4. 恢复演练

每季度或在执行破坏性迁移前，演练一次备份恢复（在与生产隔离的临时库上进行）：

```bash
# 1) 用备份在临时容器恢复
docker run -d --name restore-drill -e POSTGRES_PASSWORD=drill -e POSTGRES_DB=drill postgres:16-alpine
docker cp ./backups/backup_XXXX.dump restore-drill:/tmp/
docker exec restore-drill pg_restore -U postgres -d drill --no-owner /tmp/backup_XXXX.dump

# 2) 核对行数与生产迁移前快照一致
docker exec restore-drill psql -U postgres -d drill -c \
  'SELECT COUNT(*) FROM "User"; SELECT COUNT(*) FROM "Competition"; SELECT COUNT(*) FROM "Team";'

# 3) 记录演练结果到下表后销毁临时容器
docker rm -f restore-drill
```

### 演练记录

| 日期 | 备份文件 | 恢复结果 | 核对人 |
| --- | --- | --- | --- |
| （待演练） | — | — | — |

## 5. 已知破坏性迁移清单

| 迁移 | 破坏内容 | 适用环境 |
| --- | --- | --- |
| `20261011080000_drop_legacy_competition` | 删除 V1 竞赛域 13 张表（含数据）、采集子系统 5 张表、`Notification` 部分行，重建枚举 | 仅测试/重建库；生产已越过该版本则不受影响 |
| 后续新破坏性迁移 | 提 PR 时在本表登记，并在迁移 SQL 头部注释说明数据去向 | — |

## 6. 新增迁移的纪律

1. 常规演进一律用 `pnpm db:migrate` 生成增量迁移，禁止改写已合入的迁移文件（checksum 会失效）。
2. 需要删除数据/表的迁移：SQL 头部注释写明「破坏范围 + 数据去向 + 是否可逆」，并同步登记第 5 节清单。
3. 无法安全增量演进的大改版，走「新表 + 双写 + 校验 + 切换」流程，而不是直接 DROP。
