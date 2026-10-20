// selftest 用の最小モック JS(相対参照の JS)。日付・乱数・読み込み演出を持つ
(function () {
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var d = new Date();
  var now = document.getElementById('now');
  if (now) now.textContent = d.getUTCFullYear() + '/' + pad(d.getUTCMonth() + 1) + '/' + pad(d.getUTCDate());
  var rnd = document.getElementById('rnd');
  if (rnd) rnd.textContent = 'No. ' + Math.floor(Math.random() * 1e9) + ' @ ' + d.toISOString();
  var sk = document.getElementById('skeleton');
  if (!sk) return;
  if (/[?&]noload=1/.test(location.search)) { sk.hidden = true; return; }
  var i = 0;
  var t = setInterval(function () { sk.textContent = 'loading ' + (++i); }, 50);
  setTimeout(function () { clearInterval(t); sk.hidden = true; }, 700);
})();
