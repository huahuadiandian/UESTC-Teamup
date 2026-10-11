-- 竞赛模型 V2 第一步：删除旧的竞赛数据结构与采集子系统
-- 说明：本迁移为破坏性操作（用户明确要求"先删除竞赛相关数据结构与旧的测试信息，再写入新的"）。
-- 第二步由 Prisma 依据 schema.prisma 生成新表。

-- 1) 采集子系统（本阶段不做采集，整体移除）
DROP TABLE IF EXISTS "CrawlRevision" CASCADE;
DROP TABLE IF EXISTS "CrawlAnomaly" CASCADE;
DROP TABLE IF EXISTS "CrawlItem" CASCADE;
DROP TABLE IF EXISTS "CrawlSnapshot" CASCADE;
DROP TABLE IF EXISTS "CrawlSource" CASCADE;

-- 2) 竞赛相关表（CASCADE 会一并删除 Team / Feedback 上指向 Competition 的外键约束，
--    随后由 Prisma 生成的第二步迁移自动补回）
DROP TABLE IF EXISTS "CompetitionTimeline" CASCADE;
DROP TABLE IF EXISTS "CompetitionCustomField" CASCADE;
DROP TABLE IF EXISTS "CompetitionMaterial" CASCADE;
DROP TABLE IF EXISTS "CompetitionAward" CASCADE;
DROP TABLE IF EXISTS "CompetitionTag" CASCADE;
DROP TABLE IF EXISTS "CompetitionLevel" CASCADE;
DROP TABLE IF EXISTS "CorrectionReport" CASCADE;
DROP TABLE IF EXISTS "Competition" CASCADE;

-- 3) 移除不再使用的枚举
DROP TYPE IF EXISTS "SourceHealth";
DROP TYPE IF EXISTS "SourceKind";
DROP TYPE IF EXISTS "ParseStrategy";

-- 4) NotificationKind 去掉 CRAWL_ANOMALY / SOURCE_FAILING（先清理旧数据再重建类型）
DELETE FROM "Notification" WHERE "kind"::text IN ('CRAWL_ANOMALY', 'SOURCE_FAILING');
ALTER TABLE "Notification" ALTER COLUMN "kind" TYPE text USING "kind"::text;
DROP TYPE IF EXISTS "NotificationKind";
CREATE TYPE "NotificationKind" AS ENUM ('DDL_REMINDER', 'COMMENT_REPLY', 'CORRECTION_NEW', 'SYSTEM_NOTIFICATION', 'TEAM_INTENT');
ALTER TABLE "Notification" ALTER COLUMN "kind" TYPE "NotificationKind" USING "kind"::"NotificationKind";

-- 5) RevisionOrigin 去掉 CRAWL
DROP TYPE IF EXISTS "RevisionOrigin";
CREATE TYPE "RevisionOrigin" AS ENUM ('MANUAL', 'ROLLBACK');
