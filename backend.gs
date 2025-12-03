/***************************************************
 *  KONFIG
 ***************************************************/
const TX_SHEET_NAME   = 'Transactions';
const COA_SHEET_NAME  = 'ChartOfAccounts';
const NOTA_FOLDER_ID  = '1CJ5Rlh1QVbZbaKkaC6nvDGvvXX8v-I1l'; // ganti sendiri
const API_TOKEN       = 'R4Y_FIN_SECRET_0880';                 // GANTI DENGAN TOKEN MU SENDIRI

/***************************************************
 *  Helper: JSON response
 ***************************************************/
function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj || {}))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkToken_(e) {
  const token = e && e.parameter && e.parameter.token;
  return token === API_TOKEN;
}

/***************************************************
 *  doGet → endpoint API (init)
 *  URL: .../exec?action=init&token=XXXX
 ***************************************************/
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'init') {
    if (!checkToken_(e)) {
      return jsonResponse_({ ok:false, error:'INVALID_TOKEN' });
    }
    const res = getInitData();
    return jsonResponse_(res);
  }

  // default: ping
  return ContentService
    .createTextOutput('RAY FINANCE API')
    .setMimeType(ContentService.MimeType.TEXT);
}

/***************************************************
 *  doPost → endpoint API (save)
 *  URL: .../exec?action=save&token=XXXX
 ***************************************************/
function doPost(e) {
  if (!checkToken_(e)) {
    return jsonResponse_({ ok:false, error:'INVALID_TOKEN' });
  }

  const action = (e && e.parameter && e.parameter.action) || '';
  let payload = {};

  try {
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    }
  } catch (err) {
    return jsonResponse_({ ok:false, error:'INVALID_JSON' });
  }

  if (action === 'save') {
    const res = saveTransaction(payload);
    return jsonResponse_(res);
  }

  if (action === 'init') {
    const res = getInitData();
    return jsonResponse_(res);
  }

  return jsonResponse_({ ok:false, error:'UNKNOWN_ACTION' });
}

/***************************************************
 *  getInitData → untuk dropdown awal
 ***************************************************/
function getInitData() {
  try {
    const ss  = SpreadsheetApp.getActive();
    const coa = buildCoa_(ss);

    return {
      ok: true,
      debit:  coa.debit,
      credit: coa.credit
    };
  } catch (err) {
    return { ok:false, error:String(err) };
  }
}

/***************************************************
 *  saveTransaction(payload)
 ***************************************************/
function saveTransaction(payload) {
  try {
    const ss = SpreadsheetApp.getActive();
    const sh = ss.getSheetByName(TX_SHEET_NAME);
    if (!sh) throw new Error('TX_SHEET_NOT_FOUND');

    const tz  = Session.getScriptTimeZone();
    const now = new Date();

    const datetime = payload.datetime || Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm');

    const amount     = Number(payload.amount || 0);
    const currency   = payload.currency || 'IDR';
    const fx         = Number(payload.fx || 1);
    const amountBase = amount * fx;

    const debitAcc   = payload.debitAccount  || '';
    const creditAcc  = payload.creditAccount || '';
    const adminFee   = Number(payload.adminFee || 0);

    const desc       = payload.desc    || '';
    const project    = payload.project || '';
    const debitType  = '';
    const creditType = '';
    const notes      = payload.notes   || '';

    // ==========================
    // Simpan foto nota (jika ada)
    // ==========================
    let notaUrl = '';
    try {
      if (payload.notaFileContent && NOTA_FOLDER_ID) {
        const bytes = Utilities.base64Decode(payload.notaFileContent);
        const mime  = payload.notaMimeType || 'image/jpeg';
        const name  = payload.notaFileName || ('nota-' + Utilities.formatDate(now, tz, 'yyyyMMdd-HHmmss') + '.jpg');

        const blob   = Utilities.newBlob(bytes, mime, name);
        const folder = DriveApp.getFolderById(NOTA_FOLDER_ID);
        const file   = folder.createFile(blob);

        notaUrl = file.getUrl(); // disimpan ke kolom "nota"
      }
    } catch (e) {
      Logger.log('Gagal simpan nota: ' + e);
      // kalau gagal, notaUrl tetap ''
    }

    // =========================================================
    // MAPPING EXACT SESUAI HEADER:
    // A datetime
    // B desc
    // C amount
    // D currency
    // E fx
    // F amount_base
    // G debit_account
    // H credit_account
    // I admin_fee
    // J project
    // K debit_type
    // L credit_type
    // M created_at
    // N nota (URL)
    // O notes
    // =========================================================
    const row = [
      datetime,      // A
      desc,          // B
      amount,        // C
      currency,      // D
      fx,            // E
      amountBase,    // F
      debitAcc,      // G
      creditAcc,     // H
      adminFee,      // I
      project,       // J
      debitType,     // K
      creditType,    // L
      new Date(),    // M created_at
      notaUrl,       // N nota
      notes          // O notes
    ];

    // =========================================================
    // Cari baris kosong pertama (kolom A) mulai baris 2
    // =========================================================
    const lastRow = sh.getLastRow();
    let nextRow = 2;

    if (lastRow >= 2) {
      const colA = sh.getRange(2, 1, lastRow - 1, 1).getValues();
      const idx  = colA.findIndex(r => String(r[0]).trim() === '');
      nextRow = (idx >= 0) ? (2 + idx) : (lastRow + 1);
    }

    sh.getRange(nextRow, 1, 1, row.length).setValues([row]);

    return { ok:true };

  } catch (err) {
    return { ok:false, error:String(err) };
  }
}

/***************************************************
 *  COA dropdown builder
 ***************************************************/
function buildCoa_(ss) {
  const sh = ss.getSheetByName(COA_SHEET_NAME);
  if (!sh) throw new Error('COA_SHEET_NOT_FOUND');

  const lastRow = sh.getLastRow();
  const debitList  = [];
  const creditList = [];

  if (lastRow >= 2) {
    // B..E mulai baris 2 → account_name, side, ?, active
    const values = sh.getRange(2, 2, lastRow - 1, 4).getValues();

    values.forEach(r => {
      const name   = r[0];
      const side   = String(r[1] || '').toUpperCase();
      const active = String(r[3] || '').toUpperCase();

      if (!name) return;
      if (active !== 'TRUE') return;

      if (side === 'DEBIT'  || side === 'BOTH')  debitList.push(name);
      if (side === 'CREDIT' || side === 'BOTH') creditList.push(name);
    });
  }

  return { debit: debitList, credit: creditList };
}
