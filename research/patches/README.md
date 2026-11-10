# Pipeline patches awaiting the bundle

Files here are fixed pipeline scripts that a scheduled session could not write back into the Project's
nba_model/pipeline_bundle.json (project_write and the dashboard asset upload were refused by the permission
classifier). Copy each one over the bundle's file from an interactive chat, then remove it from here.

- clv_2026-11-10.py -> clv.py (lineup watch 3, 10 Nov 2026 12:40 AEDT): a pending pick's existing close is KEPT when
  this session has no snapshot inside its closing window (before: blanked, "a pre-tip morning price is not a close";
  on 9 Nov a watch session without the snapshots blanked 53 closes on the live ledger). A snapshot inside the window
  still overwrites it. Verified on the 10 Nov ledger: 379 closes before and after, 0 changed.
