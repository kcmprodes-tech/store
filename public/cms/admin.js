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

  /* ---------- Dialog konfirmasi: <form data-confirm="Pesan"> atau <button data-confirm="…"> ---------- */
  var dialog = $('[data-confirm-dialog]');
  function confirmAction(message, options) {
    options = options || {};
    if (!dialog || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(message));
    $('[data-confirm-title]', dialog).textContent = options.title || 'Yakin?';
    $('[data-confirm-text]', dialog).textContent = message;
    var ok = $('[data-confirm-ok]', dialog);
    ok.textContent = options.okLabel || 'Ya, lanjutkan';
    ok.className = 'btn ' + (options.danger ? 'btn-danger' : 'btn-primary');
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
    var message = (submitter && submitter.getAttribute('data-confirm')) || form.getAttribute('data-confirm');
    if (!message || form.__confirmed) return;
    e.preventDefault();
    var danger = (submitter && submitter.hasAttribute('data-danger')) || form.hasAttribute('data-danger');
    confirmAction(message, { danger: danger, okLabel: (submitter && submitter.getAttribute('data-confirm-ok')) || form.getAttribute('data-confirm-ok') }).then(function (yes) {
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
    $$('[data-show-when]', form).forEach(function (el) {
      var rule = el.getAttribute('data-show-when').split('=');
      var value = fieldValue(form, rule[0]);
      if (value === null) return;
      var show = rule[1].split(',').indexOf(value) !== -1;
      el.hidden = !show;
      $$('input, select, textarea', el).forEach(function (input) { input.disabled = !show; });
    });
  }
  $$('form').forEach(function (form) {
    if (!$('[data-show-when]', form)) return;
    refreshConditional(form);
    on(form, 'change', function () { refreshConditional(form); });
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
