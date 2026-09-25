#!/usr/bin/env python3
"""DaVinci Resolve — 브이로그 타임라인 «조립 · 되읽기 · 렌더» (vlog-found-footage-pipeline 의 후반 셋).

    python3 scripts/video/vlog_resolve.py build    --spec spec.json
    python3 scripts/video/vlog_resolve.py readback --project P --timeline T --target-frames N
    python3 scripts/video/vlog_resolve.py render   --project P --timeline T --out-dir D --name master

산출은 stdout «마지막 줄»의 JSON 하나다. 종료코드:
    0 = 했다 · 3 = 리졸브에 «못 붙었다»(app-silent — 실패가 아니라 「못 쟀다」) · 1 = 했는데 틀렸다/거부됐다

⭐ 이 파일의 규칙은 전부 2026-09-19 실물 작업(~/Movies/DKReview/03_생성/sb_resolve.py)에서 «잰» 것이다:
  ⓐ AppendToTimeline 은 «트랙 끝»에 붙는다 ⇒ recordFrame 을 «항상» 준다.
  ⓑ endFrame 은 «배타적»이다 — head+body-1 을 주면 컷마다 1프레임 틈 → 검정 깜빡임 22회였다.
  ⓒ 합성 모드 상수를 외워 적지 않는다 ⇒ resolve.COMPOSITE_* 를 «읽어서» 쓴다.
  ⓓ 전환은 «핸들»을 먹는다 — 컷은 앞뒤 핸들을 달고 온다(extract-cuts-with-handles).
  ⓔ 기존 프로젝트를 «덮지 않는다» — 현재 판을 저장하고 «새 이름»으로 만든다.
"""
import argparse, json, os, sys, time
from pathlib import Path
from typing import NoReturn

API = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
os.environ.setdefault("RESOLVE_SCRIPT_API", API)
os.environ.setdefault("RESOLVE_SCRIPT_LIB",
    "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so")
sys.path.insert(0, str(Path(API) / "Modules"))

TRANS_FRAMES = {"dissolve": 20, "match-cut": 8}


def emit(obj: dict, code: int) -> NoReturn:
    print(json.dumps(obj, ensure_ascii=False))
    sys.exit(code)


def attach():
    try:
        import DaVinciResolveScript as dvr  # noqa: E402
    except Exception as e:  # noqa: BLE001
        emit({"ok": False, "attached": False, "why": f"스크립팅 모듈을 못 읽었다: {e}"}, 3)
    r = dvr.scriptapp("Resolve")
    if not r:
        emit({"ok": False, "attached": False,
              "why": "Resolve 에 못 붙었다 — 앱이 떠 있고 «환경설정 → 시스템 → 외부 스크립팅»이 켜져 있어야 한다"}, 3)
    return r


def open_timeline(resolve, project: str, timeline: str):
    pm = resolve.GetProjectManager()
    proj = pm.LoadProject(project) if (pm.GetCurrentProject() is None or pm.GetCurrentProject().GetName() != project) else pm.GetCurrentProject()
    if not proj:
        emit({"ok": False, "attached": True, "why": f"프로젝트 «{project}» 를 못 열었다"}, 1)
    for i in range(1, (proj.GetTimelineCount() or 0) + 1):
        tl = proj.GetTimelineByIndex(i)
        if tl and tl.GetName() == timeline:
            proj.SetCurrentTimeline(tl)
            return pm, proj, tl
    emit({"ok": False, "attached": True, "why": f"타임라인 «{timeline}» 이 «{project}» 에 없다"}, 1)


def cmd_build(a) -> None:
    spec = json.loads(Path(a.spec).read_text(encoding="utf-8"))
    fps, w, h = spec["fps"], spec["width"], spec["height"]
    cuts, layers, music = spec["cuts"], spec.get("layers", []), spec.get("music")
    nframes = sum(c["body"] for c in cuts)
    files = [c["path"] for c in cuts] + [l["path"] for l in layers] + ([music] if music else [])
    missing = [f for f in files if not Path(f).exists()]
    if missing:
        emit({"ok": False, "attached": None, "why": f"소재가 없다: {missing[:3]}"}, 1)

    resolve = attach()
    pm = resolve.GetProjectManager()
    COMP = {"normal": resolve.COMPOSITE_NORMAL, "screen": resolve.COMPOSITE_SCREEN,
            "overlay": resolve.COMPOSITE_OVERLAY}

    # ⓔ 보존 — 현재 판을 저장한다. 못 하면 여기서 멈춘다(덮어쓸 위험을 지지 않는다).
    cur = pm.GetCurrentProject()
    if cur and not pm.SaveProject():
        emit({"ok": False, "attached": True, "why": f"현재 프로젝트 «{cur.GetName()}» 를 저장 못 했다 — 멈춘다"}, 1)

    base = spec.get("project_name", "vlog")
    name, n = base, 1
    while True:
        proj = pm.CreateProject(name)
        if proj:
            break
        n += 1
        name = f"{base}_v{n}"
        if n > 99:
            emit({"ok": False, "attached": True, "why": "프로젝트 이름을 못 정했다"}, 1)
    proj.SetSetting("timelineFrameRate", str(fps))
    proj.SetSetting("timelineResolutionWidth", str(w))
    proj.SetSetting("timelineResolutionHeight", str(h))

    ms, pool = resolve.GetMediaStorage(), proj.GetMediaPool()
    items = ms.AddItemListToMediaPool(files) or []
    by = {Path(it.GetClipProperty("File Path") or "").as_posix(): it for it in items}
    by_name = {Path(k).name: v for k, v in by.items()}

    def item(p: str):
        return by.get(Path(p).as_posix()) or by_name.get(Path(p).name)

    miss = [f for f in files if item(f) is None]
    if miss:
        emit({"ok": False, "attached": True, "project": name, "why": f"풀에 안 들어온 소재: {miss[:3]}"}, 1)

    tl = pool.CreateEmptyTimeline(spec.get("timeline_name", "본편"))
    if not tl:
        emit({"ok": False, "attached": True, "project": name, "why": "타임라인을 못 만들었다"}, 1)
    proj.SetCurrentTimeline(tl)
    t0 = tl.GetStartFrame()

    # V1 — 컷(본편 구간만 · 핸들은 전환이 먹는다) · ⓐ recordFrame · ⓑ endFrame 배타
    reqs, pos = [], 0
    for c in cuts:
        reqs.append({"mediaPoolItem": item(c["path"]), "startFrame": c["head"],
                     "endFrame": c["head"] + c["body"], "trackIndex": 1, "recordFrame": t0 + pos})
        pos += c["body"]
    if not pool.AppendToTimeline(reqs):
        emit({"ok": False, "attached": True, "project": name, "why": "컷을 못 얹었다"}, 1)

    # 전환 — «들어오는» 전환: 앞 컷의 끝에 가운데 정렬
    v1 = sorted(tl.GetItemListInTrack("video", 1) or [], key=lambda x: x.GetStart())
    made, failed = 0, []
    for idx, c in enumerate(cuts):
        nf = TRANS_FRAMES.get(c.get("trans") or "")
        if not nf or idx == 0 or idx - 1 >= len(v1):
            continue
        t = v1[idx - 1].AddTransition({"type": "Cross Dissolve", "category": "simple",
                                       "position": "end", "alignment": "center", "duration": nf})
        if t:
            made += 1
        else:
            failed.append(idx)

    # V2+ — 레이어 · ⓒ 합성 모드는 «읽어서»
    layer_report = []
    for L in layers:
        ti = tl.GetTrackCount("video") + 1
        tl.AddTrack("video")
        it = item(L["path"])
        src_len = int(it.GetClipProperty("Frames") or 0)
        if src_len <= 0:
            emit({"ok": False, "attached": True, "project": name, "why": f"레이어 길이를 못 읽었다: {L['path']}"}, 1)
        lreqs, p = [], 0
        while p < nframes:
            take = min(src_len, nframes - p)
            lreqs.append({"mediaPoolItem": it, "startFrame": 0, "endFrame": take,
                          "trackIndex": ti, "recordFrame": t0 + p})
            p += take
            if not L.get("loop", True):
                break
        pool.AppendToTimeline(lreqs)
        placed = tl.GetItemListInTrack("video", ti) or []
        for x in placed:
            x.SetProperty("CompositeMode", COMP.get(L.get("mode", "normal"), resolve.COMPOSITE_NORMAL))
            if float(L.get("opacity", 100.0)) != 100.0:
                x.SetProperty("Opacity", float(L["opacity"]))
        tl.SetTrackName("video", ti, L.get("name", f"V{ti}"))
        span = [min(x.GetStart() for x in placed) - t0, max(x.GetEnd() for x in placed) - t0] if placed else [0, 0]
        layer_report.append({"name": L.get("name"), "track": ti, "pieces": len(placed), "span": span})

    if music:
        ai = tl.GetTrackCount("audio") + 1
        tl.AddTrack("audio")
        pool.AppendToTimeline([{"mediaPoolItem": item(music), "startFrame": 0, "endFrame": nframes,
                                "mediaType": 2, "trackIndex": ai, "recordFrame": t0}])
        tl.SetTrackName("audio", ai, "BGM(더킹됨)")

    pm.SaveProject()
    emit({"ok": True, "attached": True, "project": name, "timeline": tl.GetName(),
          "planned_frames": nframes, "transitions_made": made, "transitions_failed": failed,
          "layers": layer_report}, 0)


def cmd_readback(a) -> None:
    resolve = attach()
    _, _, tl = open_timeline(resolve, a.project, a.timeline)
    t0 = tl.GetStartFrame()
    items = sorted(tl.GetItemListInTrack("video", 1) or [], key=lambda x: x.GetStart())
    # ⛔ 전환은 트랙 아이템 목록에 «섞여» 올 수도, 안 올 수도 있다 — 판마다 다르다. 둘 다 받는다.
    vids = [x for x in items if (getattr(x, "GetType", None) is None) or x.GetType() != "transition"]
    trs = [x for x in items if getattr(x, "GetType", None) and x.GetType() == "transition"]
    gaps, prev = [], None
    for it in vids:
        s_, e_ = it.GetStart() - t0, it.GetEnd() - t0
        if prev is not None and s_ != prev:
            gaps.append([it.GetName(), prev, s_])
        prev = e_
    end = tl.GetEndFrame() - t0
    lens = sorted(set(x.GetEnd() - x.GetStart() for x in trs))
    emit({"ok": True, "attached": True, "cuts": len(vids), "gaps": gaps,
          "transition_lens": lens, "end_frame": end, "target_frames": a.target_frames}, 0)


def cmd_render(a) -> None:
    resolve = attach()
    _, proj, tl = open_timeline(resolve, a.project, a.timeline)
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    resolve.OpenPage("deliver")
    if not proj.SetCurrentRenderFormatAndCodec("mp4", "H264"):
        emit({"ok": False, "attached": True, "why": "렌더 포맷 mp4/H264 를 못 정했다"}, 1)
    if not proj.SetRenderSettings({"SelectAllFrames": True, "TargetDir": str(out), "CustomName": a.name}):
        emit({"ok": False, "attached": True, "why": "렌더 설정을 못 넣었다"}, 1)
    job = proj.AddRenderJob()
    if not job:
        emit({"ok": False, "attached": True, "why": "렌더 잡을 못 만들었다"}, 1)
    if not proj.StartRendering(job):
        emit({"ok": False, "attached": True, "why": "렌더를 못 시작했다"}, 1)
    t_start, deadline = time.time(), time.time() + a.timeout
    while proj.IsRenderingInProgress():
        if time.time() > deadline:
            proj.StopRendering()
            emit({"ok": False, "attached": True, "why": f"렌더가 {a.timeout}s 안에 안 끝났다"}, 1)
        time.sleep(1.0)
    st = proj.GetRenderJobStatus(job) or {}
    master = out / f"{a.name}.mp4"
    if st.get("JobStatus") != "Complete" or not master.exists():
        emit({"ok": False, "attached": True, "why": f"렌더 상태 {st} · 파일 {'있음' if master.exists() else '없음'}"}, 1)
    try:
        proj.DeleteRenderJob(job)
    except Exception:  # noqa: BLE001
        pass
    emit({"ok": True, "attached": True, "master": str(master), "secs": round(time.time() - t_start, 1)}, 0)


def cmd_ping(_a) -> None:
    """붙기만 한다 — 「Resolve 에 명령을 낼 수 있나」를 값으로(0 붙음 · 3 못 붙음). 프로젝트를 열지 않는다."""
    r = attach()
    emit({"ok": True, "attached": True, "version": r.GetVersionString()}, 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build"); b.add_argument("--spec", required=True)
    r = sub.add_parser("readback"); r.add_argument("--project", required=True); r.add_argument("--timeline", required=True)
    r.add_argument("--target-frames", type=int, required=True)
    x = sub.add_parser("render"); x.add_argument("--project", required=True); x.add_argument("--timeline", required=True)
    x.add_argument("--out-dir", required=True); x.add_argument("--name", default="master")
    x.add_argument("--timeout", type=int, default=1800)
    sub.add_parser("ping")
    a = ap.parse_args()
    {"build": cmd_build, "readback": cmd_readback, "render": cmd_render, "ping": cmd_ping}[a.cmd](a)


if __name__ == "__main__":
    main()
