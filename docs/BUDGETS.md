# Budgets & charge codes

## Types

| Source | Cost class | Meaning |
|--------|------------|---------|
| **Forecast(s)** | **DIRECT** | Production job cost — **one budget can span many forecasts** |
| **Project + WBS** | **DIRECT** | PMO job cost per WBS (not standalone list) |
| **Standalone** | **INDIRECT** | Company pocketbook (facility, G&A-style) |

Optional **product** link on a forecast budget is **tracking only** — not development NRE.

## Owner (required)

Each budget has a **responsible owner** who:
- Approves **timesheet slices** charged to that code (a period can have many owners if the worker hit many codes)
- Approves **purchase requests** buying against that code (charge-owner steps)

## Charge codes

**Charge code = budget name** (spaces → hyphens), unless you type an override.  
Renaming a budget updates the charge code to match (if you leave the code field following the name).

Draft budgets are fully editable (money, labor hours, code, owner) before **Enact**.

## Money + hours

- `$` buckets: total / labor / material / other  
- **Labor hours budget** + **actual hours** (from approved timesheets)

## Lifecycle

1. Create **draft** (forecast form, `/budgets`, or PMO project → Budgets tab)  
2. Edit numbers / code / owner  
3. **Enact** → charge code live on timesheet + GL  
4. Labor + material charge → owner approves → actuals roll  
5. **Close** when done  

## Where

- `/budgets` — standalone + forecast budgets  
- PMO project → **Budgets** tab — WBS charge codes  
- New forecast — optional budget fields  
- My Timesheet — enacted codes in charge dropdown  
