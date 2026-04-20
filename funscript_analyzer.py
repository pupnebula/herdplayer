"""
funscript_analyzer.py
Analyzes funscript files (or a whole folder) and extracts unique repeating
pattern loops with descriptive auto-generated names.

Usage:
    python funscript_analyzer.py input.funscript
    python funscript_analyzer.py ./scripts_folder --export-loops -o ./patterns
    python funscript_analyzer.py input.funscript --export-loops --min-correlation 0.75
    python funscript_analyzer.py ./folder --window 15 --min-period 0.4 --max-period 20
"""

import json
import argparse
import os
import sys
import numpy as np
from scipy import signal as scipy_signal


# ---------------------------------------------------------------------------
# I/O helpers
# ---------------------------------------------------------------------------

def load_funscript(path: str) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save_funscript(path: str, actions: list, source_meta: dict = None):
    data = {
        "version": "1.0",
        "range": 100,
        "inverted": False,
        "actions": sorted(actions, key=lambda a: a["at"]),
    }
    if source_meta:
        data["metadata"] = source_meta
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)


def find_funscripts(input_path: str) -> list:
    """Return list of .funscript paths from a file or folder."""
    if os.path.isfile(input_path):
        return [input_path]
    if os.path.isdir(input_path):
        found = []
        for entry in sorted(os.listdir(input_path)):
            if entry.lower().endswith(".funscript"):
                found.append(os.path.join(input_path, entry))
        return found
    return []


def extract_segment(actions: list, start_ms: int, end_ms: int, zero_offset: bool = True) -> list:
    """Return actions within [start_ms, end_ms], optionally normalised to t=0."""
    seg = [a for a in actions if start_ms <= a["at"] <= end_ms]
    if zero_offset and seg:
        off = seg[0]["at"]
        seg = [{"pos": a["pos"], "at": a["at"] - off} for a in seg]
    return seg


# ---------------------------------------------------------------------------
# Signal processing
# ---------------------------------------------------------------------------

def resample(actions: list, interval_ms: int = 50):
    """Linearly interpolate actions onto a uniform time grid."""
    times = np.array([a["at"] for a in actions], dtype=float)
    positions = np.array([a["pos"] for a in actions], dtype=float)
    t = np.arange(times[0], times[-1] + interval_ms, interval_ms)
    pos = np.interp(t, times, positions)
    return t, pos


def autocorrelation(sig: np.ndarray) -> np.ndarray:
    """Return normalised autocorrelation (positive lags only)."""
    s = sig - sig.mean()
    n = len(s)
    corr = np.correlate(s, s, mode="full")[n - 1:]
    if corr[0] > 0:
        corr = corr / corr[0]
    return corr


def find_dominant_period(
    sig: np.ndarray,
    sample_ms: int,
    min_period_ms: float,
    max_period_ms: float,
    min_peak_height: float = 0.25,
) -> tuple:
    """
    Return (period_ms, confidence) for the strongest repeating period,
    or (None, 0) if nothing clear is found.
    """
    corr = autocorrelation(sig)
    lo = max(1, int(min_period_ms / sample_ms))
    hi = min(int(max_period_ms / sample_ms), len(corr) - 1)
    if lo >= hi:
        return None, 0.0

    region = corr[lo:hi]
    peaks, props = scipy_signal.find_peaks(
        region, height=min_peak_height, prominence=0.08
    )
    if len(peaks) == 0:
        return None, 0.0

    best = peaks[np.argmax(props["peak_heights"])]
    period_samples = best + lo
    period_ms = period_samples * sample_ms
    confidence = float(corr[period_samples])
    return float(period_ms), confidence


def segment_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Normalised cross-correlation similarity between two equal-length arrays."""
    a = a - a.mean()
    b = b - b.mean()
    sa, sb = a.std(), b.std()
    if sa == 0 or sb == 0:
        return 0.0
    return float(np.dot(a, b) / (len(a) * sa * sb))


# ---------------------------------------------------------------------------
# Pattern region detection
# ---------------------------------------------------------------------------

def detect_pattern_regions(
    t: np.ndarray,
    pos: np.ndarray,
    sample_ms: int,
    window_ms: float = 10_000,
    step_ms: float = 5_000,
    min_period_ms: float = 400,
    max_period_ms: float = 30_000,
    min_confidence: float = 0.3,
    period_tolerance: float = 0.15,
) -> list:
    """
    Slide a window across the signal; for each window find the dominant period.
    Consecutive windows sharing a similar period are merged into one region.
    Each region: {start_ms, end_ms, period_ms, confidence, n_cycles}
    """
    window_samples = int(window_ms / sample_ms)
    step_samples = max(1, int(step_ms / sample_ms))

    windows = []
    i = 0
    while i + window_samples <= len(pos):
        chunk = pos[i : i + window_samples]
        t_start = float(t[i])
        t_end = float(t[min(i + window_samples - 1, len(t) - 1)])
        period_ms, conf = find_dominant_period(
            chunk, sample_ms, min_period_ms, max_period_ms
        )
        windows.append(
            dict(start_ms=t_start, end_ms=t_end, period_ms=period_ms, confidence=conf)
        )
        i += step_samples

    regions = []
    for w in windows:
        if w["period_ms"] is None or w["confidence"] < min_confidence:
            if regions and regions[-1].get("_open"):
                regions[-1]["_open"] = False
            regions.append(
                dict(
                    start_ms=w["start_ms"], end_ms=w["end_ms"],
                    period_ms=None, confidence=0.0, n_cycles=0, _open=False,
                )
            )
            continue

        if (
            regions and regions[-1]["_open"]
            and regions[-1]["period_ms"] is not None
            and abs(regions[-1]["period_ms"] - w["period_ms"]) / regions[-1]["period_ms"]
            <= period_tolerance
        ):
            r = regions[-1]
            n = r.get("_n", 1)
            r["period_ms"] = (r["period_ms"] * n + w["period_ms"]) / (n + 1)
            r["_n"] = n + 1
            r["confidence"] = max(r["confidence"], w["confidence"])
            r["end_ms"] = w["end_ms"]
        else:
            if regions and regions[-1].get("_open"):
                regions[-1]["_open"] = False
            regions.append(
                dict(
                    start_ms=w["start_ms"], end_ms=w["end_ms"],
                    period_ms=w["period_ms"], confidence=w["confidence"],
                    n_cycles=0, _open=True, _n=1,
                )
            )

    clean = []
    for r in regions:
        r.pop("_open", None)
        r.pop("_n", None)
        if r["period_ms"] is not None:
            r["n_cycles"] = round((r["end_ms"] - r["start_ms"]) / r["period_ms"], 1)
        clean.append(r)

    return clean


# ---------------------------------------------------------------------------
# Loop extraction
# ---------------------------------------------------------------------------

def find_best_loop(
    actions: list,
    region: dict,
    t: np.ndarray,
    pos: np.ndarray,
    sample_ms: int,
    min_correlation: float = 0.75,
):
    """
    Within a repeating region, find the single period that best represents the
    pattern.  Returns a dict with start_ms, end_ms, correlation, actions (t=0),
    or None if nothing qualifies.
    """
    period_ms = region["period_ms"]
    if period_ms is None:
        return None

    period_samples = int(period_ms / sample_ms)
    mask = (t >= region["start_ms"]) & (t <= region["end_ms"])
    t_r, pos_r = t[mask], pos[mask]

    if len(pos_r) < period_samples * 2:
        return None

    template = pos_r[:period_samples]
    best_corr, best_idx = -1.0, 0

    for i in range(0, len(pos_r) - period_samples, max(1, period_samples // 8)):
        corr = segment_similarity(template, pos_r[i : i + period_samples])
        if corr > best_corr:
            best_corr, best_idx = corr, i

    if best_corr < min_correlation:
        return None

    loop_start_ms = int(t_r[best_idx])
    loop_end_ms = int(t_r[min(best_idx + period_samples, len(t_r) - 1)])
    loop_actions = extract_segment(actions, loop_start_ms, loop_end_ms, zero_offset=True)

    return dict(
        start_ms=loop_start_ms,
        end_ms=loop_end_ms,
        correlation=best_corr,
        actions=loop_actions,
    )


# ---------------------------------------------------------------------------
# Fingerprinting & deduplication
# ---------------------------------------------------------------------------

FINGERPRINT_POINTS = 64  # resolution for shape comparison


def fingerprint_loop(actions: list) -> np.ndarray:
    """
    Resample loop to a fixed number of points and normalise to [0, 1].
    Returns None if the loop has no meaningful range.
    """
    times = np.array([a["at"] for a in actions], dtype=float)
    positions = np.array([a["pos"] for a in actions], dtype=float)
    if len(times) < 2:
        return None
    t_u = np.linspace(times[0], times[-1], FINGERPRINT_POINTS)
    pos_u = np.interp(t_u, times, positions)
    rng = pos_u.max() - pos_u.min()
    if rng < 1e-3:
        return None
    return (pos_u - pos_u.min()) / rng


def max_circular_similarity(fp_a: np.ndarray, fp_b: np.ndarray) -> float:
    """
    Maximum cross-correlation over all circular phase shifts.
    Handles patterns that start at different points in the cycle.
    """
    n = len(fp_a)
    a = fp_a - fp_a.mean()
    b = fp_b - fp_b.mean()
    sa, sb = a.std(), b.std()
    if sa < 1e-6 or sb < 1e-6:
        return 0.0
    a /= sa
    b /= sb
    # FFT cross-correlation gives all circular shifts in O(n log n)
    fa = np.fft.rfft(a, n=n * 2)
    fb = np.fft.rfft(b, n=n * 2)
    cross = np.fft.irfft(fa * np.conj(fb))[:n]
    return float(cross.max() / n)


def deduplicate_loops(candidates: list, period_tol: float = 0.15, shape_thresh: float = 0.95) -> list:
    """
    Cluster loop candidates by (period × shape).  Returns one representative
    per cluster — the one with the highest correlation score.

    Each candidate must have: period_ms, correlation, fingerprint (np.ndarray or None).
    """
    # Sort best first so the representative is the highest-quality instance
    ranked = sorted(candidates, key=lambda c: c["correlation"], reverse=True)

    clusters = []  # list of lists of candidate indices

    for idx, cand in enumerate(ranked):
        fp = cand["fingerprint"]
        period = cand["period_ms"]
        placed = False

        for cluster in clusters:
            rep = ranked[cluster[0]]
            # Period must be within tolerance
            if abs(rep["period_ms"] - period) / rep["period_ms"] > period_tol:
                continue
            # Shape must be similar (try both normal and phase-inverted)
            if fp is None or rep["fingerprint"] is None:
                continue
            sim = max_circular_similarity(fp, rep["fingerprint"])
            # Also check against the inverted version (same motion, flipped start/end)
            sim_inv = max_circular_similarity(fp, rep["fingerprint"][::-1])
            if max(sim, sim_inv) >= shape_thresh:
                cluster.append(idx)
                placed = True
                break

        if not placed:
            clusters.append([idx])

    # Return the representative (index 0 in each cluster = highest correlation)
    unique = []
    for cluster in clusters:
        rep = ranked[cluster[0]]
        rep["n_sources"] = len(cluster)
        rep["source_files"] = list({ranked[i]["source_file"] for i in cluster})
        unique.append(rep)

    return unique


# ---------------------------------------------------------------------------
# Auto-naming
# ---------------------------------------------------------------------------

def detect_stroke_groups(pos_u: np.ndarray, depth_range: float) -> list:
    """
    Identify groups of strokes separated by pauses within one cycle.

    Strategy: collect all turning points (peaks + valleys), measure gaps between
    them, and treat any gap >2.5× the median as a pause.  Count the peaks in
    each resulting burst and return the list of counts, e.g. [3, 2] means
    "3 strokes, pause, 2 strokes".
    """
    prominence_thresh = max(5.0, depth_range * 0.20)
    peaks, _   = scipy_signal.find_peaks( pos_u, prominence=prominence_thresh)
    valleys, _ = scipy_signal.find_peaks(-pos_u, prominence=prominence_thresh)

    n_peaks = len(peaks)
    if n_peaks == 0:
        return [0]
    if n_peaks == 1:
        return [1]

    # All turning points in sample-index order
    all_tp = sorted(list(peaks) + list(valleys))
    if len(all_tp) < 2:
        return [n_peaks]

    gaps = np.diff(all_tp).astype(float)
    median_gap = float(np.median(gaps))
    if median_gap < 1:
        return [n_peaks]

    pause_thresh = median_gap * 2.5

    # Split turning points into bursts at every long gap
    peak_set = set(peaks.tolist())
    bursts, current = [], [all_tp[0]]
    for i in range(1, len(all_tp)):
        if all_tp[i] - all_tp[i - 1] > pause_thresh:
            bursts.append(current)
            current = [all_tp[i]]
        else:
            current.append(all_tp[i])
    bursts.append(current)

    # Count peaks per burst; drop empty bursts
    stroke_counts = [sum(1 for tp in b if tp in peak_set) for b in bursts]
    stroke_counts = [c for c in stroke_counts if c > 0]
    return stroke_counts if stroke_counts else [n_peaks]


def describe_loop(actions: list, period_ms: float) -> str:
    """
    Generate a descriptive name for a loop based on:
      speed    — strokes per minute bracket
      depth    — position range amplitude
      rhythm   — stroke-group sequence, e.g. "3-2" (3 strokes, pause, 2 strokes)
      bias     — whether motion is concentrated high or low
    """
    if not actions:
        return "unknown"

    times = np.array([a["at"] for a in actions], dtype=float)
    positions = np.array([a["pos"] for a in actions], dtype=float)

    # Resample to 128 points for smooth analysis
    n = 128
    t_u = np.linspace(times[0], times[-1], n)
    pos_u = np.interp(t_u, times, positions)

    # --- Speed ---
    spm = 60_000.0 / period_ms
    if spm <= 20:
        speed = "crawl"
    elif spm <= 35:
        speed = "slow"
    elif spm <= 55:
        speed = "medium"
    elif spm <= 80:
        speed = "fast"
    else:
        speed = "sprint"

    # --- Depth (amplitude) ---
    depth_range = float(pos_u.max() - pos_u.min())
    if depth_range <= 20:
        depth = "minimal"
    elif depth_range <= 45:
        depth = "shallow"
    elif depth_range <= 70:
        depth = "mid"
    else:
        depth = "deep"

    # --- Stroke rhythm ---
    groups = detect_stroke_groups(pos_u, depth_range)
    if len(groups) == 1:
        n_s = groups[0]
        if n_s == 0:
            rhythm_tag = "_glide"
        elif n_s == 1:
            rhythm_tag = "_single"
        elif n_s == 2:
            rhythm_tag = "_double"
        elif n_s == 3:
            rhythm_tag = "_triple"
        else:
            rhythm_tag = f"_{n_s}x"
    else:
        # Encode each burst count joined by "-", e.g. [3,2] → "_3-2"
        rhythm_tag = "_" + "-".join(str(g) for g in groups)

    # --- Position bias ---
    mean_pos = float(pos_u.mean())
    if mean_pos > 65:
        bias_tag = "_top"
    elif mean_pos < 35:
        bias_tag = "_bottom"
    else:
        bias_tag = ""

    return f"{speed}_{depth}{rhythm_tag}{bias_tag}"


def make_unique_name(base_name: str, used_names: set) -> str:
    """Append a numeric suffix if the name is already taken."""
    if base_name not in used_names:
        return base_name
    i = 2
    while f"{base_name}_{i}" in used_names:
        i += 1
    return f"{base_name}_{i}"


# ---------------------------------------------------------------------------
# Per-file processing
# ---------------------------------------------------------------------------

def collect_loops_from_file(path: str, args) -> list:
    """
    Load one funscript, detect repeating regions, extract one loop per region.
    Returns a list of candidate dicts ready for deduplication.
    """
    try:
        data = load_funscript(path)
    except Exception as e:
        print(f"  [!] Could not load {path}: {e}")
        return []

    actions = data.get("actions", [])
    if len(actions) < 4:
        print(f"  [!] Too few actions in {path}, skipping.")
        return []

    t, pos = resample(actions, args.sample_rate)

    regions = detect_pattern_regions(
        t, pos,
        sample_ms=args.sample_rate,
        window_ms=args.window * 1000,
        step_ms=args.step * 1000,
        min_period_ms=args.min_period * 1000,
        max_period_ms=args.max_period * 1000,
        min_confidence=args.min_confidence,
        period_tolerance=args.period_tolerance,
    )

    candidates = []
    for r in regions:
        # Require the pattern to repeat at least min_cycles times in the region
        if r["n_cycles"] < args.min_cycles:
            continue
        loop = find_best_loop(
            actions, r, t, pos,
            sample_ms=args.sample_rate,
            min_correlation=args.min_correlation,
        )
        if loop is None:
            continue
        # Require at least two distinct action points in the extracted loop
        if len(loop["actions"]) < 2:
            continue
        fp = fingerprint_loop(loop["actions"])
        candidates.append(dict(
            actions=loop["actions"],
            period_ms=r["period_ms"],
            correlation=loop["correlation"],
            fingerprint=fp,
            source_file=os.path.basename(path),
            region_start_ms=r["start_ms"],
            n_cycles=r["n_cycles"],
        ))

    return candidates


# ---------------------------------------------------------------------------
# Reporting helpers
# ---------------------------------------------------------------------------

def fmt_ms(ms: float) -> str:
    s = int(ms) // 1000
    ms_p = int(ms) % 1000
    m, s = divmod(s, 60)
    return f"{m:02d}:{s:02d}.{ms_p:03d}"


def print_unique_report(unique_loops: list):
    col_w = 34
    print("\n" + "=" * 80)
    print(f"{'#':>3}  {'Name':<{col_w}}  {'Period':>7}  {'SPM':>5}  {'Qual':>5}  Sources")
    print("-" * 80)
    for i, lp in enumerate(unique_loops, start=1):
        period = lp["period_ms"]
        spm = 60_000 / period
        name = lp.get("name", "?")
        sources = ", ".join(lp.get("source_files", [lp["source_file"]]))
        n = lp.get("n_sources", 1)
        src_str = f"{sources}" if n == 1 else f"{sources}  (x{n} instances)"
        print(
            f"{i:>3}  {name:<{col_w}}  {period:>6.0f}ms  {spm:>4.0f}  "
            f"{lp['correlation']:>5.2f}  {src_str}"
        )
    print("=" * 80)
    print()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Analyze funscript file(s) and extract unique repeating pattern loops.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input",
        help="Input .funscript file or folder containing .funscript files")
    parser.add_argument("--output-dir", "-o", default=None,
        help="Directory for exported files (default: ./patterns next to input)")
    parser.add_argument("--export-loops", action="store_true",
        help="Save each unique loop as a .funscript file")
    parser.add_argument("--export-regions", action="store_true",
        help="Also save the full raw region around each unique loop")
    parser.add_argument("--window", type=float, default=10.0,
        help="Analysis window size in seconds (default: 10)")
    parser.add_argument("--step", type=float, default=5.0,
        help="Window step size in seconds (default: 5)")
    parser.add_argument("--min-period", type=float, default=0.4,
        help="Minimum pattern period in seconds (default: 0.4)")
    parser.add_argument("--max-period", type=float, default=30.0,
        help="Maximum pattern period in seconds (default: 30)")
    parser.add_argument("--min-confidence", type=float, default=0.30,
        help="Min autocorrelation confidence to count as repeating (default: 0.30)")
    parser.add_argument("--min-correlation", type=float, default=0.75,
        help="Min similarity to accept a loop candidate (default: 0.75)")
    parser.add_argument("--period-tolerance", type=float, default=0.15,
        help="Period similarity tolerance for merging regions (default: 0.15)")
    parser.add_argument("--dedup-threshold", type=float, default=0.80,
        help="Shape similarity threshold for deduplication (default: 0.80)")
    parser.add_argument("--min-cycles", type=float, default=2.0,
        help="Minimum number of full cycles a pattern must repeat to be kept (default: 2.0)")
    parser.add_argument("--sample-rate", type=int, default=50,
        help="Resampling interval in ms (default: 50)")
    args = parser.parse_args()

    # --- Resolve inputs ---
    paths = find_funscripts(args.input)
    if not paths:
        print(f"Error: no .funscript files found at: {args.input}", file=sys.stderr)
        sys.exit(1)

    # --- Resolve output dir ---
    if args.output_dir:
        out_dir = args.output_dir
    elif os.path.isdir(args.input):
        out_dir = os.path.join(args.input, "patterns")
    else:
        out_dir = os.path.join(os.path.dirname(os.path.abspath(args.input)), "patterns")
    os.makedirs(out_dir, exist_ok=True)

    # --- Process each file ---
    print(f"\nAnalyzing {len(paths)} file(s)...\n")
    all_candidates = []

    for idx, path in enumerate(paths, start=1):
        fname = os.path.basename(path)
        print(f"  [{idx}/{len(paths)}] {fname}")
        candidates = collect_loops_from_file(path, args)
        print(f"          -> {len(candidates)} loop candidate(s)")
        all_candidates.extend(candidates)

    if not all_candidates:
        print("\nNo repeating patterns found across any files.")
        print("Try lowering --min-confidence or --min-correlation.")
        sys.exit(0)

    # --- Deduplicate ---
    print(f"\nDeduplicating {len(all_candidates)} candidate(s)...")
    unique_loops = deduplicate_loops(
        all_candidates,
        period_tol=args.period_tolerance,
        shape_thresh=args.dedup_threshold,
    )
    removed = len(all_candidates) - len(unique_loops)
    print(f"  {len(unique_loops)} unique pattern(s)  ({removed} duplicate(s) removed)")

    # --- Name each unique loop ---
    used_names = set()
    for lp in unique_loops:
        base = describe_loop(lp["actions"], lp["period_ms"])
        name = make_unique_name(base, used_names)
        used_names.add(name)
        lp["name"] = name

    # --- Report ---
    print_unique_report(unique_loops)

    # --- Export ---
    if not (args.export_loops or args.export_regions):
        print("No files exported. Use --export-loops or --export-regions to save results.")
        return

    exported = 0
    for lp in unique_loops:
        name = lp["name"]
        meta = dict(
            name=name,
            period_ms=lp["period_ms"],
            strokes_per_min=round(60_000 / lp["period_ms"], 1),
            quality=round(lp["correlation"], 3),
            source_files=lp.get("source_files", [lp["source_file"]]),
            n_instances=lp.get("n_sources", 1),
        )

        if args.export_loops:
            out_path = os.path.join(out_dir, f"{name}.funscript")
            save_funscript(out_path, lp["actions"], source_meta=meta)
            print(f"  Saved loop  : {out_path}")
            exported += 1

        if args.export_regions:
            # Re-load source file to get the full region slice
            src_path = next(
                (p for p in paths if os.path.basename(p) == lp["source_file"]), None
            )
            if src_path:
                try:
                    src_data = load_funscript(src_path)
                    start_ms = lp["region_start_ms"]
                    end_ms = start_ms + lp["period_ms"] * max(lp.get("n_cycles", 1), 1)
                    seg_actions = extract_segment(
                        src_data["actions"], int(start_ms), int(end_ms), zero_offset=True
                    )
                    out_path = os.path.join(out_dir, f"{name}_full_region.funscript")
                    save_funscript(out_path, seg_actions, source_meta=meta)
                    print(f"  Saved region: {out_path}")
                    exported += 1
                except Exception as e:
                    print(f"  [!] Could not export region for {name}: {e}")

    print(f"\nExported {exported} file(s) to: {out_dir}")


if __name__ == "__main__":
    main()
