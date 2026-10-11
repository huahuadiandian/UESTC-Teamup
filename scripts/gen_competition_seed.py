# -*- coding: utf-8 -*-
"""生成 apps/api/prisma/competition-seed.json —— 70 项竞赛的 V2 结构骨架 + 关键时间点。

结构规格（code / 赛道 / 阶段链）来自 docs/COMPETITION_INSTANCES_V2.md；
时间点从 data/competition-latest-editions-verified.csv 抽取（首个 YYYY-MM-DD）。
"""
import csv
import json
import re
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(ROOT, "data", "competition-latest-editions-verified.csv")
SITES_PATH = os.path.join(ROOT, "data", "competition-sites-probe.csv")
# 联网核查产物（data/research-results/ 汇总而成）：官网修正 / 结构覆盖 / 显式时间节点
OVERRIDES_PATH = os.path.join(ROOT, "data", "research-overrides.json")
OUT_PATH = os.path.join(ROOT, "apps", "api", "prisma", "competition-seed.json")

YEAR = 2026

# 阶段：名称:stageKind  （bonusTier 由 stageKind 自动推导）
# 赛道：code:名称（| 分隔）
SPEC = [
    # seq, code, name, tags, format, tracks, stages, audience, difficulty, effort, intro
    ("1", "CIC", "中国国际大学生创新大赛", ["创新创业", "综合"], "TEAM",
     "MAIN:高教主赛道|RED:青年红色筑梦之旅|INDUSTRY:产业命题赛道|SPROUT:萌芽赛道",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "MIXED", 4, 5,
     "原“互联网+”大学生创新创业大赛，国内规格最高的双创赛事，高教主赛道强调科技创新与产业化落地。"),
    ("2", "TZB-ACADEMIC", "“挑战杯”全国大学生课外学术科技作品竞赛", ["学术科技", "综合"], "TEAM",
     "PAPER:自然科学类学术论文|SURVEY:哲学社会科学类调查报告|INVENTION:科技发明制作",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国终审决赛:FINAL", "MIXED", 4, 4,
     "与创新大赛并称“两大挑”，奇数年办“大挑”，涵盖学术论文、社会调查与科技发明三类作品。"),
    ("3", "TZB-BUSINESS", "“挑战杯”中国大学生创业计划大赛", ["创新创业", "综合"], "TEAM",
     "TECH:科技创新|FUTURE:未来产业|RURAL:乡村振兴|SOCIAL:社会治理|ECO:生态环保|CULTURE:文化创意|REGION:区域合作",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国决赛:FINAL", "MIXED", 4, 4,
     "“小挑”，偶数年举办，以商业计划书为核心的大学生创业赛事。"),
    ("4", "CMC", "全国大学生数学竞赛", ["数学", "基础学科"], "INDIVIDUAL",
     "MATH-A:数学A类|MATH-B:数学B类|NON-MATH:非数学类|ECON:经管类",
     "初赛(分区赛):QUALIFIER|决赛:FINAL", "MIXED", 3, 3,
     "中国数学会主办，分数学类与非数学类，初赛即各赛区预赛，优胜者进入全国决赛。"),
    ("5", "CUPT", "中国大学生物理学术竞赛", ["物理", "基础学科"], "TEAM",
     "", "区域赛:REGIONAL|全国决赛:FINAL", "MIXED", 4, 4,
     "以国际青年物理学家锦标赛（IYPT）模式进行的物理对抗赛，重实验与辩论表达。"),
    ("6", "ICPC", "ACM-ICPC 国际大学生程序设计竞赛", ["算法", "程序设计"], "TEAM",
     "", "网络预选赛:QUALIFIER|区域赛:REGIONAL|EC Final:FINAL|World Finals:INTERNATIONAL", "MIXED", 5, 5,
     "三人一队共用一台电脑，5 小时解 10+ 道算法题，成电常年晋级 EC-Final。"),
    ("7", "CUMCM", "全国大学生数学建模竞赛", ["数学建模", "综合"], "TEAM",
     "", "报名:OTHER|竞赛:NATIONAL|评奖:OTHER", "MIXED", 4, 3,
     "三人一队 72 小时完成一道开放性工程问题的建模、求解与论文，推免加分常见起点。"),
    ("8", "NUEDC", "全国大学生电子设计竞赛", ["电子", "嵌入式", "硬件"], "TEAM",
     "", "校内选拔:CAMPUS|赛区测评:REGIONAL|全国集中竞赛:FINAL", "UNDERGRAD", 5, 5,
     "两年一届的电子类顶级赛事（单数年国赛），四天三夜完成一个完整电子系统。"),
    ("9", "UMIC", "全国大学生机械创新设计大赛", ["机械", "工程"], "TEAM",
     "", "校赛:CAMPUS|省赛:PROVINCIAL|全国决赛:FINAL", "UNDERGRAD", 3, 4,
     "以机械创新设计为主题，两年一届，含常规赛与数字孪生设计挑战赛。"),
    ("10", "SMARTCAR", "全国大学生智能汽车竞赛", ["自动化", "嵌入式"], "TEAM",
     "SPEED:竞速组|CREATIVE:创意组|OUTDOOR:室外组",
     "分赛区赛:REGIONAL|全国总决赛:FINAL", "UNDERGRAD", 4, 5,
     "以智能车为载体，覆盖竞速、创意与室外多组别，室内外决赛分开举行。"),
    ("11", "CURC", "全国大学生机器人大赛（CURC）", ["机器人", "硬件"], "TEAM",
     "ROBOCON:ROBOCON|ROBOTAC:ROBOTAC|ROBOMASTER:RoboMaster",
     "预选赛:QUALIFIER|全国赛:FINAL", "UNDERGRAD", 5, 5,
     "国内规模最大的大学生机器人赛事，含 ROBOCON、ROBOTAC、RoboMaster 三赛项。"),
    ("12", "GDESIGN", "全国大学生光电设计竞赛", ["光电", "工程"], "TEAM",
     "CREATIVE:创意设计类|COMPETE:竞技类",
     "区赛:REGIONAL|全国决赛:FINAL", "UNDERGRAD", 4, 4,
     "中国光学学会主办，采用“区赛晋级国赛”制，围绕光电技术创新设计。"),
    ("13", "CISCN", "全国大学生信息安全竞赛", ["网络安全", "程序设计"], "TEAM",
     "WORKS:作品赛|CPRACTICE:创新实践能力赛",
     "分区赛:REGIONAL|全国决赛:FINAL", "UNDERGRAD", 4, 4,
     "网安领域顶级赛事，分作品赛与创新实践能力赛两个赛道。"),
    ("14", "UCC", "“外研社·国才杯”“理解当代中国”全国大学生外语能力大赛", ["外语", "演讲辩论"], "INDIVIDUAL",
     "SPEECH:英语演讲|DEBATE:英语辩论|WRITING:英语写作|READING:英语阅读|INTEGRATED:英语综合能力",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国决赛:FINAL", "MIXED", 3, 3,
     "外研社主办的多语种多赛项外语能力大赛，含演讲、辩论、写作、阅读、综合能力五大赛项。"),
    ("15", "3CHUANG", "全国大学生电子商务“创新、创意及创业”挑战赛", ["电子商务", "创新创业"], "TEAM",
     "REGULAR:常规赛|PRACTICE:实战赛",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "MIXED", 3, 3,
     "教育部电子商务类专业教指委主办，分常规赛与实战赛，侧重电商创新与创业实践。"),
    ("16", "JNJP", "全国大学生节能减排社会实践与科技竞赛", ["能源", "社会实践"], "TEAM",
     "", "校赛:CAMPUS|全国总决赛:FINAL", "MIXED", 3, 4,
     "以节能减排为主题，分社会实践与科技作品两类，高校轮流承办。"),
    ("17", "GCXL", "中国大学生工程实践与创新能力大赛", ["工程", "综合"], "TEAM",
     "BASIC:工程基础赛项|SMART:智能+赛项|VIRTUAL:虚拟仿真赛项",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国赛:FINAL", "UNDERGRAD", 4, 4,
     "原名工程训练综合能力竞赛，两年一届，考查工程实践与创新综合能力。"),
    ("18", "GJCXCY", "全国大学生创新创业训练计划年会展示", ["创新创业", "学术交流"], "TEAM",
     "", "校内推荐:CAMPUS|年会展示:FINAL", "MIXED", 3, 2,
     "国家级大创计划的年度成果交流与展示平台，入选与获奖均可作为推免加分依据。"),
    ("19", "CIMC", "“西门子杯”中国智能制造挑战赛", ["智能制造", "工程"], "TEAM",
     "DIGITAL:数字化双胞胎|LOGIC:逻辑控制|PROCESS:流程行业",
     "分赛区初赛:REGIONAL|全国总决赛:FINAL", "UNDERGRAD", 4, 4,
     "中国仿真学会与西门子联合主办，面向智能制造与工业自动化的工程类赛事。"),
    ("20", "CHENGTU", "全国大学生先进成图技术与产品信息建模创新大赛", ["制图", "工程"], "TEAM",
     "MECH:机械类|ARCH:建筑类|ROAD:道桥类|WATER:水利类",
     "省赛:PROVINCIAL|国赛:FINAL", "UNDERGRAD", 3, 4,
     "即“高教杯”，以工程图学与产品信息建模为核心，按专业分多个赛道。"),
    ("21", "4C", "中国大学生计算机设计大赛", ["计算机", "设计"], "TEAM",
     "SOFTWARE:软件应用|MICRO:微课与教学辅助|IOT:物联网应用|BIGDATA:大数据应用|MEDIA:数媒设计",
     "省赛:PROVINCIAL|国赛:FINAL", "MIXED", 3, 3,
     "面向计算机应用与设计的多类别赛事，国赛分设多个决赛区。"),
    ("22", "CSSC", "全国大学生市场调查与分析大赛", ["统计", "商科"], "TEAM",
     "", "校赛:CAMPUS|省赛:PROVINCIAL|国赛:FINAL", "MIXED", 3, 3,
     "中国商业统计学会主办，以市场调查与数据分析报告为参赛作品。"),
    ("23", "FWWB", "中国大学生服务外包创新创业大赛", ["软件", "创新创业"], "TEAM",
     "", "区域赛:REGIONAL|全国赛:FINAL", "MIXED", 3, 4,
     "教育部与商务部等主办，面向服务外包与软件创新创业，企业命题参赛。"),
    ("24", "C4", "中国高校计算机大赛", ["计算机", "程序设计"], "TEAM",
     "BIGDATA:大数据挑战赛|GPLT:团体程序设计天梯赛|APP:移动应用创新赛|NET:网络技术挑战赛|AIC:人工智能创意赛",
     "报名:OTHER|初赛:QUALIFIER|决赛:FINAL", "MIXED", 4, 4,
     "含大数据挑战赛、天梯赛、移动应用创新赛、网络技术挑战赛、人工智能创意赛五大子赛。"),
    ("25", "CRC", "中国机器人大赛暨RoboCup机器人世界杯中国赛", ["机器人", "人工智能"], "TEAM",
     "ROBOCUP:RoboCup赛区|ROBOT:中国机器人大赛赛区",
     "赛区赛:REGIONAL|全国赛:FINAL", "MIXED", 4, 5,
     "中国自动化学会主办，含中国机器人大赛与 RoboCup 中国赛两大板块。"),
    ("26", "ZPY", "全国周培源大学生力学竞赛", ["力学", "基础学科"], "INDIVIDUAL",
     "", "个人赛:FINAL", "UNDERGRAD", 4, 4,
     "中国力学学会与周培源基金会主办，两年一届，考查力学理论基础与综合应用。"),
    ("27", "CSB", "“中国软件杯”大学生软件设计大赛", ["软件", "程序设计"], "TEAM",
     "", "区域赛:REGIONAL|全国总决赛:FINAL", "MIXED", 3, 4,
     "工信部与教育部等主办，以企业命题形式考查软件设计与工程实现能力。"),
    ("28", "NCDA", "未来设计师·全国高校数字艺术设计大赛", ["设计", "数字艺术"], "TEAM",
     "VISUAL:视觉传达|ENV:环境设计|ANIM:动画|PRODUCT:产品设计",
     "省赛:PROVINCIAL|国赛:FINAL", "MIXED", 3, 3,
     "工信部人才交流中心主办，面向数字艺术设计，分省赛与国赛两级。"),
    ("29", "CHINAUS", "中美青年创客大赛", ["创新创业", "国际"], "TEAM",
     "", "分赛区选拔赛:REGIONAL|全国总决赛:FINAL", "MIXED", 3, 4,
     "教育部主办的中美青年创客交流赛事，分赛区选拔后进入全国总决赛。"),
    ("30", "CICIEC", "全国大学生集成电路创新创业大赛", ["集成电路", "硬件"], "TEAM",
     "CHIP-DESIGN:芯片设计赛道|CHIP-APP:芯片应用赛道|FPGA:FPGA赛道",
     "校内赛:CAMPUS|分赛区决赛:REGIONAL|全国总决赛:FINAL", "MIXED", 4, 5,
     "工信部人才交流中心主办，分芯片设计、芯片应用、FPGA 三个赛道。"),
    ("31", "SUNADA", "全国大学生广告艺术大赛", ["广告", "设计"], "TEAM",
     "PRINT:平面类|VIDEO:视频类|ANIM:动画类|PLAN:策划案类",
     "赛区评审:PROVINCIAL|全国总评审:FINAL", "MIXED", 3, 3,
     "即“大广赛”，教育部高教司指导，按命题创作，分平面、视频、动画、策划案等多类别。"),
    ("32", "MEDU", "中国大学生医学技术技能大赛", ["医学", "技能"], "TEAM",
     "CLINICAL:临床医学|NURSING:护理学|PHARMACY:药学",
     "校赛:CAMPUS|片区赛:REGIONAL|全国赛:FINAL", "MIXED", 4, 5,
     "教育部主办的医学类技能竞赛，按专业分赛道，考查临床与操作技能。"),
    ("33", "MEICC", "中国大学生机械工程创新创意大赛", ["机械", "工程"], "TEAM",
     "IMIC:智能制造赛|MAT:材料成型赛|DESIGN:创新设计赛",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "UNDERGRAD", 4, 4,
     "中国机械工程学会主办，含 3 大赛道、19 个赛项，赛道下再分赛项。"),
    ("34", "JXDS", "全国大学生金相技能大赛", ["材料", "技能"], "TEAM",
     "", "校内初赛:CAMPUS|分赛区复赛:REGIONAL|全国决赛:FINAL", "UNDERGRAD", 3, 3,
     "材料类专业教学指导委员会主办，考查金相试样制备与显微组织分析技能。"),
    ("35", "HUACAN", "两岸新锐设计竞赛·华灿奖", ["设计", "两岸交流"], "TEAM",
     "VISUAL:视觉传达|DIGITAL:数字媒体|PRODUCT:产品设计",
     "校赛:CAMPUS|赛区赛:REGIONAL|全国总决赛:FINAL", "MIXED", 3, 3,
     "中国高等教育学会等主办的两岸设计交流赛事，分创意与定向主题赛道。"),
    ("36", "STRUCT", "全国大学生结构设计竞赛", ["土木", "工程"], "TEAM",
     "", "分区赛:REGIONAL|全国总决赛:FINAL", "UNDERGRAD", 4, 4,
     "土木工程领域顶级赛事，以模型制作与加载测试为核心，分分区赛与全国赛。"),
    ("37", "MILAN", "米兰设计周--中国高校设计学科师生优秀作品展", ["设计", "国际"], "TEAM",
     "VISUAL:视觉传达|ENV:环境设计|PRODUCT:产品设计",
     "省赛:PROVINCIAL|国赛:FINAL", "MIXED", 3, 3,
     "中国教育国际交流协会等主办，面向高校设计学科师生的作品展赛。"),
    ("38", "MCM", "美国大学生数学建模竞赛", ["数学建模", "国际"], "TEAM",
     "MCM:MCM|ICM:ICM",
     "报名:OTHER|竞赛:NATIONAL", "MIXED", 3, 3,
     "全球规模最大的数学建模赛事，99 小时英文论文，Outstanding Winner 按国家级最高奖计。"),
    ("39", "IGEM", "国际基因工程机器大赛（iGEM）", ["生物", "国际"], "TEAM",
     "", "注册:QUALIFIER|评审与提交:OTHER|Grand Jamboree:FINAL", "MIXED", 5, 5,
     "合成生物学领域国际顶级赛事，以课题研究与展示答辩为核心。"),
    ("40", "CAAIROBOT", "中国机器人及人工智能大赛", ["机器人", "人工智能"], "TEAM",
     "ROBOT:机器人赛项|AI:人工智能赛项|INNOV:创新赛项",
     "省级选拔赛:PROVINCIAL|全国赛:FINAL", "MIXED", 4, 4,
     "中国人工智能学会主办，覆盖机器人、人工智能与创新应用多个赛项。"),
    ("41", "CUBEC", "全国高校商业精英挑战赛", ["商科", "创新创业"], "TEAM",
     "BRAND:品牌策划竞赛|EXPO:会展专业创新创业实践竞赛|TRADE:国际贸易竞赛|INNOV:创新创业竞赛|ELITE:精英赛",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "MIXED", 3, 4,
     "中国贸促会商业行业委员会主办，含品牌策划、会展、国际贸易、创新创业等多个赛道。"),
    ("42", "CDEC", "中国好创意暨全国数字艺术设计大赛", ["设计", "数字艺术"], "TEAM",
     "VISUAL:视觉传达|ENV:环境设计|ANIM:动画|GAME:游戏设计",
     "省赛:PROVINCIAL|国赛:FINAL", "MIXED", 3, 3,
     "中国电子视像行业协会主办，面向数字艺术设计，另设多个专项赛。"),
    ("43", "3DDS", "全国三维数字化创新设计大赛", ["三维设计", "工程"], "TEAM",
     "DIGITAL:数字工业|CULTURE:数字文化|LIFE:数字人居",
     "初赛:CAMPUS|复赛/省赛:PROVINCIAL|国赛:FINAL", "MIXED", 3, 4,
     "国家制造业信息化培训中心等主办，三级赛制，聚焦三维数字化创新设计。"),
    ("44", "XCBDS", "“学创杯”全国大学生创业综合模拟大赛", ["创新创业", "模拟经营"], "TEAM",
     "", "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "MIXED", 2, 3,
     "以创业综合模拟软件为平台的经营对抗赛，考查创业决策与团队协作。"),
    ("45", "DTCP", "大学生新一代信息通信科技大赛", ["信息通信", "工程"], "TEAM",
     "ENG:工程实践赛道|EDU:产教融合赛道|ICT:ICT通识赛道",
     "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "MIXED", 3, 4,
     "原名“大唐杯”，工信部人才交流中心等主办，分工程实践、产教融合、ICT 通识三赛道。"),
    ("46", "WLSYCX", "全国大学生物理实验竞赛", ["物理", "实验"], "TEAM",
     "TOPIC:命题类|FREE:自选类|LECTURE:讲课类|INTL:国际赛道",
     "校赛:CAMPUS|全国决赛:FINAL", "MIXED", 3, 4,
     "大学物理课程教学指导委员会主办，含命题、自选、讲课与国际四个赛道。"),
    ("47", "RAICOM", "睿抗机器人开发者大赛（RAICOM）", ["机器人", "人工智能"], "TEAM",
     "RAICOM-CAI:CAI 赛道|RAICOM-ROBOT:机器人赛道|RAICOM-INNOV:创新赛道",
     "区域赛:REGIONAL|全国总决赛:FINAL", "MIXED", 4, 4,
     "工信部人才交流中心主办，面向机器人开发者，分多个赛道与赛区。"),
    ("48", "CULSC", "全国大学生生命科学竞赛", ["生命科学", "科研"], "TEAM",
     "RESEARCH:科学探究类|INNOV:创新创业类",
     "网评:QUALIFIER|省赛:PROVINCIAL|全国决赛:FINAL", "MIXED", 4, 4,
     "分科学探究类与创新创业类两个赛道，考查科研实验与成果转化能力。"),
    ("49", "HUAWEI-ICT", "华为ICT大赛", ["信息通信", "企业赛"], "TEAM",
     "PRACTICE:实践赛|CHALLENGE:挑战赛|INNOV:创新赛|PROGRAM:编程赛|TEACH:教学赛",
     "校赛:CAMPUS|省赛:PROVINCIAL|全球总决赛:FINAL", "MIXED", 4, 4,
     "华为主办，覆盖实践、挑战、创新、编程、教学多个赛道，全球总决赛收官。"),
    ("50", "SOCCHINA", "全国大学生嵌入式芯片与系统设计竞赛", ["嵌入式", "硬件"], "TEAM",
     "APP:芯片应用赛道|DESIGN:芯片设计赛道|FPGA:FPGA创新设计赛道",
     "校赛:CAMPUS|分赛区初/复赛:REGIONAL|全国总决赛:FINAL", "MIXED", 4, 5,
     "中国电子教育学会主办，含芯片应用、芯片设计、FPGA 创新设计三个赛道，赛程各异。"),
    ("51", "ROBOTCONTEST", "中国高校智能机器人创意大赛", ["机器人", "创意"], "TEAM",
     "CREATIVE:创意类|COMPETE:竞技类",
     "大区赛:REGIONAL|全国总决赛:FINAL", "MIXED", 4, 4,
     "教育部自动化类专业教指委等主办，以大区赛晋级全国总决赛。"),
    ("52", "CSCC", "全国大学生计算机系统能力大赛", ["计算机系统", "程序设计"], "TEAM",
     "CPU:CPU设计赛|OS:操作系统设计赛|COMPILER:编译系统设计赛|AI:智能计算赛",
     "初赛:QUALIFIER|决赛:FINAL", "MIXED", 5, 5,
     "全国高等学校计算机教育研究会等主办，含 CPU、操作系统、编译、智能计算等赛项。"),
    ("53", "I21ST", "“21世纪杯”全国英语演讲比赛", ["外语", "演讲辩论"], "INDIVIDUAL",
     "UNIV:大学组|SENIOR:高中组",
     "校园选拔:CAMPUS|地区赛:REGIONAL|全国半决赛/总决赛:FINAL", "MIXED", 3, 3,
     "中国日报社主办，以英语演讲为核心，分校园选拔、地区赛与全国总决赛。"),
    ("54", "SFLEP", "“外教社杯”全国高校学生跨文化能力大赛", ["外语", "综合"], "TEAM",
     "", "校赛:CAMPUS|省赛:PROVINCIAL|全国总决赛:FINAL", "MIXED", 3, 3,
     "上海外语教育出版社主办，考查跨文化沟通与案例分析能力。"),
    ("55", "IOTSJTU", "全国大学生物联网设计竞赛", ["物联网", "工程"], "TEAM",
     "", "分赛区决赛:REGIONAL|全国总决赛:FINAL", "MIXED", 3, 4,
     "教育部计算机类专业教指委主办，上海交通大学承办，以物联网创新设计为内容。"),
    ("56", "JCYXDS", "全国大学生医学创新大赛暨“一带一路”国际竞赛", ["医学", "科研"], "TEAM",
     "BASIC:基础医学|CLINICAL:临床医学|PHARMACY:药学|PUBLIC:公共卫生|NURSING:护理学|TCM:中医学|STOMATOLOGY:口腔医学",
     "校赛:CAMPUS|复赛/分区赛:REGIONAL|全国总决赛:FINAL", "MIXED", 4, 4,
     "高等学校国家级实验教学示范中心联席会主办，分 7 个学科赛道及国际赛道。"),
    # ---------------- 文体竞赛 ----------------
    ("B1", "NECCS", "全国大学生英语竞赛", ["外语", "文体竞赛"], "INDIVIDUAL",
     "A:研究生类|B:英语专业类|C:非英语专业本科|D:体育艺术类",
     "初赛:CAMPUS|决赛:FINAL", "MIXED", 3, 2,
     "全国大学生英语竞赛（NECCS），按 A/B/C/D 四类分组，初赛与决赛全国同步。"),
    ("B2", "ARTSHOW", "全国大学生艺术展演", ["艺术", "文体竞赛"], "TEAM",
     "VOCAL:声乐|INSTR:器乐|DANCE:舞蹈|DRAMA:戏剧|RECITE:朗诵|WORKSHOP:艺术实践工作坊",
     "校级展演:CAMPUS|省级展演:PROVINCIAL|全国汇演:FINAL", "MIXED", 3, 3,
     "教育部主办的全国大学生艺术展演，分声乐、器乐、舞蹈、戏剧、朗诵等类别。"),
    ("B3", "CICF", "中国国际合唱节", ["合唱", "文体竞赛"], "TEAM",
     "A:A 级|B:B 级|C:C 级|D:D 级",
     "参赛:FINAL", "MIXED", 3, 3,
     "中国国际合唱节，团队按 A/B/C/D 级评定，A 级按国家级最高奖计。"),
    ("B4", "WCDC", "世界华语辩论锦标赛", ["辩论", "文体竞赛"], "TEAM",
     "", "分区赛:REGIONAL|总决赛:FINAL", "MIXED", 3, 3,
     "华语辩论领域赛事，个人奖项仅“全程最佳辩手”“决赛最佳辩手”计入加分。"),
    ("B5", "WCDB", "华语辩论世界杯", ["辩论", "文体竞赛"], "TEAM",
     "", "分区赛:REGIONAL|总决赛:FINAL", "MIXED", 3, 3,
     "华语辩论世界杯，分分区赛与总决赛，个人奖项计入口径同辩论类赛事。"),
    ("B6", "QBIANHUI", "全辩会·国际华语辩论冠军赛", ["辩论", "文体竞赛"], "TEAM",
     "", "淘汰赛:FINAL", "MIXED", 3, 3,
     "全辩会国际华语辩论冠军赛，个人奖项仅最佳辩手计入加分。"),
    ("B7", "WUDT", "世界大学生辩论巡回赛", ["辩论", "文体竞赛"], "TEAM",
     "", "分区赛:REGIONAL|总决赛:FINAL", "MIXED", 3, 3,
     "世界大学生辩论巡回赛（星辰杯），赛区冠亚军晋级总决赛。"),
    ("B8", "XFXJXF", "全国学生“学宪法讲宪法”活动", ["法治", "文体竞赛"], "INDIVIDUAL",
     "LITERACY:法治素养|MICRO:微课",
     "省级选拔:PROVINCIAL|全国总决赛:FINAL", "MIXED", 3, 2,
     "教育部等五部门联合开展，含法治素养与微课两个赛道，个人奖项仅最佳辩手类计入。"),
    ("B9", "WLWHJ", "全国大学生网络文化节", ["网络文化", "文体竞赛"], "TEAM",
     "VIDEO:短视频|PHOTO:摄影|WRITING:网文|MUSIC:歌曲|DESIGN:公益广告",
     "省级推选:PROVINCIAL|全国遴选:FINAL", "MIXED", 2, 2,
     "教育部思政司主办，面向大学生网络文化作品，按类别征集与遴选。"),
    ("B10", "SCXIJU", "四川省戏剧小品（小戏）比赛", ["戏剧", "文体竞赛"], "TEAM",
     "", "参赛:FINAL", "MIXED", 2, 3,
     "四川省委宣传部、省文旅厅主办的省级戏剧小品（小戏）比赛。"),
]

BONUS_TIER = {
    "CAMPUS": "NONE",
    "QUALIFIER": "NONE",
    "REGIONAL": "NONE",
    "PROVINCIAL": "PROVINCIAL",
    "NATIONAL": "NATIONAL",
    "INTERNATIONAL": "NATIONAL",
    "FINAL": "NATIONAL",
    "OTHER": "NONE",
}

LEVEL_FROM_STAGE = {
    "CAMPUS": "SCHOOL",
    "QUALIFIER": None,
    "REGIONAL": None,
    "PROVINCIAL": "PROVINCIAL",
    "NATIONAL": "NATIONAL",
    "INTERNATIONAL": "INTERNATIONAL",
    "FINAL": "NATIONAL",
    "OTHER": None,
}

# 各赛道赛程互不相同的赛事：阶段链按赛道各建一套（其余赛事用全赛事共享链）
PER_TRACK = {
    "C4", "MEICC", "CUBEC", "SOCCHINA", "CICIEC", "CISCN", "CULSC", "DTCP",
    "WLSYCX", "SMARTCAR", "CURC", "CRC", "CAAIROBOT", "RAICOM", "ROBOTCONTEST",
    "CSCC", "HUAWEI-ICT", "4C", "CHENGTU", "NCDA", "HUACAN", "MILAN", "CDEC",
    "3DDS", "SUNADA", "MEDU", "JCYXDS", "GCXL", "CIMC", "UCC", "ARTSHOW", "XFXJXF",
}


def read_dates():
    """从已验证 CSV 抽取每个竞赛的首个日期，映射到 报名截止/决赛/结果。"""
    out = {}
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            seq = row["序号"].strip()
            def first_date(cell):
                m = re.search(r"(20\d{2})-(\d{2})-(\d{2})", cell or "")
                return f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else None
            out[seq] = {
                "signupEnd": first_date(row.get("报名截止时间", "")),
                "signupStart": first_date(row.get("报名开始时间", "")),
                "final": first_date(row.get("全国赛/决赛时间", "")),
                "result": first_date(row.get("结果公布/颁奖时间", "")),
                "source": (row.get("官方来源URL") or "").split(";")[0].strip(),
                "note": (row.get("备注") or "").strip(),
                "edition": (row.get("最新届次") or "").strip(),
            }
    return out


def read_sites():
    """官网首页（data/competition-sites-probe.csv 人工深验）。按名称前缀模糊匹配。"""
    import unicodedata
    sites = {}
    with open(SITES_PATH, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            sites[row["竞赛名称"].strip()] = row["官网地址"].strip()
    return sites


def norm_name(s):
    for ch in "“”（）()-- “":
        s = s.replace(ch, "")
    return s.replace(" ", "")


def load_overrides():
    if not os.path.exists(OVERRIDES_PATH):
        return {}
    with open(OVERRIDES_PATH, encoding="utf-8") as f:
        return json.load(f)


def main():
    dates = read_dates()
    sites = read_sites()
    overrides = load_overrides()
    official_map = overrides.get("official", {})
    struct_map = overrides.get("structures", {})
    events_map = overrides.get("events", {})
    competitions = []
    for (seq, code, name, tags, fmt, tracks_spec, stages_spec, audience,
         difficulty, effort, intro) in SPEC:
        tracks = []
        if tracks_spec:
            for i, item in enumerate(tracks_spec.split("|")):
                tcode, tname = item.split(":", 1)
                tracks.append({"code": tcode, "name": tname, "sortOrder": i + 1})
        stages = []
        seen_kinds = {}
        for i, item in enumerate(stages_spec.split("|")):
            sname, skind = item.split(":", 1)
            sname, skind = sname.strip(), skind.strip()
            n = seen_kinds.get(skind, 0) + 1
            seen_kinds[skind] = n
            stages.append({
                "code": skind if n == 1 else f"{skind}-{n}",
                "name": sname,
                "stageKind": skind,
                "sequence": i + 1,
                "bonusTier": BONUS_TIER.get(skind, "NONE"),
                "track": None,
            })

        # 复杂赛事：把阶段链复制到每个赛道，使各赛道拥有独立赛程
        if code in PER_TRACK and tracks:
            per_track_stages = []
            for t in tracks:
                for s in stages:
                    per_track_stages.append({**s, "track": t["code"]})
            stages = per_track_stages

        # 联网核查结构覆盖：替换赛道与阶段链（各赛道可各不相同）
        if code in struct_map:
            ov = struct_map[code]
            tracks = [
                {"code": t["code"], "name": t["name"], "sortOrder": i + 1,
                 **({"description": t["description"]} if t.get("description") else {})}
                for i, t in enumerate(ov.get("tracks", []))
            ]
            new_stages = []
            for tcode, chain in ov.get("stagesByTrack", {}).items():
                key = None if tcode == "shared" else tcode
                seen_kinds = {}
                for i, st in enumerate(chain):
                    sname, skind = st["name"], st["kind"]
                    n = seen_kinds.get(skind, 0) + 1
                    seen_kinds[skind] = n
                    new_stages.append({
                        "code": skind if n == 1 else f"{skind}-{n}",
                        "name": sname,
                        "stageKind": skind,
                        "sequence": i + 1,
                        "bonusTier": BONUS_TIER.get(skind, "NONE"),
                        "track": key,
                    })
            stages = new_stages

        levels = []
        for st in stages:
            lv = LEVEL_FROM_STAGE.get(st["stageKind"])
            if lv and lv not in levels:
                levels.append(lv)
        if not levels:
            levels = ["NATIONAL"]

        d = dates.get(seq, {})
        events = []
        if code in events_map:
            # 显式事件（联网核查产物）：stage 用阶段名精确匹配（先按 track，再退共享链）
            name_key = {}
            for st in stages:
                name_key[(st["track"], st["name"])] = st["code"]
            for ev in events_map[code]:
                tcode = ev.get("track")
                sname = ev["stage"]
                scode = name_key.get((tcode, sname)) or name_key.get((None, sname))
                if scode is None:
                    # 退级：同 track 下包含式匹配
                    for (tk, nm), c in name_key.items():
                        if tk == tcode and sname in nm:
                            scode = c
                            break
                if scode is None:
                    print(f"  ! [{code}] 事件阶段未解析: track={tcode} stage={sname}")
                    continue
                events.append({
                    "stage": scode,
                    "track": tcode,
                    "nodeType": ev["nodeType"],
                    **({"startAt": ev["startAt"]} if ev.get("startAt") else {}),
                    **({"endAt": ev["endAt"]} if ev.get("endAt") else {}),
                    **({"label": ev["label"]} if ev.get("label") else {}),
                })
        else:
            # 通用兜底：从 CSV 栏目抽取首个日期，挂到第一条链
            anchor_track = stages[0]["track"] if stages else None
            anchor = [s for s in stages if s["track"] == anchor_track]

            def pick(pattern, fallback):
                for s in anchor:
                    if re.search(pattern, s["name"]):
                        return s["code"]
                return anchor[fallback]["code"]

            signup_stage = pick(r"报名|注册", 0)
            contest_stage = pick(r"竞赛|比赛|初赛|决赛|评审|答辩", -1)
            result_stage = pick(r"评奖|结果|公布|颁奖", -1)
            if d.get("signupStart"):
                events.append({"stage": signup_stage, "track": anchor_track, "nodeType": "SIGNUP_START", "startAt": d["signupStart"]})
            if d.get("signupEnd"):
                events.append({"stage": signup_stage, "track": anchor_track, "nodeType": "SIGNUP_END", "endAt": d["signupEnd"]})
            if d.get("final"):
                events.append({"stage": contest_stage, "track": anchor_track, "nodeType": "CONTEST", "startAt": d["final"]})
            if d.get("result"):
                events.append({"stage": result_stage, "track": anchor_track, "nodeType": "RESULT", "startAt": d["result"]})

        competitions.append({
            "code": code,
            "name": name,
            "year": YEAR,
            "aliases": [],
            "tags": tags,
            "levels": levels,
            "format": fmt,
            "audience": audience,
            "difficulty": difficulty,
            "effort": effort,
            "intro": intro,
            "officialUrl": official_map.get(code)
                or next((u for n, u in sites.items() if norm_name(n)[:10] == norm_name(name)[:10]), None),
            "sourceUrl": d.get("source") or None,
            "bonusCategory": "文体竞赛" if code.startswith("SPORT") or code in
                {"NECCS", "ARTSHOW", "CICF", "WCDC", "WCDB", "QBIANHUI", "WUDT", "XFXJXF", "WLWHJ", "SCXIJU"}
                else "学科竞赛",
            "bonusEligible": True,
            "tracks": tracks,
            "stages": stages,
            "events": events,
        })

    payload = {
        "documentRef": "校教〔2026〕39号（2027 届）",
        "bonusStandards": [
            {"category": "学科竞赛", "level": "NATIONAL", "topPoints": "3", "secondPoints": "2.5", "thirdPoints": "1.5"},
            {"category": "学科竞赛", "level": "PROVINCIAL", "topPoints": "1", "secondPoints": "0.3", "thirdPoints": "0.1"},
            {"category": "文体竞赛", "level": "NATIONAL", "topPoints": "2", "secondPoints": "1.5", "thirdPoints": "1"},
            {"category": "文体竞赛", "level": "PROVINCIAL", "topPoints": "0.7", "secondPoints": "0.2", "thirdPoints": "0.1"},
        ],
        "competitions": competitions,
    }

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    n_tracks = sum(len(c["tracks"]) for c in competitions)
    n_stages = sum(len(c["stages"]) for c in competitions)
    n_events = sum(len(c["events"]) for c in competitions)
    print(f"竞赛 {len(competitions)} | 赛道 {n_tracks} | 阶段 {n_stages} | 事件 {n_events}")
    print("written:", OUT_PATH)


if __name__ == "__main__":
    main()
