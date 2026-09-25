# 안드로이드 시험을 «어떻게 돌리나»

> ✅ **2026-09-10 08:24 해소** — 대표 께서 **JDK 17 을 제거하고 기본을 21 로** 바꾸셨다.
> 📏 실측: `JAVA_HOME` 없이 맨손 `./gradlew` 로도 `ChatScreenLayoutTest` **41건 전부 통과**.
> ⇒ 아래 「환영」 절은 **이제 이 기계에서 재현되지 않는다.** 다만 ***왜 그 셋이 죽었는지***는 남긴다 —
> 다른 기계·CI 에서 같은 오류를 보면 이 문면이 30초 만에 답한다.

> ⭐ **한 줄**: ***`UnsupportedClassVersionError` 로 죽는 시험은 «코드 문제가 아니다» — JDK 판이 모자란 것이다.***
> 고치려 들면 시간을 버린다. ✅ 이 기계는 2026-09-10 에 기본이 21 이 되어 해소됐다.

---

## 🩸 실측 (2026-09-10 · 같은 밤에 자식 «둘»이 각각 밟았다)

```
./gradlew testDebugUnitTest --tests …ChatScreenLayoutTest
  → 41 tests, 3 failed
    messageBubbleShowsTheProviderThatAnsweredNotTheTitleSetting
    assistantMessageHasNoCopyControl
    modelBadgeShowsProviderAndModelWithoutReasoningPlaceholder
  → java.lang.UnsupportedClassVersionError:
      com/mikepenz/markdown/m3/MarkdownColorsKt has been compiled by a more recent
      version of the Java Runtime (class file version 65.0), this version of the
      Java Runtime only recognizes class file versions up to 61.0
```

**기전**: `com.mikepenz.markdown` 이 **Java 21(class 65)** 로 컴파일됐는데 이 기계의 **기본 `java` 는 17**(class 61 까지)이다. Robolectric 의 `SandboxClassLoader` 가 그 클래스를 못 읽는다.

```
JAVA_HOME="$(/usr/libexec/java_home -v 21)" ./gradlew testDebugUnitTest --tests …ChatScreenLayoutTest
  → BUILD SUCCESSFUL      (41건 «전부» 통과)
```

---

## ✅ 그래서 이렇게 돌린다

```bash
# ⭐ 1순위 — 게이트 러너. JDK 21 을 «스스로» 찾고, 두 변형(debug ⊕ release)을 다 돌리고,
#            「그 시험이 어느 변형에서 «실제로» 돌았나」까지 판정한다.
bun run scripts/ci-android-unit-tests.ts

# 2순위 — 한 시험만 빨리 볼 때.
#   ⚠️ 이 기계는 이제 기본이 JDK 21 이라 그냥 돌려도 된다.
#   ⛔ 기본이 21 이 «아닌» 기계에서는 JAVA_HOME 을 반드시 앞에 붙인다.
ANDROID_SERIAL=<대상기기> \
  ./gradlew   # 기본이 21 이 아니면 앞에 JAVA_HOME="$(/usr/libexec/java_home -v 21)" -p apps/android :app:testDebugUnitTest --tests '<FQCN>'
```

⛔ **`ANDROID_SERIAL` 도 «반드시»** — `connectedAndroidTest` 를 부르는 경로(게이트 포함)는 기본이 ***연결된 «모든» 기기***다. 사람이 쓰는 실기기가 붙어 있으면 그것까지 건드린다(2026-09-10 실측).

---

## 📌 이것이 «결손이 아니라 도달 실패»인 이유

이 사실은 **이미 두 곳에 적혀 있었다**:
- `내부 문서 `MANUAL-android-development-and-operations-2026-09-07`` 27~28행
- `scripts/ci-android-unit-tests.ts` 의 `classifyUnmeasurable()` — 그 오류를 보면 **정확한 조치를 문장으로 낸다**

🚨 그런데 **자식은 게이트 러너를 «안 부르고» 맨손 `gradlew` 를 쓴다.**
📏 실측: 그날 자식 하나가 맨손 `gradlew` **4회**, 게이트 러너 **0회**. ⇒ 그 안내문을 **볼 자리가 없었다.**

⇒ 🔑 그래서 이 줄이 **`docs/goal-context/`** 에 있다 — *"폴더가 계약이다"*(README). 관련도로 집히길 기대하지 않는다.
