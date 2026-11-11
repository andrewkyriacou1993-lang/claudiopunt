import csv,sys,subprocess,shutil
# usage: mergeledger.py <their_live> <their_tracking>  -> board/history.csv = union by id (theirs first, my extra rows appended)
live,tr=sys.argv[1],sys.argv[2]
mine=list(csv.DictReader(open('board/history.csv',newline='')))
shutil.copy('board/history.csv','raw/history_mine_premerge.csv')
shutil.copy(live,'raw/ledger_live_restored.csv'); shutil.copy(tr,'raw/tracking_restored_in.csv')
subprocess.run(['python3','ledger_split.py','merge','raw/ledger_live_restored.csv','raw/tracking_restored_in.csv'],check=True)
h=list(csv.DictReader(open('board/history.csv',newline='')))
ids={r['id'] for r in h}; add=[r for r in mine if r['id'] not in ids]
only_o=[r for r in h if r['id'] not in {x['id'] for x in mine}]
cols=list(h[0].keys())
with open('board/history.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=cols); w.writeheader()
    for r in h+add: w.writerow({k:r.get(k,'') for k in cols})
print('merged: theirs',len(h),'+ mine-only',len(add),[r['pick'][:50] for r in add][:10])
print('theirs-only',len(only_o),[ (r['category'],r['pick'][:50],r.get('stake')) for r in only_o][:12])
subprocess.run(['python3','ledger_split.py','split'],check=True)
