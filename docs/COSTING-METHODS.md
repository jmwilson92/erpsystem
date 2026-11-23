# Inventory costing methods

Each company chooses **STANDARD**, **AVERAGE** (moving weighted average), **FIFO**, or **LIFO** in Accounting → settings. The default remains STANDARD. Other manufacturing defaults from the inventory accounting work (consumption timing, GR/IR, ERS, labor to WIP, revenue/COGS on shipment, G&A out of inventory, GFP off the company ledger) are unchanged.

LIFO is not permitted under IFRS. The settings page shows this as a one-line note.

## How each method values inventory

- **STANDARD.** Receipts still capitalize at the actual receipt cost. Finished-goods output and COGS relieve at `Part.standardCost`. Supplier invoice match continues to post purchase-price variance (PPV) to 6221. Issues to a job use the recorded bin cost, as before.
- **AVERAGE.** A moving weighted average is recomputed on receipt only: `newAvg = (oldQty × oldAvg + recQty × recCost) / (oldQty + recQty)`. Issues, shipments, scrap, and adjustments use that average. Issues do not change the average. The new average is stored on `Part.averageCost` and on company-owned bins for that part.
- **FIFO / LIFO.** Every inbound movement (purchase receipt, work-order output, RMA receive or restock, unissue, increasing adjustment, and an opening balance after a method change) creates an additive `InventoryCostLayer` for the item and location (quantity remaining, original quantity, unit cost, source document). Layers are never deleted; quantity remaining is zeroed when the layer is exhausted. Picks/consumption, shipments (COGS), scrap, and decreasing adjustments consume remaining layers oldest-first (FIFO) or newest-first (LIFO) and post the summed layer cost. Putaway and transfers move layers to the destination location without revaluing.

WIP, the inventory-to-GL valuation, journal drill-down, and the inventory transaction register use these layer (or average) costs so the subledger ties to the general ledger.

## Method-change policy

The costing method may be changed **only at a quiet period boundary**:

1. The current open period must have no posted inventory, COGS, WIP, scrap, or RMA stock journals, and no material transactions dated in the period. A mid-period change is blocked with a clear error. Close the busy period and open a new empty period first. If no `AccountingPeriod` row exists, the calendar month is treated as the period.
2. On a permitted change, leftover layers are retired and opening layers are seeded from on-hand quantity at the currently recorded unit cost (book value). Switching among AVERAGE, FIFO, and LIFO, or off STANDARD, therefore does not jump the inventory GL balance.
3. Switching **to STANDARD** posts a revaluation journal when book value differs from standard × quantity (Dr/Cr inventory vs 6222 Inventory revaluation / `COSTING_REVAL`) and restates bin unit costs at standard so the standard subledger ties to the GL.

Journals stay period-lock aware, source-tied, and balanced. Failures are not swallowed. Reversals are posted; rows are not deleted.
