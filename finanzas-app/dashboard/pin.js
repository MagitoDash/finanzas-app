// Pantalla de PIN compartida por el panel y la página de registrar.
(function () {
  let ov, resolver;
  function armar() {
    if (ov) return ov;
    ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0f1115;display:none;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,system-ui,sans-serif;color:#eef0f4';
    ov.innerHTML = '<form style="width:100%;max-width:320px;text-align:center"><div style="font-size:44px">🔒</div><h2 style="margin:8px 0 4px">Mis Finanzas</h2>' +
      '<div style="color:#9aa3b2;font-size:14px;margin-bottom:18px">Ingresá tu PIN</div>' +
      '<input id="pin-in" type="password" inputmode="numeric" autocomplete="current-password" maxlength="8" placeholder="••••" style="width:100%;font-size:32px;text-align:center;letter-spacing:10px;padding:14px;border-radius:14px;border:1px solid rgba(255,255,255,.12);background:#171a21;color:#fff;outline:none">' +
      '<div id="pin-err" style="color:#f87171;min-height:22px;margin:10px 0;font-size:14px"></div>' +
      '<button style="width:100%;padding:15px;font-size:18px;font-weight:700;border:0;border-radius:14px;background:#6ee7b7;color:#0f1115">Entrar</button></form>';
    document.body.appendChild(ov);
    ov.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      const pin = ov.querySelector('#pin-in').value, err = ov.querySelector('#pin-err');
      try {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
        const j = await r.json();
        if (!r.ok) { err.textContent = j.error || 'PIN incorrecto'; ov.querySelector('#pin-in').value = ''; return; }
        ov.style.display = 'none'; ov.querySelector('#pin-in').value = ''; err.textContent = '';
        if (resolver) { resolver(); resolver = null; }
      } catch (x) { err.textContent = 'Sin conexión'; }
    };
    return ov;
  }
  window.Auth = {
    // Muestra el PIN si hace falta. Devuelve una promesa que se cumple cuando ya se puede usar.
    async check() {
      let est; try { est = await (await fetch('/api/auth-estado', { cache: 'no-store' })).json(); } catch (e) { return; } // sin señal: seguimos
      if (!est.pin || est.ok) return;
      return this.mostrar();
    },
    mostrar() {
      armar().style.display = 'flex'; setTimeout(() => ov.querySelector('#pin-in').focus(), 100);
      return new Promise((r) => { resolver = r; });
    },
    async salir() { await fetch('/api/logout', { method: 'POST' }); location.reload(); },
  };
})();
