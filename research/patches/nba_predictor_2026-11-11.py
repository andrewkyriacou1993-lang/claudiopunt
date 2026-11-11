#!/usr/bin/env python3
"""
NBA value-bet finder (market-anchored).

  python build_teams.py teams.csv            # blend prior-season + current ratings
  python nba_predictor.py teams.csv games.csv --date 2026-10-27 --top 20

Key long-run safeguards:
  * Projections come from pace + offensive/defensive ratings, then are BLENDED with the
    market: the no-margin consensus of Sportsbet, TAB, Ladbrokes, PointsBet and Betr (70% consensus /
    30% model; 65% / 35% when only one bookie prices it). Unanchored models show large fake edges that lose money.
  * Probabilities are compared to the bookie-consensus fair price at each bookie's line, and EV is computed on the odds
    actually available at Sportsbet.
  * Bets are only "RECOMMENDED" above an edge and EV threshold; stakes are quarter-Kelly,
    capped at 2% of bankroll.
  * Every run writes bets_<date>.csv so you can log results and track closing-line value.
"""
import argparse, csv, math, os
from statistics import NormalDist
from nba_teams import to_full, ABBR

# Calibrated by backtest.js on 3,700 games (2023-24 to 2026-27, closing lines from DraftKings / ESPN BET / Caesars):
MIN_PTS = 1.0      # side bets need the expected margin to beat the number by at least a point
HOME_ADV = 1.9      # points: average home margin 1.6-2.2 and home line 1.9 over the last three seasons
SD_MARGIN = 13.7    # spread of results around the closing line: 13.6 / 13.6 / 14.0 by season
SD_TOTAL = 17.9     # same for totals: 17.7 / 17.6 / 18.3


def cdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def dec(o):
    o = float(o)
    return 1 + (o / 100 if o > 0 else 100 / -o) if abs(o) >= 100 else o


def devig(a, b):
    """Fair probabilities from two-way odds by the power method: (1/a)^k + (1/b)^k = 1.
    Backtest (3,736 games, closing moneylines): log loss 0.5763 vs 0.5771 for the usual proportional method, which
    under-rates favourites (70-80% band: 74.8% priced vs 76.7% won; 80-90%: 84.6% vs 85.5%)."""
    ia, ib = 1 / a, 1 / b
    lo, hi = 0.5, 2.0
    for _ in range(50):
        k = (lo + hi) / 2
        if ia ** k + ib ** k > 1:
            lo = k
        else:
            hi = k
    k = (lo + hi) / 2
    pa = ia ** k
    return pa, 1 - pa


def kelly(p, d):
    b = d - 1
    if b <= 0: return 0.0   # live market at 1.00 on a started game (11 Nov 2026): no stake, no division by zero
    return max(0.0, (b * p - (1 - p)) / b)


def load_teams(path):
    with open(path, newline="") as f:
        return {r["team"]: {k: float(r[k]) for k in ("pace", "ortg", "drtg")} for r in csv.DictReader(f)}


def project(teams, home, away):
    lg = sum(t["ortg"] for t in teams.values()) / len(teams)
    h, a = teams[home], teams[away]
    poss = (h["pace"] + a["pace"]) / 2
    hp = poss / 100 * (h["ortg"] + a["drtg"] - lg) + HOME_ADV / 2
    ap = poss / 100 * (a["ortg"] + h["drtg"] - lg) - HOME_ADV / 2
    return dict(poss=poss, hp=hp, ap=ap, margin=hp - ap, total=hp + ap,
                hnet=h["ortg"] - h["drtg"], anet=a["ortg"] - a["drtg"])


# Final margins are whole numbers and there are no draws (overtime), so margin probabilities use a
# normal curve over integers with 0 removed. This matters for small lines: +1.5 only adds "lose by 1".
_K = [k for k in range(-70, 71) if k != 0]


def _pm(mu):
    w = [math.exp(-0.5 * ((k - mu) / SD_MARGIN) ** 2) for k in _K]
    s = sum(w)
    return [x / s for x in w]


def win_prob(mu):
    """P(home wins) when the expected home margin is mu."""
    return sum(p for k, p in zip(_K, _pm(mu)) if k > 0)


def cover_prob(mu, L):
    """P(home covers handicap L), i.e. margin + L > 0 (half-point lines; whole lines count a push as no)."""
    return sum(p for k, p in zip(_K, _pm(mu)) if k + L > 0)


def _solve(f, target):
    lo, hi = -40.0, 40.0
    for _ in range(50):
        mid = (lo + hi) / 2
        if f(mid) < target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def mu_from_win(p):
    return _solve(win_prob, p)


def mu_from_cover(p, L):
    return _solve(lambda m: cover_prob(m, L), p)


def inv_cdf(p):
    return NormalDist().inv_cdf(min(max(p, 1e-4), 1 - 1e-4))


def consensus(Q):
    """No-margin consensus of every bookmaker's main lines for one game:
    expected home margin (from each moneyline and each half-point spread), expected total, home win prob."""
    m, t, ml = [], [], []
    for q in Q:
        a, b = float(q["a"]), float(q["b"])
        if q["mkt"] == "ml":
            ph = devig(b, a)[0]
            ml.append(ph); m.append(mu_from_win(ph))
        elif q["mkt"] == "sp":
            L = float(q["line"])
            if L != int(L):                       # whole-number lines can push; skip
                m.append(mu_from_cover(devig(b, a)[0], L))
        elif q["mkt"] == "tot":
            t.append(float(q["line"]) + SD_TOTAL * inv_cdf(devig(a, b)[0]))
    g = {"n_m": len(m), "n_t": len(t)}
    if m:
        g["margin"] = sum(m) / len(m)
    if t:
        g["total"] = sum(t) / len(t)
    if ml:
        g["ml_home"] = sum(ml) / len(ml)
    return g


# ---- US market via RotoWire (8 Nov 2026, Andrew: "bring RotoWire into the opening price run, as this is the most important
# to find an edge"). raw/usgames_<date>_<HHMM>.txt (collect_rwgames.js on rotowire.com/betting/nba/odds): DraftKings, FanDuel,
# Circa, Caesars, BetMGM, ... main lines. They only move the market consensus (W_US_GAME of it); they are never a price we bet at.
W_US_GAME = 0.5
_US_CACHE = {}


def load_us(date):
    """{game code: [quote rows]} from the newest raw/usgames_<date>_*.txt (empty if none)."""
    if date in _US_CACHE:
        return _US_CACHE[date]
    import glob as _g
    files = sorted(_g.glob(f"raw/usgames_{date}_*.txt"))
    out = {}
    if files:
        for ln in open(files[-1]).read().splitlines():
            f = ln.split("|")
            if len(f) == 7 and f[2] in ("ml", "sp", "tot"):
                try:
                    float(f[5]); float(f[6])
                except ValueError:
                    continue
                out.setdefault(f[1], []).append(dict(book=f[0], mkt=f[2], line=f[4], a=f[5], b=f[6]))
    _US_CACHE[date] = out
    return out


def blend_us(bf, us):
    """AU consensus bf + US consensus us -> one market consensus (W_US_GAME on the US side where both have a number)."""
    if not us:
        return bf
    g = dict(bf)
    for k, nk in (("margin", "n_m"), ("total", "n_t"), ("ml_home", "n_m")):
        if k in us and k in bf:
            g[k] = (1 - W_US_GAME) * bf[k] + W_US_GAME * us[k]
        elif k in us:
            g[k] = us[k]
    g["n_m"] = bf.get("n_m", 0) + us.get("n_m", 0)
    g["n_t"] = bf.get("n_t", 0) + us.get("n_t", 0)
    g["au_n_m"], g["us_n_m"] = bf.get("n_m", 0), us.get("n_m", 0)
    for k in ("margin", "total"):
        if k in bf: g["au_" + k] = bf[k]
        if k in us: g["us_" + k] = us[k]
    return g


def evaluate(r, teams, args):
    home, away = r["home"], r["away"]
    pr = project(teams, home, away)
    pr["total"] -= args.total_bias          # slate-level calibration of model totals
    sa = args.sched.get((to_full(away), to_full(home)))
    if sa:                                   # rest / back-to-back / travel / altitude (model side only)
        pr["margin"] += float(sa["margin_adj"]); pr["total"] += float(sa["total_adj"])
    sched_txt = f" Schedule: {sa['note']} ({float(sa['margin_adj']):+.1f} to {home})." if sa and sa["note"] else ""
    w = args.market_weight
    line = float(r["spread_home"])
    mkt_total = float(r["total"])
    # every bookmaker's quote for this game: Sportsbet (games.csv) plus raw/book_*.txt
    code = f"{ABBR[to_full(away)]}@{ABBR[to_full(home)]}"
    Q = [dict(book="Sportsbet", mkt="ml", line="", a=dec(r["ml_away"]), b=dec(r["ml_home"])),
         dict(book="Sportsbet", mkt="sp", line=line, a=dec(r["spread_away_odds"]), b=dec(r["spread_home_odds"])),
         dict(book="Sportsbet", mkt="tot", line=mkt_total, a=dec(r["over_odds"]), b=dec(r["under_odds"]))]
    Q += [q for q in args.books.get(code, [])]
    bf = consensus(Q)                                     # no-margin consensus of the Australian bookies
    USQ = load_us(r["date"]).get(code, [])
    bf = blend_us(bf, consensus(USQ) if USQ else {})       # + the US market (RotoWire), half the weight
    # Market expectation: the consensus of every bookmaker's price with its margin removed. Several
    # bookies together are a better guide than any one, so the consensus gets the higher weight.
    mkt_margin = bf.get("margin", -line)                 # market's expected home margin
    mkt_total_exp = bf.get("total", mkt_total)
    wm = args.cons_weight if bf.get("n_m", 0) >= 2 else w
    wt = args.cons_weight if bf.get("n_t", 0) >= 2 else w
    pr["mkt_margin"], pr["mkt_total"] = mkt_margin, mkt_total_exp
    margin = wm * mkt_margin + (1 - wm) * pr["margin"]
    total = wt * mkt_total_exp + (1 - wt) * pr["total"]
    pr["blend_margin"], pr["blend_total"] = margin, total     # used to price alternate spreads / totals
    out = []

    big_margin_gap = abs(pr["margin"] - mkt_margin) > args.verify_margin
    big_total_gap = abs(pr["total"] - mkt_total_exp) > args.verify_total
    src = f"bookie consensus ({bf.get('n_m', 0)} prices)" if bf else "no-vig"
    us_txt = ""
    if bf.get("us_n_m"):
        us_txt = (f" US market (RotoWire, {bf['us_n_m']} prices): margin {bf['us_margin']:+.1f}" if "us_margin" in bf else "") + \
                 (f", total {bf['us_total']:.1f}" if "us_total" in bf else "") + \
                 (f" vs AU {bf['au_margin']:+.1f}" if "au_margin" in bf else "") + (f" / {bf['au_total']:.1f}" if "au_total" in bf else "") + "."

    def add(market, label, p, d, pm, why, book, key, line=None):
        ev = p * d - 1
        edge = p - pm
        stake = min(kelly(p, d) * args.kelly, args.max_stake) * 100
        verify = big_total_gap if market == "Total" else big_margin_gap
        if market != "Total":
            why += sched_txt
        why += us_txt
        # two ways to be a bet: the model disagrees with the market (edge), or, when 3+ bookie prices make
        # a consensus, this bookmaker's price simply beats the consensus fair value (price edge)
        fair_ev = pm * d - 1
        price_edge = bf.get("n_m", 0) >= 3 and fair_ev >= args.min_price_ev
        # "The number" audit (28 Oct 2026, Andrew): restate a side bet as a margin, give the break-even and the edge in
        # points; a model edge under MIN_PTS points means the number is right, so pass (price-shopping bets excepted)
        pts = None
        if market in ("Spread", "Moneyline"):
            team = label.rsplit(" ", 1)[0] if market == "Spread" else label[:-3]
            sgn = 1 if team == home else -1
            exp_m, mkt_m = sgn * margin, sgn * mkt_margin          # expected margin for the side we back
            if market == "Spread":
                need = -float(label.rsplit(" ", 1)[1])               # margin this side needs (e.g. -2.5 -> win by 3+)
                pts = exp_m - need
                land = (f"{team} must win by {math.ceil(need)}+" if need > 0 else f"{team} can lose by up to {math.floor(-need)}")
            else:
                pts = exp_m - mkt_m
                land = f"{team} must win"
            f0 = getattr(args, "first_spread", {}).get((to_full(away), to_full(home)))
            mov = (f0, float(r["spread_home"])) if f0 is not None else None
            mov_txt = (f" Line moved {mov[0]:+g} to {mov[1]:+g} ({home}) since first seen." if mov and mov[0] != mov[1] else "")
            sched_pts = float(sa["margin_adj"]) * sgn if sa else 0.0
            ratings_pts = sgn * (pr["margin"] - mkt_margin) - sched_pts
            key_in = ("the schedule adjustment" if abs(sched_pts) * (1 - wm) >= abs(ratings_pts) * (1 - wm) and abs(sched_pts) > 0.5
                      else "the team ratings gap")
            why += (f" The number: {land}. Expected margin {exp_m:+.1f} ({1 - wm:.0%} model {sgn * pr['margin']:+.1f}, "
                    f"{wm:.0%} market {mkt_m:+.1f}; home court {HOME_ADV} pts). Break-even {1 / d:.1%}, model {p:.1%}; "
                    f"edge {pts:+.1f} pts.{mov_txt} Biggest input: {key_in}.")
        model_rec = edge >= args.min_edge and (pts is None or pts >= MIN_PTS)
        # 8 Nov 2026 (Andrew): a big model-vs-market gap on a TOTAL no longer blocks the bet (market trust in best_of_day.py
        # already shrinks the model halfway to the consensus); it stays as a note. Spreads / moneylines still need the check.
        rec = ev >= args.min_ev and (model_rec or price_edge) and not (verify and market != "Total")
        if pts is not None and 0 <= pts < MIN_PTS and edge >= args.min_edge and not price_edge and ev >= args.min_ev:
            why += f" PASS: edge under {MIN_PTS:g} point, so the market number is right."
        if rec and edge < args.min_edge:
            why += f" Price: {d:.2f} at {book} beats the bookie consensus fair {1 / pm:.2f} ({fair_ev:+.1%})."
        if verify and ev >= args.min_ev and market == "Total":
            why += " Note: model total far from the market, so check injuries/lineups before betting."
        elif verify and ev >= args.min_ev:
            why += " VERIFY: model disagrees with the market by a lot, so check injuries/lineups first."
        cand.append(dict(date=r["date"], game=f"{away} @ {home}", market=market, bet=label,
                         odds=d, model_p=p, mkt_p=pm, edge=edge, ev=ev, stake_pct=stake,
                         rec=rec, why=why, book=book, key=key, line=line))

    cand = []
    p_h = win_prob(margin)
    pace_txt = f"pace {pr['poss']:.1f}"
    for q in Q:
        bk, a_odds, h_odds = q["book"], float(q["a"]), float(q["b"])
        if q["mkt"] == "ml":
            if "ml_home" in bf:
                m_h = bf["ml_home"]
            elif "margin" in bf or bk != "Sportsbet":
                m_h = win_prob(mkt_margin)
            else:
                m_h = devig(h_odds, a_odds)[0]
            add("Moneyline", f"{home} ML", p_h, h_odds, m_h,
                f"Ratings project {home} by {pr['margin']:+.1f} vs market {mkt_margin:+.1f}; "
                f"blended win prob {p_h:.0%} vs {m_h:.0%} {src}.", bk, ("ml", home))
            add("Moneyline", f"{away} ML", 1 - p_h, a_odds, 1 - m_h,
                f"Ratings project {away} {-pr['margin']:+.1f} vs market {-mkt_margin:+.1f}; "
                f"blended win prob {1 - p_h:.0%} vs {1 - m_h:.0%} {src}.", bk, ("ml", away))
        elif q["mkt"] == "sp":
            L = float(q["line"])                          # home handicap at this bookmaker
            if L == int(L):
                continue                                  # whole-number lines can push; not priced here
            if "margin" in bf or bk != "Sportsbet":
                ph_m = cover_prob(mkt_margin, L)
            else:
                ph_m = devig(h_odds, a_odds)[0]
            p_cover = cover_prob(margin, L)
            add("Spread", f"{home} {L:+g}", p_cover, h_odds, ph_m,
                f"Model margin {home} {pr['margin']:+.1f} (net rtg {pr['hnet']:+.1f} vs {pr['anet']:+.1f} + HCA) "
                f"vs market {mkt_margin:+.1f}; cover {p_cover:.0%} at {L:+g}.", bk, ("sp", home), L)
            add("Spread", f"{away} {-L:+g}", 1 - p_cover, a_odds, 1 - ph_m,
                f"Model margin {home} {pr['margin']:+.1f} vs market {mkt_margin:+.1f}, so {away} gets "
                f"{-L:+g} with {1 - p_cover:.0%} to cover.", bk, ("sp", away), -L)
        elif q["mkt"] == "tot":
            T = float(q["line"])
            if "total" in bf or bk != "Sportsbet":
                mo = 1 - cdf((T - mkt_total_exp) / SD_TOTAL)
            else:
                mo = devig(a_odds, h_odds)[0]
            p_over = 1 - cdf((T - total) / SD_TOTAL)
            add("Total", f"Over {T:g}", p_over, a_odds, mo,
                f"Model total {pr['total']:.1f} ({pace_txt}) vs market {mkt_total_exp:.1f}; over {p_over:.0%}.", bk, ("tot", "Over"), T)
            add("Total", f"Under {T:g}", 1 - p_over, h_odds, 1 - mo,
                f"Model total {pr['total']:.1f} ({pace_txt}) vs market {mkt_total_exp:.1f}; under {1 - p_over:.0%}.", bk, ("tot", "Under"), T)
    # best price per side across bookmakers (highest EV, which can mean a better line), with every price shown
    best, seen_bk = {}, {}
    for c in cand:
        if c["key"] not in best or c["ev"] > best[c["key"]]["ev"]:
            best[c["key"]] = c
    for k, b in best.items():
        same = sorted([c for c in cand if c["key"] == k and c["line"] == b["line"]], key=lambda c: -c["odds"])
        b["all_odds"] = " · ".join(f"{c['book']} {c['odds']:.2f}" for c in same)
        b["n_books"] = len(same)
        others = sorted({f"{c['bet'].split()[-1]} {c['book']}" for c in cand if c["key"] == k and c["line"] != b["line"]})
        if others:
            b["all_odds"] += " (other lines: " + ", ".join(others) + ")"
        out.append(dict(b, view="best"))
    # each bookie's own best line per side (for the dashboard's bookie filter)
    for c in cand:
        k = (c["key"], c["book"])
        if k not in seen_bk or c["ev"] > seen_bk[k]["ev"]:
            seen_bk[k] = c
    for (k, bk), c in seen_bk.items():
        out.append(dict(c, view=bk, all_odds=best[k].get("all_odds", ""), n_books=best[k].get("n_books", 1)))
    return pr, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("teams")
    ap.add_argument("games")
    ap.add_argument("--date", help="only games with this date (YYYY-MM-DD, AEDT)")
    ap.add_argument("--top", type=int, default=20)
    ap.add_argument("--market-weight", type=float, default=0.65)
    ap.add_argument("--min-edge", type=float, default=0.02)
    ap.add_argument("--min-ev", type=float, default=0.03)
    ap.add_argument("--min-price-ev", type=float, default=0.03, help="bet a price that beats the bookie consensus fair value by this much")
    ap.add_argument("--kelly", type=float, default=0.25)
    ap.add_argument("--max-stake", type=float, default=0.02)
    ap.add_argument("--verify-margin", type=float, default=6.0)
    ap.add_argument("--verify-total", type=float, default=8.0)
    ap.add_argument("--books", dest="books_file", default="", help="book_games.csv from prep.py (other bookmakers)")
    ap.add_argument("--schedule", default="", help="schedule_adj.csv from schedule.py")
    ap.add_argument("--cons-weight", type=float, default=0.7, help="weight on the bookie consensus vs the model")
    args = ap.parse_args()
    args.total_bias = 0.0
    args.books = {}
    if args.books_file and os.path.exists(args.books_file):
        for q in csv.DictReader(open(args.books_file)):
            args.books.setdefault(q["game"], []).append(q)
    args.sched = {}
    # line movement: Sportsbet home spread in the first snapshot of the day vs now (raw/sb_<date>_HHMM.txt)
    args.moves = {}
    import glob as _g
    snaps = sorted(_g.glob(f"raw/sb_{args.date}_*.txt")) if args.date else []
    if snaps:
        first = {}
        blk = open(snaps[0]).read().split("###PROPS")[0].splitlines()
        for ln in blk[2:]:
            f = ln.split(",")
            if len(f) >= 7:
                first[(to_full(f[2]), to_full(f[3]))] = float(f[6])
        args.first_spread = first
    if args.schedule and os.path.exists(args.schedule):
        args.sched = {(to_full(r["away"]), to_full(r["home"])): r for r in csv.DictReader(open(args.schedule))}

    teams = load_teams(args.teams)
    with open(args.games, newline="") as f:
        rows = [r for r in csv.DictReader(f) if not args.date or r["date"] == args.date]
    # De-bias totals: if the model runs systematically above/below the market across the
    # slate, that is model calibration error, not edge. Centre it on the market average.
    if rows:
        gaps = [project(teams, r["home"], r["away"])["total"] - float(r["total"]) for r in rows]
        args.total_bias = sum(gaps) / len(gaps)
        print(f"Total calibration: model ran {args.total_bias:+.1f} pts vs market on average; removed.\n")
    allbets, projs = [], []
    if True:
        for r in rows:
            pr, bets = evaluate(r, teams, args)
            projs.append((r, pr))
            allbets += [b for b in bets if b.get("view", "best") == "best"]

    print("PROJECTIONS (raw model, before market blend)")
    for r, pr in projs:
        print(f"  {r['away']:<24} @ {r['home']:<24} {r['home']} {pr['hp']:.0f}-{pr['ap']:.0f}  "
              f"margin {pr['margin']:+5.1f} (line {-float(r['spread_home']):+5.1f})  "
              f"total {pr['total']:.1f} (line {r['total']})")

    allbets.sort(key=lambda b: -b["ev"])
    top = allbets[:args.top]
    n_rec = sum(b["rec"] for b in allbets)
    print(f"\n{len(allbets)} bets priced, {n_rec} clear the value threshold "
          f"(EV>={args.min_ev:.0%}, edge>={args.min_edge:.0%}). Top {args.top} by EV:\n")
    for i, b in enumerate(top, 1):
        tag = "RECOMMENDED" if b["rec"] else "marginal"
        print(f"{i:>2}. [{tag}] {b['game']} | {b['bet']} @ {b['odds']:.2f} {b['book']} | "
              f"model {b['model_p']:.1%} vs mkt {b['mkt_p']:.1%} | EV {b['ev']:+.1%} | "
              f"stake {b['stake_pct']:.2f}% bankroll\n      {b['why']}")

    fn = f"bets_{args.date or 'all'}.csv"
    with open(fn, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "date", "game", "market", "bet", "odds", "model_p", "mkt_p",
                    "edge", "ev", "stake_pct", "recommended", "reason", "result", "closing_odds"])
        for i, b in enumerate(top, 1):
            w.writerow([i, b["date"], b["game"], b["market"], b["bet"], f"{b['odds']:.2f}",
                        f"{b['model_p']:.4f}", f"{b['mkt_p']:.4f}", f"{b['edge']:.4f}",
                        f"{b['ev']:.4f}", f"{b['stake_pct']:.2f}", b["rec"], b["why"], "", ""])
    print(f"\nwrote {fn}")


if __name__ == "__main__":
    main()
