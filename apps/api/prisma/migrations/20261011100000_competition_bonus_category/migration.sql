-- 竞赛加分类别（学科竞赛 / 文体竞赛）：保持反范式，便于列表展示
ALTER TABLE "Competition" ADD COLUMN "bonusCategory" TEXT;
