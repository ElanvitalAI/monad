#!/usr/bin/env python3
import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np


DEFAULT_MIN_AREA_RATIO = 0.08
DEFAULT_MIN_RECT_AREA_RATIO = 0.05
DEFAULT_DESKEW_THRESHOLD = 0.5


def order_points(pts):
    pts = np.array(pts, dtype="float32")
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1)
    return np.array([
        pts[np.argmin(s)],
        pts[np.argmin(diff)],
        pts[np.argmax(s)],
        pts[np.argmax(diff)],
    ], dtype="float32")


def four_point_transform(image, pts):
    rect = order_points(pts)
    (tl, tr, br, bl) = rect
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_width = max(int(round(max(width_a, width_b))), 10)
    max_height = max(int(round(max(height_a, height_b))), 10)
    dst = np.array(
        [[0, 0], [max_width - 1, 0], [max_width - 1, max_height - 1], [0, max_height - 1]],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, matrix, (max_width, max_height))
    if warped.shape[0] > warped.shape[1]:
        warped = cv2.rotate(warped, cv2.ROTATE_90_CLOCKWISE)
    return warped


def auto_trim(image, pad=8):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)[1]
    inv = 255 - thresh
    coords = cv2.findNonZero(inv)
    if coords is None:
        return image
    x, y, w, h = cv2.boundingRect(coords)
    x0 = max(0, x - pad)
    y0 = max(0, y - pad)
    x1 = min(image.shape[1], x + w + pad)
    y1 = min(image.shape[0], y + h + pad)
    return image[y0:y1, x0:x1]


def detect_contour_quad(image, min_area_ratio=DEFAULT_MIN_AREA_RATIO):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 60, 180)
    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.shape[0] * image.shape[1]

    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if area < image_area * min_area_ratio:
            continue
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
        if len(approx) == 4:
            return approx.reshape(4, 2), {"region_method": "contour_quad", "area_ratio": area / image_area}
    return None, {"region_method": None}


def detect_minrect(image, min_area_ratio=DEFAULT_MIN_RECT_AREA_RATIO):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 160)
    kernel = np.ones((5, 5), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=2)
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    image_area = image.shape[0] * image.shape[1]
    candidates = []

    for contour in contours:
        area = cv2.contourArea(contour)
        if area < image_area * min_area_ratio:
            continue
        rect = cv2.minAreaRect(contour)
        width, height = rect[1]
        if min(width, height) < 10:
            continue
        ratio = max(width, height) / min(width, height)
        if 1.2 <= ratio <= 2.4:
            candidates.append((area, cv2.boxPoints(rect)))

    if not candidates:
        return None, {"region_method": None}

    area, box = sorted(candidates, key=lambda item: item[0], reverse=True)[0]
    return box, {"region_method": "min_area_rect", "area_ratio": area / image_area}


def hough_deskew(image, threshold_degrees=DEFAULT_DESKEW_THRESHOLD):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 50, 150)
    min_length = max(min(image.shape[:2]) // 4, 20)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=80, minLineLength=min_length, maxLineGap=20)
    if lines is None:
        return image, None, False

    angles = []
    for line in lines[:, 0, :]:
        x1, y1, x2, y2 = line
        angle = math.degrees(math.atan2(y2 - y1, x2 - x1))
        while angle <= -90:
            angle += 180
        while angle > 90:
            angle -= 180
        if abs(angle) <= 30:
            angles.append(angle)

    if not angles:
        return image, None, False

    angle = float(np.median(angles))
    if abs(angle) < threshold_degrees:
        return image, angle, False

    height, width = image.shape[:2]
    matrix = cv2.getRotationMatrix2D((width / 2, height / 2), angle, 1.0)
    rotated = cv2.warpAffine(
        image,
        matrix,
        (width, height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )
    return rotated, angle, True


def process_image(image):
    meta = {
        "success": False,
        "used_original_fallback": False,
        "region_method": None,
        "deskew_angle": None,
        "deskew_applied": False,
        "trim_applied": False,
    }

    quad, quad_meta = detect_contour_quad(image)
    points = quad
    if points is not None:
        meta.update(quad_meta)
    else:
        box, box_meta = detect_minrect(image)
        points = box
        meta.update(box_meta)

    if points is None:
        meta["used_original_fallback"] = True
        meta["failure_reason"] = "no_card_region"
        return image, meta

    warped = four_point_transform(image, points)
    deskewed, angle, applied = hough_deskew(warped)
    trimmed = auto_trim(deskewed)

    meta["success"] = True
    meta["deskew_angle"] = angle
    meta["deskew_applied"] = applied
    meta["trim_applied"] = trimmed.shape[:2] != deskewed.shape[:2]
    meta["input_size"] = [int(image.shape[1]), int(image.shape[0])]
    meta["output_size"] = [int(trimmed.shape[1]), int(trimmed.shape[0])]
    return trimmed, meta


def main():
    parser = argparse.ArgumentParser(description="Crop/deskew/perspective-correct a business card image")
    parser.add_argument("input")
    parser.add_argument("--output", required=True)
    parser.add_argument("--meta-out")
    parser.add_argument("--stdout-json", action="store_true")
    args = parser.parse_args()

    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    if not input_path.exists():
        raise SystemExit(f"File not found: {input_path}")

    image = cv2.imread(str(input_path))
    if image is None:
        raise SystemExit(f"Failed to read image: {input_path}")

    processed, meta = process_image(image)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(output_path), processed)
    if not ok:
        raise SystemExit(f"Failed to write output: {output_path}")

    payload = {
        "input": str(input_path),
        "output": str(output_path),
        **meta,
    }

    if args.meta_out:
        meta_path = Path(args.meta_out).expanduser().resolve()
        meta_path.parent.mkdir(parents=True, exist_ok=True)
        meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if args.stdout_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(output_path)

    sys.exit(0 if meta.get("success") else 2)


if __name__ == "__main__":
    main()
