-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('CAMPUS', 'QUALIFIER', 'REGIONAL', 'PROVINCIAL', 'NATIONAL', 'INTERNATIONAL', 'FINAL', 'OTHER');

-- CreateEnum
CREATE TYPE "EventNodeType" AS ENUM ('SIGNUP_START', 'SIGNUP_END', 'SUBMISSION', 'CONTEST', 'RESULT', 'AWARD', 'OTHER');

-- CreateEnum
CREATE TYPE "BonusTier" AS ENUM ('NATIONAL', 'PROVINCIAL', 'NONE');

-- CreateTable
CREATE TABLE "Competition" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "year" INTEGER NOT NULL,
    "aliases" TEXT[],
    "organizer" TEXT,
    "officialUrl" TEXT,
    "sourceUrl" TEXT,
    "format" "CompetitionFormat",
    "teamSizeMin" INTEGER,
    "teamSizeMax" INTEGER,
    "audience" "Audience",
    "intro" TEXT,
    "difficulty" INTEGER,
    "effort" INTEGER,
    "hasTracks" BOOLEAN NOT NULL DEFAULT false,
    "stageChain" TEXT,
    "isBonusEligible" BOOLEAN,
    "bonusStandardId" TEXT,
    "bonusSpecialRule" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionTrack" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "parentId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "aliases" TEXT[],
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "format" "CompetitionFormat",
    "teamSizeMin" INTEGER,
    "teamSizeMax" INTEGER,

    CONSTRAINT "CompetitionTrack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionStage" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "trackId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "stageKind" "StageKind" NOT NULL,
    "scope" TEXT,
    "sequence" INTEGER NOT NULL,
    "bonusTier" "BonusTier",
    "note" TEXT,

    CONSTRAINT "CompetitionStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionEvent" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "trackId" TEXT,
    "nodeType" "EventNodeType" NOT NULL,
    "label" TEXT,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "location" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BonusStandard" (
    "id" TEXT NOT NULL,
    "documentRef" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "level" "BonusTier" NOT NULL,
    "topPoints" TEXT NOT NULL,
    "secondPoints" TEXT NOT NULL,
    "thirdPoints" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonusStandard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionLevel" (
    "competitionId" TEXT NOT NULL,
    "level" "Level" NOT NULL,

    CONSTRAINT "CompetitionLevel_pkey" PRIMARY KEY ("competitionId","level")
);

-- CreateTable
CREATE TABLE "CompetitionTag" (
    "competitionId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,

    CONSTRAINT "CompetitionTag_pkey" PRIMARY KEY ("competitionId","tag")
);

-- CreateTable
CREATE TABLE "CompetitionAward" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "year" INTEGER,
    "awardName" TEXT,
    "awardTier" "BonusTier",
    "teamName" TEXT,
    "members" TEXT[],
    "sourceUrl" TEXT,

    CONSTRAINT "CompetitionAward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionMaterial" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "kind" "MaterialKind" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "authorId" TEXT,

    CONSTRAINT "CompetitionMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionCustomField" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitionCustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitionRevision" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT,
    "stageId" TEXT,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "origin" "RevisionOrigin" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitionRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionReport" (
    "id" TEXT NOT NULL,
    "competitionId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "currentValue" TEXT,
    "proposedValue" TEXT,
    "note" TEXT,
    "reporterId" TEXT NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Competition_status_idx" ON "Competition"("status");

-- CreateIndex
CREATE INDEX "Competition_year_idx" ON "Competition"("year");

-- CreateIndex
CREATE INDEX "Competition_updatedAt_idx" ON "Competition"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Competition_code_year_key" ON "Competition"("code", "year");

-- CreateIndex
CREATE INDEX "CompetitionTrack_competitionId_sortOrder_idx" ON "CompetitionTrack"("competitionId", "sortOrder");

-- CreateIndex
CREATE INDEX "CompetitionTrack_parentId_idx" ON "CompetitionTrack"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionTrack_competitionId_code_key" ON "CompetitionTrack"("competitionId", "code");

-- CreateIndex
CREATE INDEX "CompetitionStage_competitionId_sequence_idx" ON "CompetitionStage"("competitionId", "sequence");

-- CreateIndex
CREATE INDEX "CompetitionStage_trackId_idx" ON "CompetitionStage"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionStage_competitionId_trackId_code_key" ON "CompetitionStage"("competitionId", "trackId", "code");

-- CreateIndex
CREATE INDEX "CompetitionEvent_competitionId_startAt_idx" ON "CompetitionEvent"("competitionId", "startAt");

-- CreateIndex
CREATE INDEX "CompetitionEvent_stageId_idx" ON "CompetitionEvent"("stageId");

-- CreateIndex
CREATE INDEX "CompetitionEvent_endAt_idx" ON "CompetitionEvent"("endAt");

-- CreateIndex
CREATE UNIQUE INDEX "BonusStandard_documentRef_category_level_key" ON "BonusStandard"("documentRef", "category", "level");

-- CreateIndex
CREATE INDEX "CompetitionLevel_level_idx" ON "CompetitionLevel"("level");

-- CreateIndex
CREATE INDEX "CompetitionTag_tag_idx" ON "CompetitionTag"("tag");

-- CreateIndex
CREATE INDEX "CompetitionAward_competitionId_idx" ON "CompetitionAward"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionMaterial_competitionId_idx" ON "CompetitionMaterial"("competitionId");

-- CreateIndex
CREATE INDEX "CompetitionMaterial_kind_idx" ON "CompetitionMaterial"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitionCustomField_competitionId_key_key" ON "CompetitionCustomField"("competitionId", "key");

-- CreateIndex
CREATE INDEX "CompetitionRevision_competitionId_createdAt_idx" ON "CompetitionRevision"("competitionId", "createdAt");

-- CreateIndex
CREATE INDEX "CompetitionRevision_stageId_createdAt_idx" ON "CompetitionRevision"("stageId", "createdAt");

-- CreateIndex
CREATE INDEX "CorrectionReport_status_createdAt_idx" ON "CorrectionReport"("status", "createdAt");

-- 清理指向已删除竞赛的旧测试数据：竞赛表已重建（新 id），旧外键值失效，
-- 必须先清除才能重新建立 Team / Feedback 的外键约束。
DELETE FROM "Team" WHERE "competitionId" NOT IN (SELECT "id" FROM "Competition");
DELETE FROM "Feedback" WHERE "competitionId" IS NOT NULL AND "competitionId" NOT IN (SELECT "id" FROM "Competition");
DELETE FROM "Comment" WHERE "targetType" = 'COMPETITION' AND "targetId" NOT IN (SELECT "id" FROM "Competition");
DELETE FROM "Favorite" WHERE "targetType" = 'COMPETITION' AND "targetId" NOT IN (SELECT "id" FROM "Competition");

-- AddForeignKey
ALTER TABLE "Competition" ADD CONSTRAINT "Competition_bonusStandardId_fkey" FOREIGN KEY ("bonusStandardId") REFERENCES "BonusStandard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionTrack" ADD CONSTRAINT "CompetitionTrack_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionTrack" ADD CONSTRAINT "CompetitionTrack_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CompetitionTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionStage" ADD CONSTRAINT "CompetitionStage_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionStage" ADD CONSTRAINT "CompetitionStage_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "CompetitionTrack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEvent" ADD CONSTRAINT "CompetitionEvent_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionEvent" ADD CONSTRAINT "CompetitionEvent_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionLevel" ADD CONSTRAINT "CompetitionLevel_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionTag" ADD CONSTRAINT "CompetitionTag_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionAward" ADD CONSTRAINT "CompetitionAward_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMaterial" ADD CONSTRAINT "CompetitionMaterial_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionMaterial" ADD CONSTRAINT "CompetitionMaterial_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionCustomField" ADD CONSTRAINT "CompetitionCustomField_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionCustomField" ADD CONSTRAINT "CompetitionCustomField_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRevision" ADD CONSTRAINT "CompetitionRevision_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitionRevision" ADD CONSTRAINT "CompetitionRevision_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "CompetitionStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionReport" ADD CONSTRAINT "CorrectionReport_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionReport" ADD CONSTRAINT "CorrectionReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_competitionId_fkey" FOREIGN KEY ("competitionId") REFERENCES "Competition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
