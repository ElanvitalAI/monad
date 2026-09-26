#!/usr/bin/env python3
# ── KR 가격 히스토리 백필 (pykrx · 2026-07-08) ────────────────────────────
#
# EODHD가 KR 종목 대부분 미지원(404·6종목만) → pykrx(KRX 무료·전종목)로 백필.
# 종목 코드를 stdin(줄바꿈)으로 받아 과거 N년 OHLCV → screener.db(prices).
# INSERT OR IGNORE(멱등). 사용: echo "005930\n000660" | python3 backfill-kr-pykrx.py [years]

import sys
import os
import sqlite3
from datetime import datetime, timedelta

try:
    from pykrx import stock
except ImportError:
    print("pykrx 미설치 — pip install pykrx", file=sys.stderr)
    sys.exit(1)

DB = os.path.expanduser("~/.elanous/conatus/screener.db")
years = int(sys.argv[1]) if len(sys.argv) > 1 else 2
codes = [ln.strip() for ln in sys.stdin if ln.strip()]
if not codes:
    print("codes 없음(stdin)", file=sys.stderr)
    sys.exit(0)

to = datetime.now().strftime("%Y%m%d")
frm = (datetime.now() - timedelta(days=365 * years)).strftime("%Y%m%d")

conn = sqlite3.connect(DB)
conn.execute("CREATE TABLE IF NOT EXISTS prices(date TEXT, code TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL, PRIMARY KEY(date,code))")
ins = "INSERT OR IGNORE INTO prices(date,code,open,high,low,close,volume) VALUES (?,?,?,?,?,?,?)"

done = hit = rows = 0
for code in codes:
    try:
        df = stock.get_market_ohlcv_by_date(frm, to, code)
        if df is not None and len(df):
            hit += 1
            for idx, r in df.iterrows():
                d = str(idx)[:10]  # Timestamp → 'YYYY-MM-DD'
                conn.execute(ins, (d, code, float(r["시가"]), float(r["고가"]), float(r["저가"]), float(r["종가"]), float(r["거래량"])))
                rows += 1
            conn.commit()
    except Exception as e:
        print(f"skip {code}: {e}", file=sys.stderr)
    done += 1
    if done % 20 == 0:
        print(f"KR pykrx {done}/{len(codes)} · hit {hit} · rows {rows}", file=sys.stderr)

conn.close()
print(f"pykrx 백필 완료: {done}종목 · 가격있음 {hit} · {rows}행")
