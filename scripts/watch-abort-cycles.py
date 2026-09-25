"""🅢 발산 감시 v6 — 「라운드 상한이 «원리상» 못 보는 축」을 본다.

⛔ 왜 v3 로 부족한가(2026-08-26 실측): abort 보존 사이클마다 `rounds` 가 «0으로 리셋»된다.
   그래서 한 런이 사이클을 11번 돌아도 round 최댓값은 4 였다. 상한(3)이 볼 수 없다.
✅ 그래서 이 자는 «round 를 안 본다» — 런당 «서로 다른 abort 아티팩트 수»를 센다.
⛔ 픽스처를 뺀다(원장 URL 축 ⊕ 아티팩트 내용 리터럴 축 — 어느 하나로도 단독 판정 불가).
"""
import json,glob,os,time,sys

STATE='/tmp/.abort-cycle-watch.json'
FIXTURE_LITERALS={'failed','완료 보고가 사라짐','빌드 실패','ok','done'}
THRESHOLD=2   # 실런 정상은 1개다(64/66). 2 이상이면 본다.

def classify_ledger_body(ledger_body, read_artifact):
    if 'childSummaryArtifactPath' not in ledger_body:
        return ''
    if 'example.test' in ledger_body or 'example.com' in ledger_body:
        return ''

    paths=set(); reason=''
    for line in ledger_body.split('\n'):
        if 'childSummaryArtifactPath' not in line:
            continue
        try:
            entry=json.loads(line)
        except Exception:
            continue
        data=entry.get('data') or {}
        path=data.get('childSummaryArtifactPath')
        if path:
            paths.add(path)
            reason=data.get('reason') or reason

    real=set()
    for path in paths:
        try:
            content=read_artifact(path).strip()
        except Exception:
            real.add(path)
            continue
        if content not in FIXTURE_LITERALS:
            real.add(path)

    if len(real)<THRESHOLD:
        return ''
    return json.dumps({'n':len(real),'reason':reason[:110]}, ensure_ascii=False)

def scan():
    dirs=[os.path.expanduser('~/.monad/run-ledger')]+glob.glob(os.path.expanduser('~/source/*/*/.monad-test/run-ledger'))
    out={}
    for directory in dirs:
        for ledger_path in glob.glob(directory+'/*.jsonl'):
            try:
                ledger_body=open(ledger_path,encoding='utf-8',errors='ignore').read()
            except Exception:
                continue

            def read_artifact(path):
                return open(path,encoding='utf-8',errors='ignore').read()

            decision=classify_ledger_body(ledger_body, read_artifact)
            if decision:
                out[os.path.basename(ledger_path)[:-6]]=json.loads(decision)
    return out

def load():
    try: return json.load(open(STATE))
    except Exception: return {}

def watch():
    seen=load()
    while True:
        try:
            cur=scan()
            for rid,info in cur.items():
                prev=seen.get(rid,{}).get('n',0)
                if info['n']>prev:
                    print(f"🚨 [사이클] {rid[:24]} — abort 아티팩트 {info['n']}개 (임계 {THRESHOLD}) · {info['reason']}", flush=True)
                    seen[rid]=info
            json.dump(seen,open(STATE,'w'))
        except Exception as e:
            print(f"⚠️ [감시자] 훑기 실패(계속한다): {e}", flush=True)
        time.sleep(180)

if __name__ == '__main__':
    watch()
