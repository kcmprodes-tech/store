/* Halaman pratinjau email (/__email, development): lebar Desktop/Mobile & tinggi iframe mengikuti isi. */
(function () {
  var frame = document.querySelector('.frame');
  var buttons = document.querySelectorAll('[data-width]');
  function fit() {
    try { frame.style.height = frame.contentDocument.documentElement.scrollHeight + 'px'; } catch (e) {}
  }
  frame.addEventListener('load', fit);
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(buttons, function (b) {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      frame.classList.toggle('is-mobile', btn.getAttribute('data-width') === 'mobile');
      setTimeout(fit, 250);
    });
  });
})();
