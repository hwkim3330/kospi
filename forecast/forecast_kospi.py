"""Daily TimesFM-3 zero-shot forecast of KOSPI (and a few large caps).

Downloads daily closes with FinanceDataReader (Naver source, Yahoo fallback),
forecasts the next 20 trading days with TimesFM 3.0 (median + q10/q90), runs a
rolling-origin backtest over the last ~12 months, and writes
`forecast/forecast.json`, which the Worker serves at /api/forecast.

Model: google/timesfm-3.0-pytorch. Code Apache-2.0; the 3.0 weights are under
timesfm-non-commercial-license-v1.0 (non-commercial, non-production use only).
This is a personal/research dashboard, not investment advice.

Usage:  python forecast/forecast_kospi.py [--no-backtest]
Env:    TIMESFM_BACKEND=torch|mlx|auto (default auto: MLX on Apple silicon, else torch CPU)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from importlib.metadata import version

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "forecast.json")
CKPT = "google/timesfm-3.0-pytorch"
HORIZON = 20
CONTEXT = 1024          # trading days of history fed to the model
HISTORY_OUT = 120       # trading days of history written to JSON for the chart
BT_DAYS = 250           # backtest window (~12 months)
BT_STEP = 5             # a new forecast origin every 5 trading days
SERIES = [
    # (key, display name, FinanceDataReader symbols tried in order)
    ("KOSPI", "코스피", ["NAVER:KOSPI", "YAHOO:^KS11", "KS11"]),
    ("005930", "삼성전자", ["NAVER:005930", "005930"]),
    ("000660", "SK하이닉스", ["NAVER:000660", "000660"]),
]


def load_close(symbols: list[str], start: str) -> pd.Series:
    import FinanceDataReader as fdr
    best = None
    for sym in symbols:
        try:
            d = fdr.DataReader(sym, start)
            s = d["Close"].astype(float).dropna()
            s = s[s > 0]
            if len(s) and (best is None or s.index.max() > best.index.max()):
                best = s
        except Exception as e:  # try the next source
            print(f"  {sym}: {e}", file=sys.stderr)
    if best is None:
        raise RuntimeError(f"no data for {symbols}")
    best.index = pd.to_datetime(best.index).tz_localize(None).normalize()
    return best[~best.index.duplicated(keep="last")].sort_index()


def next_trading_days(last: pd.Timestamp, n: int) -> list[str]:
    """Approximate KRX calendar: weekdays minus Korean public holidays and Dec 31."""
    import holidays
    kr = holidays.KR(years=range(last.year, last.year + 2))
    out, d = [], last.date()
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() < 5 and d not in kr and not (d.month == 12 and d.day == 31):
            out.append(d.isoformat())
    return out


def load_model():
    backend = os.environ.get("TIMESFM_BACKEND", "auto")
    if backend in ("auto", "mlx"):
        try:
            from timesfm3.mlx import TimesFM3Forecaster
            f = TimesFM3Forecaster.from_pretrained(CKPT)
            return (lambda ctxs, h: list(f.predict_batch(ctxs, horizon=h, return_quantiles=True))), "mlx"
        except Exception as e:
            if backend == "mlx":
                raise
            print(f"MLX unavailable ({type(e).__name__}); using torch CPU", file=sys.stderr)
    import torch
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    from timesfm3 import ModelConfig, TimesFM3Evaluator
    f = TimesFM3Evaluator(ModelConfig(checkpoint_path=CKPT, per_core_batch_size=16, device="cpu"))
    return (lambda ctxs, h: list(f.predict_batch(ctxs, horizon=h, return_quantiles=True,
                                                 use_symmetric_averaging=False))), "torch-cpu"


def backtest(predict, s: np.ndarray) -> dict:
    origins = list(range(len(s) - BT_DAYS, len(s) - HORIZON + 1, BT_STEP))
    ctxs = [s[max(0, o - CONTEXT):o].astype(np.float32) for o in origins]
    outs = predict(ctxs, HORIZON)
    res = {}
    for h in (5, 20):
        ok = [o for o in origins if o + h - 1 < len(s)]
        y = np.array([s[o + h - 1] for o in ok])
        last = np.array([s[o - 1] for o in ok])
        med = np.array([outs[i].forecast[h - 1] for i in range(len(ok))])
        q10 = np.array([outs[i].quantiles[h - 1, 0] for i in range(len(ok))])
        q90 = np.array([outs[i].quantiles[h - 1, 8] for i in range(len(ok))])
        res[f"h{h}"] = dict(
            n=len(ok),
            coverage_q10_q90=round(float(np.mean((y >= q10) & (y <= q90))), 3),
            mape_median_pct=round(float(np.mean(np.abs(med - y) / y) * 100), 2),
            mape_naive_pct=round(float(np.mean(np.abs(last - y) / y) * 100), 2),
            mean_band_width_pct=round(float(np.mean((q90 - q10) / last) * 100), 2),
            direction_hit_rate=round(float(np.mean(np.sign(med - last) == np.sign(y - last))), 3),
        )
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-backtest", action="store_true")
    args = ap.parse_args()

    start = (date.today() - timedelta(days=int(CONTEXT * 1.6) + 400)).isoformat()
    predict, backend = load_model()
    series_out = {}
    for key, name, syms in SERIES:
        s = load_close(syms, start)
        vals = s.values
        out = predict([vals[-CONTEXT:].astype(np.float32)], HORIZON)[0]
        q = out.quantiles
        entry = dict(
            name=name,
            last_date=s.index[-1].date().isoformat(),
            last_close=round(float(vals[-1]), 2),
            history=[[d.date().isoformat(), round(float(v), 2)] for d, v in s.iloc[-HISTORY_OUT:].items()],
            forecast=dict(
                dates=next_trading_days(s.index[-1], HORIZON),
                median=[round(float(v), 2) for v in out.forecast],
                q10=[round(float(v), 2) for v in q[:, 0]],
                q90=[round(float(v), 2) for v in q[:, 8]],
            ),
        )
        for h in (5, 20):
            entry[f"h{h}"] = dict(
                date=entry["forecast"]["dates"][h - 1],
                median=entry["forecast"]["median"][h - 1],
                q10=entry["forecast"]["q10"][h - 1],
                q90=entry["forecast"]["q90"][h - 1],
                median_change_pct=round((float(out.forecast[h - 1]) / vals[-1] - 1) * 100, 2),
            )
        if not args.no_backtest:
            bt = backtest(predict, vals)
            bt["window"] = dict(start=s.index[len(vals) - BT_DAYS].date().isoformat(),
                                end=s.index[-1].date().isoformat())
            entry["backtest"] = bt
        series_out[key] = entry
        print(key, entry["last_date"], entry["last_close"], entry["h5"], entry["h20"], entry.get("backtest"))

    doc = dict(
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        model=CKPT,
        model_version="TimesFM 3.0",
        timesfm_package=version("timesfm"),
        backend=backend,
        context_days=CONTEXT,
        horizon_days=HORIZON,
        quantiles="q10/q50/q90 of the TimesFM quantile head",
        data_source="FinanceDataReader (Naver Finance, Yahoo fallback), daily close",
        license_note="TimesFM 3.0 weights: timesfm-non-commercial-license-v1.0 (non-commercial, non-production)",
        disclaimer="투자 권유가 아닌 연구용 실험입니다. 모델 예측은 불확실하며 손실 책임은 이용자에게 있습니다.",
        series=series_out,
    )
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    print("wrote", OUT, os.path.getsize(OUT), "bytes")


if __name__ == "__main__":
    main()
