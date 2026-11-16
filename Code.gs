const HOI_SHEET_ID_ =
  '13tx_d7COep1j4YaxbUsZWSO1wUBPsOdU1oaXhqo93IE';

const HOI_SESSION_SECONDS_ = 21600;

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('HOI Finance')
    .addMetaTag(
      'viewport',
      'width=device-width, initial-scale=1'
    );
}

function include_(name) {
  if (['Styles', 'Client'].indexOf(name) < 0) {
    throw new Error('File tidak diizinkan.');
  }

  return HtmlService
    .createHtmlOutputFromFile(name)
    .getContent();
}

/*
 * Jalankan dari editor Apps Script satu kali saat setup.
 * Akhiran "_" menjadikan fungsi ini privat dari google.script.run.
 */
function setupHoiFinance_() {
  const props = PropertiesService.getScriptProperties();

  const emails = [
    props.getProperty('HOI_USER1_EMAIL'),
    props.getProperty('HOI_USER2_EMAIL')
  ].map(normalizeEmail_);

  const keys = [
    props.getProperty('HOI_USER1_KEY') || '',
    props.getProperty('HOI_USER2_KEY') || ''
  ];

  const invalidEmail = emails.some(
    email =>
      !/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/i.test(
        email
      )
  );

  if (invalidEmail || emails[0] === emails[1]) {
    throw new Error(
      'Isi dua email berbeda pada Script Properties.'
    );
  }

  if (
    keys.some(key => key.length < 32 || key.length > 256) ||
    keys[0] === keys[1]
  ) {
    throw new Error(
      'Gunakan dua kunci acak berbeda, masing-masing 32–256 karakter.'
    );
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const config = {
      sheetId: HOI_SHEET_ID_,
      secret: randomToken_(),
      generation: randomToken_(),
      users: emails.map(email => ({
        email: email,
        name: email.split('@')[0]
      }))
    };

    config.users.forEach((user, index) => {
      user.keyHash = hmac_(
        user.email + '\n' + keys[index],
        config.secret
      );
    });

    initializeSheet_(config);

    props.setProperty(
      'HOI_CONFIG',
      JSON.stringify(config)
    );

    ['HOI_USER1_KEY', 'HOI_USER2_KEY'].forEach(name => {
      props.deleteProperty(name);
    });

    console.log(
      'HOI Finance siap untuk dua pengguna. ' +
      'Kunci mentah di Script Properties sudah dihapus.'
    );
  } finally {
    lock.releaseLock();
  }
}

function apiLogin(email, accessKey) {
  return apiResult_(function () {
    email = normalizeEmail_(email);

    if (
      typeof accessKey !== 'string' ||
      accessKey.length > 256 ||
      email.length > 254
    ) {
      fail_(
        'AUTH',
        'Email atau kunci akses tidak sesuai.'
      );
    }

    const config = config_();
    const cache = CacheService.getScriptCache();
    const lock = LockService.getScriptLock();

    lock.waitLock(30000);

    try {
      const slot =
        'login:' + hmac_(email, config.secret);

      const attempts = Number(cache.get(slot) || 0);

      if (attempts >= 5) {
        fail_(
          'RATE_LIMIT',
          'Terlalu banyak percobaan. Tunggu 15 menit lalu coba lagi.'
        );
      }

      const user = config.users.find(
        item => item.email === email
      );

      const actual = hmac_(
        email + '\n' + accessKey,
        config.secret
      );

      if (
        !user ||
        !constantEqual_(user.keyHash, actual)
      ) {
        cache.put(
          slot,
          String(attempts + 1),
          900
        );

        fail_(
          'AUTH',
          'Email atau kunci akses tidak sesuai.'
        );
      }

      cache.remove(slot);

      const token = randomToken_();

      const expiresAt =
        Date.now() + HOI_SESSION_SECONDS_ * 1000;

      cache.put(
        'session:' + hmac_(token, config.secret),
        JSON.stringify({
          email: user.email,
          generation: config.generation,
          expiresAt: expiresAt
        }),
        HOI_SESSION_SECONDS_
      );

      return {
        token: token,
        user: {
          email: user.email,
          name: user.name
        },
        expiresAt: expiresAt
      };
    } finally {
      lock.releaseLock();
    }
  });
}

function apiRead(token) {
  return apiResult_(function () {
    const session = authenticate_(token);
    const lock = LockService.getScriptLock();

    lock.waitLock(30000);

    try {
      return response_(
        session,
        readState_(session.config)
      );
    } finally {
      lock.releaseLock();
    }
  });
}

function apiWrite(token, mutation) {
  return apiResult_(function () {
    const session = authenticate_(token);
    const lock = LockService.getScriptLock();

    lock.waitLock(30000);

    try {
      const op = validateMutation_(mutation);
      const state = readState_(session.config);
      const prior = state.events[op.eventId];

      /*
       * Jika respons sebelumnya hilang, event yang sama
       * tidak ditulis ulang.
       */
      if (prior) {
        if (
          prior[2] !== op.id ||
          prior[3] !== op.action ||
          (prior[4] || '') !== op.baseVersion ||
          prior[5] !== op.payload ||
          prior[6] !== session.user.email
        ) {
          fail_(
            'CONFLICT',
            'ID permintaan sudah digunakan untuk perubahan berbeda.'
          );
        }

        if (state.rejected[op.eventId]) {
          fail_(
            'CONFLICT',
            'Perubahan bertabrakan. Sinkron ulang lalu buka ulang transaksi.'
          );
        }

        return response_(session, state);
      }

      const current = state.entities[op.id];

      if (
        (current ? current.version : '') !== op.baseVersion ||
        (
          op.action === 'delete' &&
          (!current || current.deleted)
        ) ||
        (current && current.deleted)
      ) {
        fail_(
          'CONFLICT',
          'Transaksi sudah berubah. Sinkron ulang lalu buka ulang transaksi; draft Anda belum disimpan.'
        );
      }

      // Only additions need duplicate confirmation. Always check the latest Sheet under lock.
      if (op.action === 'put' && !current) {
        const details = duplicateDetails_(session, state, op);
        if (details && !constantEqual_(
          details.confirmationKey,
          typeof mutation.confirmationKey === 'string' ? mutation.confirmationKey : ''
        )) {
          const error = new Error('Ada transaksi dengan tanggal dan nominal yang sama.');
          error.hoiCode = 'DUPLICATE';
          error.details = details;
          throw error;
        }
      }

      const row = [
        '1',
        op.eventId,
        op.id,
        op.action,
        op.baseVersion,
        op.payload,
        session.user.email,
        session.user.name,
        new Date().toISOString()
      ];

      const sheet = sheet_(session.config);
      const nextRow = sheet.getLastRow() + 1;

      if (nextRow > sheet.getMaxRows()) {
        sheet.insertRowsAfter(
          sheet.getMaxRows(),
          1000
        );
      }

      sheet
        .getRange(nextRow, 1, 1, HEADER_.length)
        .setNumberFormat('@')
        .setValues([row]);

      SpreadsheetApp.flush();

      return response_(
        session,
        readState_(session.config)
      );
    } finally {
      lock.releaseLock();
    }
  });
}

function duplicateDetails_(session, state, op) {
  const incoming = JSON.parse(op.payload);
  const matches = state.records.filter(function (record) {
    return record.id !== op.id &&
      record.date === incoming.date &&
      record.amount === incoming.amount;
  });
  if (!matches.length) return null;
  const versions = matches.map(function (record) {
    return [record.id, record.version];
  }).sort(function (a, b) {
    return a[0].localeCompare(b[0]);
  });
  // The proof is bound to this user, exact draft, event ID and current duplicate set.
  const confirmationKey = hmac_(JSON.stringify({
    user: session.user.email,
    eventId: op.eventId,
    id: op.id,
    payload: op.payload,
    matches: versions
  }), session.config.secret);
  return {
    confirmationKey: confirmationKey,
    count: matches.length,
    date: incoming.date,
    amount: incoming.amount,
    duplicates: matches.slice(0, 5).map(function (record) {
      return {
        name: record.name,
        type: record.type,
        recorder: record.recorder || record.updatedBy || ''
      };
    })
  };
}

function apiLogout(token) {
  return apiResult_(function () {
    const session = authenticate_(token);

    CacheService
      .getScriptCache()
      .remove(
        'session:' +
        hmac_(token, session.config.secret)
      );

    return {};
  });
}

function response_(session, state) {
  return {
    records: state.records,
    user: {
      email: session.user.email,
      name: session.user.name
    },
    expiresAt: session.expiresAt
  };
}

function apiResult_(fn) {
  try {
    return {ok: true, data: fn()};
  } catch (error) {
    const result = {
      ok: false,
      code: error.hoiCode || 'SERVER',
      message: error.hoiCode ? error.message :
        'Layanan belum tersedia. Periksa setup, izin Sheet, atau kuota Apps Script; lalu coba lagi.'
    };
    if (error.hoiCode === 'DUPLICATE' && error.details) {
      result.details = error.details;
    }
    return result;
  }
}

function fail_(code, message) {
  const error = new Error(message);
  error.hoiCode = code;
  throw error;
}

function config_() {
  const raw = PropertiesService
    .getScriptProperties()
    .getProperty('HOI_CONFIG');

  if (!raw) {
    fail_(
      'SETUP',
      'Aplikasi belum disiapkan oleh pemilik. Jalankan setupHoiFinance_ dari editor Apps Script.'
    );
  }

  return JSON.parse(raw);
}

function authenticate_(token) {
  if (
    typeof token !== 'string' ||
    token.length < 50 ||
    token.length > 200
  ) {
    fail_('SESSION', 'Sesi berakhir. Login kembali.');
  }

  const config = config_();

  const raw = CacheService
    .getScriptCache()
    .get(
      'session:' + hmac_(token, config.secret)
    );

  if (!raw) {
    fail_('SESSION', 'Sesi berakhir. Login kembali.');
  }

  const stored = JSON.parse(raw);

  const user = config.users.find(
    item => item.email === stored.email
  );

  if (
    !user ||
    stored.generation !== config.generation ||
    stored.expiresAt <= Date.now()
  ) {
    fail_('SESSION', 'Sesi berakhir. Login kembali.');
  }

  return {
    config: config,
    user: user,
    expiresAt: stored.expiresAt
  };
}

function randomToken_() {
  return (
    Utilities.getUuid().replace(/-/g, '') +
    Utilities.getUuid().replace(/-/g, '')
  );
}

function hmac_(value, secret) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(
      value,
      secret,
      Utilities.Charset.UTF_8
    )
  );
}

function constantEqual_(a, b) {
  let diff = a.length ^ b.length;

  for (
    let index = 0;
    index < Math.max(a.length, b.length);
    index++
  ) {
    diff |=
      (a.charCodeAt(index) || 0) ^
      (b.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function normalizeEmail_(value) {
  return typeof value === 'string'
    ? value.trim().toLowerCase()
    : '';
}

function setupHoiFinance() {
  const activeEmail = Session.getActiveUser().getEmail();
  const ownerEmail = Session.getEffectiveUser().getEmail();

  if (
    !activeEmail ||
    activeEmail.toLowerCase() !== ownerEmail.toLowerCase()
  ) {
    throw new Error(
      'Setup hanya boleh dijalankan oleh pemilik dari editor Apps Script.'
    );
  }

  setupHoiFinance_();
}