---
change_id: next-sprint-capacity
title: Next-window capacity as a number on the availability tab
status: archived
created: 2026-08-31
updated: 2026-09-01
archived_at: 2026-08-31T22:39:28Z
---

## Notes

S-18: zakładka Availability podaje LICZBĘ pojemności (man-days) dla następnego okna, nie tylko listę nieobecnych. PRD ref: FR-010 (oraz FR-022 dla jednostki man-days). Prereq S-08 done. Otwarte pytanie do sframowania: czy okno prognozy to prawdziwy przyszły sprint z Jiry (state=future, często bez dat), czy ekstrapolowane okno, które availability-view.ts:nextWindowAfter() rysuje dziś.
