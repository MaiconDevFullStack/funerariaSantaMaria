const fs = require('fs');

['test-menu.html', 'index.html'].forEach(filename => {
  const html = fs.readFileSync(__dirname + '/' + filename, 'utf8');
  let cssHtml = html;
  if (filename === 'index.html') {
    try { cssHtml += fs.readFileSync(__dirname + '/style.css', 'utf8'); } catch(e) {}
  }
  const tests = [];
  const pass = (name) => tests.push({ name, ok: true });
  const fail = (name, reason) => tests.push({ name, ok: false, reason });
  const isProd = filename === 'index.html';
  const drawerId   = isProd ? 'nav-mobile-menu' : 'nav-drawer';
  const overlayId  = isProd ? 'nav-drawer-overlay' : 'nav-overlay';
  const closeBtnId = isProd ? 'nav-drawer-close' : 'drawer-close';
  const linkClass  = isProd ? 'nav-mob-link' : 'drawer-link';
  const ctaClass   = isProd ? 'nav-cta-mobile' : 'drawer-cta';

  // 1. Drawer existe
  html.includes('id="' + drawerId + '"')
    ? pass('Drawer existe') : fail('Drawer existe', 'id=' + drawerId + ' ausente');
  // 2. Overlay existe
  html.includes('id="' + overlayId + '"')
    ? pass('Overlay existe') : fail('Overlay existe', 'id=' + overlayId + ' ausente');
  // 3. Hamburger existe
  html.includes('id="nav-hamburger"')
    ? pass('Hamburger existe') : fail('Hamburger existe', 'ausente');
  // 4. Botão fechar dentro do drawer
  (html.includes('id="' + closeBtnId + '"') &&
    html.indexOf('id="' + closeBtnId + '"') > html.indexOf('id="' + drawerId + '"'))
    ? pass('Botao fechar dentro do drawer') : fail('Botao fechar dentro do drawer', 'posicao incorreta');
  // 5. 5+ links no drawer
  const linkCount = (html.match(new RegExp(linkClass, 'g')) || []).length;
  linkCount >= 5
    ? pass('5+ links no drawer') : fail('Links insuficientes', 'encontrados: ' + linkCount);
  // 6. CTA existe
  html.includes(ctaClass)
    ? pass('CTA existe') : fail('CTA ausente', '');
  // 7. openDrawer()
  html.includes('function openDrawer()')
    ? pass('openDrawer() definida') : fail('openDrawer() ausente', '');
  // 8. closeDrawer()
  html.includes('function closeDrawer()')
    ? pass('closeDrawer() definida') : fail('closeDrawer() ausente', '');
  // 9. Escape
  html.includes("key === 'Escape'")
    ? pass('Tecla Escape tratada') : fail('Escape nao tratado', '');
  // 10. Overlay listener
  (html.includes(overlayId + '.addEventListener') ||
   html.includes('drawerOverlay.addEventListener') ||
   html.includes("getElementById('" + overlayId + "')") ||
   html.includes('overlay.addEventListener') ||
   html.includes('Overlay') && html.includes('addEventListener'))
    ? pass('Overlay tem listener') : fail('Overlay sem listener', '');
  // 11. display:none no desktop (antes do primeiro @media)
  const beforeMedia = cssHtml.split('@media')[0];
  (beforeMedia.includes(drawerId) && /display:\s*none/.test(beforeMedia))
    ? pass('Drawer display:none desktop') : fail('display:none desktop ausente', '');
  // 12. @media 900px com display:flex
  (cssHtml.includes('@media (max-width: 900px)') && cssHtml.includes('display: flex'))
    ? pass('@media 900px com display:flex') : fail('@media 900px ausente', '');
  // 13. translateX(100%)
  cssHtml.includes('translateX(100%)')
    ? pass('translateX(100%) presente') : fail('translateX ausente', '');
  // 14. transition: transform
  cssHtml.includes('transition: transform')
    ? pass('transition:transform presente') : fail('transition ausente', '');
  // 15. aria-expanded
  html.includes('aria-expanded')
    ? pass('aria-expanded presente') : fail('aria-expanded ausente', '');

  const passed = tests.filter(t => t.ok).length;
  const icon = passed === tests.length ? 'OK' : 'FALHA';
  console.log('\n' + icon + ' [' + filename + '] ' + passed + '/' + tests.length);
  tests.forEach(t => console.log('  ' + (t.ok ? 'V' : 'X') + ' ' + t.name + (t.reason ? '  =>  ' + t.reason : '')));
  if (passed < tests.length) process.exitCode = 1;
});

if (!process.exitCode) console.log('\nTODOS OS TESTES PASSARAM -- pronto para producao\n');
else console.log('\nFALHAS ENCONTRADAS -- NAO subir para producao\n');
