# Planning & capacity guide

ForgeERP planning is **rough-cut** (infinite capacity with working calendar), not a finite APS.

## Estimate

```
estimatedMinutes = Σ(step minutes, default 30 if blank) × qty + kit buffer (60)
```

- Source: released WI steps or traveler steps  
- **Recalc estimate** on the work order refreshes after WI/step changes  

## Back vs forward schedule

| Mode | When | Result |
|------|------|--------|
| **BACK** | Due date known (SO, forecast need-by) | `plannedEnd` = due; `plannedStart` walks **working days** backward by estimate |
| **FORWARD** | No due, or start-driven | `plannedStart` = next working day; `plannedEnd` walks forward |

Working-day length is **configurable** under Planning → Calendar:

- Fixed shift hours  
- Work center `capacityHoursPerDay`  
- Staffed hours at station  
- Custom shift hours  

Weekends are skipped. Capacity *available* hours still use staff × efficiency − PTO.

## Capacity

- **Scheduled load** = hours of open WOs whose planned window **overlaps the horizon**  
- **Unscheduled backlog** = WOs with no window (listed separately; not dumped onto Monday)  
- Daily workload bars follow planned windows, not even plant-wide splits  

## Forecast → MRS → MWO

1. Forecast lines (part, qty, need-by) — editable after create; statuses DRAFT / ACTIVE / CLOSED / CANCELLED  
2. Generate MRS: net **on-hand + open production WO remaining + open PO remaining**, explode certified BOMs with **scrap** → BUILD / BUY / STOCK  
3. Set **need-by** and **child offset** (working minutes before parent start) on BUILD lines  
4. Release:  
   - Parents scheduled first (back from need-by)  
   - Children due = parent plannedStart − offset (planner override or estimate + staging)  
   - BUY PR `neededBy` uses part/vendor lead time against earliest consuming build  

## CTP-lite (sales order)

On SO detail → **CTP check**: rough free hours in the back-scheduled window vs process hours needed. Verdicts: STOCK / OK / TIGHT / MISS / NO_BOM. Does **not** reserve capacity.

## Horizon & bulk tools

Planning → Overview / Capacity: this week, next week, 2-week, 4-week horizon chips.  
**Reschedule unscheduled** backfills planned windows (back from due if present, else forward from today).

## Exceptions

Planning → Exceptions lists late risk, missing dates, weak estimates, material wait, over capacity, etc.
