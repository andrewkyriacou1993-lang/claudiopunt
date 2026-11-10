# PC sync (set up 10 Nov 2026)

Some scheduled runs cannot push to this repo from their cloud session. Those runs write the board files into the copy of
this repo on Andrew's PC instead, and `sync_site.bat` there (Windows Task Scheduler, every 5 minutes) commits and pushes
them. Commits made that way are titled "Board update (PC sync) <date time>".

Schedule check: this line was written at 7:52pm AEDT on 10 Nov 2026 to confirm the 5-minute sync picks up new files.
