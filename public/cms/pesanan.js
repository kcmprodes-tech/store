/* CMS — detail pesanan: foto paket/retur dari kamera HP, diperkecil di browser (±1600 px JPEG) sebelum diunggah. */
(function () {
  'use strict';

  var MAX_SIDE = 1600;

  /** File gambar → Blob JPEG yang sudah diperkecil (orientasi EXIF ikut diterapkan). */
  function shrink(file) {
    if (typeof createImageBitmap !== 'function') return Promise.resolve(file);
    return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (bitmap) {
      var scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (bitmap.close) bitmap.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) { resolve(blob || file); }, 'image/jpeg', 0.85);
      });
    }).catch(function () { return file; });
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-order-photo]'), function (input) {
    var label = input.closest('label');
    var text = label && label.querySelector('[data-photo-label]');
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      if (label) label.classList.add('is-busy');
      if (text) text.textContent = 'Mengunggah…';
      shrink(file).then(function (blob) {
        return window.CMS.api(input.getAttribute('data-order-photo'), {
          method: 'POST',
          body: blob,
          headers: { 'Content-Type': blob.type || 'image/jpeg' },
        });
      }).then(function () {
        location.reload();
      }).catch(function (err) {
        window.CMS.toast(err.message, 'error');
        if (label) label.classList.remove('is-busy');
        if (text) text.textContent = 'Ambil foto';
        input.value = '';
      });
    });
  });
})();
