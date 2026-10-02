#!/usr/bin/env python3
"""Run independent Python references over original synthetic data; never call Tangle.

Pinned references: ta 0.11.0, TA-Lib 0.8.1, numpy 2.5.3, pandas 3.0.6.
TA-Lib supplies the published ADX seed. ta supplies CCI, stochastic, SMA and
VWAP. Prefix-sized VWAP windows implement the declared cumulative convention;
each explicit reset starts a new prefix. Volume ratio excludes the current
volume from its reference mean. J is the declared 3K - 2D projection.
"""
import argparse
import hashlib
import json
import platform
from importlib.metadata import version
from pathlib import Path

try:
    import numpy as np
    import pandas as pd
    import ta
    import talib
except ImportError as error:
    raise SystemExit("Trading goldens require the pinned ta, TA-Lib, numpy and pandas references: " + str(error)) from error

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(__file__).resolve()
VERSIONS = {"ta": "0.11.0", "TA-Lib": "0.8.1", "numpy": "2.5.3", "pandas": "3.0.6"}
PARAMETERS = {"adxPeriod": 14, "cciPeriod": 20, "volumePeriod": 20, "kPeriod": 9, "dPeriod": 3, "jFactor": 3}
SIGNAL_PARAMETERS = {"price": "causal-adjusted-ohlc", "macd": {"fast": 12, "slow": 26, "signal": 9},
    "kdjRsi": {"k": 9, "d": 3, "rsi": 14, "entryJ": 20, "exitJ": 80, "entryRsi": 30, "exitRsi": 70},
    "meanReversion": {"window": 20, "deviations": 1, "deviation": "sample"}, "sma": {"fast": 5, "slow": 20}}


def finite(values):
    return [float(value) if np.isfinite(value) else None for value in values]


def cumulative_vwap(high, low, close, volume, resets):
    values, start = [], 0
    for i in range(len(close)):
        if resets[i]:
            start = i
        window = slice(start, i + 1)
        measured = ta.volume.VolumeWeightedAveragePrice(high[window], low[window], close[window], volume[window], window=i - start + 1)
        values.append(measured.volume_weighted_average_price().iloc[-1])
    return finite(values)


def reference_case(identity, inputs):
    high, low, close, volume = [pd.Series(inputs[key], dtype="float64") for key in ["high", "low", "close", "volume"]]
    stochastic = ta.momentum.StochasticOscillator(high, low, close, window=PARAMETERS["kPeriod"], smooth_window=PARAMETERS["dPeriod"])
    k, d = stochastic.stoch(), stochastic.stoch_signal()
    return {"id": identity, "input": inputs, "expected": {
        "adx": finite(talib.ADX(high, low, close, timeperiod=PARAMETERS["adxPeriod"])),
        "plusDI": finite(talib.PLUS_DI(high, low, close, timeperiod=PARAMETERS["adxPeriod"])),
        "minusDI": finite(talib.MINUS_DI(high, low, close, timeperiod=PARAMETERS["adxPeriod"])),
        "cci": finite(ta.trend.CCIIndicator(high, low, close, window=PARAMETERS["cciPeriod"]).cci()),
        "vwap": cumulative_vwap(high, low, close, volume, [False] * len(close)),
        "sessionVwap": cumulative_vwap(high, low, close, volume, inputs["resets"]),
        "volumeRatio": finite(volume / ta.trend.SMAIndicator(volume, window=PARAMETERS["volumePeriod"]).sma_indicator().shift(1)),
        "k": finite(k), "d": finite(d), "j": finite(PARAMETERS["jFactor"] * k - (PARAMETERS["jFactor"] - 1) * d),
    }}


def reference_signals(asset, rows):
    """Execute the declared policy predicates over independently measured kernels."""
    close = pd.Series([r["adjustedClose"] for r in rows], dtype="float64")
    factor = close / pd.Series([r["close"] for r in rows], dtype="float64")
    high = pd.Series([r["high"] for r in rows], dtype="float64") * factor
    low = pd.Series([r["low"] for r in rows], dtype="float64") * factor
    p = SIGNAL_PARAMETERS
    line = talib.EMA(close, timeperiod=p["macd"]["fast"]) - talib.EMA(close, timeperiod=p["macd"]["slow"])
    tail = talib.EMA(line.dropna(), timeperiod=p["macd"]["signal"])
    signal = tail.reindex(close.index)
    oscillator = ta.momentum.StochasticOscillator(high, low, close, window=p["kdjRsi"]["k"], smooth_window=p["kdjRsi"]["d"])
    k, d = oscillator.stoch(), oscillator.stoch_signal()
    j, strength = 3 * k - 2 * d, talib.RSI(close, timeperiod=p["kdjRsi"]["rsi"])
    fast, slow = talib.SMA(close, timeperiod=p["sma"]["fast"]), talib.SMA(close, timeperiod=p["sma"]["slow"])
    mean = close.rolling(p["meanReversion"]["window"]).mean()
    deviation = close.rolling(p["meanReversion"]["window"]).std(ddof=1)
    up = lambda a, b, i: i > 0 and np.isfinite(a[i - 1]) and np.isfinite(b[i - 1]) and a[i] > b[i] and a[i - 1] <= b[i - 1]
    down = lambda a, b, i: i > 0 and np.isfinite(a[i - 1]) and np.isfinite(b[i - 1]) and a[i] < b[i] and a[i - 1] >= b[i - 1]
    predicates = {
        "macdCross": (lambda i: np.isfinite(line[i]) and np.isfinite(signal[i]), lambda i: up(line, signal, i), lambda i: down(line, signal, i)),
        "kdjRsi": (lambda i: all(np.isfinite(x[i]) for x in [k, d, j, strength]),
            lambda i: up(k, d, i) and j[i] < p["kdjRsi"]["entryJ"] and strength[i] < p["kdjRsi"]["entryRsi"],
            lambda i: down(k, d, i) and j[i] > p["kdjRsi"]["exitJ"] and strength[i] > p["kdjRsi"]["exitRsi"]),
        "zeroMeanReversion": (lambda i: np.isfinite(mean[i]), lambda i: close[i] < mean[i] - p["meanReversion"]["deviations"] * deviation[i], lambda i: close[i] > mean[i]),
        "smaCross": (lambda i: np.isfinite(fast[i]) and np.isfinite(slow[i]), lambda i: up(fast, slow, i), lambda i: down(fast, slow, i)),
    }
    targets = {"buyAndHold": ["long"] * len(rows)}
    for name, (ready, enter, leave) in predicates.items():
        current, values = "flat", []
        for i in range(len(rows)):
            if not ready(i):
                values.append(None)
                continue
            if enter(i):
                current = "long"
            if leave(i):
                current = "flat"
            values.append(current)
        targets[name] = values
    crossings = {}
    for name, values in targets.items():
        crossings[name] = {"entries": sum(v == "long" and (i == 0 or values[i - 1] != "long") for i, v in enumerate(values)),
            "exits": sum(v == "flat" and i > 0 and values[i - 1] == "long" for i, v in enumerate(values))}
    return {"asset": asset, "targets": targets, "crossings": crossings}


def generate():
    actual = {name: version(name) for name in VERSIONS}
    if actual != VERSIONS:
        raise SystemExit("Trading reference versions differ: " + json.dumps(actual, sort_keys=True))
    source = ROOT / "benchmark/fixtures/trading/bars.json"
    bars = json.loads(source.read_text())
    cases, signals = [], []
    for asset in ["SYN-A", "SYN-B"]:
        rows = [bar for bar in bars if bar["asset"] == asset]
        inputs = {key: [bar[key] for bar in rows] for key in ["high", "low", "close", "volume"]}
        inputs["resets"] = [i % 40 == 0 for i in range(len(rows))]
        cases.append(reference_case(asset, inputs))
        signals.append(reference_signals(asset, rows))
    cases.append(reference_case("zero-volume", {"high": [11] * 40, "low": [9] * 40,
        "close": [10 + float(np.sin(i * .37)) / 10 for i in range(40)], "volume": [0] * 40, "resets": [i % 10 == 0 for i in range(40)]}))
    return {"format": "trading-indicators-reference/1", "reference": {"python": platform.python_version(), "packages": actual,
        "taLibrary": talib.__ta_version__.decode(), "generatorSha256": hashlib.sha256(SCRIPT.read_bytes()).hexdigest()},
        "source": {"path": source.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()},
        "parameters": PARAMETERS, "cases": cases, "signalParameters": SIGNAL_PARAMETERS, "signals": signals}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=ROOT / "test/fixtures/trading-indicators.json")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    output = json.dumps(generate(), indent=2, allow_nan=False) + "\n"
    if args.check:
        if args.out.read_text() != output:
            raise SystemExit("Trading indicator reference fixture drift")
    else:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(output)
    print("Verified 30 independent indicator vectors" if args.check else "Generated 30 independent indicator vectors")


if __name__ == "__main__":
    main()
