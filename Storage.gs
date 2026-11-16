const TAB_ = 'HOI_Events';

const HEADER_ = [
  'Schema',
  'Event ID',
  'Transaction ID',
  'Action',
  'Base version',
  'Transaction JSON',
  'Actor email',
  'Actor name',
  'Timestamp'
];

const CATEGORIES_ = [
  'Gift & Charity',
  'Tabungan & Investasi',
  'Makanan & Minuman',
  'Kebutuhan Sehari-hari',
  'Kebutuhan Peliharaan',
  'Transportasi',
  'Pengeluaran Rutin',
  'Hobi & Hiburan',
  'Kesehatan & Personal Care',
  'Gaji',
  'Freelance',
  'Pendidikan',
  'E Wallet',
  'Lainnya'
];

function initializeSheet_(config) {
  const book = SpreadsheetApp.openById(
    config.sheetId
  );

  let sheet = book.getSheetByName(TAB_);

  if (!sheet) {
    sheet = book.insertSheet(TAB_);
  }

  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, HEADER_.length)
      .setValues([HEADER_]);

    sheet.setFrozenRows(1);
  } else {
    checkHeader_(sheet);
  }
}

function checkHeader_(sheet) {
  const actual = sheet
    .getRange(1, 1, 1, HEADER_.length)
    .getDisplayValues()[0];

  if (
    JSON.stringify(actual) !==
    JSON.stringify(HEADER_)
  ) {
    fail_(
      'DATA',
      'Format tab HOI_Events berbeda. Jangan mengubah log secara manual.'
    );
  }
}

function sheet_(config) {
  const sheet = SpreadsheetApp
    .openById(config.sheetId)
    .getSheetByName(TAB_);

  if (!sheet) {
    fail_(
      'SETUP',
      'Tab data belum tersedia. Pemilik perlu menjalankan setup.'
    );
  }

  checkHeader_(sheet);
  return sheet;
}

function validRecord_(transaction) {
  if (
    !transaction ||
    typeof transaction.name !== 'string' ||
    !transaction.name.trim() ||
    transaction.name.length > 100 ||
    typeof transaction.note !== 'string' ||
    transaction.note.length > 200 ||
    CATEGORIES_.indexOf(transaction.category) < 0 ||
    ['income', 'expense'].indexOf(transaction.type) < 0 ||
    !Number.isSafeInteger(transaction.amount) ||
    transaction.amount <= 0 ||
    transaction.amount > 999999999999 ||
    typeof transaction.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)
  ) {
    return false;
  }

  const date = new Date(
    transaction.date + 'T12:00:00Z'
  );

  return (
    !isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === transaction.date
  );
}

function validateMutation_(mutation) {
  const idValid = value =>
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{1,100}$/.test(value);

  if (
    !mutation ||
    !idValid(mutation.eventId) ||
    !idValid(mutation.id) ||
    typeof mutation.baseVersion !== 'string' ||
    (
      mutation.baseVersion &&
      !idValid(mutation.baseVersion)
    ) ||
    ['put', 'delete'].indexOf(mutation.action) < 0
  ) {
    fail_(
      'VALIDATION',
      'Permintaan transaksi tidak valid.'
    );
  }

  let payload = '';

  if (mutation.action === 'put') {
    const transaction = mutation.transaction;

    if (!validRecord_(transaction)) {
      fail_(
        'VALIDATION',
        'Isi nama, tanggal, kategori, dan jumlah Rupiah bulat yang valid.'
      );
    }

    payload = JSON.stringify({
      name: transaction.name.trim(),
      date: transaction.date,
      type: transaction.type,
      category: transaction.category,
      amount: transaction.amount,
      note: transaction.note
    });
  }

  return {
    eventId: mutation.eventId,
    id: mutation.id,
    action: mutation.action,
    baseVersion: mutation.baseVersion,
    payload: payload
  };
}

function readState_(config) {
  const sheet = sheet_(config);
  const last = sheet.getLastRow();

  const rows = last > 1
    ? sheet
        .getRange(2, 1, last - 1, HEADER_.length)
        .getDisplayValues()
    : [];

  return replay_(rows);
}

function replay_(rows) {
  const entities = Object.create(null);
  const events = Object.create(null);
  const rejected = Object.create(null);

  rows.forEach(function (row) {
    if (
      !row.length ||
      row.every(value => value === '')
    ) {
      return;
    }

    const schema = row[0];
    const eventId = row[1];
    const id = row[2];
    const action = row[3];
    const base = row[4] || '';
    const payload = row[5];
    const email = row[6];
    const name = row[7];
    const at = row[8];

    if (
      String(schema) !== '1' ||
      !eventId ||
      !id ||
      ['put', 'delete'].indexOf(action) < 0
    ) {
      fail_(
        'DATA',
        'Log transaksi tidak valid. Hubungi pemilik Sheet.'
      );
    }

    if (
      Object.prototype.hasOwnProperty.call(
        events,
        eventId
      )
    ) {
      if (
        JSON.stringify(events[eventId]) !==
        JSON.stringify(row)
      ) {
        fail_(
          'DATA',
          'ID log ganda dengan isi berbeda.'
        );
      }

      return;
    }

    events[eventId] = row;

    const prior = entities[id];

    if (
      (prior ? prior.version : '') !== base ||
      (
        action === 'delete' &&
        (!prior || prior.deleted)
      ) ||
      (prior && prior.deleted)
    ) {
      rejected[eventId] = true;
      return;
    }

    if (action === 'delete') {
      entities[id] = {
        id: id,
        version: eventId,
        deleted: true
      };

      return;
    }

    let transaction;

    try {
      transaction = JSON.parse(payload);
    } catch (error) {
      fail_(
        'DATA',
        'JSON transaksi pada Sheet rusak.'
      );
    }

    if (!validRecord_(transaction)) {
      fail_(
        'DATA',
        'Isi transaksi pada Sheet tidak valid.'
      );
    }

    entities[id] = Object.assign(
      {},
      transaction,
      {
        id: id,
        version: eventId,
        deleted: false,
        createdBy: prior ? prior.createdBy : email,
        submittedAt: prior ? prior.submittedAt : at,
        updatedBy: email,
        recorder: name || email,
        updatedAt: at
      }
    );
  });

  return {
    entities: entities,
    events: events,
    rejected: rejected,
    records: Object.keys(entities)
      .map(id => entities[id])
      .filter(transaction => !transaction.deleted)
  };
}
