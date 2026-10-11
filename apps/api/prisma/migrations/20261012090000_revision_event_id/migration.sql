-- Issue 15：版本记录增加事件级定位
-- 一个赛程阶段可以有多个时间节点事件，旧回滚逻辑只按 stageId 取「最近更新的一条」，
-- 多事件阶段会改错节点。新增 eventId 列后，人工编辑 / 纠错采纳的修订记录精确绑定
-- 到事件本身；存量记录 eventId 为空，回滚时回退旧的 stageId 口径。
-- 非破坏性迁移：仅新增可空列与外键，不动任何既有数据。

ALTER TABLE "CompetitionRevision" ADD COLUMN "eventId" TEXT;

ALTER TABLE "CompetitionRevision" ADD CONSTRAINT "CompetitionRevision_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "CompetitionEvent"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CompetitionRevision_eventId_idx" ON "CompetitionRevision"("eventId");
