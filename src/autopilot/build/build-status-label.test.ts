import { describe, expect, it } from "bun:test";
import { formatBuildStatus } from "./build-status-label";

describe("formatBuildStatus", () => {
  it("maps disarmed", () => {
    expect(formatBuildStatus("disarmed")).toBe("🔒 미무장(대기)");
  });

  it("maps no-approved", () => {
    expect(formatBuildStatus("no-approved")).toBe("⬜ 승인 대기");
  });

  it("maps built", () => {
    expect(formatBuildStatus("built")).toBe("✅ 구현 완료(PR)");
  });

  it("maps gate-failed", () => {
    expect(formatBuildStatus("gate-failed")).toBe("❌ 무결성 실패");
  });

  it("maps impl-failed", () => {
    expect(formatBuildStatus("impl-failed")).toBe("⚠️ 구현 실패");
  });

  it("maps core-violation", () => {
    expect(formatBuildStatus("core-violation")).toBe("⛔ 불변코어 위반");
  });

  it("falls back to ❓ + status for unknown status", () => {
    expect(formatBuildStatus("weird")).toBe("❓ weird");
    expect(formatBuildStatus("")).toBe("❓ ");
  });
});
