/* ============================================================
   store-v2.js — client interactions for the Store v2 prototype
   Vanilla JS only (no jQuery). Self-contained per widget; safe to
   load on every store-v2 page (each feature no-ops if absent).
   Mirrors the reference (localhost:4173) behaviour for the widgets
   that don't need the SPA's full re-render loop.
   ============================================================ */
(function () {
  'use strict';

  /* Preview links: ?login=0 → logged-out prototype state, ?login=1 → logged in (kept for the next pages) */
  (function applyLoginParam() {
    try {
      var p = new URLSearchParams(location.search).get('login');
      if (p === '0') localStorage.removeItem('store-v2-authenticated');
      else if (p === '1') localStorage.setItem('store-v2-authenticated', 'true');
    } catch (e) {}
  })();

  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  var rupiah = new Intl.NumberFormat('id-ID');
  function digits(str) { return Number(String(str).replace(/[^0-9]/g, '')) || 0; }
  /* judul di breadcrumb maks 50 karakter + elipsis (sama dengan crumbTitle di src/view/mappers.ts) */
  function crumbTitle(str) { return str.length > 50 ? str.slice(0, 49).trimEnd() + '\u2026' : str; }

  /* Toast / snackbar (bottom-center, auto-dismiss) */
  var toastTimer = null;
  function showToast(message) {
    var t = document.querySelector('.sv2-toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'sv2-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      t.innerHTML = '<svg class="sv2-toast-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="m8.5 12 2.4 2.4 4.6-4.8"></path></svg><span class="sv2-toast-msg"></span>';
      document.body.appendChild(t);
    }
    t.querySelector('.sv2-toast-msg').textContent = message;
    t.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('is-visible'); }, 2600);
  }

  /* ---------- 1. Hero carousel (home) ---------- */
  function initHeroCarousel() {
    var hero = document.querySelector('[data-hero-carousel]');
    if (!hero) return;
    var track = hero.querySelector('.hero-carousel-track');
    var slides = hero.querySelectorAll('.hero-slide');
    var dots = hero.querySelectorAll('[data-slide-index]');
    var n = slides.length;
    if (!track || n < 2) return;
    var cur = 0, timer = null, DURATION = 6000;

    function go(i) {
      cur = (i + n) % n;
      track.style.transform = 'translateX(-' + (cur * 100) + '%)';
      dots.forEach(function (d, k) { d.classList.toggle('is-active', k === cur); });
    }
    function play() { stop(); timer = setInterval(function () { go(cur + 1); }, DURATION); }
    function stop() { if (timer) clearInterval(timer); }

    var prev = hero.querySelector('[data-carousel="prev"]');
    var next = hero.querySelector('[data-carousel="next"]');
    if (prev) prev.addEventListener('click', function () { go(cur - 1); play(); });
    if (next) next.addEventListener('click', function () { go(cur + 1); play(); });
    dots.forEach(function (d) {
      d.addEventListener('click', function () { go(digits(d.getAttribute('data-slide-index'))); play(); });
    });
    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', play);
    play();
  }

  /* ---------- 2. Product gallery (detail) ---------- */
  function initProductGallery() {
    var gallery = document.querySelector('[data-pdp-gallery-swipe]');
    if (!gallery) return;
    var track = document.querySelector('[data-pdp-main-track]');
    var indicator = document.querySelector('[data-pdp-gallery-indicator]');
    var thumbs = document.querySelectorAll('[data-product-image]');
    var count = digits(gallery.getAttribute('data-gallery-count')) || thumbs.length || 1;

    function set(i) {
      i = Math.min(Math.max(i, 0), count - 1);
      gallery.setAttribute('data-current-image', String(i));
      if (track) track.style.transform = 'translate3d(-' + (i * 100) + '%, 0, 0)';
      if (indicator) {
        indicator.textContent = (i + 1) + '/' + count;
        indicator.setAttribute('aria-label', 'Gambar ' + (i + 1) + ' dari ' + count);
      }
      thumbs.forEach(function (t) {
        var active = digits(t.getAttribute('data-product-image')) === i;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-pressed', String(active));
      });
    }
    thumbs.forEach(function (t) {
      t.addEventListener('click', function () { set(digits(t.getAttribute('data-product-image'))); });
    });

    // thumbnail slider: 5 visible, arrows only when there are more
    var strip = document.querySelector('[data-pdp-thumbs-strip]');
    var prev = document.querySelector('[data-pdp-thumbs-prev]');
    var next = document.querySelector('[data-pdp-thumbs-next]');
    if (!strip || !prev || !next || thumbs.length <= 5) return;
    prev.hidden = false;
    next.hidden = false;
    var first = 0; // index of the left-most visible thumb
    function lastFirst() { return thumbs.length - 5; }
    function syncArrows() {
      prev.disabled = first <= 0;
      next.disabled = first >= lastFirst();
    }
    function show(i) {
      first = Math.min(Math.max(i, 0), lastFirst());
      strip.scrollTo({ left: thumbs[first].offsetLeft, behavior: 'smooth' });
      syncArrows();
    }
    prev.addEventListener('click', function () { show(first - 1); });
    next.addEventListener('click', function () { show(first + 1); });
    window.addEventListener('resize', function () { show(first); });
    // after a touch swipe of the strip settles, re-derive the left-most thumb
    var settle;
    strip.addEventListener('scroll', function () {
      clearTimeout(settle);
      settle = setTimeout(function () {
        var step = thumbs[1].offsetLeft - thumbs[0].offsetLeft;
        if (step > 0) { first = Math.min(Math.round(strip.scrollLeft / step), lastFirst()); syncArrows(); }
      }, 150);
    }, { passive: true });
    // keep the active thumb in view when the main image changes (swipe / click)
    new MutationObserver(function () {
      var i = digits(gallery.getAttribute('data-current-image'));
      if (i < first) show(i);
      else if (i > first + 4) show(i - 4);
    }).observe(gallery, { attributes: true, attributeFilter: ['data-current-image'] });
    syncArrows();
  }

  /* ---------- CTA loading: selama menunggu halaman / proses berikutnya, teks CTA diganti ikon loader ----------
     Otomatis untuk CTA berupa link ke halaman lain di store; proses lain memanggil setCtaLoading() sendiri. */
  var CTA_SELECTOR = '.btn, .pdp-sheet-cta, .sv2-empty-btn, .sv2-promo-btn, .storev2-modal__btn, .storev2-addr__submit';
  function setCtaLoading(el, on) {
    if (!el) return;
    if (on) {
      el.style.setProperty('--sv2-loader-color', getComputedStyle(el).color); // loader = warna teks tombol
      el.classList.add('sv2-loading');
      el.setAttribute('aria-busy', 'true');
    } else {
      el.classList.remove('sv2-loading');
      el.removeAttribute('aria-busy');
      el.style.removeProperty('--sv2-loader-color');
    }
  }
  function initCtaLoading() {
    document.addEventListener('click', function (e) {
      // handler lain (login, bottom sheet, tombol nonaktif) yang membatalkan klik → tidak ada loading
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || !a.matches(CTA_SELECTOR) || a.target === '_blank' || a.hasAttribute('download')) return;
      var url = new URL(a.getAttribute('href'), location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // hanya pindah anchor
      setCtaLoading(a, true);
    });
    // kembali lewat tombol Back (halaman dari cache browser) → loader dihapus
    window.addEventListener('pageshow', function () {
      Array.prototype.forEach.call(document.querySelectorAll('.sv2-loading'), function (el) { setCtaLoading(el, false); });
    });
  }

  /* ---------- Detail transaksi: "Tanya pesanan ini" → WhatsApp store dengan no invoice terisi ---------- */
  function initWhatsappAsk() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-wa-ask]');
      if (!a) return;
      var invoice = '';
      Array.prototype.forEach.call(document.querySelectorAll('.od-item'), function (item) {
        var dt = item.querySelector('dt');
        if (dt && /no invoice/i.test(dt.textContent)) invoice = (item.querySelector('dd') || {}).textContent || '';
      });
      var text = 'Halo Store Kompas.com, saya mau tanya pesanan ' + invoice.trim() + '.';
      a.setAttribute('href', 'https://wa.me/' + a.getAttribute('data-wa-number') + '?text=' + encodeURIComponent(text));
    }, true);
  }

  /* ---------- PDP lightbox: klik foto utama → popup 480×480, panah kiri/kanan, close kanan atas ----------
     Latar hitam 50%. Panah kiri tersembunyi di foto pertama, panah kanan di foto terakhir.
     Esc / klik latar = tutup, ← → = ganti foto, swipe di HP. Saat ditutup, galeri halaman ikut ke foto terakhir. */
  function initPdpLightbox() {
    var media = document.querySelector('[data-pdp-gallery-swipe]');
    var track = document.querySelector('[data-pdp-main-track]');
    if (!media || !track) return;
    var PH = { // Phosphor Icons (regular)
      left: 'M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z',
      right: 'M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z',
      x: 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z'
    };
    function icon(d) { return '<svg viewBox="0 0 256 256" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="' + d + '"/></svg>'; }
    var box = null, img, prev, next, closeBtn, counter, images = [], index = 0, lastFocus = null, touchX = null;

    function build() {
      box = document.createElement('div');
      box.className = 'sv2-lightbox';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      box.setAttribute('aria-label', 'Foto produk');
      box.innerHTML =
        '<div class="sv2-lightbox__backdrop" data-lightbox-close></div>' +
        '<div class="sv2-lightbox__stage">' +
          '<div class="sv2-lightbox__frame"><img class="sv2-lightbox__img" alt=""></div>' +
          '<span class="sv2-lightbox__counter" aria-live="polite"></span>' +
          '<button type="button" class="sv2-lightbox__close" data-lightbox-close aria-label="Tutup">' + icon(PH.x) + '</button>' +
          '<button type="button" class="sv2-lightbox__nav sv2-lightbox__nav--prev" data-lightbox-prev aria-label="Foto sebelumnya">' + icon(PH.left) + '</button>' +
          '<button type="button" class="sv2-lightbox__nav sv2-lightbox__nav--next" data-lightbox-next aria-label="Foto berikutnya">' + icon(PH.right) + '</button>' +
        '</div>';
      document.body.appendChild(box);
      img = box.querySelector('.sv2-lightbox__img');
      prev = box.querySelector('[data-lightbox-prev]');
      next = box.querySelector('[data-lightbox-next]');
      closeBtn = box.querySelector('.sv2-lightbox__close');
      counter = box.querySelector('.sv2-lightbox__counter');
      box.addEventListener('click', function (e) {
        if (e.target.closest('[data-lightbox-close]')) close();
        else if (e.target.closest('[data-lightbox-prev]')) show(index - 1);
        else if (e.target.closest('[data-lightbox-next]')) show(index + 1);
      });
      var stage = box.querySelector('.sv2-lightbox__stage');
      stage.addEventListener('touchstart', function (e) { touchX = e.touches[0].clientX; }, { passive: true });
      stage.addEventListener('touchend', function (e) {
        if (touchX === null) return;
        var dx = e.changedTouches[0].clientX - touchX;
        touchX = null;
        if (Math.abs(dx) > 40) show(index + (dx < 0 ? 1 : -1));
      });
    }
    function show(i) {
      index = Math.min(Math.max(i, 0), images.length - 1);
      img.src = images[index].src;
      img.alt = images[index].alt;
      prev.hidden = index === 0;
      next.hidden = index === images.length - 1;
      counter.textContent = (index + 1) + '/' + images.length;
      counter.hidden = images.length < 2;
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') show(index - 1);
      else if (e.key === 'ArrowRight') show(index + 1);
    }
    function open() {
      images = Array.prototype.map.call(track.querySelectorAll('img'), function (im) { return { src: im.currentSrc || im.src, alt: im.alt }; });
      if (!images.length) return;
      if (!box) build();
      lastFocus = document.activeElement;
      show(digits(media.getAttribute('data-current-image')));
      box.classList.add('is-open');
      document.documentElement.classList.add('sv2-lightbox-open');
      document.addEventListener('keydown', onKey);
      closeBtn.focus();
    }
    function close() {
      box.classList.remove('is-open');
      document.documentElement.classList.remove('sv2-lightbox-open');
      document.removeEventListener('keydown', onKey);
      // galeri halaman ikut ke foto terakhir yang dilihat
      var thumb = document.querySelector('.pdp-gallery [data-product-image="' + index + '"]');
      if (thumb) thumb.click();
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }
    media.classList.add('has-lightbox');
    media.addEventListener('click', open);
  }

  /* ---------- Riwayat pencarian: daftar "Terakhir dicari" saat kolom cari diklik ----------
     Disimpan per browser (localStorage), maks 5 kata kunci, terbaru di atas. */
  var RECENT_KEY = 'store-v2-recent-searches';
  var RECENT_MAX = 5;
  function loadRecentSearches() {
    try {
      var list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(list) ? list.filter(function (s) { return typeof s === 'string' && s; }) : [];
    } catch (e) { return []; }
  }
  function saveRecentSearches(list) {
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX))); } catch (e) {}
  }
  function rememberSearch(q) {
    q = String(q || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!q) return;
    var key = q.toLowerCase();
    saveRecentSearches([q].concat(loadRecentSearches().filter(function (s) { return s.toLowerCase() !== key; })));
  }
  function initRecentSearches() {
    // setiap halaman hasil pencarian dibuka (dari form, riwayat, atau tautan), kata kuncinya dicatat
    if (location.pathname === '/cari') rememberSearch(new URLSearchParams(location.search).get('q'));
    var CLOCK = 'M136,80v43.47l36.12,21.67a8,8,0,0,1-8.24,13.72l-40-24A8,8,0,0,1,120,128V80a8,8,0,0,1,16,0Zm-8-48A95.44,95.44,0,0,0,60.08,60.15C52.81,67.51,46.35,74.59,40,82V64a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H72a8,8,0,0,0,0-16H49c7.15-8.42,14.27-16.35,22.39-24.57a80,80,0,1,1,1.66,114.75,8,8,0,1,0-11,11.64A96,96,0,1,0,128,32Z';
    var X = 'M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z';
    function icon(d, size) { return '<svg viewBox="0 0 256 256" width="' + size + '" height="' + size + '" fill="currentColor" aria-hidden="true"><path d="' + d + '"/></svg>'; }
    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    Array.prototype.forEach.call(document.querySelectorAll('[data-store-search], [data-mobile-search]'), function (form) {
      var input = form.querySelector('input[name="q"]');
      if (!input) return;
      var panel = document.createElement('div');
      panel.className = 'sv2-recent';
      panel.setAttribute('role', 'group');
      panel.setAttribute('aria-label', 'Terakhir dicari');
      panel.hidden = true;
      form.appendChild(panel);

      var filtering = false; // saat baru diklik tampil semua; begitu mengetik, disaring sesuai ketikan
      function hide() { panel.hidden = true; }
      function render() {
        var typed = filtering ? input.value.trim().toLowerCase() : '';
        var items = loadRecentSearches().filter(function (s) { return !typed || s.toLowerCase().indexOf(typed) !== -1; });
        if (!items.length) { hide(); return; }
        panel.innerHTML =
          '<div class="sv2-recent__head"><span>Terakhir dicari</span><button type="button" class="sv2-recent__clear" data-recent-clear>Hapus semua</button></div>' +
          '<ul class="sv2-recent__list">' + items.map(function (s) {
            return '<li><a class="sv2-recent__item" href="/cari?q=' + encodeURIComponent(s) + '">' + icon(CLOCK, 20) + '<span>' + esc(s) + '</span></a>' +
              '<button type="button" class="sv2-recent__remove" data-recent-remove="' + esc(s) + '" aria-label="Hapus ' + esc(s) + ' dari riwayat">' + icon(X, 16) + '</button></li>';
          }).join('') + '</ul>';
        panel.hidden = false;
      }
      function links() { return Array.prototype.slice.call(panel.querySelectorAll('.sv2-recent__item')); }

      function open() { filtering = false; render(); }
      input.addEventListener('focus', open);
      input.addEventListener('click', function () { if (panel.hidden) open(); });
      input.addEventListener('input', function () { filtering = true; render(); });
      // klik di dalam daftar tidak memindahkan fokus dari kolom cari
      panel.addEventListener('mousedown', function (e) { if (!e.target.closest('a')) e.preventDefault(); });
      panel.addEventListener('click', function (e) {
        var remove = e.target.closest('[data-recent-remove]');
        if (e.target.closest('[data-recent-clear]')) {
          saveRecentSearches([]);
          hide();
          input.focus();
        } else if (remove) {
          var key = remove.getAttribute('data-recent-remove').toLowerCase();
          saveRecentSearches(loadRecentSearches().filter(function (s) { return s.toLowerCase() !== key; }));
          render();
          input.focus();
        }
      });
      // panah atas/bawah berpindah antar riwayat, Escape menutup daftar
      form.addEventListener('keydown', function (e) {
        if (panel.hidden) return;
        var list = links();
        var at = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' && list.length) {
          e.preventDefault();
          list[Math.min(at + 1, list.length - 1)].focus();
        } else if (e.key === 'ArrowUp' && at !== -1) {
          e.preventDefault();
          if (at === 0) input.focus(); else list[at - 1].focus();
        } else if (e.key === 'Escape') {
          e.stopPropagation();
          hide();
          input.focus();
        }
      });
      form.addEventListener('focusout', function (e) { if (!form.contains(e.relatedTarget)) hide(); });
      document.addEventListener('click', function (e) { if (!panel.hidden && !form.contains(e.target)) hide(); });
    });
  }

  /* ---------- Apparel PDP (detail-apparel.html?product=<id>) ----------
     The page is one template; the product (store.kompas.com apparel: photos, description, prices,
     stock per Warna × Ukuran) comes from the inline [data-apparel-data] JSON (db storev2.apparel).
     Runs before the gallery / purchase-state init so they pick up the rendered markup. */
  var apparelProduct = null;
  function initApparelPdp() {
    var main = document.querySelector('[data-pdp-apparel]');
    var dataEl = document.querySelector('[data-apparel-data]');
    if (!main || !dataEl) return;
    var list = [];
    try { list = JSON.parse(dataEl.textContent); } catch (e) {}
    if (!list.length) return;
    var id = new URLSearchParams(location.search).get('product');
    var p = list.filter(function (x) { return x.id === id; })[0] || list[0];
    apparelProduct = p;
    // aman untuk isi elemen DAN atribut (data produk berasal dari CMS)
    function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }
    document.title = p.title + ' - Store Kompas.com';
    each('[data-apparel-title], [data-sheet-title]', function (el) { el.textContent = p.title; });
    each('[data-apparel-crumb]', function (el) { el.textContent = crumbTitle(p.title); el.title = p.title; });
    each('[data-wishlist]', function (el) { if (!el.getAttribute('data-wishlist')) el.setAttribute('data-wishlist', p.id); });
    var track = document.querySelector('[data-pdp-main-track]');
    var strip = document.querySelector('[data-pdp-thumbs-strip]');
    var media = document.querySelector('[data-pdp-gallery-swipe]');
    if (track) track.innerHTML = p.images.map(function (src, i) {
      return '<img src="' + esc(src) + '" alt="' + esc(p.title) + ' ' + (i + 1) + '" draggable="false">';
    }).join('');
    if (strip) strip.innerHTML = p.images.map(function (src, i) {
      return '<button class="pdp-gallery-thumb' + (i ? '' : ' is-active') + '" type="button" data-product-image="' + i +
        '" aria-label="Lihat gambar ' + (i + 1) + '" aria-pressed="' + (i ? 'false' : 'true') + '"><img src="' + esc(src) + '" alt=""></button>';
    }).join('');
    if (media) media.setAttribute('data-gallery-count', String(p.images.length));
    var indicator = document.querySelector('[data-pdp-gallery-indicator]');
    if (indicator) indicator.textContent = '1/' + p.images.length;
    each('[data-sheet-image]', function (img) { img.src = p.images[0]; });
    each('[data-apparel-desc]', function (box) {
      var CHECK = '<span class="pdp-description-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4 4L19 6"></path></svg></span>';
      // descHtml: deskripsi HTML dari database; desc[]: paragraf polos (data prototipe)
      box.innerHTML = (p.descHtml || p.desc.map(function (para) { return '<p>' + esc(para) + '</p>'; }).join('')) +
        // video premium: what the purchase unlocks (store.kompas.com /video-premium/<id>/cart)
        (p.access && p.access.length ? '<h2 class="pdp-description-heading">Akses Video Eksklusif</h2><ul>' +
          p.access.map(function (li) { return '<li>' + CHECK + '<span>' + esc(li) + '</span></li>'; }).join('') + '</ul>' : '');
    });
    each('[data-video-meta]', function (el) {
      el.innerHTML = [p.playlist, p.date].filter(Boolean).map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('');
      el.hidden = !p.playlist && !p.date;
    });
    each('[data-apparel-specs]', function (ul) {
      var specs = p.specs ? p.specs.concat(['SKU: ' + p.sku]) : ['Produk: ' + p.title, 'Kategori: Merchandise · Apparel', 'Warna: Hitam, Putih, Grey',
        'Ukuran: XS, S, M, L, XL, XXL, XXXL', 'SKU: ' + p.sku];
      if (ul.children.length) return; // sudah dirender server
      ul.innerHTML = specs.map(function (li) {
        var i = li.indexOf(': ');
        return i > 0
          ? '<li><span class="pdp-spec-label">' + esc(li.slice(0, i)) + '</span><span class="pdp-spec-sep">:</span><span class="pdp-spec-value">' + esc(li.slice(i + 2)) + '</span></li>'
          : '<li><span class="pdp-spec-full">' + esc(li) + '</span></li>';
      }).join('');
    });
  }

  /* ---------- 3. PDP quantity stepper + subtotal ---------- */
  /* ---------- 3+4. PDP purchase state: variant chips, quantity, price, photo, mobile sheet ----------
     One state drives every [data-pdp-*] target on the page and in the mobile "Atur Pembelian" sheet.
     Variant data lives on the page chips (data-price / data-price-original / data-discount / data-stock / data-image). */
  function initPdpQuantity() {}
  function initPdpOptions() {
    var sheet = document.querySelector('[data-pdp-sheet]');
    var thumbs = document.querySelectorAll('[data-product-image]');
    var MAX = 99;
    // option axes: the classic single "Varian" row (variant data on the chips), or
    // apparel's Warna × Ukuran rows ([data-pdp-axis], price / stock from apparelProduct)
    var axes = [];
    var axisGroups = document.querySelectorAll('.pdp-options[data-pdp-axis]');
    var single = !axisGroups.length && !!apparelProduct && !document.querySelector('.pdp-options'); // e.g. video premium: no varian
    if (axisGroups.length && apparelProduct) {
      Array.prototype.forEach.call(axisGroups, function (g) {
        var name = g.getAttribute('data-pdp-axis');
        axes.push({ name: name, chips: Array.prototype.slice.call(g.querySelectorAll('button[data-value]')),
          sheetBox: sheet && sheet.querySelector('[data-sheet-options="' + name + '"]') });
      });
    } else if (!single) {
      var group = document.querySelector('.pdp-options');
      if (!group) return;
      axes.push({ name: 'format', chips: Array.prototype.slice.call(group.querySelectorAll('button[data-product-format]')),
        sheetBox: sheet && sheet.querySelector('[data-sheet-options]') });
    }
    if (axes.length && !axes[0].chips.length) return;
    var chips = axes.length ? axes[0].chips : []; // classic mode
    var state = { sel: {}, qty: 1 };
    axes.forEach(function (a) { state.sel[a.name] = 0; });

    function all(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
    function rp(n) { return 'Rp&nbsp;' + rupiah.format(n); }
    function valueOf(a) { return a.chips[state.sel[a.name]].getAttribute('data-value'); }
    function variant() {
      if (apparelProduct && (!axes.length || axes[0].name !== 'format')) {
        var p = apparelProduct;
        var picked = {};
        axes.forEach(function (a) { picked[a.name] = valueOf(a); });
        var row = (p.stock && p.stock[picked.color]) || {};
        return {
          name: axes.map(valueOf).join(', '),
          price: digits(p.price_disc),
          original: digits(p.price),
          discount: digits(p.disc),
          stock: picked.size in row ? row[picked.size] : MAX,
          // foto milik warna terpilih (colorImages dari database); warna tanpa foto → galeri tetap
          image: p.colorImages && picked.color in p.colorImages ? p.colorImages[picked.color] : -1
        };
      }
      var c = chips[state.sel.format];
      return {
        name: c.getAttribute('data-product-format'),
        price: digits(c.getAttribute('data-price')),
        original: digits(c.getAttribute('data-price-original')),
        discount: digits(c.getAttribute('data-discount')),
        stock: c.hasAttribute('data-stock') ? digits(c.getAttribute('data-stock')) : MAX, // 0 = sold out
        image: digits(c.getAttribute('data-image'))
      };
    }

    // sheet chips mirror the page chips
    axes.forEach(function (a) {
      a.sheetChips = [];
      if (!a.sheetBox) return;
      a.chips.forEach(function (c, i) {
        var b = document.createElement('button');
        b.type = 'button';
        if (a.name === 'format') b.textContent = c.getAttribute('data-product-format');
        else b.innerHTML = c.innerHTML;
        b.addEventListener('click', function () { select(a.name, i); });
        a.sheetBox.appendChild(b);
        a.sheetChips.push(b);
      });
    });

    // "Stock habis": dimmed main photo with a pill, buy / cart CTAs disabled (only for the sold-out variant)
    var media = document.querySelector('.pdp-main-media');
    var soldBadge = null;
    if (media) {
      soldBadge = document.createElement('div');
      soldBadge.className = 'pdp-soldout';
      soldBadge.hidden = true;
      soldBadge.innerHTML = '<span>Stock habis</span>';
      media.appendChild(soldBadge);
    }
    function setDisabled(el, off) {
      if (el.tagName === 'BUTTON') el.disabled = off;
      el.classList.toggle('is-disabled', off);
      if (off) { el.setAttribute('aria-disabled', 'true'); el.setAttribute('tabindex', '-1'); }
      else { el.removeAttribute('aria-disabled'); el.removeAttribute('tabindex'); }
    }
    // a disabled link must not navigate / open the sheet / trigger the login gate (all of those listen in capture)
    document.addEventListener('click', function (e) {
      var off = e.target.closest && e.target.closest('.is-disabled[aria-disabled="true"]');
      if (off) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);

    function render() {
      var v = variant();
      var soldOut = v.stock <= 0;
      var max = Math.max(1, Math.min(MAX, v.stock));
      if (state.qty > max) state.qty = max;
      axes.forEach(function (a) {
        [a.chips, a.sheetChips].forEach(function (list) {
          list.forEach(function (b, k) {
            b.classList.toggle('is-selected', k === state.sel[a.name]);
            b.setAttribute('aria-pressed', String(k === state.sel[a.name]));
          });
        });
        if (a.name !== 'format') all('[data-pdp-axis-name="' + a.name + '"]').forEach(function (el) { el.textContent = valueOf(a); });
      });
      all('[data-pdp-variant-name]').forEach(function (el) { el.textContent = v.name; });
      all('[data-pdp-price]').forEach(function (el) { el.innerHTML = rp(v.price); });
      all('[data-pdp-price-original]').forEach(function (el) { el.innerHTML = v.original ? rp(v.original) : ''; el.hidden = !v.original; });
      all('[data-pdp-discount]').forEach(function (el) { el.textContent = v.discount ? v.discount + '%' : ''; el.hidden = !v.discount; });
      all('[data-pdp-stock]').forEach(function (el) { el.textContent = soldOut ? 'Stock habis' : 'Stok ' + v.stock; });
      all('[data-pdp-qty]').forEach(function (el) { el.textContent = String(state.qty); });
      all('[data-pdp-subtotal]').forEach(function (el) { el.innerHTML = rp(v.price * state.qty); });
      all('[data-pdp-stepper]').forEach(function (box) {
        var minus = box.querySelector('[data-qty="minus"]');
        var plus = box.querySelector('[data-qty="plus"]');
        if (minus) minus.disabled = soldOut || state.qty <= 1;
        if (plus) plus.disabled = soldOut || state.qty >= max;
      });
      if (soldBadge) soldBadge.hidden = !soldOut;
      if (media) media.classList.toggle('is-sold-out', soldOut);
      all('[data-pdp-buy-link], [data-add-to-cart], [data-pdp-open-sheet], [data-sheet-cta]').forEach(function (el) { setDisabled(el, soldOut); });
      var sheetImg = sheet && sheet.querySelector('[data-sheet-image]');
      if (sheetImg) sheetImg.classList.toggle('is-sold-out', soldOut);
      all('[data-pdp-buy-link]').forEach(function (a) {
        var url = new URL(a.getAttribute('href'), location.href);
        url.searchParams.set('type', v.name);
        if (apparelProduct) url.searchParams.set('product', apparelProduct.id);
        url.searchParams.set('qty', String(state.qty));
        a.setAttribute('href', url.pathname + url.search);
      });
      var img = sheet && sheet.querySelector('[data-sheet-image]');
      var thumbImg = thumbs[v.image] && thumbs[v.image].querySelector('img');
      if (img && thumbImg) img.src = thumbImg.getAttribute('src');
    }
    function select(axis, i) {
      state.sel[axis] = i;
      render();
      var v = variant();
      if (thumbs[v.image]) thumbs[v.image].click(); // gallery follows the variant
    }
    function selectFirst() {
      axes.forEach(function (a) { state.sel[a.name] = 0; });
      render();
      var v = variant();
      if (thumbs[v.image]) thumbs[v.image].click();
    }

    axes.forEach(function (a) {
      a.chips.forEach(function (c, i) { c.addEventListener('click', function () { select(a.name, i); }); });
    });
    all('[data-pdp-stepper]').forEach(function (box) {
      box.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-qty]');
        if (!btn || btn.disabled) return;
        state.qty += btn.getAttribute('data-qty') === 'plus' ? 1 : -1;
        if (state.qty < 1) state.qty = 1;
        render();
      });
    });

    // ---- mobile bottom sheet ----
    var mobile = window.matchMedia('(max-width: 640px)');
    function openSheet(mode) {
      if (!sheet) return;
      sheet.querySelector('[data-sheet-cta="buy"]').hidden = mode !== 'buy';
      sheet.querySelector('[data-sheet-cta="cart"]').hidden = mode !== 'cart';
      sheet.hidden = false;
      document.documentElement.classList.add('pdp-sheet-lock');
      void sheet.offsetHeight; // commit the closed position so the slide-up transition runs (rAF can stall in background tabs)
      sheet.classList.add('is-open');
      document.addEventListener('keydown', onKey);
    }
    function closeSheet() {
      if (!sheet || sheet.hidden) return;
      sheet.classList.remove('is-open');
      document.documentElement.classList.remove('pdp-sheet-lock');
      document.removeEventListener('keydown', onKey);
      setTimeout(function () { if (!sheet.classList.contains('is-open')) sheet.hidden = true; }, 240);
    }
    function onKey(e) { if (e.key === 'Escape') closeSheet(); }
    if (sheet) {
      // capture phase so the bottom-bar "Beli Sekarang" opens the sheet before the login gate sees the click
      document.addEventListener('click', function (e) {
        var trigger = e.target.closest && e.target.closest('[data-pdp-open-sheet]');
        if (!trigger || !mobile.matches) return;
        e.preventDefault();
        e.stopImmediatePropagation(); // the login gate also listens on document (capture)
        openSheet(trigger.getAttribute('data-pdp-open-sheet'));
      }, true);
      Array.prototype.forEach.call(sheet.querySelectorAll('[data-pdp-sheet-close]'), function (el) {
        el.addEventListener('click', closeSheet);
      });
      sheet.querySelector('[data-sheet-cta="cart"]').addEventListener('click', function () {
        closeSheet();
        showToast('Berhasil ditambahkan ke keranjang');
      });
    }
    // desktop cart button (no sheet there)
    all('[data-add-to-cart]').forEach(function (b) {
      b.addEventListener('click', function () { if (!mobile.matches) showToast('Berhasil ditambahkan ke keranjang'); });
    });

    // every visit starts on the first variant (also when the page comes back from the bfcache)
    selectFirst();
    window.addEventListener('pageshow', function (e) { if (e.persisted) { state.qty = 1; closeSheet(); selectFirst(); } });
  }

  /* ---------- 5. PDP description expand / collapse ---------- */
  function initDescriptionToggle() {
    var toggle = document.querySelector('[data-description-toggle]');
    var block = document.querySelector('.pdp-description-block');
    if (!toggle || !block) return;
    var content = block.querySelector('[data-pdp-description-content]');
    var LINES = 5;
    // bottom of the 5th rendered text line (paragraph gaps included), measured from the content box
    function fiveLineHeight() {
      if (!content) return 0;
      var top = content.getBoundingClientRect().top;
      var walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      var range = document.createRange();
      var lines = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.nodeValue.trim()) continue;
        range.selectNodeContents(walker.currentNode);
        // text rects only cover the glyphs: grow them to the full line box (line-height)
        var lh = parseFloat(getComputedStyle(walker.currentNode.parentNode).lineHeight) || 0;
        Array.prototype.forEach.call(range.getClientRects(), function (r) {
          if (!r.width) return;
          var pad = Math.max(0, (lh - r.height) / 2);
          r = { top: r.top - pad, bottom: r.bottom + pad };
          var last = lines[lines.length - 1];
          if (!last || r.top >= last.bottom - 2) lines.push({ top: r.top, bottom: r.bottom });
          else last.bottom = Math.max(last.bottom, r.bottom);
        });
      }
      if (lines.length <= LINES) return 0; // fits: no toggle
      return Math.ceil(lines[LINES - 1].bottom - top);
    }
    function measure() {
      if (block.classList.contains('is-expanded') || !content) return;
      content.classList.remove('is-collapsed');
      var h = fiveLineHeight();
      content.style.setProperty('--pdp-description-collapsed-height', h + 'px');
      content.classList.toggle('is-collapsed', h > 0);
      block.classList.toggle('has-description-overflow', h > 0);
      toggle.hidden = !h;
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    toggle.addEventListener('click', function () {
      var expanded = block.classList.toggle('is-expanded');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? 'Tutup' : 'Selengkapnya';
    });
  }

  /* ---------- Order detail: status chip + progress timeline (from ?status=) ---------- */
  /* ---------- Kategori mega dropdown: category list left, its sub-categories right ----------
     Desktop: hover/focus previews a category, click opens it. Mobile (no hover): tap previews. */
  function initKategoriMenu() {
    Array.prototype.forEach.call(document.querySelectorAll('.sv2k'), function (panel) {
      var tapSelects = !!panel.closest('.sv2m-header');
      var cats = panel.querySelectorAll('[data-kcat]');
      function select(key) {
        Array.prototype.forEach.call(cats, function (c) { c.classList.toggle('is-active', c.getAttribute('data-kcat') === key); });
        Array.prototype.forEach.call(panel.querySelectorAll('[data-ksub]'), function (s) { s.hidden = s.getAttribute('data-ksub') !== key; });
      }
      Array.prototype.forEach.call(cats, function (c) {
        var key = c.getAttribute('data-kcat');
        if (tapSelects) {
          c.addEventListener('click', function (e) { e.preventDefault(); select(key); });
        } else {
          c.addEventListener('mouseenter', function () { select(key); });
          c.addEventListener('focus', function () { select(key); });
        }
      });
    });
  }

  /* Label kategori dari database (<script data-store-categories>); konstanta prototipe jadi cadangan. */
  function storeCategoryLabels(cat, sub) {
    var el = document.querySelector('script[data-store-categories]');
    if (el) {
      try {
        var data = JSON.parse(el.textContent);
        if (data && data.cat && data.sub) return data;
      } catch (e) { /* pakai cadangan */ }
    }
    return { cat: cat, sub: sub };
  }

  /* ---------- Semua produk: filter the grid by ?category= & ?sub= ---------- */
  function initAllProducts() {
    var page = document.querySelector('[data-all-products]');
    if (!page) return;
    var CAT = { merchandise: 'Merchandise', buku: 'Buku', membership: 'Membership', digital: 'Digital', event: 'Event' };
    var SUB = { apparel: 'Apparel', accessories: 'Accessories', drinkware: 'Drinkware', novel: 'Novel', quran: 'Quran',
      biografi: 'Biografi', ensiklopedia: 'Ensiklopedia', 'video-premium': 'Video premium', 'konten-premium': 'Konten premium',
      sticker: 'Sticker', aktivitas: 'Aktivitas', webinar: 'Webinar', workshop: 'Workshop', tour: 'Tour' };
    var labels = storeCategoryLabels(CAT, SUB);
    CAT = labels.cat;
    SUB = labels.sub;
    var params = new URLSearchParams(location.search);
    var cat = CAT[params.get('category')] ? params.get('category') : '';
    var sub = cat && SUB[params.get('sub')] ? params.get('sub') : '';
    var shown = 0;
    Array.prototype.forEach.call(page.querySelectorAll('.product-card'), function (card) {
      var ok = (!cat || card.getAttribute('data-kcat') === cat) && (!sub || card.getAttribute('data-ksub') === sub);
      card.hidden = !ok;
      if (ok) shown++;
    });
    var label = sub ? SUB[sub] : (cat ? CAT[cat] : 'Semua produk');
    var title = page.querySelector('[data-all-products-title]');
    var crumb = page.querySelector('[data-all-products-crumb]');
    var count = page.querySelector('[data-all-products-count]');
    var empty = page.querySelector('[data-all-products-empty]');
    if (title) title.textContent = label;
    if (crumb) {
      if (cat) {
        // dibangun lewat DOM: nama kategori berasal dari CMS, jangan masuk innerHTML
        crumb.textContent = '';
        var crumbLink = function (href, text) {
          var a = document.createElement('a');
          a.href = href;
          a.textContent = text;
          crumb.appendChild(a);
          var sep = document.createElement('span');
          sep.textContent = '/';
          crumb.append(' ', sep, ' ');
        };
        crumbLink('/produk', 'Semua produk');
        if (sub) crumbLink('/produk?category=' + encodeURIComponent(cat), CAT[cat]);
        var cur = document.createElement('span');
        cur.textContent = label;
        crumb.appendChild(cur);
      }
    }
    if (count) count.textContent = shown + ' produk';
    if (empty) empty.hidden = shown > 0;
    page.classList.toggle('is-empty', !shown); // Figma 217:5126: empty state only, no page head
    if (cat) document.title = label + ' - Store Kompas.com';
  }

  /* ---------- Hasil Pencarian: ?q= + Kategori dropdown (same taxonomy / layout as the header Kategori) + Urutkan ---------- */
  function initSearchPage() {
    var page = document.querySelector('[data-search-page]');
    if (!page) return;
    function each(list, fn) { Array.prototype.forEach.call(list, fn); }
    var CAT = { merchandise: 'Merchandise', buku: 'Buku', membership: 'Membership', digital: 'Digital', event: 'Event' };
    var SUB = { apparel: 'Apparel', accessories: 'Accessories', drinkware: 'Drinkware', novel: 'Novel', quran: 'Quran',
      biografi: 'Biografi', ensiklopedia: 'Ensiklopedia', 'video-premium': 'Video premium', 'konten-premium': 'Konten premium',
      sticker: 'Sticker', aktivitas: 'Aktivitas', webinar: 'Webinar', workshop: 'Workshop', tour: 'Tour' };
    var labels = storeCategoryLabels(CAT, SUB);
    CAT = labels.cat;
    SUB = labels.sub;
    var params = new URLSearchParams(location.search);
    var q = (params.get('q') || '').trim();
    var cat = CAT[params.get('category')] ? params.get('category') : '';
    var sub = '';
    var grid = page.querySelector('[data-search-grid]');
    var cards = grid ? Array.prototype.slice.call(grid.querySelectorAll('.product-card')) : [];
    var needle = q.toLowerCase();
    var shown = 0;
    cards.forEach(function (card) {
      var title = (card.querySelector('.product-card-title') || card).textContent.toLowerCase();
      var ok = (!cat || card.getAttribute('data-kcat') === cat) && (!sub || card.getAttribute('data-ksub') === sub) &&
        (!needle || title.indexOf(needle) !== -1);
      card.hidden = !ok;
      if (ok) shown++;
    });
    var count = page.querySelector('[data-search-count]');
    var summary = page.querySelector('[data-search-summary]');
    var empty = page.querySelector('[data-search-empty]');
    var label = sub ? SUB[sub] : (cat ? CAT[cat] : '');
    if (count) count.textContent = shown + ' produk';
    if (empty) empty.hidden = shown > 0;
    page.classList.toggle('is-empty', !shown); // Figma 217:6063: only the "Pencarian tidak ditemukan." state
    var reco = page.querySelector('[data-search-reco]'); // "Mungkin kamu tertarik" under the empty state
    if (reco) reco.hidden = shown > 0;
    // "Ubah pencarian" → back to the header search bar, active (focused, keyword selected)
    var edit = page.querySelector('[data-search-edit]');
    if (edit) edit.addEventListener('click', function () {
      var mOpen = document.querySelector('[data-mobile-search-open]');
      var useMobile = mOpen && mOpen.offsetParent !== null;
      if (useMobile) mOpen.click();
      var input = useMobile ? document.querySelector('[data-mobile-search] input[name="q"]')
        : document.querySelector('[data-store-search] input[name="q"]');
      if (!input) return;
      window.scrollTo(0, 0);
      input.focus();
      input.select();
    });
    if (summary) {
      summary.textContent = q ? 'Menampilkan hasil untuk “' + q + '”' + (label ? ' di ' + label : '') + '.'
        : (label ? 'Menampilkan produk ' + label + ' di Store Kompas.com.' : 'Menampilkan semua produk Store Kompas.com.');
    }
    each(document.querySelectorAll('[data-store-search] input[name="q"]'), function (input) { if (q) input.value = q; });

    // Kategori: plain dropdown of the main categories, default "Semua kategori"
    var box = page.querySelector('[data-search-kategori]');
    var toggle = box && box.querySelector('[data-search-kategori-toggle]');
    var panel = box && box.querySelector('[data-search-kategori-panel]');
    if (toggle && panel) {
      var chipLabel = toggle.querySelector('[data-search-kategori-label]');
      if (chipLabel) chipLabel.textContent = cat ? CAT[cat] : 'Semua kategori';
      toggle.classList.toggle('is-active', !!cat);
      each(panel.querySelectorAll('[data-search-category]'), function (a) {
        var k = a.getAttribute('data-search-category');
        a.classList.toggle('is-current', k === cat);
        if (k === cat) a.setAttribute('aria-current', 'true');
        // keep the search keyword when switching category
        var url = new URLSearchParams();
        if (q) url.set('q', q);
        if (k) url.set('category', k);
        a.setAttribute('href', '/cari' + (url.toString() ? '?' + url.toString() : ''));
      });
      function setOpen(open) {
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.classList.toggle('is-open', open);
      }
      toggle.addEventListener('click', function (e) { e.stopPropagation(); setOpen(panel.hidden); });
      document.addEventListener('click', function (e) { if (!panel.hidden && !box.contains(e.target)) setOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); toggle.focus(); } });
    }

    // Urutkan
    var sort = page.querySelector('[data-search-sort]');
    if (sort && grid) {
      var original = cards.slice();
      function priceOf(card) { var p = card.querySelector('.product-card-current-price'); return p ? digits(p.textContent) : 0; }
      sort.addEventListener('change', function () {
        var list = original.slice();
        if (sort.value === 'newest') list.reverse();
        else if (sort.value === 'price-high') list.sort(function (a, b) { return priceOf(b) - priceOf(a); });
        else if (sort.value === 'price-low') list.sort(function (a, b) { return priceOf(a) - priceOf(b); });
        list.forEach(function (card) { grid.appendChild(card); });
      });
    }
  }

  /* ---------- Menu akun (Figma Store-kompascom 238:4323) ----------
     Login: ikon akun di bar hitam jadi avatar inisial; diklik → kartu profil + Daftar Pesanan /
     Alamat Pengiriman / Membership aktif / Logout. Belum login: ikon akun membuka popup login
     ([data-login-required]) lalu lanjut ke /akun. Status login masih flag localStorage prototipe. */
  var STORE_USER = { name: 'Reza Pratama', email: 'reza.pratama@gmail.com' };
  // "Lihat profil": sementara ke halaman akun store; setelah tersambung SSO kompas.com → halaman profil SSO
  var PROFILE_URL = '/akun';
  // ikon pin yang sama dengan menu Alamat Pengiriman di halaman akun
  var ICON_PIN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  var ACCT_ICON = '/images/store-v2/account-menu/';
  function accountMenuHtml() {
    function item(href, icon, label) {
      var ico = icon.charAt(0) === '<' ? icon : '<img src="' + ACCT_ICON + icon + '" width="20" height="20" alt="">';
      return '<a class="sv2-acct-item" href="' + href + '">' + ico + '<span>' + label + '</span></a>';
    }
    return '<a class="sv2-acct-profile" href="' + PROFILE_URL + '">' +
        '<span class="sv2-acct-avatar" aria-hidden="true">' + STORE_USER.name.trim().charAt(0).toUpperCase() + '</span>' +
        '<span class="sv2-acct-who"><strong>' + STORE_USER.name + '</strong><span>Lihat profil</span></span>' +
        '<span class="sv2-acct-caret"><img src="' + ACCT_ICON + 'caret-right.svg" width="9.33333" height="5.33333" alt=""></span>' +
      '</a>' +
      '<nav class="sv2-acct-list" aria-label="Menu akun">' +
        item('/akun', 'receipt.svg', 'Daftar Pesanan') +
        item('/akun?accountSection=addresses', ICON_PIN, 'Alamat Pengiriman') +
        item('https://plus.kompas.com/', 'star.svg', 'Membership aktif') +
        '<img class="sv2-acct-divider" src="' + ACCT_ICON + 'divider.svg" width="248" height="1" alt="">' +
        '<button type="button" class="sv2-acct-item sv2-acct-logout" data-acct-logout><img src="' + ACCT_ICON + 'sign-out.svg" width="20" height="20" alt=""><span>Logout</span></button>' +
      '</nav>';
  }
  function initAccountAvatar() {
    var authed = false;
    try { authed = localStorage.getItem('store-v2-authenticated') === 'true'; } catch (e) {}
    var dWrap = document.querySelector('.sv2h-account');
    var mLinks = document.querySelectorAll('.sv2m-topacct');

    if (!authed) {
      // belum login: ikon akun → popup login, setelah login lanjut ke halaman akun
      var dTrigOut = dWrap && dWrap.querySelector('.js-sso-user');
      if (dTrigOut) {
        dTrigOut.setAttribute('href', '/akun');
        var dBoardOut = dWrap.querySelector('.js-sso-user-board');
        if (dBoardOut) dBoardOut.remove();
      }
      Array.prototype.forEach.call([dTrigOut].concat(Array.prototype.slice.call(mLinks)), function (a) {
        if (!a) return;
        a.setAttribute('data-login-required', '');
        a.setAttribute('data-login-title', 'Login untuk masuk ke akunmu');
      });
      return;
    }

    var avatar = '<i class="sso__icon__login sso__avatar" data-avatar="bg" data-init="' + STORE_USER.name.trim().charAt(0).toUpperCase() + '"></i>';
    function attach(box, trig) {
      trig.innerHTML = avatar;
      trig.setAttribute('href', '/akun');
      trig.setAttribute('role', 'button');
      trig.setAttribute('aria-label', 'Akun ' + STORE_USER.name);
      trig.setAttribute('aria-haspopup', 'true');
      trig.setAttribute('aria-expanded', 'false');
      var menu = document.createElement('div');
      menu.className = 'sv2-acct-menu';
      menu.hidden = true;
      menu.innerHTML = accountMenuHtml();
      box.appendChild(menu);
      function close() { menu.hidden = true; trig.setAttribute('aria-expanded', 'false'); }
      trig.addEventListener('click', function (e) {
        e.preventDefault();
        menu.hidden = !menu.hidden;
        trig.setAttribute('aria-expanded', String(!menu.hidden));
      });
      menu.addEventListener('click', function (e) {
        if (e.target.closest('[data-acct-logout]')) {
          try { localStorage.removeItem('store-v2-authenticated'); } catch (err) {}
          location.reload();
        } else if (e.target.closest('a')) close();
      });
      document.addEventListener('click', function (e) { if (!menu.hidden && !box.contains(e.target)) close(); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !menu.hidden) { close(); trig.focus(); } });
      window.addEventListener('scroll', function () { if (window.scrollY > 20) close(); }, { passive: true });
    }

    // desktop: avatar di bar hitam; menu SSO kompas.com lama diganti menu akun
    if (dWrap) {
      var dTrig = dWrap.querySelector('.js-sso-user');
      var dBoard = dWrap.querySelector('.js-sso-user-board');
      if (dBoard) dBoard.remove();
      if (dTrig) attach(dWrap, dTrig);
    }
    // mobile: ikon akun di bar hitam diganti avatar + menu yang sama
    Array.prototype.forEach.call(mLinks, function (link) {
      var box = document.createElement('div');
      box.className = 'sv2m-account sso__header';
      box.innerHTML = '<ul class="sso__wrap"><li class="sso__item"><a class="sso__link sso__link__icon js-sso-user" href="/akun"></a></li></ul>';
      link.parentNode.replaceChild(box, link);
      attach(box, box.querySelector('.js-sso-user'));
    });
  }

  /* ---------- Account: Daftar Pesanan / Alamat Pengiriman (?accountSection=addresses) ---------- */
  function initAccountSections() {
    var panels = document.querySelectorAll('[data-account-section]');
    if (!panels.length) return;
    var key = new URLSearchParams(location.search).get('accountSection') === 'addresses' ? 'addresses' : 'orders';
    Array.prototype.forEach.call(panels, function (p) { p.hidden = p.getAttribute('data-account-section') !== key; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-account-link]'), function (a) {
      var on = a.getAttribute('data-account-link') === key;
      a.classList.toggle('is-active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var crumb = document.querySelector('[data-account-crumb]');
    if (crumb) crumb.textContent = key === 'addresses' ? 'Alamat Pengiriman' : 'Pesanan';
    if (key === 'addresses') document.title = 'Alamat Pengiriman - Store Kompas.com';
  }

  /* ---------- Shared address modal ("Tambah Alamat" / "Ubah Alamat") ----------
     Fields & wording from gerai, store-v2 address-popup styling. Used by the account page
     (Alamat Pengiriman) and by checkout; the saved address is shared via localStorage. */
  var ADDRESS_KEY = 'store-v2-address';
  function loadAddress() { try { return JSON.parse(localStorage.getItem(ADDRESS_KEY) || 'null'); } catch (e) { return null; } }
  function saveAddress(d) { try { localStorage.setItem(ADDRESS_KEY, JSON.stringify(d)); } catch (e) {} }
  function addressLine(d) { return [d.alamat, d.kecamatan, d.kota, d.provinsi, d.kodepos].filter(Boolean).join(', '); }
  var addressModal = (function () {
    var REGION = {
      'DKI Jakarta': { 'Jakarta Barat': ['Kebon Jeruk', 'Palmerah', 'Grogol Petamburan', 'Kembangan'], 'Jakarta Pusat': ['Gambir', 'Menteng', 'Tanah Abang', 'Senen'], 'Jakarta Selatan': ['Kebayoran Baru', 'Setiabudi', 'Tebet', 'Cilandak'], 'Jakarta Timur': ['Jatinegara', 'Duren Sawit', 'Cakung', 'Matraman'], 'Jakarta Utara': ['Kelapa Gading', 'Penjaringan', 'Tanjung Priok', 'Koja'] },
      'Jawa Barat': { 'Kota Bandung': ['Coblong', 'Sukajadi', 'Lengkong', 'Cicendo'], 'Kota Bekasi': ['Bekasi Barat', 'Bekasi Selatan', 'Medan Satria'], 'Kota Bogor': ['Bogor Tengah', 'Bogor Utara', 'Tanah Sareal'], 'Kota Depok': ['Beji', 'Pancoran Mas', 'Sukmajaya'] },
      'Banten': { 'Kota Tangerang': ['Cipondoh', 'Karawaci', 'Tangerang'], 'Kota Tangerang Selatan': ['Serpong', 'Pondok Aren', 'Ciputat'], 'Kota Serang': ['Serang', 'Cipocok Jaya', 'Taktakan'] }
    };
    var FIELDS = ['label', 'nama', 'telp', 'provinsi', 'kota', 'kecamatan', 'alamat', 'kodepos', 'catatan'];
    var REQUIRED = FIELDS.slice(0, 8); // catatan optional
    var modal = null, form, saveBtn, onSave = null;
    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function options(list, placeholder, selected) {
      return '<option value="" disabled' + (selected ? '' : ' selected') + '>' + placeholder + '</option>' +
        list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join('');
    }
    function field(name, label, control, full) {
      return '<div class="storev2-addr__field' + (full ? ' storev2-addr__field--full' : '') + '"><label class="storev2-addr__label" for="addr-' + name + '">' + label + '</label>' + control + '</div>';
    }
    function input(name, ph, extra) { return '<input class="storev2-addr__control" id="addr-' + name + '" name="' + name + '" placeholder="' + ph + '" autocomplete="off"' + (extra || '') + '>'; }
    function val(n) { var el = form.elements[n]; return el ? el.value.trim() : ''; }
    function sync() {
      saveBtn.disabled = !REQUIRED.every(function (n) { return val(n) !== ''; });
      Array.prototype.forEach.call(form.querySelectorAll('select'), function (sel) { sel.classList.toggle('is-filled', !!sel.value); });
    }
    function fillKota(prov, selected) { form.elements.kota.innerHTML = options(Object.keys(REGION[prov] || {}), 'Pilih kota/kabupaten', selected); }
    function fillKecamatan(prov, kota, selected) { form.elements.kecamatan.innerHTML = options(((REGION[prov] || {})[kota]) || [], 'Pilih kecamatan', selected); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    function close() { if (modal) modal.classList.remove('is-open'); document.removeEventListener('keydown', onKey); }
    function build() {
      if (modal) return;
      modal = document.createElement('div');
      modal.className = 'storev2-modal storev2-modal--addr';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-labelledby', 'addr-manager-title');
      modal.innerHTML =
        '<div class="storev2-modal__backdrop" data-addr-dismiss></div>' +
        '<div class="storev2-modal__panel storev2-modal__panel--addr storev2-addr-manager">' +
          '<span class="storev2-addr__handle" aria-hidden="true"></span>' +
          '<button type="button" class="storev2-addr__close" data-addr-dismiss aria-label="Tutup"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>' +
          // header stays put; only the fields scroll; Batal / Simpan stick to the bottom
          '<div class="storev2-addr-manager__head">' +
            '<h2 class="storev2-addr__title" id="addr-manager-title">Ubah Alamat</h2>' +
            '<p class="storev2-addr__desc"></p>' +
          '</div>' +
          '<form class="storev2-addr storev2-addr-manager__scroll" novalidate>' +
            '<div class="storev2-addr__grid">' +
              field('label', 'Label Alamat', input('label', 'Contoh: Rumah, Kantor, Apartemen'), true) +
              field('nama', 'Nama Penerima', input('nama', 'Nama penerima')) +
              field('telp', 'Nomor Ponsel', input('telp', 'Contoh: 08123456789', ' inputmode="tel"')) +
              field('provinsi', 'Provinsi', '<select class="storev2-addr__control" id="addr-provinsi" name="provinsi"></select>') +
              field('kota', 'Kota/Kabupaten', '<select class="storev2-addr__control" id="addr-kota" name="kota"></select>') +
              field('kecamatan', 'Kecamatan', '<select class="storev2-addr__control" id="addr-kecamatan" name="kecamatan"></select>') +
              field('kodepos', 'Kode Pos', input('kodepos', 'Contoh: 10270', ' inputmode="numeric" maxlength="5"')) +
              field('alamat', 'Alamat Lengkap', '<textarea class="storev2-addr__control" id="addr-alamat" name="alamat" placeholder="Nama jalan, nomor rumah, RT/RW"></textarea>', true) +
              field('catatan', 'Catatan untuk Kurir (Opsional)', input('catatan', 'Warna rumah, patokan, pesan khusus, dll.'), true) +
            '</div>' +
            '<div class="storev2-addr__actions">' +
              '<button type="button" class="storev2-addr__cancel" data-addr-dismiss>Batal</button>' +
              '<button type="submit" class="storev2-addr__submit">Simpan Alamat</button>' +
            '</div>' +
          '</form>' +
        '</div>';
      document.body.appendChild(modal);
      form = modal.querySelector('form');
      saveBtn = modal.querySelector('.storev2-addr__submit');
      form.elements.provinsi.innerHTML = options(Object.keys(REGION), 'Pilih provinsi', '');
      form.addEventListener('input', sync);
      form.addEventListener('change', function (e) {
        if (e.target.name === 'provinsi') { fillKota(e.target.value, ''); fillKecamatan('', '', ''); }
        if (e.target.name === 'kota') fillKecamatan(val('provinsi'), e.target.value, '');
        sync();
      });
      modal.addEventListener('click', function (e) { if (e.target.closest('[data-addr-dismiss]')) close(); });
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        sync();
        if (saveBtn.disabled) return;
        var d = {};
        FIELDS.forEach(function (n) { d[n] = val(n); });
        saveAddress(d);
        close();
        if (onSave) onSave(d);
        showToast('Alamat berhasil disimpan');
      });
    }
    function open(data, cb) {
      build();
      onSave = cb || null;
      var d = data || {};
      modal.querySelector('#addr-manager-title').textContent = data ? 'Ubah Alamat' : 'Tambah Alamat';
      modal.querySelector('.storev2-addr__desc').textContent = data
        ? 'Perbarui alamat pengiriman untuk pesanan Store Kompas.com.'
        : 'Tambahkan alamat pengiriman untuk pesanan Store Kompas.com.';
      ['label', 'nama', 'telp', 'alamat', 'kodepos', 'catatan'].forEach(function (n) { form.elements[n].value = d[n] || ''; });
      form.elements.provinsi.value = d.provinsi || '';
      fillKota(d.provinsi, d.kota);
      fillKecamatan(d.provinsi, d.kota, d.kecamatan);
      sync();
      form.scrollTop = 0;
      modal.classList.add('is-open');
      document.addEventListener('keydown', onKey);
    }
    return { open: open };
  })();

  /* ---------- Account › Alamat Pengiriman: empty box (as on checkout) or the saved address card ---------- */
  function initAddressManager() {
    var card = document.querySelector('[data-address-card]');
    if (!card) return;
    var emptyBox = document.querySelector('[data-address-empty]');
    var data = loadAddress();
    function render() {
      card.hidden = !data;
      if (emptyBox) emptyBox.hidden = !!data;
      if (!data) return;
      card.querySelector('[data-address-name]').textContent = data.nama;
      card.querySelector('[data-address-label]').textContent = data.label;
      card.querySelector('[data-address-full]').textContent = addressLine(data);
      card.querySelector('[data-address-phone]').textContent = data.telp;
    }
    render();
    document.addEventListener('click', function (e) {
      if (!(e.target.closest && e.target.closest('[data-address-manager-open]'))) return;
      e.preventDefault();
      addressModal.open(data, function (d) { data = d; render(); });
    });
  }

  /* ---------- Tab pages (koleksi.html?tab=…): title panel + max 20 products, infinite scroll beyond ----------
     All 33 store products are rendered once; each tab picks / orders them. Tabs with more than 20
     products load the next 20 when the sentinel scrolls into view, and hide the footer. */
  function initTabPage() {
    var page = document.querySelector('[data-tab-page]');
    if (!page) return;
    var PAGE_SIZE = 20;
    var IMG = '/images/store-v2/';
    var TABS = {
      terlaris: { title: 'Terlaris', icon: 'cat-terlaris.png', first: ["premium-kompascom-max", "kaos-hitam-ekslusif-kompascom-sandang-pangan-papan-kebenaran", "tumbler-eksklusif-kompascom", "payung-eksklusif-kompascom"] },
      rekomendasi: { title: 'Rekomendasi', icon: 'cat-rekomendasi.png', first: ["buku-menafsir-gelap-menyulam-terang-catatan-kolumnis-kompascom-di-jalan-ketidakpastian", "jason-ranti-mentalitas-di-dunia-yang-berisik-beginu-5-tahun", "premium-kompas-one", "the-things-you-can-see-only-when-you-slow-down"] },
      terbaru: { title: 'Terbaru', icon: 'cat-terbaru.png', first: ["jaket-principles-kompasiana", "jaket-storyteller-kompasiana", "kaos-principles-kompasiana", "kaos-storyteller-kompasiana", "tumbler-principles-kompasiana", "tumbler-storyteller-kompasiana", "kaos-hitam-ekslusif-kompascom-mencari-kebenaran-bukan-pembenaran", "dr-m-faisal-bertumbuh-di-era-ngonten-beginu-5-tahun", "jj-rizal-bisakah-membangun-masa-depan-tanpa-sejarah-beginu-5-tahun", "ade-putri-makanan-cerita-dan-prinsip-cukup-beginu-5-tahun", "premium-kompascom-lite", "you-do-you-discovering-life-through-experiments-self-awareness"], only: true },
      diskon: { title: 'Diskon Spesial', icon: 'cat-diskon-spesial.png', discounted: true },
      merchandise: { title: 'Merchandise', icon: 'cat-merchandise.png', kcat: 'merchandise' },
      'video-premium': { title: 'Video premium', icon: 'cat-video-premium.svg', kcat: 'digital', ksub: 'video-premium' },
      event: { title: 'Event', icon: 'cat-event.png', kcat: 'event' },
      membership: { title: 'Membership', icon: 'cat-membership.png', kcat: 'membership' }
    };
    // data-tab-server: produk sudah difilter & diurutkan server (koleksi dari database)
    var serverTab = page.getAttribute('data-tab-server');
    var key = serverTab || new URLSearchParams(location.search).get('tab');
    if (!TABS[key]) key = 'terlaris';
    var tab = TABS[key];
    var grid = page.querySelector('[data-tab-grid]');
    var cards = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
    function idOf(c) { var a = c.querySelector('[data-select-product]'); return a ? a.getAttribute('data-select-product') : ''; }
    var list = serverTab ? cards.slice() : cards.filter(function (c) {
      if (tab.kcat && c.getAttribute('data-kcat') !== tab.kcat) return false;
      if (tab.ksub && c.getAttribute('data-ksub') !== tab.ksub) return false;
      if (tab.discounted && !c.querySelector('.product-card-discount')) return false;
      if (tab.only && tab.first.indexOf(idOf(c)) === -1) return false;
      return true;
    });
    if (!serverTab && tab.first) { // curated order first (same as the home section), then the rest
      list.sort(function (a, b) {
        var ia = tab.first.indexOf(idOf(a)), ib = tab.first.indexOf(idOf(b));
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
    }
    cards.forEach(function (c) { c.hidden = true; });
    list.forEach(function (c) { grid.appendChild(c); });

    if (!serverTab) {
      page.querySelector('[data-tab-title]').textContent = tab.title;
      page.querySelector('[data-tab-crumb]').textContent = tab.title;
      page.querySelector('[data-tab-icon]').setAttribute('src', IMG + tab.icon);
      document.title = tab.title + ' - Store Kompas.com';
    }
    var empty = page.querySelector('[data-tab-empty]');
    if (empty) empty.hidden = list.length > 0;
    page.classList.toggle('is-empty', !list.length); // Figma 217:5126: empty state only, no page head

    var shown = 0;
    var loader = page.querySelector('[data-tab-loader]');
    var sentinel = page.querySelector('[data-tab-sentinel]');
    function more() {
      list.slice(shown, shown + PAGE_SIZE).forEach(function (c) { c.hidden = false; });
      shown = Math.min(list.length, shown + PAGE_SIZE);
      if (loader) loader.hidden = shown >= list.length;
      // the footer stays hidden while more products can still load; it comes back once the list is complete
      if (shown >= list.length) document.body.classList.remove('is-infinite-scroll');
    }
    if (list.length > PAGE_SIZE) document.body.classList.add('is-infinite-scroll'); // no footer while the list keeps growing
    more();
    if (list.length > PAGE_SIZE) {
      var busy = false;
      var io = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting || busy || shown >= list.length) return;
        busy = true;
        setTimeout(function () { more(); busy = false; if (shown >= list.length) io.disconnect(); }, 500);
      }, { rootMargin: '0px 0px 300px 0px' });
      io.observe(sentinel);
    }
  }

  function initOrderTimeline() {
    var list = document.querySelector('[data-od-timeline]');
    if (!list) return;
    var status = 'processing';
    try { status = new URLSearchParams(location.search).get('status') || status; } catch (e) {}
    var STEP = {
      created: 'Pesanan dibuat', paid: 'Pembayaran berhasil', processing: 'Pesanan diproses',
      shipped: 'Pesanan dikirim', completed: 'Pesanan selesai', canceled: 'Pesanan dibatalkan'
    };
    // oldest → newest per status
    var FLOW = {
      unpaid: ['created'],
      processing: ['created', 'paid', 'processing'],
      shipped: ['created', 'paid', 'processing', 'shipped'],
      completed: ['created', 'paid', 'processing', 'shipped', 'completed'],
      canceled: ['created', 'canceled']
    };
    var CHIP = {
      unpaid: ['Menunggu Pembayaran', 'unpaid'], processing: ['Diproses', 'processing'], shipped: ['Dikirim', 'shipped'],
      completed: ['Selesai', 'completed'], canceled: ['Dibatalkan', 'canceled']
    };
    if (!FLOW[status]) status = 'processing';
    // "Ambil di tempat": nothing is shipped — the order waits at the pickup point instead
    var order = pageOrder();
    var pickup = !!(order && (order.pickup || order.shipping === 'Ambil di tempat'));
    if (pickup) {
      STEP.processing = 'Pesanan menunggu diambil';
      CHIP.processing = ['Menunggu diambil', 'pickup'];
      Object.keys(FLOW).forEach(function (k) { FLOW[k] = FLOW[k].filter(function (x) { return x !== 'shipped'; }); });
    }
    if (order && order.digital) {
      FLOW.processing = FLOW.completed = ['created', 'paid', 'completed'];
      STEP.completed = 'Pesanan selesai · akses video aktif';
    }
    var chip = document.querySelector('.od-status');
    if (chip) { chip.textContent = CHIP[status][0]; chip.className = 'order-status order-status--' + CHIP[status][1] + ' od-status'; }
    var DATE = '24 Agustus 2026, 13.45 WIB';
    function dateOf(key) { // a stored order shows its own times
      if (!order || !order.createdAt) return DATE;
      if (key === 'created') return fmtDate(order.createdAt);
      return fmtDate(order.paidAt || order.createdAt);
    }
    list.innerHTML = FLOW[status].slice().reverse().map(function (key, i) {
      return '<li class="od-step' + (i === 0 ? ' is-current' : '') + '"><strong>' + STEP[key] + '</strong><span>' + dateOf(key) + '</span></li>';
    }).join('');
  }

  /* ---------- Copy-to-clipboard buttons ([data-copy="text"]) ---------- */
  function initCopyButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-copy]');
      if (!btn) return;
      var text = btn.getAttribute('data-copy');
      // toast names what was copied: data-copy-toast, else derived from the aria-label ("Salin X" → "X berhasil disalin")
      var msg = btn.getAttribute('data-copy-toast');
      if (!msg) {
        var lab = (btn.getAttribute('aria-label') || '').replace(/^Salin\s+/i, '').trim();
        msg = lab ? lab.charAt(0).toUpperCase() + lab.slice(1) + ' berhasil disalin' : 'Berhasil disalin';
      }
      var done = function () { showToast(msg); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (err) {}
        ta.remove(); done();
      }
    });
  }

  /* ---------- 6. Wishlist toggle (any page, delegated) ---------- */
  function initWishlist() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-wishlist]');
      if (!btn) return;
      e.preventDefault();
      var active = btn.classList.toggle('is-active');
      btn.setAttribute('aria-pressed', String(active));
      showToast(active ? 'Berhasil ditambahkan ke wishlist' : 'Berhasil dihapus dari wishlist');
      // Wishlist page: an un-hearted product leaves the list
      var card = !active && btn.closest('[data-wishlist-grid] .product-card');
      if (card) { card.remove(); if (refreshWishlistPage) refreshWishlistPage(); }
    });
  }

  /* ---------- Wishlist page: store products, count, Urutkan, empty state (Figma 217:5126 layout) ---------- */
  var refreshWishlistPage = null;
  function initWishlistPage() {
    var page = document.querySelector('[data-wishlist-page]');
    var grid = page && page.querySelector('[data-wishlist-grid]');
    if (!grid) return;
    var count = page.querySelector('[data-wishlist-count]');
    var empty = page.querySelector('[data-wishlist-empty]');
    // preview: wishlist.html?empty=1
    if (new URLSearchParams(location.search).get('empty') === '1') {
      Array.prototype.forEach.call(grid.querySelectorAll('.product-card'), function (c) { c.remove(); });
    }
    refreshWishlistPage = function () {
      var n = grid.querySelectorAll('.product-card').length;
      if (count) count.textContent = n + ' produk';
      if (empty) empty.hidden = n > 0;
      grid.hidden = !n;
      page.classList.toggle('is-empty', !n); // empty: only the illustration block, 48px under the header
    };
    refreshWishlistPage();
    var sort = page.querySelector('[data-wishlist-sort]');
    if (sort) {
      var original = Array.prototype.slice.call(grid.querySelectorAll('.product-card'));
      function priceOf(card) { var p = card.querySelector('.product-card-current-price'); return p ? digits(p.textContent.split('/')[0]) : 0; }
      sort.addEventListener('change', function () {
        var list = original.filter(function (c) { return grid.contains(c); });
        if (sort.value === 'oldest') list.reverse();
        else if (sort.value === 'price-high') list.sort(function (a, b) { return priceOf(b) - priceOf(a); });
        else if (sort.value === 'price-low') list.sort(function (a, b) { return priceOf(a) - priceOf(b); });
        list.forEach(function (c) { grid.appendChild(c); });
      });
    }
  }

  /* ---------- 7. Cart quantity steppers (visual) ----------
     Cart stepper markup mirrors the PDP one:
       .cart-quantity > button[minus] + span(value) + button[plus]
     so the number lives in the <span>, not on [data-cart-qty]. */
  // qty === 1 → the decrease button acts as "delete" (cart shows a trash icon for it on mobile)
  function syncQtyState(box) {
    var value = box.querySelector('span');
    if (!value) return;
    var one = (digits(value.textContent) || 1) <= 1;
    box.classList.toggle('is-one', one);
    var dec = box.querySelector('[data-cart-qty-action="decrease"], [data-cart-qty-action="minus"]');
    if (dec && dec.closest('.checkout-product-row')) dec.setAttribute('aria-label', one ? 'Hapus' : 'Kurangi');
  }

  function initCartQuantity() {
    document.querySelectorAll('.cart-quantity, .pdp-quantity, .cart-qty').forEach(syncQtyState);
    document.addEventListener('click', function (e) {
      var action = e.target.closest && e.target.closest('[data-cart-qty-action]');
      if (!action) return;
      var dir = action.getAttribute('data-cart-qty-action');
      var box = action.closest('.cart-quantity, .pdp-quantity, .cart-qty') || action.parentElement;
      if (!box) return;
      var value = box.querySelector('span');
      if (!value) return;
      var qty = digits(value.textContent) || 1;
      var isDown = !(dir === 'increase' || dir === 'plus');
      if (isDown && qty <= 1) {
        // qty is 1: decreasing removes the product (with confirmation)
        var row = action.closest('.checkout-product-row');
        if (row) { confirmRemoveProduct(row); }
        return;
      }
      qty = isDown ? qty - 1 : qty + 1;
      value.textContent = String(qty);
      syncQtyState(box);
      if (refreshCartState) refreshCartState();
    });
  }

  // shared reference so removals elsewhere can refresh the cart totals/disabled state
  var refreshCartState = null;

  /* Generic delete-confirmation popup (same design as "Pesananmu"). */
  function openConfirmDelete(title, onConfirm) {
    var modal = document.createElement('div');
    modal.className = 'storev2-modal is-open';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Hapus produk');
    modal.innerHTML =
      '<div class="storev2-modal__backdrop" data-del-dismiss></div>' +
      '<div class="storev2-modal__panel"><div class="storev2-modal__inner">' +
        '<div>' +
          '<div class="storev2-modal__title">' + title + '</div>' +
        '</div>' +
        '<div class="storev2-modal__actions">' +
          '<button type="button" class="storev2-modal__btn storev2-modal__btn--danger" data-del-confirm>Hapus</button>' +
          '<button type="button" class="storev2-modal__btn storev2-modal__btn--secondary" data-del-dismiss>Batal</button>' +
        '</div>' +
      '</div></div>';
    document.body.appendChild(modal);
    function onKey(e) { if (e.key === 'Escape') teardown(); }
    function teardown() { modal.remove(); document.removeEventListener('keydown', onKey); }
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-del-dismiss]')) { teardown(); return; }
      if (e.target.closest('[data-del-confirm]')) { onConfirm(); teardown(); }
    });
    document.addEventListener('keydown', onKey);
  }

  /* Confirmation before removing a single product (Pesananmu / cart). */
  function confirmRemoveProduct(row) {
    openConfirmDelete('Apakah kamu ingin menghapus produk ini dari pesananmu?', function () {
      row.remove();
      if (refreshCartState) refreshCartState();
    });
  }

  /* ---------- Kode promo (keranjang + checkout) — Figma "div.checkout-promo-entry" (Store-kompascom 217:4939) ----------
     Inline accordion, no modal. States: Default (collapsed) · promo kosong (open, "Gunakan" disabled) ·
     mulai mengetik / terisi (input focus = 2px #5A5A5A, "Gunakan" primary) · terisi, form tidak aktif ·
     promo tidak dapat digunakan (error text) · promo digunakan (collapsed: "Menggunakan kode promo" + Hemat + check) ·
     batalkan (open: code + check in the field, red "Batalkan").
     The code is kept in localStorage so the cart promo carries over to checkout. Preview: ?promo=DJFXA54 / ?promo=0. */
  var PROMO_KEY = 'store-v2-promo';
  var PROMOS = {
    DJFXA54: { value: 14000 },
    PAYDAY25: { value: 25000 }
  };
  function loadPromo() {
    try { var c = localStorage.getItem(PROMO_KEY); return PROMOS[c] ? c : ''; } catch (e) { return ''; }
  }
  function savePromo(code) {
    try { if (code) localStorage.setItem(PROMO_KEY, code); else localStorage.removeItem(PROMO_KEY); } catch (e) {}
  }
  function promoDiscount(base) {
    var c = loadPromo();
    return c ? Math.min(PROMOS[c].value, Math.max(0, base)) : 0;
  }
  var promoSaving = 0;
  function renderPromoEntries(disc) {
    promoSaving = disc;
    Array.prototype.forEach.call(document.querySelectorAll('[data-promo]'), function (box) {
      if (box._promoRender) box._promoRender();
    });
  }
  var refreshPromoTotals = function () {};
  function initPromo() {
    var boxes = document.querySelectorAll('[data-promo]');
    if (!boxes.length) return;
    var p = new URLSearchParams(location.search).get('promo');
    if (p !== null) savePromo(PROMOS[String(p).toUpperCase()] ? String(p).toUpperCase() : '');

    Array.prototype.forEach.call(boxes, function (box) {
      var head = box.querySelector('[data-promo-toggle]');
      var body = box.querySelector('[data-promo-body]');
      var title = box.querySelector('[data-promo-title]');
      var saving = box.querySelector('[data-promo-saving]');
      var check = box.querySelector('[data-promo-check]');
      var input = box.querySelector('[data-promo-input]');
      var fieldCheck = box.querySelector('[data-promo-field-check]');
      var btn = box.querySelector('[data-promo-apply]');
      var error = box.querySelector('[data-promo-error]');
      var open = false, invalid = false;

      box._promoRender = function () {
        var code = loadPromo();
        var applied = !!code && promoSaving > 0;
        box.classList.toggle('is-open', open);
        box.classList.toggle('is-applied', applied);
        box.classList.toggle('is-invalid', invalid && !applied);
        head.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
        // collapsed + applied = "promo digunakan"
        var showUsed = applied && !open;
        title.textContent = showUsed ? 'Menggunakan kode promo' : 'Gunakan Kode Promo';
        saving.hidden = !showUsed;
        saving.textContent = 'Hemat Rp' + rupiah.format(promoSaving) + ' untuk pesanan ini';
        check.hidden = !showUsed;
        // open + applied = "batalkan"
        if (applied) input.value = code;
        input.readOnly = applied;
        fieldCheck.hidden = !applied;
        btn.textContent = applied ? 'Batalkan' : 'Gunakan';
        btn.classList.toggle('is-danger', applied);
        btn.disabled = !applied && !input.value.trim();
        error.hidden = !(invalid && !applied);
      };
      head.addEventListener('click', function () {
        open = !open;
        box._promoRender();
        if (open && !input.readOnly && !('ontouchstart' in window)) input.focus();
      });
      input.addEventListener('input', function () {
        invalid = false;
        box._promoRender();
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !btn.disabled) { e.preventDefault(); btn.click(); } });
      btn.addEventListener('click', function () {
        if (loadPromo()) { // Batalkan
          savePromo('');
          input.value = '';
          invalid = false;
          refreshPromoTotals();
          showToast('Kode promo dibatalkan');
          if (!('ontouchstart' in window)) input.focus();
          return;
        }
        var code = input.value.trim().toUpperCase();
        if (!code) return;
        if (!PROMOS[code]) { // promo tidak dapat digunakan (form loses focus, error below)
          invalid = true;
          input.blur();
          box._promoRender();
          return;
        }
        savePromo(code);
        invalid = false;
        open = false; // collapse to "promo digunakan"
        refreshPromoTotals();
        showToast('Kode promo berhasil digunakan');
      });
      box._promoRender();
    });

    // checkout summary: "Diskon promo" line + Total + mobile pay bar
    var totalEl = document.querySelector('.checkout-total strong');
    if (totalEl) {
      var base = digits(totalEl.textContent);
      var line = document.querySelector('[data-promo-line]');
      var amount = document.querySelector('[data-promo-amount]');
      var payBar = document.querySelector('[data-pay-bar-total]');
      refreshPromoTotals = function () {
        var disc = promoDiscount(base);
        if (line) line.hidden = !disc;
        if (amount) amount.innerHTML = '-Rp&nbsp;' + rupiah.format(disc);
        totalEl.innerHTML = 'Rp&nbsp;' + rupiah.format(base - disc);
        if (payBar) payBar.textContent = 'Rp' + rupiah.format(base - disc);
        renderPromoEntries(disc);
      };
    } else {
      // keranjang: Total Diskon / Total Tagihan / bottom bar are recomputed by the cart selection sync
      refreshPromoTotals = function () { if (refreshCartState) refreshCartState(); else renderPromoEntries(0); };
    }
    refreshPromoTotals();
  }

  /* ---------- 8. Cart select-all / per item ---------- */
  function initCartSelect() {
    // select-all + Beli exist twice on mobile (list header / summary + sticky bottom bar)
    var alls = document.querySelectorAll('[data-cart-select-all]');
    var items = document.querySelectorAll('[data-cart-select-item]');
    var buyBtns = document.querySelectorAll('[data-cart-checkout]');
    var delBtns = document.querySelectorAll('[data-cart-delete-selected]');
    var barTotal = document.querySelector('[data-cart-bar-total]');
    var sumLines = document.querySelectorAll('.cart-summary-lines > div');
    var sumTotal = document.querySelector('.cart-summary-total strong');
    var cartPage = document.querySelector('.cart-page');
    var emptyBox = document.querySelector('[data-cart-empty]');
    if (!items.length) return;
    // preview: cart.html?empty=1 starts with an empty cart
    if (new URLSearchParams(location.search).get('empty') === '1') {
      items.forEach(function (cb) { var row = cb.closest('.checkout-product-row, .cart-item'); if (row) row.remove(); });
    }

    function rowAmount(cb) {
      var row = cb.closest('.checkout-product-row, .cart-item');
      if (!row) return 0;
      var price = row.querySelector('.checkout-product-meta strong, .cart-item-price strong');
      var qty = row.querySelector('.checkout-quantity > span, .cart-quantity > span');
      return digits(price ? price.textContent : 0) * (qty ? (digits(qty.textContent) || 1) : 1);
    }

    function checkedItems() {
      return Array.prototype.filter.call(items, function (x) { return x.checked && document.body.contains(x); });
    }
    function liveItems() {
      return Array.prototype.filter.call(items, function (x) { return document.body.contains(x); });
    }
    function setDisabled(el, off) {
      if (!el) return;
      if ('disabled' in el && el.tagName === 'BUTTON') { el.disabled = off; }
      el.classList.toggle('is-disabled', off);
      el.setAttribute('aria-disabled', String(off));
    }
    function sync() {
      var sel = checkedItems(), n = sel.length;
      var total = sel.reduce(function (s, cb) { return s + rowAmount(cb); }, 0);
      // "Beli (N)" when something is selected, plain disabled "Beli" otherwise
      buyBtns.forEach(function (b) {
        b.textContent = n ? 'Beli (' + n + ')' : 'Beli';
        setDisabled(b, n === 0);
      });
      delBtns.forEach(function (b) { setDisabled(b, n === 0); });
      var disc = n ? promoDiscount(total) : 0;
      if (barTotal) barTotal.textContent = n ? 'Rp' + rupiah.format(total - disc) : '-';
      // keep the summary card in step with the selection
      if (sumLines[0]) {
        var lbl = sumLines[0].querySelector('span'), amt = sumLines[0].querySelector('strong');
        if (lbl) lbl.textContent = 'Total Harga (' + n + ' Barang)';
        if (amt) amt.innerHTML = 'Rp&nbsp;' + rupiah.format(total);
      }
      if (sumLines[1]) {
        var dAmt = sumLines[1].querySelector('strong');
        if (dAmt) dAmt.innerHTML = '-Rp&nbsp;' + rupiah.format(disc);
      }
      if (sumTotal) sumTotal.innerHTML = 'Rp&nbsp;' + rupiah.format(total - disc);
      renderPromoEntries(disc);
      var live = liveItems();
      var allOn = live.length > 0 && live.every(function (x) { return x.checked; });
      alls.forEach(function (a) { a.checked = allOn; a.disabled = !live.length; });
      // empty cart — Figma Store-kompascom 217:5485: list replaced by the empty state, summary shows "Rp -" / "Rp 0"
      var isEmpty = !live.length;
      if (cartPage) cartPage.classList.toggle('is-cart-empty', isEmpty);
      if (emptyBox) emptyBox.hidden = !isEmpty;
      if (isEmpty && sumLines[0]) {
        var eAmt = sumLines[0].querySelector('strong');
        if (eAmt) eAmt.textContent = 'Rp -';
      }
    }
    refreshCartState = sync;

    alls.forEach(function (a) {
      a.addEventListener('change', function () {
        liveItems().forEach(function (it) { it.checked = a.checked; });
        sync();
      });
    });
    items.forEach(function (it) {
      it.addEventListener('change', sync);
    });

    // "Hapus" (delete selected) → confirmation, then remove checked rows
    delBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.disabled || btn.classList.contains('is-disabled')) return;
        var sel = checkedItems();
        if (!sel.length) return;
        openConfirmDelete('Apakah kamu ingin menghapus produk yang dipilih dari keranjang?', function () {
          sel.forEach(function (cb) {
            var row = cb.closest('.checkout-product-row, .cart-item');
            if (row) row.remove();
          });
          sync();
        });
      });
    });

    // prevent navigating via a disabled "Beli" link
    buyBtns.forEach(function (b) {
      b.addEventListener('click', function (e) {
        if (b.classList.contains('is-disabled')) { e.preventDefault(); }
      });
    });

    sync();
  }

  /* ---------- 11. Store header: "Kategori" dropdown ---------- */
  function initStoreHeader() {
    var toggle = document.querySelector('[data-kategori-toggle]');
    var panel = document.querySelector('[data-kategori-panel]');
    if (!toggle || !panel) return;
    function close() { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
    function open() { panel.hidden = false; toggle.setAttribute('aria-expanded', 'true'); }
    toggle.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.hidden) open(); else close();
    });
    document.addEventListener('click', function (e) {
      if (!panel.hidden && !panel.contains(e.target) && !toggle.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

  /* ---------- 10. Login gate for "Beli Sekarang" ----------
     If the visitor is not logged in, clicking a [data-buy-now-trigger]
     opens a login popup (repo login-modal design) instead of navigating.
     Login state is a simple localStorage flag for the prototype. */
  function initLoginGate() {
    var AUTH_KEY = 'store-v2-authenticated';
    var modal = null;
    var pendingHref = null;

    function isAuthed() {
      try { return localStorage.getItem(AUTH_KEY) === 'true'; } catch (e) { return false; }
    }
    function onKey(e) { if (e.key === 'Escape') closeModal(); }
    // repo default login popup (kgOneTap markup) when the page has it; the built-in modal below is the fallback
    var oneTap = null, oneTapTitle = null, DEFAULT_TITLE = '';
    // the repo kgOneTap popup: detail pages ship it statically; elsewhere it is built on first use
    function getOneTap() {
      if (oneTap) return oneTap;
      oneTap = document.getElementById('kgmModal-onetap') || buildOneTap();
      oneTapTitle = oneTap.querySelector('#kgmModal-title');
      DEFAULT_TITLE = oneTapTitle ? oneTapTitle.textContent : '';
      oneTap.addEventListener('click', function (e) {
        if (e.target === oneTap || e.target.closest('[data-login-close]')) { closeModal(); return; } // backdrop / ✕
        if (e.target.closest('[data-login-continue]')) continueLogin(e);
      });
      return oneTap;
    }
    // same markup as the static copy on detail pages (repo partials/_v2/components/kgOneTap.handlebars)
    function buildOneTap() {
      var el = document.createElement('section');
      el.className = 'kgmModal -hide';
      el.id = 'kgmModal-onetap';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      el.setAttribute('aria-labelledby', 'kgmModal-title');
      el.innerHTML =
        '<div class="kgmModal-block"><div class="kgmModal-header"><div class="kgmModal-header-inner">' +
          '<div class="kgmModal-header-logo"><img src="https://asset.kompas.com/data/2024/pluskompas/images/logo-kompascom.svg" alt="Kompas.com"></div>' +
          '<button type="button" class="kgmModal-close" data-login-close aria-label="Tutup"></button></div></div>' +
        '<div class="kgmModal-body"><div class="kgmModal-title" id="kgmModal-title">Login untuk melanjutkan</div>' +
          '<div class="kgmModal-onetap"><div class="form-google" id="kgOne1" data-login-continue>' +
            '<div id="g_id_onload" data-client_id="776828813358-infk4sje3q07sa8mg8n6lq1mk2pdkkua.apps.googleusercontent.com" data-context="signin" data-ux_mode="popup" data-login_uri="https://account.kompas.com/social/user" data-itp_support="true"></div>' +
            '<div class="g_id_signin" data-type="standard" data-shape="rectangular" data-theme="filled_blue" data-text="continue_with" data-size="large" data-logo_alignment="left"></div>' +
          '</div></div>' +
          '<div class="kgmModal-divider -clean"><span>atau</span></div>' +
          '<div class="kgmModal-method"><a href="https://dummy.kompas.com/repo/kgmedia/html/index.html" data-login-continue>Gunakan metode lain</a></div></div>' +
        '<div class="kgmModal-footer"><div class="kgmModal-info">Dengan login, kamu menyetujui <a href="https://www.kgmedia.id/legal-privacy-id" target="_blank" rel="noopener">Kebijakan Data Pribadi</a></div></div></div>';
      document.body.appendChild(el);
      var style = document.createElement('style');
      style.textContent = '.form-google>*{pointer-events:none}';
      document.head.appendChild(style);
      if (!document.querySelector('script[src*="accounts.google.com/gsi/client"]')) {
        var gsi = document.createElement('script');
        gsi.src = 'https://accounts.google.com/gsi/client';
        gsi.async = true;
        document.head.appendChild(gsi);
      }
      return el;
    }
    function closeModal() {
      if (oneTap) {
        oneTap.classList.add('-hide');
        document.body.classList.remove('-locked');
      }
      if (modal) modal.classList.remove('is-open');
      document.removeEventListener('keydown', onKey);
    }
    function continueLogin(e) {
      e.preventDefault();
      try { localStorage.setItem(AUTH_KEY, 'true'); } catch (err) {}
      closeModal();
      if (pendingHref) window.location.href = pendingHref;
    }
    function buildModal() {
      if (modal) return modal;
      modal = document.createElement('div');
      modal.className = 'storev2-modal';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', 'Login untuk melanjutkan');
      modal.innerHTML =
        '<div class="storev2-modal__backdrop" data-login-dismiss></div>' +
        '<div class="storev2-modal__panel"><div class="storev2-modal__inner">' +
          '<div>' +
            '<div class="storev2-modal__title">Login untuk melanjutkan</div>' +
            '<div class="storev2-modal__desc">Masuk ke akun Kompas.com dulu untuk membeli produk di Store.</div>' +
          '</div>' +
          '<div class="storev2-modal__actions">' +
            '<a href="#" class="storev2-modal__btn storev2-modal__btn--primary" data-login-continue>Login</a>' +
            '<button type="button" class="storev2-modal__btn storev2-modal__btn--secondary" data-login-dismiss>Lain kali</button>' +
          '</div>' +
          '<div class="storev2-modal__note">Dengan login, kamu menyetujui <strong>Kebijakan Data Privasi</strong> dan <strong>Kebijakan Kompas.com</strong>.</div>' +
        '</div></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', function (e) {
        if (e.target.closest('[data-login-dismiss]')) closeModal();
      });
      modal.querySelector('[data-login-continue]').addEventListener('click', function (e) {
        e.preventDefault();
        try { localStorage.setItem(AUTH_KEY, 'true'); } catch (err) {}
        closeModal();
        if (pendingHref) window.location.href = pendingHref;
      });
      return modal;
    }
    function openModal() {
      if (getOneTap()) {
        oneTap.classList.remove('-hide');
        document.body.classList.add('-locked');
      } else {
        buildModal().classList.add('is-open');
      }
      document.addEventListener('keydown', onKey);
    }

    document.addEventListener('click', function (e) {
      var trigger = e.target.closest && e.target.closest('[data-buy-now-trigger], [data-login-required]');
      if (!trigger) return;
      if (isAuthed()) return; // logged in → normal navigation
      e.preventDefault();
      pendingHref = trigger.getAttribute('href') || null;
      getOneTap();
      if (oneTapTitle) oneTapTitle.textContent = trigger.getAttribute('data-login-title') || DEFAULT_TITLE;
      openModal();
    }, true);
  }

  /* ---------- 9. Cart tabs (active state) ---------- */
  function initCartTabs() {
    var tabs = document.querySelectorAll('[data-cart-tab]');
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.classList.toggle('is-active', on);
          t.setAttribute('aria-selected', String(on));
        });
      });
    });
  }

  /* ---------- Prototype order store (localStorage "store-v2-orders", newest first) ----------
     Checkout creates the order (unpaid for BCA VA / QRIS, otherwise straight to processing);
     "Saya sudah bayar" moves it to processing; Daftar Pesanan / instruction / success pages read it. */
  var ORDERS_KEY = 'store-v2-orders';
  var MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sept', 'Okt', 'Nov', 'Des'];
  var METHOD_LABEL = { cc: 'Kartu kredit', gopay: 'GoPay', ovo: 'OVO', shopeepay: 'ShopeePay', dana: 'DANA', linkaja: 'LinkAja', astrapay: 'AstraPay', 'bca-va': 'Virtual account BCA', qris: 'QRIS' };
  function loadOrders() { try { return JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]') || []; } catch (e) { return []; } }
  function saveOrders(list) { try { localStorage.setItem(ORDERS_KEY, JSON.stringify(list)); } catch (e) {} }
  function findOrder(id) {
    var list = loadOrders();
    if (!id) return list[0] || null;
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function updateOrder(id, patch) {
    var list = loadOrders();
    list.forEach(function (o) { if (o.id === id) for (var k in patch) o[k] = patch[k]; });
    saveOrders(list);
  }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtDate(ts, short) {
    var d = new Date(ts);
    return d.getDate() + ' ' + (short ? MONTHS_SHORT : MONTHS)[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad2(d.getHours()) + (short ? ':' : ':') + pad2(d.getMinutes()) + ' WIB';
  }
  function rp(n) { return 'Rp' + rupiah.format(n); }
  // id pesanan: ?id= (prototipe) atau segmen path /pesanan/<id> & /pembayaran/<id>
  function queryId() {
    try {
      var q = new URLSearchParams(location.search).get('id');
      if (q) return q;
      var m = location.pathname.match(/^\/(?:pesanan|pembayaran)\/([^/]+)/);
      return m && m[1] !== 'berhasil' && m[1] !== 'diambil' ? decodeURIComponent(m[1]) : null;
    } catch (e) { return null; }
  }

  /* ---------- 11. Checkout address: same "Tambah Alamat" / "Ubah Alamat" modal as the account page ----------
     Empty box → Tambah; filled card → Ubah. A previously saved address (account page or an earlier
     checkout) is shown right away; saving replaces the box/card and notifies the checkout flow. */
  function initAddressForm() {
    if (!document.querySelector('[data-address-empty-add]')) return;
    var addrEl = document.querySelector('.checkout-address-empty') || document.querySelector('[data-address-empty-add]');
    var data = loadAddress();
    function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function applyAddress(d) {
      // same card as Akun › Alamat Pengiriman
      var filled = document.createElement('div');
      filled.className = 'account-address-card checkout-address-card';
      filled.setAttribute('data-address-filled', '');
      filled.innerHTML =
        '<svg class="account-address-ico" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>' +
        '<div class="account-address-info">' +
          '<strong><span data-address-name>' + esc(d.nama) + '</span> <span class="account-address-label">' + esc(d.label || 'Rumah') + '</span></strong>' +
          '<p>' + esc(addressLine(d)) + '</p>' +
          (d.telp ? '<small>' + esc(d.telp) + '</small>' : '') +
        '</div>' +
        '<button class="btn btn-secondary account-address-edit" type="button" data-address-empty-add>Ubah</button>';
      addrEl.replaceWith(filled);
      addrEl = filled;
      document.dispatchEvent(new CustomEvent('storev2:addresschange'));
    }
    if (data) applyAddress(data);
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('[data-address-empty-add]');
      if (!t) return;
      e.preventDefault();
      addressModal.open(data, function (d) { data = d; applyAddress(d); });
    });
  }

  /* ---------- 12. Checkout flow: shipping option → address → payment → CTA ----------
     - "Kirim melalui kurir": show Alamat Pengiriman; CTA needs address + payment.
     - "Ambil di tempat": hide Alamat Pengiriman; CTA needs payment only. */
  function initCheckoutFlow() {
    var shipRadios = document.querySelectorAll('[data-shipping]');
    var payBtn = document.querySelector('[data-pay-now]');
    var addrSection = document.querySelector('[data-address-section]');
    var pickupSection = document.querySelector('[data-pickup-section]');
    var courierSection = document.querySelector('[data-courier-section]');
    if (!shipRadios.length || !payBtn) return;

    // Video premium checkout (payment.html?product=<video id>): digital product, so no "Opsi pengiriman"
    // (nor address / courier / pickup); Pesananmu shows the video, the summary has no shipping lines.
    var digital = null;
    try {
      var vids = JSON.parse((document.querySelector('[data-video-data]') || {}).textContent || '[]');
      var pid = new URLSearchParams(location.search).get('product');
      digital = vids.filter(function (v) { return v.id === pid; })[0] || null;
    } catch (e) {}
    if (digital) {
      var shipCard = document.querySelector('[data-shipping-options]');
      shipCard = shipCard && shipCard.closest('section');
      if (shipCard) shipCard.remove();
      [addrSection, pickupSection, courierSection].forEach(function (s) { if (s) s.hidden = true; });
      var rows = document.querySelectorAll('.checkout-product-row');
      Array.prototype.forEach.call(rows, function (r, i) { if (i) r.remove(); });
      var row = rows[0];
      if (row) {
        var im = row.querySelector('img'); if (im) { im.src = digital.image || (digital.images || [])[0]; im.alt = digital.title; }
        var h = row.querySelector('h3'); if (h) h.textContent = digital.title;
        var vr = row.querySelector('.checkout-product-variant'); if (vr) vr.textContent = 'Video premium · Akses video eksklusif';
        var meta = row.querySelector('.checkout-product-meta');
        if (meta) meta.innerHTML = '<strong>Rp&nbsp;' + digital.price_disc + '</strong>' +
          (digital.price ? '<span class="checkout-price-old">Rp&nbsp;' + digital.price + '</span>' : '') +
          (digital.disc ? '<span class="badge badge-soft-red">' + digital.disc + '%</span>' : '');
        var qtyCtl = row.querySelector('.checkout-quantity-control'); if (qtyCtl) qtyCtl.remove(); // one access per purchase
      }
      var lines = document.querySelectorAll('.checkout-summary-lines > div');
      Array.prototype.forEach.call(lines, function (l) {
        var lbl = (l.querySelector('span') || {}).textContent || '';
        if (/Pengiriman|Proteksi/.test(lbl)) l.remove();
        if (/Subtotal/.test(lbl)) l.querySelector('strong').innerHTML = 'Rp&nbsp;' + digital.price_disc;
      });
      var tot = document.querySelector('.checkout-total strong');
      if (tot) tot.innerHTML = 'Rp&nbsp;' + digital.price_disc;
      document.body.classList.add('is-digital-checkout');
    }

    function shippingValue() {
      var c = document.querySelector('[data-shipping]:checked');
      return c ? c.getAttribute('data-shipping') : null;
    }
    function addressFilled() { return !!document.querySelector('[data-address-filled], .checkout-address-filled'); }
    function courierSelected() { return !!document.querySelector('input[name="courier"]:checked'); }
    function paymentSelected() { return !!document.querySelector('input[name="paymentMethod"]:checked'); }

    function sync() {
      var ship = shippingValue();
      var hasAddr = addressFilled();
      if (addrSection) addrSection.hidden = (ship !== 'kurir');
      if (pickupSection) pickupSection.hidden = (ship !== 'pickup');
      // courier options appear only once a delivery address exists
      if (courierSection) courierSection.hidden = !(ship === 'kurir' && hasAddr);
      var valid = false;
      if (digital) valid = paymentSelected();
      else if (ship === 'pickup') valid = paymentSelected();
      else if (ship === 'kurir') valid = hasAddr && courierSelected() && paymentSelected();
      payBtn.disabled = !valid;
      if (payProxy) payProxy.disabled = !valid;   // mobile sticky "Bayar" follows the same rules
    }

    // mobile sticky bar: total from the summary, "Bayar" delegates to the real CTA
    var payProxy = document.querySelector('[data-pay-proxy]');
    var payBarTotal = document.querySelector('[data-pay-bar-total]');
    var sumTotal = document.querySelector('.checkout-total strong');
    if (payBarTotal && sumTotal) payBarTotal.textContent = 'Rp' + rupiah.format(digits(sumTotal.textContent));
    if (payProxy) payProxy.addEventListener('click', function () { if (!payProxy.disabled) payBtn.click(); });

    shipRadios.forEach(function (r) { r.addEventListener('change', sync); });
    document.addEventListener('change', function (e) {
      if (e.target && (e.target.name === 'paymentMethod' || e.target.name === 'courier')) sync();
    });
    document.addEventListener('storev2:addresschange', sync);

    // CTA: go straight to success, except BCA VA / QRIS which need a payment-instruction step
    payBtn.addEventListener('click', function () {
      if (payBtn.disabled) return;
      var m = document.querySelector('input[name="paymentMethod"]:checked');
      var v = m ? m.value : '';
      var pending = v === 'bca-va' || v === 'qris';
      // video premium (digital): paid at once → Selesai straight away; BCA VA / QRIS → Belum dibayar first
      setCtaLoading(payBtn, true);
      setCtaLoading(payProxy, true);
      var order = createOrder(v, pending ? 'unpaid' : (digital ? 'completed' : 'processing'));
      window.location.href = pending
        ? '/pembayaran/' + encodeURIComponent(order.id) + '?method=' + v
        : '/pembayaran/' + encodeURIComponent(order.id) + '/berhasil';
    });
    function pickupLocation() { // "Kantor KOMPAS.com" + its address, as shown in the checkout pickup card
      var n = document.querySelector('.checkout-pickup-name'), ad = document.querySelector('.checkout-pickup-addr');
      return [n && n.textContent.trim(), ad && ad.textContent.trim()].filter(Boolean).join('\n') || 'Kantor KOMPAS.com';
    }
    function createOrder(method, status) {
      var now = Date.now();
      var d = new Date(now);
      // invoice SKC-YYMMDD-XXXXXX: 6 karakter acak tanpa O, 0, I, 1 (mudah dieja, tidak membuka jumlah pesanan)
      var INVOICE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', rand = '';
      for (var k = 0; k < 6; k++) rand += INVOICE_CHARS.charAt(Math.floor(Math.random() * INVOICE_CHARS.length));
      var id = 'SKC-' + String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + rand;
      var qp = new URLSearchParams(location.search);
      var productSlug = qp.get('checkoutFlow') === 'buy-now' ? (qp.get('product') || '') : '';
      var row = document.querySelector('.checkout-product-row');
      var img = row && row.querySelector('img');
      var title = row && row.querySelector('h3');
      var variant = row && row.querySelector('.checkout-product-variant');
      var courier = document.querySelector('input[name="courier"]:checked');
      var courierLabel = courier ? (courier.closest('label') || courier.parentNode).textContent.replace(/Rp[\s\d.]+/g, '').replace(/\s+/g, ' ').trim() : '';
      var ship = document.querySelector('input[name="shipping"]:checked');
      var addr = loadAddress();
      var order = {
        id: id, status: status, method: method, createdAt: now, deadline: now + 24 * 60 * 60 * 1000,
        paidAt: status === 'unpaid' ? undefined : now,
        total: digits((document.querySelector('.checkout-total strong') || {}).textContent || ''),
        image: img ? img.getAttribute('src') : '', title: title ? title.textContent.trim() : '',
        variant: variant ? variant.textContent.trim() : '',
        product: productSlug,
        shipping: digital ? 'Produk digital' : (ship && ship.value === 'pickup' ? 'Ambil di tempat' : (courierLabel || 'JNE Regular')),
        pickup: !!(ship && ship.value === 'pickup'),
        digital: !!digital,
        address: digital ? '' : (ship && ship.value === 'pickup' ? pickupLocation() : (addr ? addressLine(addr) : '')),
        va: method === 'bca-va' ? '08777 ' + [0, 0, 0].map(function () { return String(Math.floor(1000 + Math.random() * 9000)); }).join(' ') : ''
      };
      var list = loadOrders();
      list.unshift(order);
      saveOrders(list);
      return order;
    }

    sync();
  }

  /* ---------- 15. Mobile store header: hide the category bar once the page scrolls ---------- */
  function initMobileHeader() {
    var catbar = document.querySelector('[data-store-catbar]');
    if (!catbar) return;
    // search mode: the magnifier turns the header's main row into a search form
    var main = document.querySelector('.sv2m-main');
    var sOpen = document.querySelector('[data-mobile-search-open]');
    var sForm = document.querySelector('[data-mobile-search]');
    var sClose = document.querySelector('[data-mobile-search-close]');
    if (main && sOpen && sForm) {
      var sInput = sForm.querySelector('input');
      try { var q0 = new URLSearchParams(location.search).get('q'); if (q0 && sInput) sInput.value = q0; } catch (e) {}
      var openSearch = function () {
        sForm.hidden = false; main.classList.add('is-searching'); sOpen.setAttribute('aria-expanded', 'true');
        if (sInput) sInput.focus();
      };
      var closeSearch = function () {
        sForm.hidden = true; main.classList.remove('is-searching'); sOpen.setAttribute('aria-expanded', 'false');
        sOpen.focus();
      };
      sOpen.addEventListener('click', openSearch);
      if (sClose) sClose.addEventListener('click', closeSearch);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !sForm.hidden) closeSearch(); });
    }

    var toggle = document.querySelector('[data-mkategori-toggle]');
    var panel = document.querySelector('[data-mkategori-panel]');
    function closePanel() {
      if (!panel || panel.hidden) return;
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
    if (toggle && panel) {
      toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', function (e) {
        if (!panel.hidden && !panel.contains(e.target)) closePanel();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    }

    // header is position:fixed (so collapsing the bar never shifts the page); reserve its full height once
    var header = document.querySelector('.sv2m-header');
    function reserve() {
      if (!header || catbar.classList.contains('is-hidden')) return;
      document.documentElement.style.setProperty('--sv2m-header-h', header.offsetHeight + 'px');
    }
    reserve();
    window.addEventListener('resize', reserve);

    var ticking = false;
    function update() {
      // hysteresis: hide past 24px, show again only near the very top — no flip-flopping on small scrolls
      var y = window.scrollY, hidden = catbar.classList.contains('is-hidden');
      if (!hidden && y > 24) {
        catbar.classList.add('is-hidden');
        closePanel(); // the panel hangs off the category bar
      } else if (hidden && y < 8) {
        catbar.classList.remove('is-hidden');
      }
      ticking = false;
    }
    window.addEventListener('scroll', function () {
      if (!ticking) { window.requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ---------- 14. Account orders: tab filter, 3-dot menu, cancel confirm ---------- */
  // newest prototype orders on top of Daftar Pesanan, built from the sample card of the same status
  function renderStoredOrders(list) {
    // sample "Ambil di tempat" card: once its QR was scanned it becomes a completed order
    var sample = list.querySelector('[data-order-pickup]');
    var done = false;
    try { done = localStorage.getItem('store-v2-sample-pickup-done') === '1'; } catch (e) {}
    var doneTpl = list.querySelector('.order-card[data-order-status="completed"]:not([data-order-pickup])');
    if (sample && done && doneTpl) {
      sample.setAttribute('data-order-status', 'completed');
      sample.querySelector('.order-card-status').innerHTML = doneTpl.querySelector('.order-card-status').innerHTML;
      var acts = doneTpl.querySelector('.order-card-actions').cloneNode(true);
      Array.prototype.forEach.call(acts.querySelectorAll('a[href^="/pesanan"]'), function (a) { a.setAttribute('href', '/pesanan/SKC-260626-H7Q4MP?status=completed&pickup=1'); });
      sample.querySelector('.order-card-actions').replaceWith(acts);
    }
    var orders = loadOrders();
    if (!orders.length) return;
    var tpl = {};
    ['unpaid', 'processing', 'shipped', 'completed', 'canceled'].forEach(function (st) { tpl[st] = list.querySelector('.order-card[data-order-status="' + st + '"]:not([data-order-pickup])'); });
    var frag = document.createDocumentFragment();
    orders.forEach(function (o) {
      var base = tpl[o.status] || tpl.processing;
      if (!base) return;
      var card = base.cloneNode(true);
      card.setAttribute('data-order-status', o.status);
      card.setAttribute('data-order-id', o.id);
      card.setAttribute('data-product-slug', o.product || '');
      var again = card.querySelector('[data-buy-again]'); if (again) again.setAttribute('href', buyAgainHref(o.product));
      card.querySelector('.order-card-id strong').textContent = o.id;
      card.querySelector('.order-card-time').textContent = fmtDate(o.createdAt);
      var dl = card.querySelector('.order-deadline strong'); if (dl) dl.textContent = fmtDate(o.deadline, true);
      var img = card.querySelector('.order-card-product img'); if (img && o.image) { img.src = o.image; img.alt = o.title; }
      var h3 = card.querySelector('.order-card-info h3'); if (h3 && o.title) h3.textContent = o.title;
      var va = card.querySelector('.order-card-variant'); if (va && o.variant) va.textContent = o.variant;
      var pm = card.querySelector('.order-card-payment strong'); if (pm) pm.textContent = METHOD_LABEL[o.method] || o.method;
      var tot = card.querySelector('.order-card-total strong'); if (tot) tot.textContent = rp(o.total);
      // "Ambil di tempat" being processed = waiting at the pickup point
      var chip = card.querySelector('.order-card-status .order-status');
      if (chip && o.status === 'processing' && (o.pickup || o.shipping === 'Ambil di tempat')) {
        chip.textContent = 'Ambil di tempat';
        chip.className = 'order-status order-status--pickup';
        var acts = card.querySelector('.order-card-actions');
        if (acts && !acts.querySelector('[data-pickup-qr-card]')) {
          var qr = document.createElement('button');
          qr.className = 'btn btn-primary';
          qr.type = 'button';
          qr.setAttribute('data-pickup-qr-card', '');
          qr.setAttribute('data-order-id', o.id);
          qr.textContent = 'Buka QR code';
          acts.appendChild(qr);
        }
      }
      Array.prototype.forEach.call(card.querySelectorAll('a[href^="/pesanan"]'), function (a) { a.setAttribute('href', '/pesanan/' + encodeURIComponent(o.id) + '?status=' + o.status); });
      var how = card.querySelector('a[href^="/pembayaran"]'); if (how) how.setAttribute('href', '/pembayaran/' + encodeURIComponent(o.id) + '?method=' + o.method);
      frag.appendChild(card);
    });
    list.insertBefore(frag, list.firstChild);
    // "Belum dibayar" badge counts every unpaid card
    var tab = document.querySelector('[data-account-order-filter="unpaid"]');
    if (tab) {
      var n = list.querySelectorAll('.order-card[data-order-status="unpaid"]').length;
      var badge = tab.querySelector('.filter-count');
      if (!badge && n) { badge = document.createElement('span'); badge.className = 'filter-count'; tab.appendChild(document.createTextNode(' ')); tab.appendChild(badge); }
      if (badge) { if (n) badge.textContent = String(n); else badge.remove(); }
    }
  }

  function initAccountOrders() {
    var list = document.querySelector('[data-order-list]');
    if (!list) return;
    renderStoredOrders(list);
    // unpaid orders always lead the list (stable: the others keep their order)
    Array.prototype.slice.call(list.querySelectorAll('.order-card[data-order-status="unpaid"]')).reverse()
      .forEach(function (c) { list.insertBefore(c, list.firstChild); });
    var tabs = document.querySelectorAll('[data-account-order-filter]');
    var MAP = { all: null, unpaid: ['unpaid'], ongoing: ['processing', 'shipped'], completed: ['completed'], canceled: ['canceled'] };

    function applyFilter(key) {
      var allowed = MAP[key];
      list.querySelectorAll('.order-card').forEach(function (c) {
        var st = c.getAttribute('data-order-status');
        c.hidden = allowed ? allowed.indexOf(st) === -1 : false;
      });
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        tabs.forEach(function (x) {
          var on = x === t;
          x.classList.toggle('is-active', on);
          x.setAttribute('aria-selected', String(on));
        });
        applyFilter(t.getAttribute('data-account-order-filter'));
      });
    });

    function closeMenus() { list.querySelectorAll('.order-more-menu').forEach(function (m) { m.hidden = true; }); }
    document.addEventListener('click', function (e) {
      var more = e.target.closest && e.target.closest('[data-order-more]');
      if (more) {
        var menu = more.parentElement.querySelector('.order-more-menu');
        var willOpen = menu.hidden;
        closeMenus();
        menu.hidden = !willOpen;
        more.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) {
          // open upward when there isn't room below the button (e.g. last card / bottom of the screen)
          menu.classList.remove('is-up');
          var r = menu.getBoundingClientRect();
          if (r.bottom > window.innerHeight - 8) menu.classList.add('is-up');
        }
        return;
      }
      var cancel = e.target.closest && e.target.closest('[data-order-cancel]');
      if (cancel) { closeMenus(); openCancelConfirm(cancel.closest('.order-card')); return; }
      var complete = e.target.closest && e.target.closest('[data-order-complete]');
      if (complete) { completeOrder(complete.closest('.order-card')); return; }
      if (!e.target.closest('.order-more-menu')) closeMenus();
    });

    applyFilter('all');
  }

  // Beli Lagi membuka halaman detail produk dari pesanan itu (tanpa slug: Semua produk)
  function buyAgainHref(slug) { return slug ? '/produk/' + encodeURIComponent(slug) : '/produk'; }
  function buyAgainLink(card) {
    return '<a class="btn btn-primary" href="' + buyAgainHref(card && card.getAttribute('data-product-slug')) + '" data-buy-again>Beli Lagi</a>';
  }

  // "Pesanan selesai" on a Dikirim card: the order becomes Selesai and moves to the Selesai tab
  function completeOrder(card) {
    if (!card) return;
    card.setAttribute('data-order-status', 'completed');
    if (card.getAttribute('data-order-id')) updateOrder(card.getAttribute('data-order-id'), { status: 'completed' });
    var st = card.querySelector('.order-card-status');
    if (st) st.innerHTML = '<span class="order-status order-status--completed">Selesai</span>';
    Array.prototype.forEach.call(card.querySelectorAll('a[href*="status=shipped"]'), function (a) {
      a.setAttribute('href', a.getAttribute('href').replace('status=shipped', 'status=completed'));
    });
    var act = card.querySelector('.order-card-actions');
    var done = act && act.querySelector('[data-order-complete]');
    if (done) done.outerHTML = buyAgainLink(card);
    // re-apply the active filter so the card leaves Berlangsung and shows up under Selesai
    var activeTab = document.querySelector('[data-account-order-filter].is-active');
    if (activeTab) activeTab.click();
    showToast('Pesanan selesai. Cek di tab Selesai');
  }

  function openCancelConfirm(card) {
    var modal = document.createElement('div');
    modal.className = 'storev2-modal is-open';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML =
      '<div class="storev2-modal__backdrop" data-cx-dismiss></div>' +
      '<div class="storev2-modal__panel"><div class="storev2-modal__inner">' +
        '<div>' +
          '<div class="storev2-modal__title">Apakah kamu yakin ingin membatalkan transaksi?</div>' +
          '<div class="storev2-modal__desc">Konfirmasi jika ingin membatalkan transaksi ini.</div>' +
        '</div>' +
        '<div class="storev2-modal__actions storev2-modal__actions--row">' +
          '<button type="button" class="storev2-modal__btn storev2-modal__btn--secondary" data-cx-dismiss>Kembali</button>' +
          '<button type="button" class="storev2-modal__btn storev2-modal__btn--primary" data-cx-confirm>Ya, batalkan</button>' +
        '</div>' +
      '</div></div>';
    document.body.appendChild(modal);
    function onKey(e) { if (e.key === 'Escape') teardown(); }
    function teardown() { modal.remove(); document.removeEventListener('keydown', onKey); }
    modal.addEventListener('click', function (e) {
      if (e.target.closest('[data-cx-dismiss]')) { teardown(); return; }
      if (e.target.closest('[data-cx-confirm]')) {
        if (card) {
          card.setAttribute('data-order-status', 'canceled');
          if (card.getAttribute('data-order-id')) updateOrder(card.getAttribute('data-order-id'), { status: 'canceled' });
          var st = card.querySelector('.order-card-status');
          if (st) st.innerHTML = '<span class="order-status order-status--canceled">Dibatalkan</span>';
          var act = card.querySelector('.order-card-actions');
          if (act) act.innerHTML = '<a class="btn btn-secondary" href="/pesanan/' + encodeURIComponent(card.getAttribute('data-order-id') || 'SKC-260626-H7Q4MP') + '?status=canceled">Detail</a>' + buyAgainLink(card);
          // decrement the "Belum dibayar" badge
          var badge = document.querySelector('[data-account-order-filter="unpaid"] .filter-count');
          if (badge) { var n = parseInt(badge.textContent, 10) - 1; if (n > 0) badge.textContent = String(n); else badge.remove(); }
          // re-apply the active filter so a now-canceled card leaves the current view if needed
          var activeTab = document.querySelector('[data-account-order-filter].is-active');
          if (activeTab) activeTab.click();
        }
        teardown();
      }
    });
    document.addEventListener('keydown', onKey);
  }

  /* ---------- 13. Payment instruction page (BCA VA / QRIS) ---------- */
  function initPaymentInstruction() {
    var page = document.querySelector('[data-instruction]');
    if (!page) return;
    var method = 'bca-va';
    try {
      var q = new URLSearchParams(window.location.search).get('method');
      if (q) method = q;
    } catch (e) {}
    var order = findOrder(queryId());
    if (order && order.method) method = order.method;
    page.querySelectorAll('[data-instr]').forEach(function (b) {
      b.hidden = (b.getAttribute('data-instr') !== method);
    });
    function set(sel, text) { var el = page.querySelector(sel); if (el) el.textContent = text; }
    set('[data-pay-method]', METHOD_LABEL[method] || METHOD_LABEL['bca-va']);
    if (order) {
      set('[data-pay-deadline]', fmtDate(order.deadline));
      set('[data-pay-total]', rp(order.total));
      var tc = page.querySelector('[data-pay-total-copy]'); if (tc) tc.setAttribute('data-copy', String(order.total));
      if (order.va) {
        set('[data-pay-va]', order.va);
        var vc = page.querySelector('[data-pay-va-copy]'); if (vc) vc.setAttribute('data-copy', order.va.replace(/\s/g, ''));
      }
    }
    // "Saya sudah bayar": the order moves to Berlangsung (processing) and the success page shows it
    var done = page.querySelector('[data-pay-done]');
    if (done) done.addEventListener('click', function (e) {
      if (!order) return; // plain prototype visit → default link
      e.preventDefault();
      setCtaLoading(done, true);
      updateOrder(order.id, { status: order.digital ? 'completed' : 'processing', paidAt: Date.now() });
      window.location.href = '/pembayaran/' + encodeURIComponent(order.id) + '/berhasil';
    });
  }

  /* ---------- Order card (Pembelian Berhasil + Detail Transaksi) filled from a stored prototype order ----------
     "Ambil di tempat" orders show "Lokasi pengambilan" instead of "Alamat pengiriman" and have no airway bill. */
  function fillOrderCard(page, order) {
    function item(label) {
      var hit = null;
      Array.prototype.forEach.call(page.querySelectorAll('.od-item'), function (it) { var dt = it.querySelector('dt'); if (dt && dt.textContent.trim() === label) hit = it; });
      return hit;
    }
    function setItem(label, text) { var it = item(label); if (it) it.querySelector('dd').textContent = text; return it; }
    var img = page.querySelector('.od-product img'); if (img && order.image) { img.src = order.image; img.alt = order.title; }
    var h3 = page.querySelector('.od-product h3'); if (h3 && order.title) h3.textContent = order.title;
    var p = page.querySelector('.od-product p'); if (p && order.variant) p.textContent = order.variant;
    var inv = setItem('No Invoice', order.id); if (inv) { var c = inv.querySelector('[data-copy]'); if (c) c.setAttribute('data-copy', order.id); }
    if (order.createdAt) setItem('Tanggal pembelian', fmtDate(order.createdAt));
    if (order.method) setItem('Metode pembayaran', METHOD_LABEL[order.method] || order.method);
    if (order.total) setItem('Total pembayaran', rp(order.total));
    if (order.shipping) setItem('Pengiriman', order.shipping);
    var pickup = order.pickup || order.shipping === 'Ambil di tempat';
    var addr = item('Alamat pengiriman') || item('Lokasi pengambilan');
    if (addr && order.address) {
      addr.querySelector('dt').textContent = pickup ? 'Lokasi pengambilan' : 'Alamat pengiriman';
      var dd = addr.querySelector('dd');
      dd.textContent = '';
      // first line = place name (bold, as the other values); the lines under it = its address (secondary text)
      String(order.address).split('\n').forEach(function (line, i) {
        if (!i) { dd.appendChild(document.createTextNode(line)); return; }
        var sub = document.createElement('span');
        sub.className = 'od-dd-sub';
        sub.textContent = line;
        dd.appendChild(sub);
      });
    }
    var resi = item('No resi');
    if (resi && (pickup || order.digital || (order.status !== 'shipped' && order.status !== 'completed'))) resi.hidden = true;
    if (order.digital) { // video premium: nothing is shipped
      [item('Pengiriman'), item('Alamat pengiriman'), item('Lokasi pengambilan')].forEach(function (it) { if (it) it.hidden = true; });
    }
    // a section left without visible rows (digital: the whole Pengiriman block) goes too, with its divider
    Array.prototype.forEach.call(page.querySelectorAll('.od-section'), function (sec) {
      sec.hidden = !Array.prototype.some.call(sec.querySelectorAll('.od-item'), function (it) { return !it.hidden; });
    });
  }

  /* ---------- Pembelian Berhasil: show the order that was just paid ---------- */
  function initPaymentSuccess() {
    var page = document.querySelector('.payment-success-v2:not(.payment-pending-v2)');
    if (!page) return;
    var order = queryId() && findOrder(queryId());
    if (!order) return; // plain prototype visit keeps the sample content
    fillOrderCard(page, order);
    var detail = page.querySelector('.ps-actions .btn-secondary');
    if (detail) detail.setAttribute('href', '/pesanan/' + encodeURIComponent(order.id) + '?status=' + order.status);
  }

  /* ---------- Detail Transaksi: a stored order (order-detail.html?id=…) replaces the sample content ---------- */
  function initOrderDetailFromStore() {
    var page = document.querySelector('[data-order-detail]');
    if (!page) return;
    var order = pageOrder();
    if (order) fillOrderCard(page, order);
    initPickupQr(page, order);
    // video premium: once paid (Selesai) the buyer can open the video
    var access = page.querySelector('[data-video-access]');
    if (access) access.hidden = !(order && order.digital && order.status === 'completed');
  }

  var PICKUP_PLACE = 'Kantor KOMPAS.com\nKompas Gramedia, Jl. Palmerah Sel. No.22-26 Unit 2 Lantai 2, RT.4/RW.2, Gelora, Kecamatan Tanah Abang, Kota Jakarta Pusat, Daerah Khusus Ibukota Jakarta 10270';
  // order shown on order-detail: the stored one for ?id=, or the sample "Ambil di tempat" card (?pickup=1)
  function pageOrder() {
    if (pageOrder.v !== undefined) return pageOrder.v;
    var id = queryId();
    var o = id && findOrder(id);
    if (!o && new URLSearchParams(location.search).get('pickup') === '1') {
      o = { id: id || 'SKC-260626-H7Q4MP', pickup: true, shipping: 'Ambil di tempat', status: new URLSearchParams(location.search).get('status') || 'processing', address: PICKUP_PLACE, sample: true };
    }
    pageOrder.v = o || null;
    return pageOrder.v;
  }

  /* ---------- Pickup QR popup (bottom sheet on mobile, centred on desktop) — shared by Detail Transaksi
     ("Buka QR code") and the Daftar Pesanan card ("Buka QR code") ---------- */
  var pickupQrModal = null, scanTimer = null, scanOrderId = null;
  var SAMPLE_PICKUP_KEY = 'store-v2-sample-pickup-done';
  // prototype stand-in for the staff scanning the QR: the order is completed and the page moves on
  function pickupScanned() {
    clearTimeout(scanTimer);
    var id = scanOrderId;
    if (findOrder(id)) updateOrder(id, { status: 'completed', pickedAt: Date.now() });
    else { try { localStorage.setItem(SAMPLE_PICKUP_KEY, '1'); } catch (e) {} }
    window.location.href = '/pesanan/' + encodeURIComponent(id) + '/diambil';
  }
  function openPickupQr(orderId) {
    function close() { clearTimeout(scanTimer); pickupQrModal.classList.remove('is-open'); document.removeEventListener('keydown', onKey); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    if (!pickupQrModal) {
      pickupQrModal = document.createElement('div');
      pickupQrModal.className = 'storev2-modal storev2-modal--qr';
      pickupQrModal.setAttribute('role', 'dialog');
      pickupQrModal.setAttribute('aria-modal', 'true');
      pickupQrModal.setAttribute('aria-labelledby', 'pickup-qr-title');
      pickupQrModal.innerHTML =
        '<div class="storev2-modal__backdrop" data-qr-close></div>' +
        '<div class="storev2-modal__panel pickup-qr-panel">' +
          '<span class="storev2-addr__handle" aria-hidden="true"></span>' +
          '<button type="button" class="storev2-addr__close" data-qr-close aria-label="Tutup"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg></button>' +
          '<h2 class="pickup-qr-title" id="pickup-qr-title">QR code pengambilan</h2>' +
          '<p class="pickup-qr-desc">Tunjukkan QR code ini kepada petugas di lokasi pengambilan.</p>' +
          '<div class="pickup-qr-code"><img src="/images/store-v2/qr-pickup.svg" alt="QR code pengambilan pesanan"></div>' +
          '<p class="pickup-qr-id"></p>' +
          '<p class="pickup-qr-place">Kantor KOMPAS.com · Senin-Jumat Pukul 09.00-17.00</p>' +
        '</div>';
      document.body.appendChild(pickupQrModal);
      pickupQrModal.addEventListener('click', function (e) {
        if (e.target.closest('[data-qr-close]')) close();
        else if (e.target.closest('.pickup-qr-code')) pickupScanned(); // tap the QR = scan now
      });
    }
    scanOrderId = orderId || 'SKC-260626-H7Q4MP';
    pickupQrModal.querySelector('.pickup-qr-id').textContent = scanOrderId;
    pickupQrModal.classList.add('is-open');
    document.addEventListener('keydown', onKey);
    clearTimeout(scanTimer);
    scanTimer = setTimeout(pickupScanned, 5000); // the staff scans it a few seconds later
  }

  /* ---------- Pesanan berhasil diambil: "Detail pesanan" opens the now-completed order ---------- */
  function initPickupSuccess() {
    var page = document.querySelector('[data-pickup-success]');
    if (!page) return;
    var id = queryId() || 'SKC-260626-H7Q4MP';
    var link = page.querySelector('[data-pickup-detail]');
    if (link) link.setAttribute('href', '/pesanan/' + encodeURIComponent(id) + '?status=completed' + (findOrder(id) ? '' : '&pickup=1'));
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-pickup-qr-card]');
    if (b) { e.preventDefault(); openPickupQr(b.getAttribute('data-order-id')); }
  });

  /* ---------- "Buka QR code" on Detail Transaksi for Ambil di tempat orders waiting at the pickup point ----------
     Mobile: floating primary CTA at the bottom of the screen; desktop: last item of the card. */
  function initPickupQr(page, order) {
    var box = page.querySelector('[data-pickup-qr]');
    if (!box || !order) return;
    var status = new URLSearchParams(location.search).get('status') || order.status;
    var pickup = order.pickup || order.shipping === 'Ambil di tempat';
    if (!pickup || status !== 'processing') return;
    box.hidden = false;
    document.body.classList.add('has-pickup-qr');
    box.querySelector('[data-pickup-qr-open]').addEventListener('click', function () { openPickupQr(order.id); });
  }

  ready(function () {
    initHeroCarousel();
    initApparelPdp();
    initProductGallery();
    initPdpLightbox();
    initWhatsappAsk();
    initCtaLoading();
    initPdpQuantity();
    initPdpOptions();
    initDescriptionToggle();
    initWishlist();
    initCartQuantity();
    initCartSelect();
    initCartTabs();
    initLoginGate();
    initAccountAvatar();
    initAccountSections();
    initAddressManager();
    initPaymentSuccess();
    initOrderDetailFromStore();
    initPickupSuccess();
    initTabPage();
    initStoreHeader();
    initAddressForm();
    initCheckoutFlow();
    initPaymentInstruction();
    initAccountOrders();
    initMobileHeader();
    initRecentSearches();
    initCopyButtons();
    initOrderTimeline();
    initKategoriMenu();
    initAllProducts();
    initPromo();
    initSearchPage();
    initWishlistPage();
  });
})();
