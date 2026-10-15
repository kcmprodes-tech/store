/* Form stok CMS: cari SKU, daftar barang masuk (banyak baris), dan pratinjau penyesuaian. */
(function () {
  'use strict';
  var CMS = window.CMS;
  if (!CMS) return;
  var $ = CMS.$;
  var $$ = CMS.$$;

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) { if (c) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return node;
  }

  /** Kotak pencarian SKU; onPick(item) dipanggil saat hasil dipilih. */
  function skuSearch(box, onPick, isPicked) {
    var input = $('[data-sku-search-input]', box);
    var results = $('[data-sku-results]', box);
    var timer = null;
    function run() {
      CMS.api('/admin/stok/api/sku?q=' + encodeURIComponent(input.value.trim()), { method: 'GET' }).then(function (data) {
        results.innerHTML = '';
        if (!data.items.length) results.appendChild(h('p', { class: 'help picker-none', text: 'SKU tidak ditemukan (hanya SKU yang stoknya dilacak).' }));
        data.items.forEach(function (item) {
          var picked = isPicked && isPicked(item);
          results.appendChild(h('div', { class: 'picker-item picker-result' }, [
            h('img', { class: 'thumb thumb-sm', src: item.image || '', alt: '' }),
            h('div', { class: 'list-main' }, [
              h('strong', { text: item.title }),
              h('span', { class: 'small muted', text: (item.variantName ? item.variantName + ' · ' : '') + item.sku + ' · tersedia ' + item.available }),
            ]),
            h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: picked, text: picked ? 'Sudah dipilih' : 'Pilih', onclick: function () {
              onPick(item);
              results.hidden = true;
              input.value = '';
            } }),
          ]));
        });
        results.hidden = false;
      }).catch(function (err) { CMS.toast(err.message, 'error'); });
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 250); });
    input.addEventListener('focus', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); if (e.key === 'Escape') results.hidden = true; });
    document.addEventListener('click', function (e) { if (!box.contains(e.target)) results.hidden = true; });
  }

  /* ---------- Barang masuk ---------- */
  var stockIn = $('[data-stock-in]');
  if (stockIn) {
    var list = $('[data-stock-list]', stockIn);
    var empty = $('[data-stock-empty]', stockIn);
    var rows = JSON.parse($('[data-stock-rows]', stockIn).textContent || '[]');
    var errors = JSON.parse($('[data-stock-errors]', stockIn).textContent || '{}') || {};
    function render() {
      list.innerHTML = '';
      empty.hidden = rows.length > 0;
      rows.forEach(function (row, i) {
        var qty = h('input', {
          class: 'input input-sm qty-input' + (errors['rows.' + i] ? ' is-invalid' : ''),
          type: 'number', min: '1', inputmode: 'numeric', name: 'rows[' + i + '][qty]', value: row.qty === undefined ? '' : String(row.qty),
          placeholder: 'Jumlah', 'aria-label': 'Jumlah masuk ' + row.sku, required: true,
          oninput: function (e) { row.qty = e.target.value; },
        });
        list.appendChild(h('li', { class: 'picker-item stock-row' }, [
          h('img', { class: 'thumb thumb-sm', src: row.image || '', alt: '' }),
          h('div', { class: 'list-main' }, [
            h('strong', { text: row.title }),
            h('span', { class: 'small muted', text: (row.variantName ? row.variantName + ' · ' : '') + row.sku + ' · fisik sekarang ' + row.onHand }),
            errors['rows.' + i] ? h('span', { class: 'field-error', text: errors['rows.' + i] }) : null,
          ]),
          h('input', { type: 'hidden', name: 'rows[' + i + '][variantId]', value: String(row.id) }),
          qty,
          h('button', { type: 'button', class: 'btn btn-danger btn-sm btn-icon', 'aria-label': 'Hapus ' + row.sku, text: '×', onclick: function () {
            rows.splice(i, 1);
            errors = {};
            render();
          } }),
        ]));
      });
    }
    skuSearch($('[data-sku-search]', stockIn), function (item) {
      rows.push(Object.assign({}, item, { qty: '' }));
      errors = {};
      render();
      var inputs = $$('.qty-input', list);
      if (inputs.length) inputs[inputs.length - 1].focus();
      stockIn.dispatchEvent(new Event('input', { bubbles: true }));
    }, function (item) { return rows.some(function (r) { return r.id === item.id; }); });
    render();
  }

  /* ---------- Penyesuaian ---------- */
  var adjust = $('[data-stock-adjust]');
  if (adjust) {
    var current = $('[data-adjust-current]', adjust);
    var idInput = $('[data-adjust-id]', adjust);
    var qtyInput = $('[data-adjust-qty]', adjust);
    var preview = $('[data-adjust-preview]', adjust);
    var onHand = Number($('[data-adjust-onhand]', adjust).textContent) || 0;
    var reserved = Number($('[data-adjust-reserved]', adjust).textContent) || 0;
    function updatePreview() {
      if (!preview) return;
      var qty = Number(qtyInput.value);
      if (!idInput.value || qtyInput.value === '' || !Number.isFinite(qty)) { preview.textContent = ''; return; }
      var mode = ($('input[name="mode"]:checked', adjust) || {}).value;
      var next = mode === 'delta' ? onHand + qty : qty;
      var delta = next - onHand;
      preview.textContent = 'Stok fisik ' + onHand + ' → ' + next + ' (' + (delta > 0 ? '+' : '') + delta + ')' + (next < reserved ? ' — lebih kecil dari jumlah dipesan (' + reserved + ')!' : '');
    }
    skuSearch($('[data-sku-search]', adjust), function (item) {
      idInput.value = item.id;
      onHand = item.onHand;
      reserved = item.reserved;
      $('[data-adjust-image]', adjust).src = item.image || '';
      $('[data-adjust-title]', adjust).textContent = item.title + (item.variantName ? ' · ' + item.variantName : '');
      $('[data-adjust-sku]', adjust).textContent = item.sku;
      $('[data-adjust-onhand]', adjust).textContent = item.onHand;
      $('[data-adjust-reserved]', adjust).textContent = item.reserved;
      current.hidden = false;
      updatePreview();
      qtyInput.focus();
    });
    qtyInput.addEventListener('input', updatePreview);
    adjust.addEventListener('change', updatePreview);
    updatePreview();
  }
})();
