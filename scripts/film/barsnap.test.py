#!/usr/bin/env python3
"""barsnap 반증 — python3 scripts/film/barsnap.test.py

⛔ 이 파일이 있는 이유: `Track.from_audio()` 가 저장소 어디서도 «안 불려서»
   dead addition 이라는 리뷰 지적(#18564)을 받았다. 폴백은 «실제 경우»가 있어서
   남기지만, 안 불리면 썩는다 — 그래서 시험이 부른다.
"""
import os, subprocess, sys, tempfile, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from barsnap import Track, plan_bars, report

FAILED = []
def check(name, fn):
    try:
        fn(); print(f"  ✅ {name}")
    except AssertionError as e:
        FAILED.append(name); print(f"  ⛔ {name} — {e}")
    except Exception as e:
        FAILED.append(name); print(f"  ⛔ {name} — {type(e).__name__}: {e}")

def sine_wav(path, bpm, seconds=8.0, sr=22050):
    """클릭을 BPM 간격으로 찍은 WAV — from_audio 가 그 주기를 되찾아야 한다."""
    beat = 60.0 / bpm
    clicks = ",".join(f"sin(2*PI*1200*t)*exp(-40*mod(t\\,{beat:.6f}))" for _ in [0])
    subprocess.run(["ffmpeg", "-v", "error", "-f", "lavfi",
                    "-i", f"aevalsrc={clicks}:s={sr}:d={seconds}",
                    "-ac", "1", path, "-y"], check=True)

def t_bar_math():
    t = Track("x", 128, 60.0, "-", "test")
    assert abs(t.bar - 1.875) < 1e-9, t.bar
    assert abs(t.bars - 32.0) < 1e-6, t.bars

def t_plan_is_exact():
    t = Track("x", 128, 60.0, "-", "test")
    p = plan_bars(t, [("a", 2), ("b", 4), ("c", 3)])
    assert [d for _, _, d in p] == [3.75, 7.5, 5.625], p
    assert p[1][1] == 3.75 and p[2][1] == 11.25, p

def t_rejects_fractional_bars():
    t = Track("x", 128, 60.0, "-", "test")
    try: plan_bars(t, [("a", 2.5)])
    except ValueError: return
    raise AssertionError("소수 마디가 통과했다")

def t_rejects_overrun():
    t = Track("x", 128, 60.0, "-", "test")
    try: plan_bars(t, [("a", 40)])
    except ValueError: return
    raise AssertionError("트랙 초과가 통과했다")

def t_from_audio_recovers_bpm():
    """🔻 폴백이 «실제로» 돈다 — 120 BPM 클릭을 넣으면 그 근처를 돌려준다."""
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "click.wav")
        sine_wav(p, 120)
        t = Track.from_audio(p)
        assert t.source == "estimated", t.source      # ⛔ 추정임이 «표시»되어야 한다
        assert abs(t.bpm - 120) < 6, f"추정 {t.bpm}"
        assert 7.0 < t.duration < 9.0, t.duration

def t_from_audio_is_marked_not_authoritative():
    """⛔ 추정 트랙과 메타 트랙이 «같은 값»으로 접히지 않는다."""
    meta = Track("m", 128, 60.0, "-", "epidemic-sound")
    est  = Track("e", 128, 60.0, "-", "estimated")
    assert meta.source != est.source
    assert "estimated" in report(est, plan_bars(est, [("a", 2)]))

CHECKS = [("bar 계산", t_bar_math), ("계획이 정확하다", t_plan_is_exact),
          ("소수 마디를 거부한다", t_rejects_fractional_bars),
          ("트랙 초과를 거부한다", t_rejects_overrun),
          ("from_audio 가 BPM 을 되찾는다", t_from_audio_recovers_bpm),
          ("추정임이 표시된다", t_from_audio_is_marked_not_authoritative)]
for nm, fn in CHECKS:
    check(nm, fn)

# ⛔ 고정 문면("6/6")을 밖에서 대조하면 반증을 «늘릴 때» 래퍼가 깨진다 —
#    통과 수를 세는 목적은 유지하되 «구조화된 한 줄»로 낸다(리뷰 지적 · #18571).
TOTAL = len(CHECKS)
PASSED = TOTAL - len(FAILED)
print(f"\n{PASSED}/{TOTAL} 통과")
print("BARSNAP_SUMMARY " + json.dumps(
    {"total": TOTAL, "passed": PASSED, "failed": FAILED,
     "names": [n for n, _ in CHECKS]}, ensure_ascii=False))
sys.exit(1 if FAILED else 0)
