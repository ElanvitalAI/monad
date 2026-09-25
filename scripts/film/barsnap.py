"""
마디 스냅 — 음악의 BPM 을 «타이밍 계약»으로 쓴다.

⭐ 한 줄: 컷 시각을 임의의 소수로 적지 않는다. 마디 배수로만 짠다.
📚 근거·함정 = docs/manual/MANUAL-script-driven-film-production-2026-09-16.md §5a-④

쓰는 법
    from barsnap import Track, plan_bars
    t = Track.from_manifest("Rethinking Strategies")      # ES manifest 에서 BPM 을 읽는다
    V = plan_bars(t, [("K1_hook.mov", 2), ("B_ring.mp4", 4), ...])
    # → [("K1_hook.mov", 0.0, 3.75), ("B_ring.mp4", 3.75, 7.5), ...]
"""
from __future__ import annotations
import json, os, subprocess, re
from dataclasses import dataclass

MANIFEST = os.path.expanduser("~/Media/ES/inbox/manifest.json")


@dataclass
class Track:
    title: str
    bpm: float
    duration: float           # 초
    file: str
    source: str = "unknown"

    @property
    def bar(self) -> float:
        """1마디 길이(초) — 4/4 기준."""
        return 60.0 / self.bpm * 4.0

    @property
    def bars(self) -> float:
        return self.duration / self.bar

    @classmethod
    def from_manifest(cls, title_or_id: str, manifest: str = MANIFEST) -> "Track":
        """⭐ BPM 을 «추정하지 않는다» — Epidemic Sound 가 메타로 준 값을 읽는다."""
        rows = json.load(open(manifest))
        for r in rows:
            if title_or_id in (r.get("title"), r.get("id")):
                return cls(r["title"], float(r["bpm"]), r["durationMs"] / 1000.0,
                           r["file"], r.get("source", "epidemic-sound"))
        raise KeyError(f"manifest 에 없다: {title_or_id} (행 {len(rows)}개)")

    @classmethod
    def from_audio(cls, path: str) -> "Track":
        """⛔ 폴백 — BPM 메타가 «없는» 생성 트랙에만 쓴다. 추정값이므로 정수가 아니다.
        📏 실측 대조: 같은 트랙을 요청 124 BPM 으로 만들었는데 추정은 120.19 였다."""
        import numpy as np
        SR, H, N = 22050, 256, 1024
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1",
                              "-ar", str(SR), "-f", "f32le", "-"],
                             capture_output=True).stdout
        x = np.frombuffer(raw, dtype=np.float32)
        frames = 1 + (x.size - N) // H
        win = np.hanning(N)
        S = np.empty((frames, N // 2 + 1), dtype=np.float32)
        for i in range(frames):
            S[i] = np.abs(np.fft.rfft(x[i * H:i * H + N] * win))
        flux = np.maximum(0, np.diff(S, axis=0)).sum(1)
        flux = (flux - flux.mean()) / (flux.std() + 1e-9)
        fps = SR / H
        ac = np.correlate(flux, flux, mode="full")[len(flux) - 1:]
        lo, hi = int(fps * 60 / 180), int(fps * 60 / 60)
        bpm = 60 * fps / (lo + int(np.argmax(ac[lo:hi])))
        while bpm < 80: bpm *= 2
        while bpm > 170: bpm /= 2
        dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                                    "format=duration", "-of", "csv=p=0", path],
                                   capture_output=True, text=True).stdout)
        return cls(os.path.basename(path), round(bpm, 2), dur, path, "estimated")


def plan_bars(track: Track, beats):
    """[(파일, 마디수), ...] → [(파일, 시작초, 길이초), ...]

    ⛔ 마디 수는 «정수»여야 한다 — 소수를 주면 컷이 음악과 어긋난다.
    """
    for name, n in beats:
        if int(n) != n or n <= 0:
            raise ValueError(f"마디 수는 양의 정수여야 한다: {name}={n}")
    bar, t, out = track.bar, 0.0, []
    for name, n in beats:
        d = n * bar
        out.append((name, round(t, 4), round(d, 4)))
        t += d
    total_bars = sum(n for _, n in beats)
    if t > track.duration + 1e-6:
        raise ValueError(f"계획 {t:.3f}초({total_bars}마디)가 트랙 {track.duration:.3f}초보다 길다")
    return out


def report(track: Track, plan) -> str:
    total = sum(d for _, _, d in plan)
    lines = [f"{track.title} · {track.bpm:g} BPM ({track.source}) · 1마디 {track.bar:.4f}초",
             f"트랙 {track.duration:.3f}초 = {track.bars:.2f}마디 · 계획 {total:.3f}초 = {total/track.bar:.1f}마디"]
    for n, s, d in plan:
        lines.append(f"  {n:<18} {s:7.3f}  +{d:6.3f}  ({d/track.bar:.0f}마디)")
    return "\n".join(lines)


if __name__ == "__main__":
    import sys
    t = Track.from_manifest(sys.argv[1] if len(sys.argv) > 1 else "Rethinking Strategies")
    p = plan_bars(t, [("K1_hook.mov",2),("K2_oneline.mov",2),("B_ring.mp4",4),
                      ("K3_outputs.mov",3),("B_merge.mp4",4),("K4_tracks.mov",2),
                      ("K5_number.mov",2),("HF_arch.mp4",5),("K6_end.mov",3)])
    print(report(t, p))
