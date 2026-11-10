#!/usr/bin/env python3
"""
Closing-line value (CLV) and calibration for the track record.

  python clv.py [--history board/history.csv] [--raw raw]

The CLOSE of a pick is the bookie consensus (closes.py: every bookie's price with its margin removed, averaged)
from each bookie's LAST snapshot taken before the game's tip, and only if that snapshot is no more than
CLOSE_WINDOW minutes before the tip (a morning price is not a close). The lineup watch re-collects every few
minutes before each tip, so its snapshots are the closes. Snapshots are kept across sessions in the site repo
(closes_sync.py save / restore, run by run_daily.sh), so the evening run can close the day's picks too (8 Nov 2026).
  close_prob = consensus fair chance at the pick's own line (same line > same ladder rung > nearby line moved)
  clv_pct    = our odds x close_prob - 1   (the standard measure: did we beat the market's final view?)
  close_odds = our bookie's own closing price for the same selection, when it still had it (price CLV)
  close_src  = 'same line (n)', 'rung (n)', 'shifted (n)'
Old estimates for ladder bets (alt lines / threes rungs priced off the main line with a normal curve) are removed:
they were not a close (29 Oct 2026). Pending picks with no qualifying close have their close cleared.
Writes close columns into history.csv and board/calibration.csv (by category, bet type and trigger).
"""
import argparse, csv, math, os
from closes import all_snapshots, tips, quotes_at, consensus, hhmm_minus, game_code

CLOSE_WINDOW = 45          # minutes before tip
LADDER_CATS = ("Alt line", "Threes", "Steals", "Blocks")
NEW_COLS = ("close_src", "close_line", "close_prob", "clv_pct", "close_odds", "close_min")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", default="board/history.csv")
    ap.add_argument("--raw", default="raw")
    ap.add_argument("--calib", default="board/calibration.csv")
    a = ap.parse_args()
    hist = list(csv.DictReader(open(a.history)))
    cols = list(hist[0].keys()) if hist else []
    for c in NEW_COLS:
        if c not in cols:
            cols.append(c)
    S = all_snapshots(a.raw)      # raw/ + raw/closes/ (snapshots other sessions saved to the site repo)
    T = {d: tips(v) for d, v in S.items()}
    qcache = {}
    fixed = 0
    for h in hist:
        if h["kind"] in ("multi", "fb", "combo"):
            continue
        # one-time clean-up: ladder bets whose old "close" was a normal-curve estimate from the main line
        if h.get("close_src") == "sportsbet" and h.get("category") in LADDER_CATS and h.get("close_line") not in ("", h.get("line")):
            for c in ("close_src", "close_line", "close_prob", "clv_pct"):
                h[c] = ""
            h["close_src"] = "removed: estimate"; fixed += 1
        d = h["date"]
        g = game_code(h["game"])
        tip = T.get(d, {}).get(g) if g else None
        c = None
        if tip and d in S:
            key = (d, tip)
            if key not in qcache:
                qcache[key] = quotes_at(S[d], before=tip.replace(":", ""), after=hhmm_minus(tip, CLOSE_WINDOW))
            Q, when = qcache[key]
            if Q.books:
                c = consensus(h, Q)
                if c:
                    th, tm = map(int, tip.split(":"))
                    last = max(when.values())
                    c["min"] = th * 60 + tm - (int(last[:2]) * 60 + int(last[2:]))
        if c:
            h["close_src"] = f"{c['src']} ({c['n']})"
            h["close_line"] = c["line"]
            h["close_prob"] = round(c["prob"] * 100, 1)
            h["clv_pct"] = round((float(h["odds"]) * c["prob"] - 1) * 100, 1)
            h["close_odds"] = c["own_odds"] or ""
            h["close_min"] = c["min"]
        elif h["result"] == "pending" and not str(h.get("close_src") or "").strip():
            for k in NEW_COLS:
                h[k] = ""                     # a pre-tip morning price is not a close
        # 10 Nov 2026: a close another session computed from snapshots this session does not have is KEPT
        # (9 Nov: a watch session without the snapshots blanked 53 closes on the live ledger). A later snapshot
        # inside the window still overwrites it above.
    byid = {h["id"]: h for h in hist}
    for h in hist:
        if h["kind"] != "multi":
            continue
        legs = [byid.get(i) for i in (h.get("legs") or "").split(";") if i]
        if legs and all(l and l.get("close_prob") not in (None, "") for l in legs):
            pc = math.prod(float(l["close_prob"]) / 100 for l in legs)
            h["close_src"], h["close_line"], h["close_prob"] = "legs", "", round(pc * 100, 1)
            h["clv_pct"] = round((float(h["odds"]) * pc - 1) * 100, 1)
        elif h["result"] == "pending" and not str(h.get("close_src") or "").strip():
            for k in NEW_COLS:
                h[k] = ""

    with open(a.history, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols); w.writeheader()
        for h in hist:
            w.writerow({k: h.get(k, "") for k in cols})

    # calibration / scorecard by category, bet type (model / price / tracking) and trigger, plus "All"
    def group(name, key):
        out = []
        for val in sorted({key(h) for h in hist if key(h)}) + ["All"]:
            H = [h for h in hist if (val == "All" or key(h) == val) and h["category"] != "Multi leg"]
            S_ = [h for h in H if h["result"] in ("win", "loss")]
            St = [h for h in S_ if float(h.get("stake_u") or 0) > 0]
            C = [h for h in H if h.get("clv_pct") not in (None, "")]
            staked = sum(float(h["stake_u"] or 0) for h in St)
            pl = sum(float(h["profit_u"] or 0) for h in H if h["result"] in ("win", "loss", "push", "void"))
            wins = sum(h["result"] == "win" for h in S_)
            out.append(dict(
                group=name, category=val, picks=len(H), settled=len(S_), record=f"{wins}-{len(S_) - wins}",
                model_prob=round(sum(float(h["prob"]) for h in S_) / len(S_), 1) if S_ else "",
                win_pct=round(wins / len(S_) * 100, 1) if S_ else "",
                brier=round(sum((float(h["prob"]) / 100 - (h["result"] == "win")) ** 2 for h in S_) / len(S_), 3) if S_ else "",
                with_close=len(C),
                avg_clv=round(sum(float(h["clv_pct"]) for h in C) / len(C), 1) if C else "",
                beat_close=round(sum(float(h["clv_pct"]) > 0 for h in C) / len(C) * 100) if C else "",
                pl_u=round(pl, 2), roi=round(pl / staked * 100, 1) if staked else ""))
        return out
    out = group("category", lambda h: h["category"].split(" ·")[0])
    out += [r for r in group("bet type", lambda h: h.get("bet_type") or "") if r["category"] != "All"]
    out += [r for r in group("trigger", lambda h: h.get("trigger") or "") if r["category"] != "All"]
    with open(a.calib, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys())); w.writeheader(); w.writerows(out)
    al = [r for r in out if r["group"] == "category" and r["category"] == "All"][0]
    print(f"clv: {al['with_close']} of {al['picks']} picks have a close; avg CLV {al['avg_clv']}%, "
          f"beat close {al['beat_close']}%" + (f"; removed {fixed} old ladder estimates" if fixed else ""))
    for r in out:
        if r["group"] != "category" and r["with_close"]:
            print(f"  clv by {r['group']} {r['category']}: {r['with_close']} closes, avg {r['avg_clv']}%, beat {r['beat_close']}%")


if __name__ == "__main__":
    main()
