/* CMS Store Kompas.com — perilaku halaman (vanilla JS, tanpa dependensi).
   Semua fitur diaktifkan lewat atribut data-*, jadi halaman tetap bisa dipakai walau JS gagal dimuat. */
(function () {
  'use strict';

  var csrfMeta = document.querySelector('meta[name="csrf-token"]');
  var CSRF = csrfMeta ? csrfMeta.getAttribute('content') : '';

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(el, type, fn) { if (el) el.addEventListener(type, fn); }

  /** fetch ke CMS dengan token CSRF; hasil JSON. */
  function api(url, options) {
    options = options || {};
    var headers = Object.assign({ 'X-CSRF-Token': CSRF, 'X-Requested-With': 'fetch', Accept: 'application/json' }, options.headers || {});
    var body = options.body;
    if (body && !(body instanceof FormData) && !(body instanceof Blob) && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    return fetch(url, Object.assign({}, options, { headers: headers, body: body, credentials: 'same-origin' })).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw Object.assign(new Error(data.error || 'Gagal menyimpan. Coba lagi.'), { status: res.status, data: data });
        return data;
      });
    });
  }

  /** Toast singkat dari JS (sama dengan flash message server). */
  function toast(message, type) {
    var old = $('[data-toast]');
    if (old) old.remove();
    var el = document.createElement('div');
    el.className = 'toast is-' + (type || 'success');
    el.setAttribute('role', 'status');
    el.setAttribute('data-toast', '');
    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    var close = document.createElement('button');
    close.className = 'icon-btn';
    close.type = 'button';
    close.setAttribute('data-toast-close', '');
    close.setAttribute('aria-label', 'Tutup');
    close.textContent = '×';
    el.appendChild(text);
    el.appendChild(close);
    document.body.appendChild(el);
    initToast(el);
  }

  window.CMS = { api: api, toast: toast, csrf: CSRF, $: $, $$: $$ };

  /* ---------- Toast ---------- */
  function dismissToast(el) {
    el.classList.add('is-leaving');
    setTimeout(function () { el.remove(); }, 200);
  }
  function initToast(el) {
    if (!el) return;
    on($('[data-toast-close]', el), 'click', function () { dismissToast(el); });
    if (!el.classList.contains('is-error')) setTimeout(function () { if (el.isConnected) dismissToast(el); }, 5000);
  }
  initToast($('[data-toast]'));

  /* ---------- Sheet (menu Lainnya & akun di HP) ---------- */
  var lastOpener = null;
  function openSheet(sheet, opener) {
    lastOpener = opener;
    sheet.hidden = false;
    document.body.style.overflow = 'hidden';
    var first = $('a, button, input', sheet);
    if (first) first.focus();
  }
  function closeSheet(sheet) {
    sheet.hidden = true;
    document.body.style.overflow = '';
    if (lastOpener) lastOpener.focus();
  }
  $$('[data-sheet-open]').forEach(function (btn) {
    on(btn, 'click', function () {
      var sheet = document.getElementById(btn.getAttribute('data-sheet-open'));
      if (sheet) openSheet(sheet, btn);
    });
  });
  $$('[data-sheet]').forEach(function (sheet) {
    on(sheet, 'click', function (e) { if (e.target === sheet) closeSheet(sheet); });
  });
  on(document, 'keydown', function (e) {
    if (e.key !== 'Escape') return;
    $$('[data-sheet]').forEach(function (sheet) { if (!sheet.hidden) closeSheet(sheet); });
  });

  /* ---------- Dialog konfirmasi (pola AlertDialog shadcn/ui) ----------
     <form data-confirm="Hapus X? Tindakan ini tidak bisa dibatalkan." data-confirm-ok="Hapus" data-danger data-confirm-icon="trash">
     Teks sampai tanda tanya pertama jadi judul, sisanya deskripsi (atau pakai data-confirm-title).
     Ikon: question (default), warning (default bila data-danger), trash, check. */
  var dialog = $('[data-confirm-dialog]');
  function splitMessage(message) {
    var m = /^([^?]*\?)\s+([\s\S]+)$/.exec(message || '');
    return m ? { title: m[1], description: m[2] } : { title: message || 'Yakin?', description: '' };
  }
  function confirmAction(message, options) {
    options = options || {};
    var parts = options.title ? { title: options.title, description: message || '' } : splitMessage(message);
    if (!dialog || typeof dialog.showModal !== 'function') {
      return Promise.resolve(window.confirm([parts.title, parts.description].filter(Boolean).join('\n\n')));
    }
    $('[data-confirm-title]', dialog).textContent = parts.title;
    var text = $('[data-confirm-text]', dialog);
    text.textContent = parts.description;
    text.hidden = !parts.description;
    dialog.setAttribute('data-tone', options.danger ? 'danger' : 'default');
    dialog.setAttribute('data-media', options.icon || (options.danger ? 'warning' : 'question'));
    var ok = $('[data-confirm-ok]', dialog);
    ok.textContent = options.okLabel || 'Ya, lanjutkan';
    ok.className = 'btn ' + (options.danger ? 'btn-destructive' : 'btn-primary');
    $('[data-confirm-cancel]', dialog).textContent = options.cancelLabel || 'Batal';
    dialog.returnValue = '';
    dialog.showModal();
    return new Promise(function (resolve) {
      dialog.addEventListener('close', function handler() {
        dialog.removeEventListener('close', handler);
        resolve(dialog.returnValue === 'ok');
      });
    });
  }
  window.CMS.confirm = confirmAction;

  on(document, 'submit', function (e) {
    var form = e.target;
    var submitter = e.submitter;
    var attr = function (name) { return (submitter && submitter.getAttribute(name)) || form.getAttribute(name); };
    var message = attr('data-confirm');
    if (!message || form.__confirmed) return;
    e.preventDefault();
    var danger = (submitter && submitter.hasAttribute('data-danger')) || form.hasAttribute('data-danger');
    confirmAction(message, {
      danger: danger,
      title: attr('data-confirm-title'),
      icon: attr('data-confirm-icon'),
      okLabel: attr('data-confirm-ok'),
      cancelLabel: attr('data-confirm-cancel'),
    }).then(function (yes) {
      if (!yes) return;
      form.__confirmed = true;
      if (submitter && submitter.name) {
        var hidden = document.createElement('input');
        hidden.type = 'hidden';
        hidden.name = submitter.name;
        hidden.value = submitter.value;
        form.appendChild(hidden);
      }
      form.submit();
    });
  }, true);

  /* ---------- Cegah kirim ganda ---------- */
  on(document, 'submit', function (e) {
    var form = e.target;
    if (e.defaultPrevented || !form.hasAttribute('data-busy-form')) return;
    form.__dirty = false;
    setTimeout(function () {
      $$('button[type="submit"], button:not([type])', form).forEach(function (b) { b.disabled = true; });
    }, 0);
  });

  /* ---------- Peringatan perubahan belum disimpan ---------- */
  $$('form[data-dirty-guard]').forEach(function (form) {
    form.__dirty = false;
    on(form, 'input', function () { form.__dirty = true; });
    on(form, 'change', function () { form.__dirty = true; });
    on(form, 'submit', function () { form.__dirty = false; });
  });
  window.addEventListener('beforeunload', function (e) {
    var dirty = $$('form[data-dirty-guard]').some(function (f) { return f.__dirty; });
    if (dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  /* ---------- Tampilkan/sembunyikan password ---------- */
  $$('[data-toggle-password]').forEach(function (btn) {
    on(btn, 'click', function () {
      var input = document.getElementById(btn.getAttribute('data-toggle-password'));
      if (!input) return;
      var show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.setAttribute('aria-label', show ? 'Sembunyikan password' : 'Tampilkan password');
    });
  });

  /* ---------- Slug otomatis dari judul (selama slug belum diubah manual) ---------- */
  function slugify(text) {
    return text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
  }
  window.CMS.slugify = slugify;
  $$('[data-slug-source]').forEach(function (source) {
    var target = document.getElementById(source.getAttribute('data-slug-source'));
    if (!target) return;
    var touched = target.value !== '' && target.value !== slugify(source.value);
    on(target, 'input', function () { touched = target.value !== ''; });
    on(source, 'input', function () { if (!touched) target.value = slugify(source.value); });
  });

  /* ---------- Tampil/sembunyi bagian form sesuai pilihan: data-show-when="nama=nilai1,nilai2" ---------- */
  function fieldValue(form, name) {
    var field = form.elements[name];
    if (!field) return null;
    if (typeof RadioNodeList !== 'undefined' && field instanceof RadioNodeList) {
      var checked = Array.prototype.find.call(field, function (r) { return r.checked; });
      return checked ? checked.value : '';
    }
    if (field.type === 'checkbox') return field.checked ? 'on' : '';
    return field.value;
  }
  function refreshConditional(form) {
    var blocks = $$('[data-show-when]', form);
    blocks.forEach(function (el) {
      var rule = el.getAttribute('data-show-when').split('=');
      var value = fieldValue(form, rule[0]);
      if (value === null) return;
      el.hidden = rule[1].split(',').indexOf(value) === -1;
    });
    // Input di bagian yang tersembunyi (termasuk bagian bertingkat) tidak ikut dikirim.
    blocks.forEach(function (el) {
      $$('input, select, textarea', el).forEach(function (input) {
        input.disabled = !!input.closest('[data-show-when][hidden]');
      });
    });
  }
  $$('form').forEach(function (form) {
    if (!$('[data-show-when]', form)) return;
    refreshConditional(form);
    on(form, 'change', function () { refreshConditional(form); });
  });

  /* ---------- Upload gambar (satu file per request ke /admin/upload) ---------- */
  var MAX_IMAGE = 5 * 1024 * 1024;
  function uploadImage(file) {
    if (['image/jpeg', 'image/png', 'image/webp'].indexOf(file.type) === -1) {
      return Promise.reject(new Error('Format foto harus JPG, PNG, atau WebP.'));
    }
    if (file.size > MAX_IMAGE) return Promise.reject(new Error('Ukuran foto maksimal 5 MB.'));
    return api('/admin/upload', { method: 'POST', body: file, headers: { 'Content-Type': file.type } }).then(function (d) { return d.url; });
  }
  window.CMS.uploadImage = uploadImage;

  $$('[data-image-field]').forEach(function (box) {
    var input = $('[data-image-url]', box);
    var file = $('[data-image-file]', box);
    var preview = $('[data-image-preview]', box);
    var empty = $('[data-image-empty]', box);
    var label = $('[data-image-upload-label]', box);
    function show() {
      var url = input.value.trim();
      preview.hidden = !url;
      empty.hidden = !!url;
      if (url) preview.src = url;
    }
    on(input, 'input', show);
    on(preview, 'error', function () { preview.hidden = true; empty.hidden = false; });
    on(file, 'change', function () {
      var f = file.files && file.files[0];
      if (!f) return;
      box.classList.add('is-uploading');
      label.textContent = 'Mengunggah…';
      uploadImage(f).then(function (url) {
        input.value = url;
        show();
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }).catch(function (err) { toast(err.message, 'error'); }).then(function () {
        box.classList.remove('is-uploading');
        label.textContent = 'Unggah foto';
        file.value = '';
      });
    });
  });

  /* ---------- Pemilih produk berurutan (seksi & koleksi) ---------- */
  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }
  function iconButton(cls, label, symbol, attr, value) {
    var b = el('button', 'btn btn-sm btn-icon ' + cls, symbol);
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.setAttribute(attr, value);
    return b;
  }
  function productRow(p, withControls) {
    var li = el('li', 'picker-item');
    li.setAttribute('data-id', p.id);
    var img = el('img', 'thumb thumb-sm');
    img.src = p.image || '';
    img.alt = '';
    var main = el('div', 'list-main');
    main.appendChild(el('strong', null, p.title));
    main.appendChild(el('span', 'small muted', [p.price, p.status].filter(Boolean).join(' · ')));
    li.appendChild(img);
    li.appendChild(main);
    if (withControls) {
      li.appendChild(iconButton('btn-secondary', 'Naikkan', '↑', 'data-picker-move', '-1'));
      li.appendChild(iconButton('btn-secondary', 'Turunkan', '↓', 'data-picker-move', '1'));
      li.appendChild(iconButton('btn-danger', 'Hapus dari daftar', '×', 'data-picker-remove', ''));
    }
    return li;
  }
  window.CMS.productRow = productRow;

  $$('[data-picker]').forEach(function (picker) {
    var input = $('[data-picker-input]', picker);
    var list = $('[data-picker-list]', picker);
    var search = $('[data-picker-search]', picker);
    var results = $('[data-picker-results]', picker);
    var empty = $('[data-picker-empty]', picker);
    function sync() {
      var ids = $$('.picker-item', list).map(function (li) { return li.getAttribute('data-id'); });
      input.value = ids.join(',');
      empty.hidden = ids.length > 0;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    on(list, 'click', function (e) {
      var btn = e.target.closest('button');
      if (!btn) return;
      var li = btn.closest('.picker-item');
      if (btn.hasAttribute('data-picker-remove')) li.remove();
      var move = btn.getAttribute('data-picker-move');
      if (move === '-1' && li.previousElementSibling) list.insertBefore(li, li.previousElementSibling);
      if (move === '1' && li.nextElementSibling) list.insertBefore(li.nextElementSibling, li);
      sync();
    });
    var timer = null;
    function runSearch() {
      api('/admin/api/produk?q=' + encodeURIComponent(search.value.trim()), { method: 'GET' }).then(function (data) {
        results.innerHTML = '';
        var chosen = input.value ? input.value.split(',') : [];
        if (!data.items.length) results.appendChild(el('p', 'help picker-none', 'Produk tidak ditemukan.'));
        data.items.forEach(function (p) {
          var row = productRow(p, false);
          row.classList.add('picker-result');
          var added = chosen.indexOf(String(p.id)) !== -1;
          var add = el('button', 'btn btn-ghost btn-sm', added ? 'Sudah dipilih' : 'Tambah');
          add.type = 'button';
          add.disabled = added;
          on(add, 'click', function () {
            list.appendChild(productRow(p, true));
            add.disabled = true;
            add.textContent = 'Sudah dipilih';
            sync();
          });
          row.appendChild(add);
          results.appendChild(row);
        });
        results.hidden = false;
      }).catch(function (err) { toast(err.message, 'error'); });
    }
    on(search, 'input', function () {
      clearTimeout(timer);
      timer = setTimeout(runSearch, 250);
    });
    on(search, 'focus', function () { if (!results.innerHTML) runSearch(); else results.hidden = false; });
    on(search, 'keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Escape') results.hidden = true; });
    on(document, 'click', function (e) { if (!picker.contains(e.target)) results.hidden = true; });
  });

  /* ---------- Pratinjau isi aturan otomatis ---------- */
  $$('[data-rules-preview]').forEach(function (box) {
    var form = box.closest('form');
    var list = $('[data-rules-preview-list]', box);
    var limitName = box.getAttribute('data-limit-field');
    var timer = null;
    function refresh() {
      var params = new URLSearchParams();
      ['ruleCategory', 'ruleSort', 'ruleRecentDays'].forEach(function (n) { if (form.elements[n]) params.set(n, form.elements[n].value); });
      if (form.elements.ruleDiscounted && form.elements.ruleDiscounted.checked) params.set('ruleDiscounted', 'on');
      if (limitName && form.elements[limitName]) params.set('limit', form.elements[limitName].value || '8');
      api('/admin/api/pratinjau?' + params.toString(), { method: 'GET' }).then(function (data) {
        list.innerHTML = '';
        if (!data.items.length) list.appendChild(el('p', 'help', 'Tidak ada produk yang cocok dengan aturan ini — seksi tidak akan tampil.'));
        data.items.forEach(function (p) { list.appendChild(productRow(p, false)); });
      }).catch(function () { list.innerHTML = ''; list.appendChild(el('p', 'help', 'Pratinjau gagal dimuat.')); });
    }
    on(form, 'input', function (e) {
      if (!e.target.name || (e.target.name.indexOf('rule') !== 0 && e.target.name !== limitName)) return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 300);
    });
    on(form, 'change', function (e) { if (e.target.name && e.target.name.indexOf('rule') === 0) refresh(); });
    if (!box.closest('[hidden]')) refresh();
    box.__refresh = refresh;
  });
  on(document, 'change', function (e) {
    if (e.target.name !== 'source') return;
    $$('[data-rules-preview]').forEach(function (box) { if (box.__refresh && !box.closest('[hidden]')) box.__refresh(); });
  });

  /* ---------- Salin teks: <button data-copy="id-input"> ---------- */
  $$('[data-copy]').forEach(function (btn) {
    on(btn, 'click', function () {
      var input = document.getElementById(btn.getAttribute('data-copy'));
      if (!input) return;
      var done = function () { toast('Disalin.', 'success'); };
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).then(done, function () { input.select(); });
      else { input.select(); document.execCommand('copy'); done(); }
    });
  });

  /* ---------- Cetak (label): <button data-print> ---------- */
  $$('[data-print]').forEach(function (btn) {
    on(btn, 'click', function () { window.print(); });
  });

  /* ---------- Filter otomatis: <select data-autosubmit> ---------- */
  $$('[data-autosubmit]').forEach(function (el) {
    on(el, 'change', function () { if (el.form) el.form.submit(); });
  });

  /* ---------- PWA ---------- */
  if ('serviceWorker' in navigator && location.pathname.indexOf('/admin') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/admin/sw.js', { scope: '/admin/' }).catch(function () { /* opsional */ });
    });
  }
})();
