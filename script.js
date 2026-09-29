/* ==========================================================
   SIMULADOR DE ESTUFA 3D  ·  script.js
   Organización del archivo:
     1. Utilidades y constantes
     2. Estado de la estufa (S)
     3. Sonido
     4. Construcción de perillas y quemadores (DOM)
     5. Acciones (lo que hacen los botones)
     6. Controles: botones y teclado
     7. render(): dibuja el estado en pantalla
     8. Simulación física (reloj de 200 ms)
     9. Cámara 3D (girar con el mouse)
    10. Autotest (pruebas automáticas)
   ========================================================== */


/* ---------- 1. UTILIDADES Y CONSTANTES ---------- */

// Atajo para seleccionar un elemento del HTML: $('#id')
const $ = s => document.querySelector(s);

// Pausa asíncrona (se usa en el autotest para esperar la ignición)
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Módulo que siempre da positivo: mod(-1, 6) = 5. Sirve para que las perillas den la vuelta
const mod = (a, n) => ((a % n) + n) % n;

// Temperatura del horno para cada posición de la perilla (0 = apagado)
const TEMPS = [0, 100, 150, 180, 200, 220, 250];

// Posición (x, y) de cada quemador sobre la cubierta de la estufa.
// Están a la misma distancia del centro, por eso la disposición es simétrica.
const POS = [[110, 70], [310, 70], [110, 190], [310, 190]];


/* ---------- 2. ESTADO DE LA ESTUFA ---------- */
// Toda la información del simulador vive en este objeto.
// Las funciones lo modifican y render() lo dibuja en pantalla.
const S = {
  b:     [0, 0, 0, 0],                  // nivel de cada quemador (0 apagado a 5 máximo)
  lit:   [false, false, false, false],  // ¿la llama está realmente encendida?
  pot:   [true, true, false, false],    // ¿hay olla sobre el quemador?
  w:     [22, 22, 22, 22],              // temperatura del agua de cada olla (°C)
  ov:    0,                             // posición de la perilla del horno (0 a 6)
  T:     22,                            // temperatura actual dentro del horno (°C)
  door:  false,                         // puerta del horno abierta
  light: false,                         // luz del horno encendida
  tm:    0,                             // segundos que le quedan al temporizador
  tmOn:  false,                         // temporizador corriendo
  al:    0,                             // alarma: cuántos pitidos faltan (0 = sin alarma)
  mute:  false,                         // sonido silenciado
  ready: false                          // el horno ya llegó a la temperatura pedida
};


/* ---------- 3. SONIDO (Web Audio API) ---------- */
// Genera un tono sin necesidad de archivos de audio.
// f = frecuencia (Hz), d = duración (s), t = forma de onda, v = volumen
let AC; // contexto de audio, se crea la primera vez que se usa
function tone(f, d, t = 'sine', v = .12) {
  if (S.mute) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.type = t;
    o.frequency.value = f;
    g.gain.value = v;
    o.connect(g);
    g.connect(AC.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(.0001, AC.currentTime + d); // se apaga suave
    o.stop(AC.currentTime + d);
  } catch (e) { /* si el navegador no soporta audio, se ignora */ }
}

// Suena n pitidos seguidos (alarma del temporizador y aviso del horno)
const beeps = n => {
  for (let i = 0; i < n; i++) setTimeout(() => tone(1400, .15, 'square', .08), i * 220);
};


/* ---------- 4. CONSTRUCCIÓN DEL DOM ---------- */

// 4.1 Perillas: 4 de quemadores (0 a 3) y 1 del horno (4)
const kn = $('#knobs');
for (let i = 0; i < 5; i++) {
  const d = document.createElement('div');
  d.className = 'knob' + (i == 4 ? ' ov' : '');   // la del horno tiene la clase 'ov' (indicador naranja)
  d.style.left = (23 + 80 * i) + 'px';            // 80 px de separación entre perillas
  d.tabIndex = 0;                                  // se puede enfocar con el teclado
  d.innerHTML = '<i></i><i></i><i class="cap"><u></u></i><span class="kl"></span>'; // 3 capas 3D + etiqueta
  kn.appendChild(d);
  d.onclick = () => step(i, 1);                                        // clic: sube un nivel
  d.oncontextmenu = e => { e.preventDefault(); step(i, -1); };         // clic derecho: baja un nivel
  d.onwheel = e => { e.preventDefault(); step(i, e.deltaY < 0 ? 1 : -1); }; // rueda: sube o baja
}

// 4.2 Quemadores: se crean 4 con llamas, parrilla, olla, agua, burbujas y vapor.
// BU guarda los 4 elementos para poder modificarlos después.
const BU = POS.map((p, i) => {
  const b = document.createElement('div');
  b.className = 'burner';
  b.style.left = p[0] + 'px';
  b.style.top  = p[1] + 'px';

  // Base, tapa y resplandor azul
  let h = '<div class="glow"></div><div class="base"></div><div class="cap2"></div><div class="ring">';

  // Corona de 16 llamas, una cada 22.5° (16 x 22.5 = 360°), por eso queda simétrica
  for (let k = 0; k < 16; k++)
    h += `<div class="fl" style="--r:${k * 22.5}deg"><i class="fi" style="animation-delay:${(k % 5) * .03}s"></i></div>`;

  // Parrilla (dos barras en cruz) y el número del quemador
  h += '</div><div class="gr"></div><div class="gr b"></div><div class="num">' + (i + 1) + '</div><div class="pw">';

  // Olla: se arma apilando 21 discos a distintas alturas (z) para que parezca un cilindro
  for (let z = 26; z <= 66; z += 2) h += `<div class="pl" style="transform:translateZ(${z}px)"></div>`;
  // Asa de la olla
  for (let z = 48; z <= 54; z += 2) h += `<div class="pl hd" style="transform:translateZ(${z}px)"></div>`;
  // Agua con 7 burbujas
  h += '<div class="pl wt" style="transform:translateZ(65px)">';
  for (let k = 0; k < 7; k++)
    h += `<i class="bb" style="left:${8 + k * 9}px;top:${12 + (k * 23) % 50}px;animation-delay:${k * .11}s"></i>`;
  h += '</div>';
  // 3 nubes de vapor
  for (let k = 0; k < 3; k++)
    h += `<i class="st" style="margin-left:${(k - 1) * 16 - 9}px;animation-delay:${k * .6}s"></i>`;
  b.innerHTML = h + '</div>';

  // Clic en el quemador: poner o quitar la olla (si se quita, el agua vuelve a 22 °C)
  b.onclick = () => {
    S.pot[i] = !S.pot[i];
    if (!S.pot[i]) S.w[i] = 22;
    tone(300, .12, 'triangle');
    render();
  };

  $('#top').appendChild(b); // se agrega a la cubierta de la estufa
  return b;
});


/* ---------- 5. ACCIONES ---------- */

// Cambia el nivel de un quemador (0 a 5, da la vuelta con mod)
function setB(i, l) {
  l = mod(l, 6);
  const p = S.b[i];   // nivel anterior
  S.b[i] = l;
  // Si estaba apagado y ahora se enciende: suenan 3 chispas y la llama sale a los 450 ms
  if (p === 0 && l > 0) {
    [0, 120, 240].forEach(t => setTimeout(() => tone(1900, .04, 'square', .07), t));
    setTimeout(() => { if (S.b[i] > 0) { S.lit[i] = true; render(); } }, 450);
  }
  if (l === 0) S.lit[i] = false;            // nivel 0: se apaga la llama
  else tone(500 + l * 80, .06, 'triangle'); // sonido de clic más agudo cuanto mayor el nivel
  render();
}

// Cambia la perilla del horno (0 a 6, ver TEMPS)
function setOv(l) {
  S.ov = mod(l, 7);
  S.ready = false;   // al cambiar la temperatura hay que volver a precalentar
  tone(700, .07, 'triangle');
  render();
}

// Sube (d = 1) o baja (d = -1) una perilla: 0 a 3 son quemadores, 4 es el horno
function step(i, d) { i < 4 ? setB(i, S.b[i] + d) : setOv(S.ov + d); }

// Abre o cierra la puerta del horno
const door = () => { S.door = !S.door; tone(220, .2, 'triangle'); render(); };

// Enciende o apaga la luz del horno
const light = () => { S.light = !S.light; tone(900, .05, 'square', .06); render(); };

// Suma o resta segundos al temporizador (mínimo 0, máximo 5940 s = 99 min) y apaga la alarma
const tmAdd = s => { S.tm = Math.max(0, Math.min(5940, S.tm + s)); S.al = 0; render(); };

// Botón ⏱ / Iniciar: si suena la alarma la silencia; si no, inicia o pausa.
// Si está en 00:00 arranca solo con 1 minuto (así nunca "no hace nada").
const tmGo = () => {
  if (S.al) S.al = 0;
  else {
    if (S.tm === 0) S.tm = 60;
    S.tmOn = !S.tmOn;
  }
  tone(1000, .06, 'square', .06);
  render();
};

// Reiniciar: deja el temporizador en 00:00 y lo detiene
const tmReset = () => { S.tm = 0; S.tmOn = false; S.al = 0; render(); };

// Apagar todo: quemadores, horno, temporizador y alarma
const allOff = () => {
  S.b = [0, 0, 0, 0];
  S.lit = [false, false, false, false];
  S.ov = 0;
  S.tmOn = false;
  S.al = 0;
  render();
};


/* ---------- 6. CONTROLES: BOTONES Y TECLADO ---------- */

// Botones del panel de la estufa
$('#tmM').onclick = () => tmAdd(-60);  // − 1 minuto
$('#tmP').onclick = () => tmAdd(60);   // + 1 minuto
$('#tmG').onclick = tmGo;              // iniciar / pausar
$('#lt').onclick = light;              // luz del horno
$('#handle').onclick = door;           // la manija abre la puerta

// Temporizador del panel lateral (misma función que el de la estufa, más grande y fácil de tocar)
$('#s10').onclick = () => tmAdd(10);   // + 10 segundos
$('#s1').onclick  = () => tmAdd(60);   // + 1 minuto
$('#s5').onclick  = () => tmAdd(300);  // + 5 minutos
$('#sm').onclick  = () => tmAdd(-60);  // − 1 minuto
$('#sgo').onclick = tmGo;              // iniciar / pausar
$('#srs').onclick = tmReset;           // reiniciar a 00:00

// Botones del panel lateral
$('#bDoor').onclick = door;
$('#bOff').onclick = allOff;
$('#bMute').onclick = () => {
  S.mute = !S.mute;
  $('#bMute').textContent = S.mute ? '🔇 Silencio' : '🔊 Sonido';
};

// Atajos de teclado
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (['1', '2', '3', '4'].includes(k)) setB(+k - 1, S.b[+k - 1] + (e.shiftKey ? -1 : 1)); // 1-4 quemadores (Shift baja)
  else if (k === 'o') setOv(S.ov + (e.shiftKey ? -1 : 1));  // O = horno
  else if (k === 'l') light();                                // L = luz
  else if (k === 'p') door();                                 // P = puerta
  else if (k === 't') tmGo();                                 // T = temporizador
  else if (k === 'a') allOff();                               // A = apagar todo
});


/* ---------- 7. RENDER: DIBUJAR EL ESTADO ---------- */
// Se llama después de cada cambio. Lee el objeto S y actualiza la pantalla.
function render() {

  // Perillas: rotación de la marca y texto de la etiqueta
  document.querySelectorAll('.knob').forEach((k, i) => {
    const l = i < 4 ? S.b[i] : S.ov;
    const ang = i < 4 ? -120 + l * 48 : -120 + l * 40; // 5 niveles x 48° o 6 niveles x 40°, de -120° a 120°
    k.style.setProperty('--a', ang + 'deg');
    k.querySelector('.kl').textContent = i < 4 ? `Q${i + 1} · ${l || '–'}` : (l ? TEMPS[l] + '°C' : 'HORNO');
  });

  // Quemadores: llama, tamaño de llama, olla y hervor (agua a 97 °C o más con llama encendida)
  BU.forEach((b, i) => {
    b.classList.toggle('on', S.lit[i]);
    b.style.setProperty('--lv', S.b[i]);
    b.classList.toggle('pot', S.pot[i]);
    b.classList.toggle('boil', S.pot[i] && S.lit[i] && S.w[i] >= 97);
  });

  // Horno: puerta, brillo del calor (--heat de 0 a 1) y luz interior (--lum)
  const st = $('#stove');
  st.classList.toggle('open', S.door);
  st.style.setProperty('--heat', Math.max(0, Math.min(1, (S.T - 30) / 220)));
  st.style.setProperty('--lum', S.light ? 1 : 0);
  $('#lt').classList.toggle('on', S.light);

  // Pantalla LCD: línea 1 = horno, línea 2 = temporizador
  const tgt = TEMPS[S.ov];
  const stt = !S.ov ? (S.T > 60 ? 'ENFRIA' : 'OFF') : S.ready ? 'LISTO' : 'PRECAL';
  const m = String(Math.floor(S.tm / 60)).padStart(2, '0');  // minutos
  const s = String(S.tm % 60).padStart(2, '0');              // segundos
  $('#l1').textContent = `HORNO ${Math.round(S.T)}°C ${stt}`;
  $('#l2').textContent = S.al ? '⏱ ¡TIEMPO!' : `⏱ ${m}:${s} ${S.tmOn ? '▶' : '■'}`;
  $('#lcd').classList.toggle('al', !!S.al);  // parpadea cuando suena la alarma

  // Temporizador del panel lateral: tiempo grande, estado y texto del botón
  $('#tbig').textContent = `${m}:${s}`;
  $('#tst').textContent = S.al ? '¡Tiempo terminado!' : S.tmOn ? 'Corriendo' : (S.tm ? 'En pausa' : 'Detenido');
  $('#sgo').textContent = S.tmOn ? '⏸ Pausar' : '▶ Iniciar';

  // Panel lateral: una fila por quemador con barra de nivel, estado y temperatura del agua
  $('#rows').innerHTML = S.b.map((l, i) => `
    <div class="row">
      <span>Q${i + 1}</span>
      <div class="bar"><b style="width:${l * 20}%"></b></div>
      <span class="chip ${S.lit[i] ? 'on' : ''}">${S.lit[i] ? 'Encendido' : 'Apagado'}</span>
      <span class="mu" style="width:82px;text-align:right">${S.pot[i] ? 'Olla ' + Math.round(S.w[i]) + '°C' + (S.w[i] >= 97 && S.lit[i] ? ' 💨' : '') : 'sin olla'}</span>
    </div>`).join('');

  // Resumen del horno en el panel lateral
  $('#ovs').textContent = `${Math.round(S.T)}°C / ${tgt ? tgt + '°C' : 'apagado'} · puerta ${S.door ? 'abierta' : 'cerrada'}`;
}


/* ---------- 8. SIMULACIÓN FÍSICA ---------- */
// Un reloj que corre cada 200 ms (5 veces por segundo) y hace evolucionar el sistema.
let n = 0; // contador de ciclos
setInterval(() => {
  n++;

  // Agua de las ollas: sube según el nivel de llama (máx. 100 °C); sin llama se enfría hacia 22 °C
  S.b.forEach((l, i) => {
    if (S.pot[i]) {
      if (S.lit[i]) S.w[i] = Math.min(100, S.w[i] + l * .55);
      else S.w[i] = Math.max(22, S.w[i] - (S.w[i] - 22) * .012);
    }
  });

  // Horno: se acerca a la temperatura objetivo poco a poco.
  // Con la puerta abierta calienta más lento y se enfría más rápido.
  const tg = TEMPS[S.ov] || 22, up = tg > S.T;
  S.T += (tg - S.T) * (up ? (S.door ? .012 : .035) : (S.door ? .03 : .01));

  // Al llegar a la temperatura pedida (3 °C de margen) marca "LISTO" y pita 2 veces
  if (S.ov && !S.ready && S.T >= tg - 3) { S.ready = true; S.T = tg; beeps(2); }
  // Si se enfría más de 15 °C, vuelve a quedar en "PRECAL"
  if (S.ready && S.T < tg - 15) S.ready = false;

  // Temporizador: cada 5 ciclos (1 segundo) resta 1 s; al llegar a 0 activa la alarma (8 rondas de pitidos)
  if (n % 5 === 0) {
    if (S.tmOn && S.tm > 0) {
      S.tm--;
      if (S.tm === 0) { S.tmOn = false; S.al = 8; }
    } else if (S.al > 0) {
      S.al--;
      beeps(2);
    }
  }

  render();
}, 200);


/* ---------- 9. CÁMARA 3D ---------- */
const stg = $('#stage'), stv = $('#stove');
let rx = -24, ry = -28,   // ángulos de la cámara: inclinación (rx) y giro (ry)
    sc = 1,               // escala según el tamaño de la ventana
    moved = false,        // ¿el mouse se arrastró? (para no confundirlo con un clic)
    dr = null;            // punto donde empezó el arrastre

// Aplica la rotación y la escala a la estufa
const cam = () => { stv.style.transform = `scale(${sc}) rotateX(${rx}deg) rotateY(${ry}deg)`; };

// Ajusta la escala para que la estufa siempre quepa en pantalla (también en celular)
const fit = () => { sc = Math.min(1.15, stg.clientWidth / 600, stg.clientHeight / 560); cam(); };
addEventListener('resize', fit);
fit();

// Arrastrar con el mouse o el dedo para girar la estufa
stg.addEventListener('pointerdown', e => { dr = { x: e.clientX, y: e.clientY }; moved = false; });
addEventListener('pointermove', e => {
  if (!dr) return;
  const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
  if (!moved && Math.hypot(dx, dy) < 6) return;               // menos de 6 px = todavía es un clic
  moved = true;
  ry += dx * .5;                                                // mover en horizontal gira
  rx = Math.max(-85, Math.min(10, rx - dy * .4));              // mover en vertical inclina (con límites)
  dr = { x: e.clientX, y: e.clientY };
  cam();
});
addEventListener('pointerup', () => dr = null);

// Si se arrastró, se cancela el clic para no mover perillas ni ollas sin querer
stg.addEventListener('click', e => {
  if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; }
}, true);

// Botones de vista: frontal, superior y 3/4 (con animación de 0.6 s)
document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
  const v = { f: [0, 0], t: [-80, 0], q: [-24, -28] }[b.dataset.v];
  rx = v[0]; ry = v[1];
  stv.style.transition = 'transform .6s';
  cam();
  setTimeout(() => stv.style.transition = '', 650); // se quita para que el arrastre no tenga retraso
});


/* ---------- 10. AUTOTEST ---------- */
// Botón "▶ Autotest": revisa que el navegador soporte lo necesario y prueba las funciones.
async function autotest() {
  const L = $('#log');
  L.textContent = '';
  let ok = 0, ko = 0;                                   // contadores de pruebas correctas y fallidas
  const w = t => L.textContent += t + '\n';             // escribe una línea en el registro
  const T = (nombre, cond) => {                          // registra una prueba: ✔ si cumple, ✘ si no
    cond ? ok++ : ko++;
    w((cond ? '✔ ' : '✘ ') + nombre);
  };

  // Compatibilidad del navegador
  w('Navegador: ' + navigator.userAgent.replace(/\(.*?\)/, '').slice(0, 90));
  T('CSS transform 3D (preserve-3d)', CSS.supports('transform-style', 'preserve-3d'));
  T('backface-visibility', CSS.supports('backface-visibility', 'hidden'));
  T('Web Audio API', !!(window.AudioContext || window.webkitAudioContext));
  T('Pointer Events', !!window.PointerEvent);
  T('CSS variables', CSS.supports('--a', '0'));

  // Se silencia el sonido y se apaga todo antes de probar
  const m = S.mute;
  S.mute = true;
  allOff();

  // Quemadores
  setB(0, 3);
  T('Q1 nivel 3', S.b[0] === 3);
  await sleep(650);                                     // espera a que salga la llama
  T('Q1 enciende con retraso de ignición', S.lit[0]);
  setB(0, S.b[0] + 3);
  T('Q1 vuelve a 0 tras nivel 5', S.b[0] === 0 && !S.lit[0]);
  setB(1, -1);
  T('Q2 rueda hacia abajo desde 0 → 5', S.b[1] === 5);
  setB(1, 0);

  // Horno, puerta y luz
  setOv(3);
  T('Horno nivel 3 = 180°C', TEMPS[S.ov] === 180);
  setOv(0);
  const d = S.door;  door();  T('Puerta cambia de estado', S.door !== d);  door();
  const l = S.light; light(); T('Luz cambia de estado', S.light !== l);    light();

  // Temporizador
  tmAdd(120);
  T('Temporizador +2 min', S.tm === 120);
  tmGo();
  T('Temporizador inicia', S.tmOn);
  tmGo();
  tmAdd(-999);
  T('Temporizador no baja de 0', S.tm === 0);
  tmGo();
  T('Iniciar en 00:00 arranca con 1 minuto', S.tm === 60 && S.tmOn);
  await sleep(1300);                                    // espera más de 1 segundo real
  T('Temporizador cuenta hacia atrás', S.tm < 60);
  tmReset();
  T('Reiniciar deja 00:00 detenido', S.tm === 0 && !S.tmOn);

  // Ollas
  const p = S.pot[3];
  BU[3].click();
  T('Poner/quitar olla', S.pot[3] !== p);
  BU[3].click();

  // Apagar todo y restaurar el sonido
  allOff();
  T('Apagar todo', S.b.every(x => !x) && S.ov === 0);
  S.mute = m;

  w(`\nResultado: ${ok} correctas, ${ko} fallidas`);
}
$('#bTest').onclick = autotest;

// Primer dibujo al cargar la página
render();
