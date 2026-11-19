#!/usr/bin/env python3
"""
The bottom-up model's own tracked record (0u, information only) and its grading.

  python3 track.py log   --date 2026-11-10 --posted "2026-11-10 08:20" [--min-ev 4] [--max-odds 6] [--max-ev 15]
      appends the day's qualifying picks from out/<date>_priced.csv to track/bottomup_track.csv. A pick (game, player,
      market, side, line) is logged once per slate, at the odds / bookie when first found; later runs add new picks only.
      Game lines are never logged (model weight 0). Questionable / Doubtful players are logged with status so the review
      can split them out.
  python3 track.py grade [--boxes raw/fullbox_2026.psv]
      settles pending picks from the box scores (cache/boxes.pkl via bottomup.build); a player who did not play = void.
  python3 track.py report
      P/L by market, bookie, EV band, status; prints the running total.
  --pure (log / grade / report): the PURE bottom-up record, track/bottomup_pure_track.csv (Andrew, 9 Nov 2026: "i want the model
      to predict it on its own - then we compare what we predict to the bookies"): picks by the model's own calibrated probability
      with no market in it (ev_model_pct >= --min-ev, default 8%), all prop markets, odds <= 6. Same grading and report.
"""
import argparse, csv, os, sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bottomup as B
import price as PR

HERE = os.path.dirname(os.path.abspath(__file__))
TRACK = os.path.join(HERE, "track", "bottomup_track.csv")
PURE = os.path.join(HERE, "track", "bottomup_pure_track.csv")
SHADOW = os.path.join(HERE, "track", "shadow_track.csv")
CUR = {"path": TRACK}
COLS = ["date", "posted", "trigger", "tier", "game", "player", "status", "market", "side", "line", "book", "odds", "model_p", "market_p", "sharp_p", "ev_sharp", "blend_p",
        "fair_odds", "ev_pct", "kelly_u", "stake_u", "matchup", "rw_lineup", "rw_play_pct", "rw_min", "rw_min_gap", "rw_proj", "rw_vs_line", "rw_agrees", "probets", "cons_ok", "model_ok", "result", "actual", "profit_u"]   # kelly_u = the suggested (capped) stake; stake_u stays 0 (information only)


def load():
    if not os.path.exists(CUR["path"]): return pd.DataFrame(columns=COLS)
    return pd.read_csv(CUR["path"], dtype={"line": str})


def save(T):
    os.makedirs(os.path.dirname(CUR["path"]), exist_ok=True)
    T.to_csv(CUR["path"], index=False)


def log(a):
    X = pd.read_csv(os.path.join(B.OUT, f"{a.date}_{'shadow' if a.shadow else 'priced_pure' if a.pure else 'priced'}.csv"), dtype={"line": str}, low_memory=False)
    if "matchup" not in X.columns: X["matchup"] = ""
    if "tier" not in X.columns: X["tier"] = ""
    if a.shadow:   # shadow.py already applied the rules; log everything it produced
        X = X[X.player.notna() & (X.player != "")]
    elif a.pure:   # the model on its own: its calibrated probability x odds, every prop market, no blend
        X["ev_pct"] = X.ev_model_pct; X["blend_p"] = X.model_p; X["fair_odds"] = (100 / X.model_p).round(2)
        X = X[(X.ev_pct >= a.min_ev) & (X.odds <= a.max_odds) & (X.player != "") & X.market.isin(PR.MARKET_STAT)]
    else:
        X["model_used"] = X.market.map(lambda m: PR.BLEND.get(m, PR.BLEND_DEFAULT)[1] > 0)
        X = X[(X.ev_pct >= a.min_ev) & (X.odds <= a.max_odds) & X.model_used & (X.player != "")]   # 15%+ EV picks are logged too (stake_u 0 in the suggestion) so the band can be reviewed
    X["pkey"] = X.player.map(B.norm)
    X = X.sort_values("ev_pct", ascending=False).drop_duplicates(["game", "pkey", "market", "side", "line"])
    T = load()
    have = set(zip(T.date, T.game, T.player.map(B.norm), T.market, T.side, T.line.astype(str))) if len(T) else set()
    new = []
    for r in X.itertuples():
        k = (a.date, r.game, r.pkey, r.market, r.side, str(r.line))
        if k in have: continue
        new.append(dict(date=a.date, posted=a.posted, trigger=getattr(r, "trigger", "") if isinstance(getattr(r, "trigger", ""), str) else "", tier=getattr(r, "tier", "") if isinstance(getattr(r, "tier", ""), str) else "", game=r.game, player=r.player, status=r.status if isinstance(r.status, str) else "",
                        market=r.market, side=r.side, line=r.line, book=r.book, odds=r.odds, model_p=r.model_p, market_p=r.market_p,
                        sharp_p=getattr(r, "sharp_p", ""), ev_sharp=getattr(r, "ev_sharp", ""),
                        blend_p=r.blend_p, fair_odds=r.fair_odds, ev_pct=r.ev_pct, kelly_u=getattr(r, "stake_u", 0), stake_u=0,
                        matchup=r.matchup if isinstance(r.matchup, str) else "",
                        **{c: (getattr(r, c, "") if not (isinstance(getattr(r, c, ""), float) and np.isnan(getattr(r, c, ""))) else "") for c in ("rw_lineup", "rw_play_pct", "rw_min", "rw_min_gap", "rw_proj", "rw_vs_line", "rw_agrees", "probets", "cons_ok", "model_ok")},
                        result="pending", actual="", profit_u=""))
    T = pd.concat([T, pd.DataFrame(new, columns=COLS)], ignore_index=True)
    save(T)
    print(f"track{' (shadow card)' if a.shadow else ' (pure model)' if a.pure else ''}: {len(new)} new picks logged for {a.date} ({len(T[T.date == a.date])} on the day, {len(T)} total)")
    for r in (new[:25] if not a.pure else []):
        if a.shadow: print(f"  {r['tier']} {r['game']:8s} {r['player']:24s} {r['market']:9s} {r['side']:5s} {r['line']:>5s} @ {r['odds']:.2f} {r['book']:10s} vs Pinnacle +{r['ev_pct']:.1f}% ({r['trigger']})"); continue
        print(f"  {r['game']:8s} {r['player']:24s} {r['market']:9s} {r['side']:5s} {r['line']:>5s} @ {r['odds']:.2f} {r['book']:10s} "
              f"model {r['model_p']:.0f}% mkt {r['market_p'] if r['market_p'] != '' else '-'} ev {r['ev_pct']:+.1f}% {r['status']} | {r['matchup']}")


def grade(a):
    T = load()
    if not len(T): print("nothing to grade"); return
    df = B.load_boxes()
    pend = T.result == "pending"
    us = {d: (pd.Timestamp(d) - pd.Timedelta(days=1)).strftime("%Y%m%d") for d in T.date.unique()}
    n = 0
    for i in T[pend].index:
        r = T.loc[i]; d = us[r.date]
        day = df[df.date == d]
        if not len(day): continue
        st = PR.MARKET_STAT.get(r.market)
        a_, h_ = r.game.split("@")
        rows = day[(day.name.map(B.norm) == B.norm(r.player)) & day.team.isin([a_, h_])]
        if not len(rows):
            # did the game happen? then the player did not play -> void
            if len(day[(day.away == a_) & (day.home == h_)]):
                T.loc[i, ["result", "actual", "profit_u"]] = ["void", float("nan"), 0.0]; n += 1
            continue
        v = float(rows.iloc[0][st]); line = float(r.line)
        if v == line: res = "push"
        else: res = "win" if ((v > line) == (r.side == "Over")) else "loss"
        T.loc[i, ["result", "actual", "profit_u"]] = [res, v, 0.0]   # 0u record: profit is reported at a flat 1u in `report`
        n += 1
    save(T)
    print(f"graded {n} picks; pending {int((T.result == 'pending').sum())}")


def report(a):
    T = load()
    S = T[T.result.isin(["win", "loss", "push"])].copy()
    if not len(S): print("no settled picks yet"); return
    S["pl"] = np.where(S.result == "win", S.odds - 1, np.where(S.result == "loss", -1.0, 0.0))
    def tab(by):
        t = S.groupby(by).agg(n=("pl", "size"), wins=("result", lambda s: int((s == "win").sum())), pl_u=("pl", "sum"), avg_odds=("odds", "mean"), avg_ev=("ev_pct", "mean"))
        t["roi_pct"] = t.pl_u / t.n * 100; return t.round(2)
    print(f"settled {len(S)} (void {int((T.result == 'void').sum())}, pending {int((T.result == 'pending').sum())}): "
          f"{int((S.result == 'win').sum())}W-{int((S.result == 'loss').sum())}L, {S.pl.sum():+.1f}u at 1u flat, ROI {S.pl.sum() / len(S) * 100:+.1f}%")
    print("\nby market\n", tab("market").to_string()); print("\nby bookie\n", tab("book").to_string())
    S["ev_band"] = pd.cut(S.ev_pct, [0, 6, 10, 15, 100], labels=["4-6", "6-10", "10-15", "15+"])
    print("\nby EV band\n", tab("ev_band").to_string())
    S["status"] = S.status.fillna("").replace("", "available")
    print("\nby status\n", tab("status").to_string())
    if "ev_sharp" in S.columns and pd.to_numeric(S.ev_sharp, errors="coerce").notna().any():
        S["vs_pinnacle"] = np.where(pd.to_numeric(S.ev_sharp, errors="coerce") > 0, "beat Pinnacle fair", np.where(pd.to_numeric(S.ev_sharp, errors="coerce").notna(), "under Pinnacle fair", "no Pinnacle line"))
        print("\nby Pinnacle (did our price beat Pinnacle's no-margin price at bet time?)\n", tab("vs_pinnacle").to_string())
    if "tier" in S.columns and S.tier.fillna("").astype(str).str.len().gt(0).any():
        print("\nby tier\n", tab("tier").to_string())
        for c, nm in (("rw_agrees", "RotoWire projection agrees"), ("probets", "also in ProBets"), ("cons_ok", "AU consensus edge >= 2%"), ("model_ok", "model agrees")):
            if c in S.columns and S[c].astype(str).str.len().gt(0).any():
                S[c + "_f"] = S[c].astype(str).map(lambda v: "yes" if v in ("True", "true") or (c == "probets" and v not in ("", "nan")) else "no" if v in ("False", "false", "") else "n/a")
                print(f"\nby {nm}\n", tab(c + "_f").to_string())
        S["timing"] = np.where(S.trigger.isin(["evening", "opening", "propswatch"]), "early (night before)", "late (game day)")
        print("\nby timing\n", tab("timing").to_string())
    if "trigger" in S.columns:
        S["trigger"] = S.trigger.fillna("").replace("", "?"); print("\nby trigger (when the price was taken)\n", tab("trigger").to_string())
    print("\nby day\n", tab("date").to_string())


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("log"); l.add_argument("--date", required=True); l.add_argument("--posted", required=True)
    l.add_argument("--min-ev", type=float, default=4.0); l.add_argument("--max-ev", type=float, default=15.0); l.add_argument("--max-odds", type=float, default=6.0)
    g = sub.add_parser("grade"); r = sub.add_parser("report")
    for sp in (l, g, r):
        sp.add_argument("--pure", action="store_true", help="the pure bottom-up record (model probability only, no market)")
        sp.add_argument("--shadow", action="store_true", help="the shadow card (Pinnacle-gated two-way props, shadow.py)")
    a = ap.parse_args()
    if a.pure:
        CUR["path"] = PURE
        if a.cmd == "log" and a.min_ev == 4.0: a.min_ev = 8.0
    if a.shadow:
        CUR["path"] = SHADOW
        if a.cmd == "log": a.min_ev = -100; a.max_odds = 100
    {"log": log, "grade": grade, "report": report}[a.cmd](a)


if __name__ == "__main__":
    main()
