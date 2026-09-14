import { promises as fs } from 'fs';
import { createWriteStream, existsSync } from 'fs';
import path from 'path';
import os from 'os';
import { resolveWorkbookContentString } from '../SkSpreadSheet/SkSpreadSheetContent.mjs';
import { getSkExcelWasmPool } from '../SkExcelWasmPool.mjs';
import { getSkExcelChildPool } from '../SkExcelChildPool.mjs';

// Conversions run on a reused-wasm-instance pool (the native SkExcel binary is no longer used).
// Pool implementation: 'child' (child_process — default) gives hard OS memory reclamation on
// recycle + crash isolation, best for a long-running server; 'worker' (worker_threads) is lighter
// but shares the host process. Both expose the same convertXlsxToSker/exportSkerToXlsx API.
const SKEXCEL_POOL_KIND = process.env.SKEXCEL_POOL_KIND || 'child';

function getSkExcelConversionPool() {
  return SKEXCEL_POOL_KIND === 'child' ? getSkExcelChildPool() : getSkExcelWasmPool();
}

/** Excel OOXML (.xlsx/.xlsm) and ZIP both start with PK. OLE .xls starts with D0 CF 11 E0. */
function looksLikeExcelBinary(buffer) {
  if (!buffer || buffer.length < 4) {
    return false;
  }
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
  const isOle =
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0;
  return isZip || isOle;
}

function looksLikeSkerJson(buffer) {
  const start = buffer.subarray(0, Math.min(buffer.length, 200)).toString('utf8').trimStart();
  if (!start.startsWith('{')) {
    return false;
  }
  return (
    start.includes('"sheets"') ||
    start.includes('"uri"') ||
    start.includes('"si"')
  );
}

async function assertFileIsExcelWorkbook(fullPath, fileName) {
  const header = Buffer.alloc(256);
  const handle = await fs.open(fullPath, 'r');
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }
  const slice = header.subarray(0, bytesRead);
  const stat = await fs.stat(fullPath);

  if (looksLikeSkerJson(slice)) {
    throw new Error(
      `${fileName} is not an Excel workbook: it contains Sker JSON (a .sker file saved with a .xlsx name). ` +
      'Rename it to .sker, or upload a real .xlsx exported from Microsoft Excel.'
    );
  }
  if (!looksLikeExcelBinary(slice)) {
    throw new Error(
      `${fileName} is not a valid Excel file (${stat.size} bytes, missing ZIP/OLE header). ` +
      'Upload a real .xlsx from Excel, then use Convert Excel.'
    );
  }
}

/** Count user-visible sheets/cells in a converted .sker (ignore _$$ system sheets). */
function countImportedUserCells(skerJson) {
  let parsed;
  try {
    parsed = JSON.parse(skerJson);
  } catch {
    return { sheets: 0, cells: 0 };
  }
  const sheets = Array.isArray(parsed?.sheets) ? parsed.sheets : [];
  let userSheets = 0;
  let cells = 0;
  for (const sheet of sheets) {
    const name = String(sheet?.name || '');
    if (!name || name.startsWith('_$$')) {
      continue;
    }
    userSheets += 1;
    const sheetCells = sheet?.cells;
    if (Array.isArray(sheetCells)) {
      cells += sheetCells.length;
    } else if (sheetCells && typeof sheetCells === 'object') {
      cells += Object.keys(sheetCells).length;
    }
  }
  return { sheets: userSheets, cells };
}

/**
 * Download xlsx from Mongo, run SkExcel, persist resulting .sker to VirtualDisk.
 * @returns {Promise<object>} success payload (same shape as legacy sync POST)
 */
export async function executeExcelConversion({
  file,
  filePath,
  userEmail,
  gridFSBucket,
  persistSkerVirtualFileDirect,
  tmpDir,
  fileNameOverride,
}) {
  let wDownloadPath;
  if (tmpDir) {
    wDownloadPath = path.isAbsolute(tmpDir)
      ? tmpDir
      : path.join(os.tmpdir(), tmpDir);
  } else {
    wDownloadPath = path.join(process.cwd(), 'tmp');
  }

  await fs.mkdir(wDownloadPath, { recursive: true });

  const fileName = path.basename(fileNameOverride || file.name);
  const fullPath = path.join(wDownloadPath, fileName);

  if (file.gridfsId) {
    const downloadStream = gridFSBucket.openDownloadStream(file.gridfsId);
    const writeStream = createWriteStream(fullPath);
    await new Promise((resolve, reject) => {
      downloadStream.pipe(writeStream).on('error', reject).on('finish', resolve);
    });
  } else {
    const content = file.content;
    if (typeof content === 'string') {
      if (content.startsWith('data:')) {
        const base64Data = content.split(',')[1];
        await fs.writeFile(fullPath, Buffer.from(base64Data, 'base64'));
      } else {
        await fs.writeFile(fullPath, content, 'utf8');
      }
    } else if (Buffer.isBuffer(content)) {
      await fs.writeFile(fullPath, content);
    } else {
      throw new Error('Unsupported file content type for Excel conversion');
    }
  }

  await assertFileIsExcelWorkbook(fullPath, fileName);

  const baseName = path.parse(fileName).name;
  const skerName = `${baseName}.sker`;
  const originalDir = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
  const targetPath = originalDir === '/' ? `/${skerName}` : `${originalDir}/${skerName}`;

  const skerFullPath = path.join(wDownloadPath, skerName);
  const wSkExcelStarted = Date.now();

  // Reused wasm instance (import path): skexcel_convert(uri, xlsxPath) writes the .sker next to the
  // xlsx. No native binary involved.
  let wFileSize = file.size || 0;
  if (!wFileSize) {
    try { wFileSize = (await fs.stat(fullPath)).size; } catch (_) { /* best effort */ }
  }
  console.log(`Executing (wasm pool): /f:${fullPath} /u:${targetPath}`);
  try {
    await getSkExcelConversionPool().convertXlsxToSker({ xlsxPath: fullPath, uri: targetPath, fileSize: wFileSize });
    console.log(`SkExcel (wasm) finished in ${((Date.now() - wSkExcelStarted) / 1000).toFixed(1)}s`);
  } catch (poolError) {
    const err = new Error(`SkExcel wasm conversion failed: ${poolError.message}`);
    err.skExcelCode = poolError.rc ?? null;
    err.path = fullPath;
    err.fileName = fileName;
    throw err;
  }

  if (!existsSync(skerFullPath)) {
    const wHint = 'SkExcel produced no .sker file (import may have failed or run out of memory on large workbooks).';
    throw new Error(`${wHint} Expected: ${skerFullPath}`);
  }

  const skerContent = await fs.readFile(skerFullPath, 'utf8');
  const wImportStats = countImportedUserCells(skerContent);
  console.log(
    `SkExcel import stats: ${wImportStats.sheets} sheet(s), ${wImportStats.cells} cell(s), ${skerContent.length} JSON chars`,
  );
  if (wImportStats.cells === 0 && (wFileSize || 0) > 64 * 1024) {
    throw new Error(
      `Conversion produced an empty workbook (${wImportStats.sheets} sheet(s), 0 cells) from a ${wFileSize}-byte Excel file. ` +
      'The worksheet XML was probably not extracted (large zip entries need a full zip_fread loop). Rebuild SkExcel WASM.',
    );
  }
  const injected = await persistSkerVirtualFileDirect({
    name: skerName,
    path: targetPath,
    content: skerContent,
    owner: userEmail,
    permissions: 644,
  });

  let deletedTempXlsx = false;
  let deletedTempSker = false;
  try { await fs.unlink(fullPath); deletedTempXlsx = true; } catch (_) { /* best effort */ }
  try { await fs.unlink(skerFullPath); deletedTempSker = true; } catch (_) { /* best effort */ }

  return {
    message: 'success',
    path: fullPath,
    size: file.size || 0,
    fileName,
    createdSker: {
      targetPath,
      result: injected,
    },
    deletedTempXlsx,
    deletedTempSker,
    skExcelOutput: '',
    skExcelError: '',
  };
}

/** Build virtual-disk path for s_<basename>.xlsx next to the source .sker. */
export function skerExportXlsxVirtualPath(skerVirtualPath, skerFileName) {
  const baseName = path.parse(skerFileName || path.basename(skerVirtualPath)).name;
  const xlsxName = `s_${baseName}.xlsx`;
  const originalDir = skerVirtualPath.substring(0, skerVirtualPath.lastIndexOf('/')) || '/';
  return originalDir === '/' ? `/${xlsxName}` : `${originalDir}/${xlsxName}`;
}

/**
 * Load .sker from Mongo, run SkExcel sker2xlsx, persist s_<name>.xlsx to VirtualDisk.
 * @returns {Promise<object>} success payload (mirrors convert-xlsx shape)
 */
export async function executeSkerToExcelExport({
  fastify,
  file,
  filePath,
  userEmail,
  gridFSBucket,
  persistBinaryVirtualFileDirect,
  tmpDir,
}) {
  let wDownloadPath;
  if (tmpDir) {
    wDownloadPath = path.isAbsolute(tmpDir)
      ? tmpDir
      : path.join(os.tmpdir(), tmpDir);
  } else {
    wDownloadPath = path.join(process.cwd(), 'tmp');
  }

  await fs.mkdir(wDownloadPath, { recursive: true });

  const fileName = path.basename(file.name || filePath);
  const skerFullPath = path.join(wDownloadPath, fileName);

  const skerContent = await resolveWorkbookContentString(fastify, file, gridFSBucket);
  if (!skerContent || typeof skerContent !== 'string' || skerContent.length === 0) {
    throw new Error('Could not load .sker content for export');
  }
  await fs.writeFile(skerFullPath, skerContent, 'utf8');

  const targetPath = skerExportXlsxVirtualPath(filePath, fileName);
  const xlsxName = path.basename(targetPath);
  const xlsxFullPath = path.join(wDownloadPath, xlsxName);

  const wSkExcelStarted = Date.now();

  let wFileSize = 0;
  try { wFileSize = (await fs.stat(skerFullPath)).size; } catch (_) { /* best effort */ }
  console.log(`Executing (wasm pool): /m:sker2xlsx /f:${skerFullPath} /x:${xlsxFullPath}`);
  try {
    await getSkExcelConversionPool().exportSkerToXlsx({ skerPath: skerFullPath, xlsxPath: xlsxFullPath, fileSize: wFileSize });
    console.log(`SkExcel export (wasm) finished in ${((Date.now() - wSkExcelStarted) / 1000).toFixed(1)}s`);
  } catch (poolError) {
    const err = new Error(`SkExcel wasm export failed: ${poolError.message}`);
    err.skExcelCode = poolError.rc ?? null;
    err.path = skerFullPath;
    err.fileName = fileName;
    throw err;
  }

  if (!existsSync(xlsxFullPath)) {
    const wHint = 'SkExcel produced no .xlsx file (export may have failed).';
    throw new Error(`${wHint} Expected: ${xlsxFullPath}`);
  }

  const xlsxBuffer = await fs.readFile(xlsxFullPath);
  const injected = await persistBinaryVirtualFileDirect({
    name: xlsxName,
    path: targetPath,
    buffer: xlsxBuffer,
    owner: userEmail,
    permissions: 644,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });

  let deletedTempSker = false;
  let deletedTempXlsx = false;
  try { await fs.unlink(skerFullPath); deletedTempSker = true; } catch (_) { /* best effort */ }
  try { await fs.unlink(xlsxFullPath); deletedTempXlsx = true; } catch (_) { /* best effort */ }

  return {
    message: 'success',
    path: filePath,
    size: file.size || 0,
    fileName,
    createdXlsx: {
      targetPath,
      result: injected,
    },
    deletedTempSker,
    deletedTempXlsx,
    skExcelOutput: '',
    skExcelError: '',
  };
}
