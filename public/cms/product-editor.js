/* Editor produk CMS: foto, deskripsi, spesifikasi, opsi (Varian / Warna × Ukuran), dan daftar SKU.
   State awal dari <script data-product-state>; semua field dikirim sebagai form biasa (nama bersarang
   seperti variants[0][sku]) supaya server bisa memvalidasi & merender ulang dengan pesan error. */
(function () {
  'use strict';
  var form = document.querySelector('[data-product-form]');
  if (!form || !window.CMS) return;
  var CMS = window.CMS;
  var $ = CMS.$;
  var $$ = CMS.$$;
  var state = JSON.parse($('[data-product-state]', form).textContent || '{}');
  var errors = state.errors || {};
  var readOnly = form.querySelector('fieldset').disabled;
  var SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }
  function errorFor(key) {
    return errors[key] ? h('p', { class: 'field-error', text: errors[key] }) : null;
  }
  function changed() {
    form.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function iconBtn(label, symbol, onclick, cls, disabled) {
    return h('button', { type: 'button', class: 'btn btn-sm btn-icon ' + (cls || 'btn-secondary'), 'aria-label': label, title: label, onclick: onclick, disabled: disabled || readOnly }, [symbol]);
  }
  function move(list, i, d) {
    var j = i + d;
    if (j < 0 || j >= list.length) return;
    var tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
  }
  function str(v) { return v === null || v === undefined ? '' : String(v); }
  function slugUpper(text) { return CMS.slugify(str(text)).toUpperCase(); }

  /* ---------- Mode opsi & jenis produk ---------- */
  function mode() {
    var checked = $('input[name="optionMode"]:checked', form);
    return checked ? checked.value : 'NONE';
  }
  function physical() { return form.elements.type.value === 'PHYSICAL'; }

  /* ---------- Foto ---------- */
  var imagesBox = $('[data-images]', form);
  var images = (state.images || []).map(function (i) { return { url: str(i.url), alt: str(i.alt), color: str(i.color) }; });

  function renderImages() {
    imagesBox.innerHTML = '';
    if (!images.length) {
      imagesBox.appendChild(h('p', { class: 'help', text: 'Belum ada foto.' }));
      return;
    }
    var colors = mode() === 'APPAREL' ? warna.map(function (w) { return w.value; }).filter(Boolean) : [];
    images.forEach(function (img, i) {
      var colorSelect = null;
      if (colors.length) {
        colorSelect = h('select', { class: 'select input-sm', name: 'images[' + i + '][color]', 'aria-label': 'Foto untuk warna', onchange: function (e) { img.color = e.target.value; } },
          [h('option', { value: '', text: 'Semua warna' })].concat(colors.map(function (c) { return h('option', { value: c, text: 'Warna ' + c, selected: img.color === c }); })));
      }
      imagesBox.appendChild(h('div', { class: 'photo-card' + (errors['images.' + i + '.url'] ? ' is-invalid' : '') }, [
        h('div', { class: 'photo-media' }, [
          h('img', { src: img.url, alt: '', loading: 'lazy' }),
          i === 0 ? h('span', { class: 'photo-badge', text: 'Foto utama' }) : null,
          h('span', { class: 'photo-index', text: String(i + 1) }),
        ]),
        h('input', { type: 'hidden', name: 'images[' + i + '][url]', value: img.url }),
        h('input', { class: 'input input-sm', name: 'images[' + i + '][alt]', value: img.alt, placeholder: 'Teks alternatif (opsional)', 'aria-label': 'Teks alternatif foto ' + (i + 1), oninput: function (e) { img.alt = e.target.value; } }),
        colorSelect,
        errorFor('images.' + i + '.url'),
        h('div', { class: 'photo-actions' }, [
          iconBtn('Geser ke kiri', '←', function () { move(images, i, -1); renderImages(); renderVariants(); changed(); }, null, i === 0),
          iconBtn('Geser ke kanan', '→', function () { move(images, i, 1); renderImages(); renderVariants(); changed(); }, null, i === images.length - 1),
          iconBtn('Hapus foto', '×', function () { images.splice(i, 1); renderImages(); renderVariants(); changed(); }, 'btn-danger'),
        ]),
      ]));
    });
  }

  var uploadInput = $('[data-images-upload]', form);
  if (uploadInput) {
    uploadInput.addEventListener('change', function () {
      var files = Array.prototype.slice.call(uploadInput.files || []);
      uploadInput.value = '';
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          return CMS.uploadImage(file).then(function (url) {
            images.push({ url: url, alt: '', color: '' });
            renderImages();
            renderVariants();
            changed();
          }).catch(function (err) { CMS.toast(file.name + ': ' + err.message, 'error'); });
        });
      });
    });
  }
  var addUrl = $('[data-images-add-url]', form);
  if (addUrl) {
    addUrl.addEventListener('click', function () {
      var url = (window.prompt('Alamat foto (https://… atau /uploads/…)') || '').trim();
      if (!url) return;
      if (!/^(https:\/\/|\/(?!\/))/.test(url)) return CMS.toast('Alamat foto harus diawali https:// atau /', 'error');
      images.push({ url: url, alt: '', color: '' });
      renderImages();
      renderVariants();
      changed();
    });
  }

  /* ---------- Deskripsi (editor teks sederhana) ---------- */
  var rte = $('[data-rte]', form);
  if (rte) {
    var body = $('[data-rte-body]', rte);
    var hidden = $('[data-rte-input]', rte);
    if (readOnly) body.setAttribute('contenteditable', 'false');
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) { /* lama */ }
    function syncRte() { hidden.value = body.innerHTML.trim() === '<br>' ? '' : body.innerHTML; }
    body.addEventListener('input', syncRte);
    body.addEventListener('paste', function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData('text/plain');
      document.execCommand('insertText', false, text);
    });
    $$('[data-cmd]', rte).forEach(function (btn) {
      btn.addEventListener('mousedown', function (e) { e.preventDefault(); });
      btn.addEventListener('click', function () {
        var cmd = btn.getAttribute('data-cmd');
        body.focus();
        if (cmd === 'h3') {
          var block = document.queryCommandValue('formatBlock');
          document.execCommand('formatBlock', false, /h3/i.test(block) ? 'p' : 'h3');
        } else if (cmd === 'link') {
          var url = (window.prompt('Alamat link (https://…)') || '').trim();
          if (url && /^(https:\/\/|\/(?!\/)|mailto:)/.test(url)) document.execCommand('createLink', false, url);
          else if (url) CMS.toast('Link harus diawali https://', 'error');
        } else if (cmd === 'removeFormat') {
          document.execCommand('removeFormat');
          document.execCommand('unlink');
          document.execCommand('formatBlock', false, 'p');
        } else {
          document.execCommand(cmd);
        }
        syncRte();
      });
    });
    form.addEventListener('submit', syncRte, true);
  }

  /* ---------- Spesifikasi ---------- */
  var specsBox = $('[data-specs]', form);
  var specs = (state.specs || []).map(function (s) { return { label: str(s.label), value: str(s.value) }; });
  function renderSpecs() {
    specsBox.innerHTML = '';
    if (!specs.length) specsBox.appendChild(h('p', { class: 'help', text: 'Belum ada baris. Kosong = "Produk: <judul>".' }));
    specs.forEach(function (s, i) {
      specsBox.appendChild(h('div', { class: 'spec-row' }, [
        h('input', { class: 'input input-sm', name: 'specs[' + i + '][label]', value: s.label, placeholder: 'Label, mis. Bahan', 'aria-label': 'Label baris ' + (i + 1), oninput: function (e) { s.label = e.target.value; } }),
        h('input', { class: 'input input-sm', name: 'specs[' + i + '][value]', value: s.value, placeholder: 'Nilai, mis. Cotton combed 30s', 'aria-label': 'Nilai baris ' + (i + 1), oninput: function (e) { s.value = e.target.value; } }),
        h('div', { class: 'row-actions' }, [
          iconBtn('Naikkan', '↑', function () { move(specs, i, -1); renderSpecs(); changed(); }, null, i === 0),
          iconBtn('Turunkan', '↓', function () { move(specs, i, 1); renderSpecs(); changed(); }, null, i === specs.length - 1),
          iconBtn('Hapus baris', '×', function () { specs.splice(i, 1); renderSpecs(); changed(); }, 'btn-danger'),
        ]),
      ]));
    });
  }
  var specsAdd = $('[data-specs-add]', form);
  if (specsAdd) specsAdd.addEventListener('click', function () { specs.push({ label: '', value: '' }); renderSpecs(); $$('.spec-row input', specsBox).slice(-2)[0].focus(); changed(); });

  /* ---------- Opsi ---------- */
  var editorsBox = $('[data-option-editors]', form);
  var varian = (state.optVarian || []).map(function (o) { return { value: str(o.value) }; });
  var warna = (state.optWarna || []).map(function (o) { return { value: str(o.value), swatch: str(o.swatch) || '#FFFFFF' }; });
  var ukuran = (state.optUkuran || []).map(function (o) { return { value: str(o.value) }; });

  /** Ganti nama nilai opsi → SKU yang sama ikut berganti nama (stok & riwayatnya tetap). */
  function renameValue(field, from, to) {
    if (!from || from === to) return;
    variants.forEach(function (v) { if (v[field] === from) v[field] = to; });
    images.forEach(function (img) { if (field === 'warna' && img.color === from) img.color = to; });
  }

  function valueList(title, list, field, opts) {
    var wrap = h('div', { class: 'option-editor' }, [h('p', { class: 'label', text: title })]);
    list.forEach(function (item, i) {
      var input = h('input', {
        class: 'input input-sm' + (errors[opts.key + '.' + i] ? ' is-invalid' : ''),
        name: opts.key + '[' + i + '][value]',
        value: item.value,
        placeholder: opts.placeholder,
        'aria-label': title + ' ' + (i + 1),
      });
      input.dataset.prev = item.value;
      input.addEventListener('input', function () { item.value = input.value; });
      input.addEventListener('change', function () {
        var to = input.value.trim();
        renameValue(field, input.dataset.prev, to);
        item.value = to;
        input.dataset.prev = to;
        refreshOptions();
      });
      var row = [input];
      if (opts.swatch) {
        row.unshift(h('input', { type: 'color', class: 'swatch-input', name: opts.key + '[' + i + '][swatch]', value: item.swatch, 'aria-label': 'Warna swatch ' + (i + 1), oninput: function (e) { item.swatch = e.target.value; } }));
      }
      row.push(iconBtn('Naikkan', '↑', function () { move(list, i, -1); refreshOptions(); }, null, i === 0));
      row.push(iconBtn('Turunkan', '↓', function () { move(list, i, 1); refreshOptions(); }, null, i === list.length - 1));
      row.push(iconBtn('Hapus ' + (item.value || 'nilai'), '×', function () { list.splice(i, 1); refreshOptions(); }, 'btn-danger'));
      wrap.appendChild(h('div', { class: 'option-row' }, row));
      var err = errorFor(opts.key + '.' + i);
      if (err) wrap.appendChild(err);
    });
    var addRow = h('div', { class: 'row' }, [
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: readOnly, onclick: function () {
        list.push(opts.swatch ? { value: '', swatch: '#FFFFFF' } : { value: '' });
        refreshOptions();
        var inputs = $$('input[name^="' + opts.key + '"][name$="[value]"]', editorsBox);
        if (inputs.length) inputs[inputs.length - 1].focus();
      } }, ['+ ' + opts.addLabel]),
    ]);
    if (opts.presets) {
      addRow.appendChild(h('button', { type: 'button', class: 'btn btn-plain btn-sm', disabled: readOnly, onclick: function () {
        opts.presets.forEach(function (p) { if (!list.some(function (x) { return x.value === p; })) list.push({ value: p }); });
        refreshOptions();
      } }, ['Isi ' + opts.presets[0] + '–' + opts.presets[opts.presets.length - 1]]));
    }
    wrap.appendChild(addRow);
    var groupErr = errorFor(opts.key);
    if (groupErr) wrap.appendChild(groupErr);
    return wrap;
  }

  function renderEditors() {
    editorsBox.innerHTML = '';
    var m = mode();
    if (m === 'VARIAN') {
      editorsBox.appendChild(valueList('Varian', varian, 'varian', { key: 'optVarian', placeholder: 'mis. Bundling Plus', addLabel: 'Tambah varian' }));
    } else if (m === 'APPAREL') {
      editorsBox.appendChild(h('div', { class: 'grid grid-auto' }, [
        valueList('Warna', warna, 'warna', { key: 'optWarna', placeholder: 'mis. Hitam', addLabel: 'Tambah warna', swatch: true }),
        valueList('Ukuran', ukuran, 'ukuran', { key: 'optUkuran', placeholder: 'mis. XL', addLabel: 'Tambah ukuran', presets: SIZES }),
      ]));
    }
  }

  /* ---------- SKU ---------- */
  var variantsBox = $('[data-variants]', form);
  var bulk = $('[data-sku-bulk]', form);
  var variants = (state.variants || []).map(function (v) {
    return {
      id: str(v.id), sku: str(v.sku), price: str(v.price), priceOriginal: str(v.priceOriginal),
      isActive: v.isActive !== false, trackStock: v.trackStock !== false, lowStockThreshold: str(v.lowStockThreshold),
      imageIndex: str(v.imageIndex), varian: str(v.varian), warna: str(v.warna), ukuran: str(v.ukuran),
      stock: v.stock === undefined ? null : v.stock, hasHistory: Boolean(v.hasHistory),
    };
  });
  var removed = [];

  function keyOf(v, m) {
    if (m === 'VARIAN') return v.varian;
    if (m === 'APPAREL') return v.warna + '|' + v.ukuran;
    return 'default';
  }
  function combos(m) {
    if (m === 'VARIAN') return varian.map(function (o) { return o.value.trim(); }).filter(Boolean).map(function (v) { return { varian: v, warna: '', ukuran: '' }; });
    if (m === 'APPAREL') {
      var out = [];
      warna.forEach(function (w) {
        ukuran.forEach(function (u) {
          if (w.value.trim() && u.value.trim()) out.push({ varian: '', warna: w.value.trim(), ukuran: u.value.trim() });
        });
      });
      return out;
    }
    return [{ varian: '', warna: '', ukuran: '' }];
  }
  function suggestSku(c) {
    var base = slugUpper(form.elements.sku.value) || slugUpper(form.elements.slug.value) || 'SKU';
    var parts = [c.varian, c.warna, c.ukuran].filter(Boolean).map(slugUpper);
    return [base].concat(parts).join('-');
  }

  /** Susun ulang daftar SKU dari opsi: SKU lama dipertahankan (id, harga, stok), kombinasi baru ditambahkan. */
  function rebuildVariants() {
    var m = mode();
    var byKey = {};
    variants.forEach(function (v) { if (!byKey[keyOf(v, m)]) byKey[keyOf(v, m)] = v; });
    if (m === 'NONE' && !byKey.default && variants.length) byKey.default = variants[0];
    var template = variants[0] || {};
    var next = combos(m).map(function (c) {
      var hit = byKey[keyOf(c, m)];
      if (hit) {
        hit.varian = c.varian; hit.warna = c.warna; hit.ukuran = c.ukuran;
        return hit;
      }
      return {
        id: '', sku: suggestSku(c), price: str(template.price), priceOriginal: str(template.priceOriginal), isActive: true,
        trackStock: physical(), lowStockThreshold: '', imageIndex: '', varian: c.varian, warna: c.warna, ukuran: c.ukuran, stock: null, hasHistory: false,
      };
    });
    removed = variants.filter(function (v) { return v.id && next.indexOf(v) === -1; });
    variants = next;
  }

  function field(label, input, err) {
    return h('label', { class: 'sku-field' }, [h('span', { class: 'sku-field-label', text: label }), input, err]);
  }

  function renderVariants() {
    var m = mode();
    variantsBox.innerHTML = '';
    bulk.hidden = variants.length < 2 || readOnly;
    var phys = physical();
    variants.forEach(function (v, i) {
      var pre = 'variants[' + i + ']';
      var title = m === 'VARIAN' ? v.varian : m === 'APPAREL' ? v.warna + ' / ' + v.ukuran : 'SKU utama';
      var stockText = !phys || !v.trackStock ? 'Stok tidak dilacak' : v.stock === null ? 'Stok: 0 (baru)' : 'Stok tersedia: ' + v.stock;
      var imageSelect = null;
      if (m === 'VARIAN' && images.length) {
        imageSelect = field('Foto saat dipilih', h('select', { class: 'select input-sm', name: pre + '[imageIndex]', onchange: function (e) { v.imageIndex = e.target.value; } },
          [h('option', { value: '', text: 'Foto utama' })].concat(images.map(function (img, j) { return h('option', { value: String(j), text: 'Foto ' + (j + 1), selected: v.imageIndex === String(j) }); }))));
      }
      var card = h('div', { class: 'sku-card' + (v.isActive ? '' : ' is-inactive') }, [
        h('div', { class: 'sku-card-head' }, [
          h('strong', { text: title }),
          h('span', { class: 'small muted', text: stockText }),
          h('label', { class: 'switch switch-sm' }, [
            h('input', { type: 'checkbox', name: pre + '[isActive]', checked: v.isActive, onchange: function (e) { v.isActive = e.target.checked; card.classList.toggle('is-inactive', !v.isActive); } }),
            h('span', { text: 'Aktif' }),
          ]),
        ]),
        h('input', { type: 'hidden', name: pre + '[id]', value: v.id }),
        h('input', { type: 'hidden', name: pre + '[varian]', value: v.varian }),
        h('input', { type: 'hidden', name: pre + '[warna]', value: v.warna }),
        h('input', { type: 'hidden', name: pre + '[ukuran]', value: v.ukuran }),
        h('div', { class: 'sku-fields' }, [
          field('Kode SKU', h('input', { class: 'input input-sm mono' + (errors['variants.' + i + '.sku'] ? ' is-invalid' : ''), name: pre + '[sku]', value: v.sku, required: true, oninput: function (e) { v.sku = e.target.value; } }), errorFor('variants.' + i + '.sku')),
          field('Harga jual (Rp)', h('input', { class: 'input input-sm' + (errors['variants.' + i + '.price'] ? ' is-invalid' : ''), name: pre + '[price]', type: 'number', min: '0', inputmode: 'numeric', value: v.price, required: true, oninput: function (e) { v.price = e.target.value; } }), errorFor('variants.' + i + '.price')),
          field('Harga coret (Rp)', h('input', { class: 'input input-sm' + (errors['variants.' + i + '.priceOriginal'] ? ' is-invalid' : ''), name: pre + '[priceOriginal]', type: 'number', min: '0', inputmode: 'numeric', value: v.priceOriginal, placeholder: 'Tanpa diskon', oninput: function (e) { v.priceOriginal = e.target.value; } }), errorFor('variants.' + i + '.priceOriginal')),
          phys ? field('Ambang stok menipis', h('input', { class: 'input input-sm', name: pre + '[lowStockThreshold]', type: 'number', min: '0', inputmode: 'numeric', value: v.lowStockThreshold, placeholder: 'Default', oninput: function (e) { v.lowStockThreshold = e.target.value; } }), errorFor('variants.' + i + '.lowStockThreshold')) : null,
          imageSelect,
        ]),
        phys ? h('label', { class: 'check small' }, [h('input', { type: 'checkbox', name: pre + '[trackStock]', checked: v.trackStock, onchange: function (e) { v.trackStock = e.target.checked; renderVariants(); } }), h('span', { text: 'Lacak stok SKU ini' })]) : null,
        errorFor('variants.' + i + '.varian'),
        errorFor('variants.' + i + '.warna'),
      ]);
      variantsBox.appendChild(card);
    });
    if (removed.length) {
      variantsBox.appendChild(h('div', { class: 'alert alert-warning' }, [h('div', { class: 'alert-body' }, [
        h('p', { text: 'SKU yang tidak ada lagi di daftar opsi: ' + removed.map(function (v) { return v.sku; }).join(', ') + '.' }),
        h('p', { class: 'small', text: 'Saat disimpan, SKU yang punya riwayat stok/pesanan dinonaktifkan; yang belum pernah dipakai dihapus.' }),
      ])]));
    }
  }

  function refreshOptions() {
    rebuildVariants();
    renderEditors();
    renderVariants();
    renderImages();
    changed();
  }

  $$('input[name="optionMode"]', form).forEach(function (r) {
    r.addEventListener('change', function () {
      if (mode() === 'APPAREL' && !ukuran.length) SIZES.slice(1, 5).forEach(function (s) { ukuran.push({ value: s }); });
      refreshOptions();
    });
  });
  form.elements.type.addEventListener('change', function () {
    variants.forEach(function (v) { v.trackStock = physical(); });
    renderVariants();
  });

  var bulkApply = $('[data-bulk-apply]', form);
  if (bulkApply) {
    bulkApply.addEventListener('click', function () {
      var price = $('[data-bulk-price]', form).value;
      var original = $('[data-bulk-original]', form).value;
      variants.forEach(function (v) {
        if (price !== '') v.price = price;
        if (original !== '') v.priceOriginal = original;
      });
      renderVariants();
      changed();
      CMS.toast('Harga diterapkan ke ' + variants.length + ' SKU. Jangan lupa simpan.', 'success');
    });
  }

  renderEditors();
  renderVariants();
  renderImages();
  renderSpecs();
})();
