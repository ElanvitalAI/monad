#!/usr/bin/env python3
"""Per-shot focus measurement for the video QC recipe.

focus_peak — how sharp the sharpest part of a shot is:
  sample up to 8 frames evenly (an image counts as one frame), resize to height 540,
  split each frame into a 6x10 grid, take the Laplacian variance of every cell,
  take each frame's 95th percentile, and report the median across frames.

Why the peak and not the whole-frame variance (2026-09-24, S measurement): a
shallow-depth close-up has a blurred background by design, so whole-frame variance
put healthy close-ups (44-68) level with blurred controls. The sharpest cells keep
them apart (healthy close-up 239-256 vs gblur=3 controls 36-208).

Output: one JSON line {"results": [{"path": ..., "focus_peak": number | null,
"frames": n, "face_frames": n, "face_center_x": number | null}]}.
A path that cannot be read yields null — "not measured", never 0.
"""
import json
import sys

import cv2
import numpy as np

FRAMES = 8
HEIGHT = 540
GRID_Y, GRID_X = 10, 6


def frames_of(path):
    image = cv2.imread(path)
    if image is not None:
        return [image]
    capture = cv2.VideoCapture(path)
    if not capture.isOpened():
        return []
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    total = total or 1
    picks = [int((i + 0.5) * total / FRAMES) for i in range(FRAMES)]
    frames = []
    for index in picks:
        capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        ok, frame = capture.read()
        if ok and frame is not None:
            frames.append(frame)
    capture.release()
    return frames


def focus_peak(frames):
    # 🅢 프로토타입(~/tmp/cv-prototype/cv_focus.py)과 «같은 자» — 문턱(<100)이 이 자로 잰 값이다(2026-09-24 대조):
    #   컬러로 높이 540 에 맞춘 뒤 회색조 · 프레임 «전체»에 Laplacian · 세로 10 × 가로 6 칸 분산 ·
    #   프레임마다 95 백분위 → 프레임들의 중앙값. (첫 판은 칸마다 Laplacian · 6×10 · 모은 칸 한 번에 95% 라 값이 갈렸다.)
    peaks = []
    for frame in frames:
        height, width = frame.shape[:2]
        if height == 0 or width == 0:
            continue
        resized = cv2.resize(frame, (int(width * HEIGHT / height), HEIGHT))
        lap = cv2.Laplacian(cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY), cv2.CV_64F)
        rows, cols = lap.shape
        tiles = [lap[y * rows // GRID_Y:(y + 1) * rows // GRID_Y, x * cols // GRID_X:(x + 1) * cols // GRID_X].var()
                 for y in range(GRID_Y) for x in range(GRID_X)]
        peaks.append(float(np.percentile(tiles, 95)))
    if not peaks:
        return None
    return float(np.median(peaks))


def face_center(frames, cascade):
    centers = []
    for frame in frames:
        height, width = frame.shape[:2]
        if height == 0 or width == 0:
            continue
        resized = cv2.resize(frame, (int(width * HEIGHT / height), HEIGHT))
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
        if len(faces):
            x, _, w, _ = max(faces, key=lambda face: face[2] * face[3])
            centers.append((x + w / 2) / gray.shape[1])
    return len(centers), float(np.median(centers)) if centers else None


def main(paths):
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    results = []
    for path in paths:
        frames = frames_of(path)
        peak = focus_peak(frames) if frames else None
        face_frames, face_center_x = face_center(frames, cascade) if frames and not cascade.empty() else (0, None)
        results.append({"path": path, "focus_peak": None if peak is None else round(peak, 1),
                        "frames": len(frames), "face_frames": face_frames, "face_center_x": face_center_x})
    print(json.dumps({"results": results}))


if __name__ == "__main__":
    main(sys.argv[1:])
