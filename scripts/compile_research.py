# -*- coding: utf-8 -*-
"""把 data/research-results/batch-*.json 汇总编译为 data/research-overrides.json，
供 scripts/gen_competition_seed.py 消费（官网修正 / 结构覆盖 / 显式时间节点）。

事件解析：研究产物中的 event 往往不带 stage（或带长注释），这里依据同一竞赛的
stagesByTrack（缺失时回落基线结构）+ label 关键词 + nodeType 语义，
把事件锚定到「track + 阶段名」，gen 脚本按 (track, name) 精确挂载。"""
import json
import os
import glob
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = os.path.join(ROOT, "data", "research-results")
BASELINE = os.path.join(ROOT, "data", "research-baseline", "all.json")
OUT = os.path.join(ROOT, "data", "research-overrides.json")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CONTEST_HINTS = ["资格赛", "初赛", "省赛", "复赛", "区域", "分赛区", "决赛", "答辩", "评审", "竞赛", "比赛", "会评", "汇评", "函评"]


VALID_NODE_TYPES = {"SIGNUP_START", "SIGNUP_END", "SUBMISSION", "CONTEST", "RESULT", "AWARD", "OTHER"}
# 代理偶发把阶段类型（REGIONAL/FINAL 等）当节点类型：阶段类型→比赛节点，评审→OTHER
STAGE_KIND_AS_NODE = {"CAMPUS", "QUALIFIER", "REGIONAL", "PROVINCIAL", "NATIONAL", "INTERNATIONAL", "FINAL"}


def fix_node_type(v):
    v = (v or "OTHER").strip().upper()
    if v in VALID_NODE_TYPES:
        return v
    if v in STAGE_KIND_AS_NODE:
        return "CONTEST"
    return "OTHER"


def norm_date(v):
    if not v:
        return None
    v = str(v).strip()
    return v if DATE_RE.match(v) else None


def build_chains(item, base_by_code):
    """结构链：研究覆盖优先，缺失的竞赛回落基线。返回 {trackCode或'shared': [stage,...]}。"""
    st = item.get("structure") or {}
    chains = st.get("stagesByTrack") or {}
    if chains:
        return chains
    code = item.get("code")
    base = base_by_code.get(code)
    if not base:
        return {}
    out = {}
    for s in base.get("stages", []):
        key = s.get("track") or "shared"
        out.setdefault(key, []).append({"name": s.get("name"), "kind": s.get("kind")})
    return out


def pick_chain(chains, ev, tracks):
    """选候选链：label 提到的赛道 > 指定 track > shared > 唯一链 > 首条链。"""
    label = (ev.get("label") or "") + " " + (ev.get("scope") or "")
    track = ev.get("track")
    if track in chains:
        return track, chains[track]
    for tcode in chains:
        tname = next((t.get("name", "") for t in (tracks or []) if t.get("code") == tcode), "")
        if tname and len(tname) >= 2 and (tname in label or label.strip() in tname):
            return tcode, chains[tcode]
    if "shared" in chains:
        return "shared", chains["shared"]
    if len(chains) == 1:
        k = next(iter(chains))
        return k, chains[k]
    if chains:
        k = next(iter(chains))
        return k, chains[k]
    return None, []


def resolve_stage(chain, ev):
    """在候选链内锚定阶段。返回 (stageName, warnReason|None)。"""
    track = ev.get("track")
    label = (ev.get("label") or "") + " " + (ev.get("scope") or "")
    stage_field = (ev.get("stage") or "").strip()
    node_type = ev.get("nodeType") or "OTHER"
    names = [s["name"] for s in chain if s.get("name")]
    if not names:
        return None, None

    def find(pred):
        for nm in names:
            if pred(nm):
                return nm
        return None

    if stage_field:
        hit = find(lambda nm: nm == stage_field) or find(lambda nm: stage_field in nm) or find(lambda nm: nm in stage_field)
        if hit:
            return hit, None if names[0] == stage_field else "stage 字段双向包含匹配"

    # label 中出现的层级关键词 → 阶段名含同关键词的第一个
    for hint in CONTEST_HINTS:
        if hint in label:
            hit = find(lambda nm: hint in nm)
            if hit:
                return hit, f"label 层级「{hint}」"

    # label 中出现阶段名片段（≥3 字）→ 包含该片段的阶段
    for nm in names:
        frag = nm[:4]
        if len(frag) >= 3 and frag in label:
            return nm, "label 阶段片段"

    # nodeType 语义兜底
    if node_type in ("SIGNUP_START", "SIGNUP_END"):
        return names[0], "nodeType 兜底→首阶段"
    if node_type in ("RESULT", "AWARD"):
        return names[-1], "nodeType 兜底→末阶段"
    # CONTEST/SUBMISSION：末阶段（默认理解为决赛/终审）
    return names[-1], "nodeType 兜底→末阶段"


def main():
    official, structures, events = {}, {}, {}
    skipped_dates, warns = [], []
    base_by_code = {c["code"]: c for c in json.load(open(BASELINE, encoding="utf-8"))}

    for path in sorted(glob.glob(os.path.join(RESULTS, "batch-*.json"))):
        batch = os.path.basename(path)
        try:
            items = json.load(open(path, encoding="utf-8"))
        except Exception as e:
            print(f"[跳过] {batch} 解析失败: {e}")
            continue
        for it in items:
            code = it.get("code")
            if not code:
                continue
            if it.get("officialUrl"):
                official[code] = it["officialUrl"].strip()

            st = it.get("structure") or {}
            tracks = st.get("tracks") or []
            chains_raw = st.get("stagesByTrack") or {}
            if tracks or chains_raw:
                structures[code] = {"tracks": tracks, "stagesByTrack": chains_raw}
            chains = build_chains(it, base_by_code)

            evs = []
            for ev in it.get("events", []):
                start, end = norm_date(ev.get("startAt")), norm_date(ev.get("endAt"))
                if not start and not end:
                    if ev.get("startAt") or ev.get("endAt"):
                        skipped_dates.append(f"{code}: {ev.get('label') or ev.get('nodeType')} → {ev.get('startAt') or ev.get('endAt')}")
                    continue
                tkey, chain = pick_chain(chains, ev, tracks)
                stage_name, warn = resolve_stage(chain, ev)
                if not stage_name:
                    warns.append(f"[{code}] 事件无法锚定阶段: {ev.get('label') or ev.get('nodeType')}")
                    continue
                if warn:
                    warns.append(f"[{code}] {ev.get('label') or ev.get('nodeType')} → {tkey}:{stage_name}（{warn}）")
                evs.append({
                    "stage": stage_name,
                    "track": None if tkey == "shared" else tkey,
                    "nodeType": fix_node_type(ev.get("nodeType")),
                    **({"startAt": start} if start else {}),
                    **({"endAt": end} if end else {}),
                    **({"label": ev["label"]} if ev.get("label") else {}),
                })
            events[code] = evs

    out = {"official": official, "structures": structures, "events": events}
    json.dump(out, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    n_ev = sum(len(v) for v in events.values())
    print(f"official: {len(official)} | structures: {len(structures)} | events: {len(events)} 组 / {n_ev} 条")
    print(f"写入: {OUT}")
    if skipped_dates:
        print("\n[非精确日期，未入库]")
        for s in skipped_dates:
            print(" -", s)


if __name__ == "__main__":
    main()
