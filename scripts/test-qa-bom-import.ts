/** File-sourced BOM import: parsers, review flags, draft approve/discard. */
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { TENANT_TABLES_SQL, TENANT_FKS_SQL } from "../src/lib/tenant-template";
import * as XLSX from "xlsx";
import { buildEmptyOleFixture } from "../src/lib/bom-import/parse-cad";

const FIXTURE_DIR = path.join(__dirname, "fixtures", "bom-import");

function buildTextPdf(lines: string[]): Buffer {
  const content =
    "BT\n/F1 12 Tf\n72 720 Td\n" +
    lines
      .map((line, i) => (i === 0 ? `(${line}) Tj\n` : `0 -18 Td (${line}) Tj\n`))
      .join("") +
    "ET\n";
  const objs = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${content.length} >> stream\n${content}endstream\nendobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objs) {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

function writeFixtures() {
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const csv = [
    "Level,Find,Part Number,Description,Qty,UoM,Rev",
    "0,,WG-ASSY,Widget assembly,1,EA,A",
    "1,1,WG-HOUSING,Widget housing,1,EA,B",
    "1,2,SCR-4,Socket cap screw,8,EA,A",
    "1,3,WASHER-4,Flat washer,8,EA,",
    "",
  ].join("\n");
  writeFileSync(path.join(FIXTURE_DIR, "sample-bom.csv"), csv);

  const wb = XLSX.utils.book_new();
  const aoa = [
    ["Item P/N", "Noun", "QTY PER", "Unit", "Item No", "Rev"],
    ["WG-HOUSING", "Widget housing", 1, "EA", "1", "B"],
    ["SCR-4", "Socket cap screw", 8, "EA", "2", "A"],
    ["NEW-CLIP", "Spring clip", 2, "EA", "3", "A"],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "BOM");
  writeFileSync(
    path.join(FIXTURE_DIR, "sample-bom.xlsx"),
    Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }))
  );

  writeFileSync(
    path.join(FIXTURE_DIR, "sample-bom.pdf"),
    buildTextPdf([
      "Part Number  Description  Qty  UoM",
      "WG-HOUSING  Widget housing  1  EA",
      "SCR-4  Socket cap screw  8  EA",
      "WASHER-4  Flat washer  8  EA",
    ])
  );

  writeFileSync(path.join(FIXTURE_DIR, "sample-empty.sldasm"), buildEmptyOleFixture());
}

async function main() {
  process.env.TZ = "America/Los_Angeles";
  Object.assign(globalThis, { AsyncLocalStorage });
  writeFixtures();

  // ── Pure parse tests (no DB, no LLM) ─────────────────────────────
  const { extractBomFromFile } = await import("../src/lib/bom-import/extract");
  const { suggestColumnMapping, applyColumnMapping, parseCsvGrid, parseExcelBuffer } = await import(
    "../src/lib/bom-import/parse-tabular"
  );
  const { extractPdfPlainText } = await import("../src/lib/bom-import/parse-pdf");
  const { extractCadBom, isOleCompound } = await import("../src/lib/bom-import/parse-cad");
  const { flagExtractedLines } = await import("../src/lib/services/bom-import");
  const { buildNavRegistry } = await import("../src/lib/ai-help/nav-registry");

  const csvBytes = readFileSync(path.join(FIXTURE_DIR, "sample-bom.csv"));
  const csv = await extractBomFromFile({ fileName: "sample-bom.csv", bytes: csvBytes, allowLlm: false });
  assert.equal(csv.sourceKind, "CSV");
  assert.equal(csv.assemblyPartNumber, "WG-ASSY");
  assert.equal(csv.lines.length, 3);
  assert.equal(csv.lines[0].partNumber, "WG-HOUSING");
  assert.equal(csv.lines[1].quantity, 8);
  assert.equal(csv.mapping.partNumber, "Part Number");
  assert.equal(csv.mapping.quantity, "Qty");

  const xlsxBytes = readFileSync(path.join(FIXTURE_DIR, "sample-bom.xlsx"));
  const grid = parseExcelBuffer(xlsxBytes);
  const suggested = suggestColumnMapping(grid.headers);
  assert.equal(suggested.partNumber, "Item P/N");
  assert.equal(suggested.description, "Noun");
  assert.equal(suggested.quantity, "QTY PER");
  assert.equal(suggested.findNumber, "Item No");
  const xlsx = await extractBomFromFile({ fileName: "sample-bom.xlsx", bytes: xlsxBytes, allowLlm: false });
  assert.equal(xlsx.sourceKind, "EXCEL");
  assert.equal(xlsx.lines.length, 3);
  assert.equal(xlsx.lines[2].partNumber, "NEW-CLIP");
  assert.equal(xlsx.lines[2].quantity, 2);

  // User-adjusted mapping: if we intentionally map part number to Noun, rows follow.
  const remapped = applyColumnMapping(grid.headers, grid.rows, { ...suggested, partNumber: "Noun", description: "Item P/N" });
  assert.equal(remapped.lines[0].partNumber, "WIDGET HOUSING");

  const pdfBytes = readFileSync(path.join(FIXTURE_DIR, "sample-bom.pdf"));
  const pdfText = extractPdfPlainText(pdfBytes);
  assert.match(pdfText, /Part Number/);
  assert.match(pdfText, /WG-HOUSING/);
  const pdf = await extractBomFromFile({ fileName: "drawing.pdf", bytes: pdfBytes, allowLlm: false });
  assert.equal(pdf.sourceKind, "PDF_TEXT");
  assert.equal(pdf.needsExport, false);
  assert.ok(pdf.lines.length >= 3, `expected 3 PDF lines, got ${pdf.lines.length}: ${JSON.stringify(pdf.lines)}`);
  assert.equal(pdf.lines.some((l) => l.partNumber === "WG-HOUSING" && l.quantity === 1), true);
  assert.equal(pdf.lines.some((l) => l.partNumber === "SCR-4" && l.quantity === 8), true);

  const swBytes = readFileSync(path.join(FIXTURE_DIR, "sample-empty.sldasm"));
  assert.equal(isOleCompound(swBytes), true);
  const cad = extractCadBom(swBytes, "SOLIDWORKS", "sample-empty.sldasm");
  assert.equal(cad.needsExport, true);
  assert.equal(cad.parseStatus, "NEEDS_EXPORT");
  assert.equal(cad.lines.length, 0);
  assert.match(cad.extractionNotes, /Export the BOM table/i);
  assert.match(cad.extractionNotes, /SolidWorks/i);

  const flagged = flagExtractedLines(xlsx.lines, new Map([
    ["WG-HOUSING", { id: "p1", partNumber: "WG-HOUSING", description: "Housing", uom: "EA" }],
  ]));
  assert.equal(flagged.find((l) => l.partNumber === "WG-HOUSING")?.flag, "MATCHED");
  assert.equal(flagged.find((l) => l.partNumber === "NEW-CLIP")?.flag, "NEW_ITEM");
  assert.equal(flagged.find((l) => l.partNumber === "NEW-CLIP")?.createNewItem, true);

  const nav = buildNavRegistry();
  const importRoute = nav.find((r) => r.href === "/bom/import");
  assert.ok(importRoute, "Carina nav registry should include /bom/import");
  assert.ok(importRoute!.synonyms.includes("import this bom"));
  assert.equal(importRoute!.permission, "bom.view");

  // ── DB fixture: draft approve + discard + permission ─────────────
  const pg = await PGlite.create();
  const ddl = execFileSync(
    process.execPath,
    [
      "node_modules/prisma/build/index.js",
      "migrate",
      "diff",
      "--from-empty",
      "--to-schema",
      "prisma/schema.prisma",
      "--script",
    ],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      env: {
        PATH: process.env.PATH,
        CHECKPOINT_DISABLE: "1",
        PRISMA_HIDE_UPDATE_MESSAGE: "1",
        DATABASE_URL: "postgresql://postgres@127.0.0.1:1/unused",
        DIRECT_URL: "postgresql://postgres@127.0.0.1:1/unused",
      },
    }
  );
  await pg.exec(ddl);
  const schema = "tenant_qabomimp01";
  await pg.exec(
    `CREATE SCHEMA ${schema}; SET search_path TO ${schema};` +
      TENANT_TABLES_SQL +
      TENANT_FKS_SQL +
      "SET search_path TO public;"
  );
  const socket = new PGLiteSocketServer({
    db: pg,
    host: "127.0.0.1",
    port: 0,
    maxConnections: 16,
  });
  await socket.start();
  process.env.DATABASE_URL = `postgresql://postgres@${socket.getServerConn()}/postgres`;
  process.env.DIRECT_URL = process.env.DATABASE_URL;
  process.env.DATABASE_POOL_MAX = "1";
  process.env.DEMO_MODE = "0";
  process.env.MFA_SECRET_KEY = randomBytes(32).toString("hex");
  delete process.env.XAI_API_KEY;
  globalThis.fetch = async () => {
    throw new Error("External requests disabled in bom-import tests");
  };

  const { createRequestStoreForAPI } = await import(
    "next/dist/server/async-storage/request-store"
  );
  const { createWorkStore } = await import(
    "next/dist/server/async-storage/work-store"
  );
  const { workAsyncStorage } = await import(
    "next/dist/server/app-render/work-async-storage.external"
  );
  const { workUnitAsyncStorage } = await import(
    "next/dist/server/app-render/work-unit-async-storage.external"
  );
  const { NextRequest } = await import(
    "next/dist/server/web/spec-extension/request"
  );
  const { controlPlaneClient, clientForSchema } = await import("../src/lib/db");
  const bomImport = await import("../src/lib/services/bom-import");
  const auth = await import("../src/lib/auth-core");
  const p = controlPlaneClient();
  const tenant = clientForSchema(schema);
  const password = "Synthetic-QA-" + randomBytes(20).toString("hex");

  async function request<T>(fn: () => Promise<T>, cookies: Record<string, string> = {}) {
    const store = createRequestStoreForAPI(
      new NextRequest("http://127.0.0.1/bom-import-qa", {
        headers: {
          cookie: Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join("; "),
        },
      }),
      { pathname: "/bom-import-qa", search: "" },
      { tags: [], expirationsByCacheKind: new Map() },
      undefined,
      undefined
    );
    const work = createWorkStore({
      page: "/bom-import-qa",
      buildId: "qa-local",
      previouslyRevalidatedTags: [],
      renderOpts: {
        supportsDynamicResponse: true,
        isPossibleServerAction: true,
        assetPrefix: "",
        incrementalCache: {} as never,
        experimental: {
          isRoutePPREnabled: false,
          cacheComponents: false,
          authInterrupts: false,
        },
        waitUntil: () => {},
        onClose: () => {},
      } as Parameters<typeof createWorkStore>[0]["renderOpts"],
    });
    const value = await workAsyncStorage.run(work, () =>
      workUnitAsyncStorage.run(store, fn)
    );
    return {
      value,
      cookies: Object.fromEntries(
        store.mutableCookies
          .getAll()
          .filter((c) => c.value)
          .map((c) => [c.name, c.value])
      ),
    };
  }

  try {
    await p.tenant.create({
      data: { slug: "qa-bom-import", schemaName: schema, status: "ACTIVE" },
    });
    const db = tenant;
    const engineer = await db.user.create({
      data: {
        name: "Engineer",
        email: "eng@example.invalid",
        role: "ENGINEERING",
        passwordHash: auth.hashPassword(password),
        isActive: true,
      },
    });
    const production = await db.user.create({
      data: {
        name: "Production",
        email: "prod@example.invalid",
        role: "PRODUCTION",
        passwordHash: auth.hashPassword(password),
        isActive: true,
      },
    });
    const engSess = await request(() => auth.createTenantSession(engineer.id, schema));
    const prodSess = await request(() => auth.createTenantSession(production.id, schema));
    const runEng = async <T>(fn: () => Promise<T>) => (await request(fn, engSess.cookies)).value;
    const runProd = async <T>(fn: () => Promise<T>) => (await request(fn, prodSess.cookies)).value;

    await db.companySettings.create({
      data: { id: "default", bomPrototypeRequired: true },
    });
    await db.part.create({
      data: {
        partNumber: "WG-HOUSING",
        description: "Existing housing",
        sourcingMethod: "PURCHASE",
        uom: "EA",
      },
    });

    await assert.rejects(
      () => runProd(() => bomImport.createBomImportFromFile({
        fileName: "sample-bom.csv",
        bytes: csvBytes,
        allowLlm: false,
      })),
      (err: unknown) => {
        const digest = typeof err === "object" && err && "digest" in err ? String((err as { digest?: string }).digest) : "";
        const msg = err instanceof Error ? err.message : String(err);
        return digest.includes("NEXT_REDIRECT") || /no-access|bom\.edit/i.test(digest + msg);
      }
    );

    const imported = await runEng(() =>
      bomImport.createBomImportFromFile({
        fileName: "sample-bom.csv",
        bytes: csvBytes,
        allowLlm: false,
      })
    );
    assert.equal(imported.status, "PENDING_REVIEW");
    assert.equal(imported.assemblyPartNumber, "WG-ASSY");
    const housing = imported.lines.find((l) => l.partNumber === "WG-HOUSING");
    const clipish = imported.lines.find((l) => l.partNumber === "SCR-4");
    assert.equal(housing?.flag, "MATCHED");
    assert.equal(clipish?.flag, "NEW_ITEM");

    const discarded = await runEng(() =>
      bomImport.createBomImportFromFile({
        fileName: "sample-bom.csv",
        bytes: csvBytes,
        allowLlm: false,
      })
    );
    await runEng(() => bomImport.discardBomImport(discarded.id));
    const discardedRow = await db.bomImport.findUniqueOrThrow({ where: { id: discarded.id } });
    assert.equal(discardedRow.status, "DISCARDED");
    assert.equal(discardedRow.bomHeaderId, null);

    const approved = await runEng(() =>
      bomImport.updateBomImportReview({
        importId: imported.id,
        assemblyPartNumber: "WG-ASSY",
        assemblyDescription: "Widget assembly",
        assemblyRevision: "A",
        lines: imported.lines.map((l) => ({
          id: l.id,
          partNumber: l.partNumber,
          description: l.description,
          quantity: l.quantity,
          uom: l.uom,
          findNumber: l.findNumber,
          createNewItem: l.createNewItem,
        })),
      })
    );
    const bom = await runEng(() => bomImport.approveBomImport(approved.id));
    assert.equal(bom.status, "DRAFT");
    assert.equal(bom.prototypeRequired, true);
    assert.equal(bom.certifiedAt, null);
    assert.equal(bom.part.partNumber, "WG-ASSY");
    assert.equal(bom.lines.length, 3);
    assert.equal(bom.sourceFileName, "sample-bom.csv");
    assert.ok(bom.sourceFileUrl?.startsWith("data:text/csv"));
    assert.equal(bom.sourceKind, "CSV");
    const newScrew = await db.part.findUniqueOrThrow({ where: { partNumber: "SCR-4" } });
    assert.equal(newScrew.description, "Socket cap screw");
    const header = await db.bomHeader.findUniqueOrThrow({ where: { id: bom.id } });
    assert.equal(header.status, "DRAFT");
    const importRow = await db.bomImport.findUniqueOrThrow({ where: { id: imported.id } });
    assert.equal(importRow.status, "APPROVED");
    assert.equal(importRow.bomHeaderId, bom.id);

    // Companion path after an unreadable CAD upload
    const cadImport = await runEng(() =>
      bomImport.createBomImportFromFile({
        fileName: "sample-empty.sldasm",
        bytes: swBytes,
        allowLlm: false,
      })
    );
    assert.equal(cadImport.needsExport, true);
    assert.equal(cadImport.lines.length, 0);
    const withCompanion = await runEng(() =>
      bomImport.attachCompanionFile({
        importId: cadImport.id,
        fileName: "sample-bom.csv",
        bytes: csvBytes,
      })
    );
    assert.equal(withCompanion.needsExport, false);
    assert.ok(withCompanion.lines.length >= 3);
    assert.equal(withCompanion.sourceKind, "COMPANION");
    assert.equal(withCompanion.companionFileName, "sample-bom.csv");

    console.log("PASS qa-bom-import");
  } finally {
    await socket.stop();
    await pg.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
