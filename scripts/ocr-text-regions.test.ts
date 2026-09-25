import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const script = readFileSync(join(import.meta.dir, 'ocr-text-regions.swift'), 'utf8');

test('ocr-text-regions uses the macOS Vision source verbatim', () => {
  expect(script).toBe(`import Foundation
import Vision
import AppKit
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    print("ERR load"); exit(1)
}
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["ko-KR", "en-US"]
req.usesLanguageCorrection = true
try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
let obs = req.results ?? []
print("regions=\\(obs.count)")
for o in obs { if let t = o.topCandidates(1).first { print(String(format: "  %.2f  %@", t.confidence, t.string)) } }
`);
});
