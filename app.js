var DEFAULT_API_URL = 'https://script.google.com/macros/s/AKfycbyLFxbzBKqP2BRIXoywWpFgxdDXImNetYSVerQPYFDgJ91ChUYisEm3BAMdgKDoRMnd/exec';
var API_URL = localStorage.getItem('sac_custom_api_url') || DEFAULT_API_URL;
var CACHE_KEY_BOOT = 'sac_boot_cache_v1';

var STATE = null;
var USUARIO_SESION = null;
var SEC_ACTIVA = 'SERVICIOS_PUBLICOS';
var TIPO_ACTIVO = 'Pendientes';
var MODO_VISTA_ADMIN_GESTOR = 'MIS_ASIGNADOS'; // 'MIS_ASIGNADOS' o 'TODA_LA_PLANILLA'
var CORREO_EDITANDO_PERM = null;
var CHARTS_VIVO = {};

/* ============================================================================
 * 1. ARRANQUE ULTRARRÁPIDO (STALE-WHILE-REVALIDATE) Y CONTROL DE ACCESO
 * ============================================================================ */

window.addEventListener('DOMContentLoaded', function() {
  var inp = document.getElementById('inpMailLogin');
  if (inp) {
    inp.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') validarCorreoAcceso();
    });
  }

  // 1. Cargar instantáneamente desde caché local si existe (< 10 ms)
  var cached = localStorage.getItem(CACHE_KEY_BOOT);
  if (cached) {
    try {
      STATE = JSON.parse(cached);
      document.getElementById('indicadorCargaInicial').textContent = '🟢 Sistema listo (Sincronizando cambios en segundo plano...)';
    } catch (e) {}
  }

  // 2. Sincronizar en paralelo con el servidor de Google Sheets
  sincronizarConServidor(false);
});

function configurarUrlApiManual() {
  var nueva = prompt('Ingresá la URL de implementación (/exec) de Google Apps Script:', API_URL);
  if (nueva && nueva.trim().indexOf('https://script.google.com') === 0) {
    API_URL = nueva.trim();
    localStorage.setItem('sac_custom_api_url', API_URL);
    sincronizarConServidor(true);
  }
}

function llamarAPI(accion, payload, onSuccess, onError) {
  if (!API_URL || API_URL.indexOf('PEGAR_AQUI') !== -1) {
    var msg = 'Falta configurar la URL /exec de Apps Script (hacé clic en el ícono ⚙️ arriba a la derecha).';
    if (onError) onError(msg); else alert(msg);
    return;
  }

  fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ accion: accion, payload: payload || {} })
  })
  .then(function(r) { return r.json(); })
  .then(function(res) {
    if (res && res.ok) {
      if (onSuccess) onSuccess(res.data);
    } else {
      var errTxt = (res && res.error) ? res.error : 'Error desconocido en el servidor.';
      if (onError) onError(errTxt); else alert('❌ Atención: ' + errTxt);
    }
  })
  .catch(function(err) {
    if (onError) onError(err.message || String(err));
  });
}

function sincronizarConServidor(mostrarAviso) {
  if (mostrarAviso) actualizarPillSync('⏳ Sincronizando...');
  llamarAPI('OBTENER_PAQUETE_INICIAL', {}, function(paquete) {
    STATE = paquete;
    try { localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(paquete)); } catch (e) {}
    var ind = document.getElementById('indicadorCargaInicial');
    if (ind) ind.textContent = '🟢 Conectado en tiempo real (' + paquete.actualizadoEn + ')';
    actualizarPillSync('🟢 En línea (' + paquete.actualizadoEn + ')');

    if (USUARIO_SESION) {
      reconstruirPerfilUsuario(USUARIO_SESION.email);
      actualizarContadoresYSelectores();
      renderizarGrillaReclamos();
    }
  }, function(errTxt) {
    var ind = document.getElementById('indicadorCargaInicial');
    if (ind) ind.textContent = '⚠️ Sin conexión con API (' + errTxt + ')';
    actualizarPillSync('⚠️ Modo caché local');
  });
}

function obtenerSaludoHorario() {
  var h = new Date().getHours();
  if (h >= 0 && h <= 12) return '☀️ Buenos días, bienvenido';
  if (h >= 13 && h <= 19) return '🌤️ Buenas tardes, bienvenido';
  return '🌙 Buenas noches, bienvenido';
}

function reconstruirPerfilUsuario(mail) {
  var mSP = (STATE.configPermisos.mapeos.SERVICIOS_PUBLICOS || {})[mail];
  var mOP = (STATE.configPermisos.mapeos.OBRAS_PUBLICAS || {})[mail];

  var esSuperAdminDefecto = (
    mail === 'carlosfernandezws@gmail.com' ||
    mail === 'carlosfernandezwz@gmail.com' ||
    (STATE.correoPropietario && mail === STATE.correoPropietario)
  );

  if (!mSP && !mOP && !esSuperAdminDefecto) return null;

  var esAdmin = Boolean(esSuperAdminDefecto || (mSP && mSP.esAdmin) || (mOP && mOP.esAdmin));
  var verPanelVivo = Boolean(esSuperAdminDefecto || (mSP && mSP.verPanelEnVivo) || (mOP && mOP.verPanelEnVivo));
  var esModSP = Boolean(mSP && mSP.esModerador);
  var esModOP = Boolean(mOP && mOP.esModerador);

  var ptesSP = (mSP && mSP.Pendientes) ? mSP.Pendientes : [];
  var reitSP = (mSP && mSP.Reiterados) ? mSP.Reiterados : [];
  var ptesOP = (mOP && mOP.Pendientes) ? mOP.Pendientes : [];
  var reitOP = (mOP && mOP.Reiterados) ? mOP.Reiterados : [];

  var unicasMap = {};
  ptesSP.concat(reitSP, ptesOP, reitOP).forEach(function(d) {
    if (d) unicasMap[String(d).trim().toUpperCase()] = true;
  });
  var totalDepsAsignadas = Object.keys(unicasMap).length;

  return {
    email: mail,
    esAdmin: esAdmin,
    verPanelEnVivo: verPanelVivo,
    esModeradorSP: esModSP,
    esModeradorOP: esModOP,
    tieneAsignacionesGestor: totalDepsAsignadas > 0,
    totalAsignadas: totalDepsAsignadas,
    SERVICIOS_PUBLICOS: { Pendientes: ptesSP, Reiterados: reitSP },
    OBRAS_PUBLICAS: { Pendientes: ptesOP, Reiterados: reitOP }
  };
}

function validarCorreoAcceso() {
  if (!STATE) {
    alert('Aguardá un instante a que termine de conectar con la base de datos o verificá la URL de la API en ⚙️.');
    return;
  }
  var mail = document.getElementById('inpMailLogin').value.trim().toLowerCase();
  var caja = document.getElementById('cajaResultadoLogin');

  if (!mail || mail.indexOf('@') === -1) {
    caja.className = 'msg err';
    caja.innerHTML = '⚠️ Ingresá un correo electrónico válido.';
    return;
  }

  var perfil = reconstruirPerfilUsuario(mail);
  if (!perfil || (!perfil.esAdmin && !perfil.esModeradorSP && !perfil.esModeradorOP && !perfil.tieneAsignacionesGestor)) {
    caja.className = 'msg err';
    caja.innerHTML = '⛔ <b>Acceso denegado:</b> El correo <b>' + mail + '</b> no tiene dependencias ni asuntos asignados en esta planilla.';
    return;
  }

  USUARIO_SESION = perfil;
  document.getElementById('bloqueFormularioLogin').style.display = 'none';
  var saludo = obtenerSaludoHorario();

  // Caso 1: Administrador PURO (sin reclamos propios asignados como gestor) -> Saluda y entra directo
  if (perfil.esAdmin && !perfil.tieneAsignacionesGestor) {
    MODO_VISTA_ADMIN_GESTOR = 'TODA_LA_PLANILLA';
    caja.className = 'msg ok';
    caja.innerHTML = '<div class="welcome-title">' + saludo + '</div>' +
                     '<div class="counter-lbl">👑 Acceso de Administrador verificado. Abriendo sistema...</div>';
    setTimeout( function() { abrirEntornoTrabajo('Pendientes'); }, 800);
    return;
  }

  // Caso 2: Gestor, Moderador o Administrador Híbrido (Admin + Gestor)
  var html = '<div class="welcome-title">' + saludo + '</div>';
  var tienePtes = (perfil.SERVICIOS_PUBLICOS.Pendientes.length + perfil.OBRAS_PUBLICAS.Pendientes.length) > 0 || perfil.esModeradorSP || perfil.esModeradorOP;
  var tieneReit = (perfil.SERVICIOS_PUBLICOS.Reiterados.length + perfil.OBRAS_PUBLICAS.Reiterados.length) > 0 || perfil.esModeradorSP || perfil.esModeradorOP;

  if (tienePtes) {
    html += '<button type="button" class="link-btn" onclick="MODO_VISTA_ADMIN_GESTOR=\'MIS_ASIGNADOS\'; abrirEntornoTrabajo(\'Pendientes\')">🚀 Ver mis reclamos pendientes</button>';
  }
  if (tieneReit) {
    html += '<button type="button" class="link-btn" style="background:#b45309;" onclick="MODO_VISTA_ADMIN_GESTOR=\'MIS_ASIGNADOS\'; abrirEntornoTrabajo(\'Reiterados\')">🚀 Ver mis reclamos reiterados</button>';
  }

  if (perfil.tieneAsignacionesGestor) {
    html += '<div class="counter-lbl">📌 Usted tiene ' + perfil.totalAsignadas + ' dep. asignadas' + (perfil.esAdmin ? ' (Rol: Administrador y Gestor)' : '') + '</div>';
  }

  if (perfil.esAdmin) {
    html += '<button type="button" class="admin-btn" onclick="MODO_VISTA_ADMIN_GESTOR=\'TODA_LA_PLANILLA\'; abrirEntornoTrabajo(\'Pendientes\')">👑 Ver toda la planilla completa (Modo Administrador)</button>';
  }

  caja.className = 'msg ok';
  caja.innerHTML = html;
}

function abrirEntornoTrabajo(tipoInicial) {
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';

  var u = USUARIO_SESION;
  var badge = document.getElementById('badgeRolActivo');
  if (u.esAdmin && u.tieneAsignacionesGestor) {
    badge.className = 'role-badge admin';
    badge.textContent = '👑 Admin + 👤 Gestor: ' + u.email;
  } else if (u.esAdmin) {
    badge.className = 'role-badge admin';
    badge.textContent = '👑 Administrador: ' + u.email;
  } else if (u.esModeradorSP || u.esModeradorOP) {
    badge.className = 'role-badge mod';
    badge.textContent = '🛡️ Moderador: ' + u.email;
  } else {
    badge.className = 'role-badge';
    badge.textContent = '👤 Gestor: ' + u.email;
  }

  // Mostrar pestañas superiores según permisos (Punto 6: Panel en Vivo controlado por tilde)
  document.getElementById('navVivo').classList.toggle('hidden', !u.verPanelEnVivo);
  document.getElementById('navCarga').classList.toggle('hidden', !u.esAdmin);
  document.getElementById('navPermisos').classList.toggle('hidden', !u.esAdmin);
  document.getElementById('navConfig').classList.toggle('hidden', !u.esAdmin);
  document.getElementById('navBackup').classList.toggle('hidden', !u.esAdmin);

  // Botón de alternancia rápida para Administradores que también son Gestores
  var btnSw = document.getElementById('btnSwitchAdminGestor');
  if (u.esAdmin && u.tieneAsignacionesGestor) {
    btnSw.classList.remove('hidden');
    actualizarTextoBotonHibrido();
  } else {
    btnSw.classList.add('hidden');
  }

  // Visibilidad de Secretarías
  var puedeSP = u.esAdmin || u.esModeradorSP || (u.SERVICIOS_PUBLICOS.Pendientes.length + u.SERVICIOS_PUBLICOS.Reiterados.length) > 0;
  var puedeOP = u.esAdmin || u.esModeradorOP || (u.OBRAS_PUBLICAS.Pendientes.length + u.OBRAS_PUBLICAS.Reiterados.length) > 0;

  document.getElementById('btnSecSP').classList.toggle('hidden', !puedeSP);
  document.getElementById('btnSecOP').classList.toggle('hidden', !puedeOP);

  SEC_ACTIVA = puedeSP ? 'SERVICIOS_PUBLICOS' : 'OBRAS_PUBLICAS';
  TIPO_ACTIVO = tipoInicial || 'Pendientes';

  cambiarSecretariaActiva(SEC_ACTIVA);
  cambiarTipoReclamoActivo(TIPO_ACTIVO);
}

function alternarModoAdminGestor() {
  MODO_VISTA_ADMIN_GESTOR = (MODO_VISTA_ADMIN_GESTOR === 'MIS_ASIGNADOS') ? 'TODA_LA_PLANILLA' : 'MIS_ASIGNADOS';
  actualizarTextoBotonHibrido();
  actualizarContadoresYSelectores();
  renderizarGrillaReclamos();
}

function actualizarTextoBotonHibrido() {
  var btn = document.getElementById('btnSwitchAdminGestor');
  if (MODO_VISTA_ADMIN_GESTOR === 'MIS_ASIGNADOS') {
    btn.textContent = '👤 Viendo: Mis Asignados (Cambiar a 👑 Todo)';
    btn.style.background = '#dcfce7';
    btn.style.color = '#166534';
  } else {
    btn.textContent = '👑 Viendo: Toda la Secretaría (Cambiar a 👤 Mis Asignados)';
    btn.style.background = '#fef3c7';
    btn.style.color = '#92400e';
  }
}

function cerrarSesionSAC() {
  USUARIO_SESION = null;
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('loginOverlay').style.display = 'flex';
  document.getElementById('bloqueFormularioLogin').style.display = 'block';
  document.getElementById('cajaResultadoLogin').className = 'msg';
  document.getElementById('cajaResultadoLogin').innerHTML = '';
}

/* ============================================================================
 * 2. MOTOR DE GRILLA INTERACTIVA Y GUARDADO EN 0 MS (OPTIMISTIC UI)
 * ============================================================================ */

function puedeUsuarioVerFila(r, claveSec, tipoReclamo) {
  if (!USUARIO_SESION) return false;
  var u = USUARIO_SESION;

  if (u.esAdmin && (!u.tieneAsignacionesGestor || MODO_VISTA_ADMIN_GESTOR === 'TODA_LA_PLANILLA')) {
    return true;
  }
  if ((claveSec === 'SERVICIOS_PUBLICOS' && u.esModeradorSP) || (claveSec === 'OBRAS_PUBLICAS' && u.esModeradorOP)) {
    return true;
  }

  var listaAsig = ((u[claveSec] && u[claveSec][tipoReclamo]) || []).map(function(x) { return String(x).trim().toUpperCase(); });
  if (listaAsig.length === 0) return false;

  if (tipoReclamo === 'Pendientes') {
    return listaAsig.indexOf(String(r.gestorDep || '').toUpperCase()) !== -1 ||
           listaAsig.indexOf(String(r.depPrincipal || '').toUpperCase()) !== -1 ||
           listaAsig.indexOf(String(r.asunto || '').toUpperCase()) !== -1;
  } else {
    return listaAsig.indexOf(String(r.dependencia || '').toUpperCase()) !== -1 ||
           listaAsig.indexOf(String(r.problema || '').toUpperCase()) !== -1;
  }
}

function cambiarSecretariaActiva(sec) {
  SEC_ACTIVA = sec;
  document.getElementById('btnSecSP').classList.toggle('active-sec', sec === 'SERVICIOS_PUBLICOS');
  document.getElementById('btnSecOP').classList.toggle('active-sec', sec === 'OBRAS_PUBLICAS');
  actualizarContadoresYSelectores();
  renderizarGrillaReclamos();
}

function cambiarTipoReclamoActivo(tipo) {
  TIPO_ACTIVO = tipo;
  document.getElementById('btnTabPtes').classList.toggle('active-ptes', tipo === 'Pendientes');
  document.getElementById('btnTabReit').classList.toggle('active-reit', tipo === 'Reiterados');
  actualizarContadoresYSelectores();
  renderizarGrillaReclamos();
}

function actualizarContadoresYSelectores() {
  var ptes = (STATE.reclamos[SEC_ACTIVA].Pendientes || []).filter(function(r) { return puedeUsuarioVerFila(r, SEC_ACTIVA, 'Pendientes'); });
  var reit = (STATE.reclamos[SEC_ACTIVA].Reiterados || []).filter(function(r) { return puedeUsuarioVerFila(r, SEC_ACTIVA, 'Reiterados'); });

  document.getElementById('cntPtes').textContent = ptes.length;
  document.getElementById('cntReit').textContent = reit.length;

  var listaAct = (TIPO_ACTIVO === 'Pendientes') ? ptes : reit;
  var depsMap = {};
  listaAct.forEach(function(r) {
    var d = (TIPO_ACTIVO === 'Pendientes') ? (r.gestorDep || r.depPrincipal) : r.dependencia;
    if (d) depsMap[d] = true;
  });

  var sel = document.getElementById('selFiltroDepTabla');
  sel.innerHTML = '<option value="TODAS">🔍 Todas las dependencias (' + Object.keys(depsMap).length + ')</option>';
  Object.keys(depsMap).sort().forEach(function(d) {
    var o = document.createElement('option');
    o.value = d;
    o.textContent = d;
    sel.appendChild(o);
  });
}

function claseColorChip(valor) {
  if (!valor) return 'chip-vacio';
  if (valor === 'Solucionado') return 'chip-verde';
  if (valor.indexOf('Datos insuficientes') !== -1 || valor.indexOf('Demora de empresas') !== -1 || valor.indexOf('Reincidencia en misma') !== -1) return 'chip-rojo';
  if (valor === 'En ejecución' || valor === 'Cambio de responsable' || valor.indexOf('Competencia de ente') !== -1) return 'chip-marron';
  if (valor === 'Falta de maquinaria') return 'chip-azul';
  if (valor.indexOf('Falta de materiales') !== -1) return 'chip-teal';
  if (valor.indexOf('Plazo de ejecución') !== -1 || valor.indexOf('Reiteración dentro') !== -1) return 'chip-violeta';
  if (valor.indexOf('En agenda') !== -1 || valor.indexOf('Reprogramado por clima') !== -1) return 'chip-oscuro';
  return 'chip-gris';
}

function renderizarGrillaReclamos() {
  var tbl = document.getElementById('tablaReclamosDOM');
  var esPtes = (TIPO_ACTIVO === 'Pendientes');
  var base = (STATE.reclamos[SEC_ACTIVA][TIPO_ACTIVO] || []).filter(function(r) {
    return puedeUsuarioVerFila(r, SEC_ACTIVA, TIPO_ACTIVO);
  });

  var fDep = document.getElementById('selFiltroDepTabla').value;
  var fEst = document.getElementById('selFiltroEstadoTabla').value;
  var q = document.getElementById('inpBuscarGrilla').value.trim().toLowerCase();

  var filas = base.filter(function(r) {
    if (fDep !== 'TODAS') {
      var dComp = esPtes ? (r.gestorDep || r.depPrincipal) : r.dependencia;
      if (dComp !== fDep) return false;
    }
    var completo = (r.estado !== '' && r.motivo !== '');
    if (fEst === 'INCOMPLETOS' && completo) return false;
    if (fEst === 'COMPLETOS' && !completo) return false;
    if (q) {
      var texto = [r.id, r.asunto, r.problema, r.barrio, r.depPrincipal, r.gestorDep, r.dependencia, r.gestor, r.ciudadano, r.desc].join(' ').toLowerCase();
      if (texto.indexOf(q) === -1) return false;
    }
    return true;
  });

  var opciones = esPtes ? STATE.opcionesPendientes : STATE.opcionesReiterados;
  var html = ['<thead><tr>'];

  if (esPtes) {
    html.push(
      '<th>Contacto Nro</th><th>Fecha y Hora</th><th>Contacto Tipo</th><th>Vía de Captación</th><th style="min-width:147px;">Boca Receptora</th>',
      '<th style="min-width:249px;">Asunto</th><th style="min-width:300px;">Descripción</th><th>Barrio</th><th>Calle</th><th>Altura</th>',
      '<th>Visualizado</th><th>Dts. Cierre-Fecha</th><th style="min-width:208px;">Dts. Área-Dependencia principal</th>',
      '<th>Dts. Gestor-Nombre</th><th style="min-width:215px;">Dts. Gestor-Dependencia</th>',
      '<th style="min-width:225px;">Estado del pendiente</th><th style="min-width:260px;">Motivos del pendiente</th><th>Fecha últ. resp.</th>'
    );
  } else {
    html.push(
      '<th>Reit.</th><th>ID Contacto</th><th>Fecha</th><th style="min-width:249px;">Problema</th><th>Barrio</th>',
      '<th>Ciudadano</th><th>DNI</th><th>Secretaría</th><th style="min-width:208px;">Dependencia</th><th>Gestor</th>',
      '<th style="min-width:230px;">Estado de reincidencia</th><th style="min-width:260px;">Motivos de reincidencia</th><th>Fecha últ. resp.</th>'
    );
  }
  html.push('</tr></thead><tbody>');

  if (filas.length === 0) {
    html.push('<tr><td colspan="18" style="padding:28px; font-weight:700; color:#64748b;">No hay reclamos que coincidan con el filtro seleccionado.</td></tr></tbody>');
    tbl.innerHTML = html.join('');
    return;
  }

  for (var i = 0; i < filas.length; i++) {
    var r = filas[i];
    var clsEst = (r.estado === '') ? 'editable-cell mandatory-alert' : 'editable-cell';
    var clsMot = (r.motivo === '') ? 'editable-cell mandatory-alert' : 'editable-cell';
    var clsChip = claseColorChip(r.estado);

    var optsHtml = ['<option value="">— Seleccionar —</option>'];
    for (var o = 0; o < opciones.length; o++) {
      var op = opciones[o];
      optsHtml.push('<option value="' + escaparAttr(op) + '" ' + (r.estado === op ? 'selected' : '') + '>' + op + '</option>');
    }

    var selHtml = '<select class="chip-select ' + clsChip + '" id="sel_' + r.id + '" onchange="guardarFilaOptimista(' + r.id + ', ' + r.filaHoja + ')">' + optsHtml.join('') + '</select>';
    var motHtml = '<textarea class="motivo-input" id="mot_' + r.id + '" placeholder="Escribir motivo..." onchange="guardarFilaOptimista(' + r.id + ', ' + r.filaHoja + ')">' + escaparHtml(r.motivo) + '</textarea>';

    if (esPtes) {
      html.push(
        '<tr>',
        '<td data-label="Contacto Nro"><b>#' + r.id + '</b></td>',
        '<td data-label="Fecha y Hora">' + r.fechaTxt + '</td>',
        '<td data-label="Tipo">' + r.contactoTipo + '</td>',
        '<td data-label="Vía">' + r.via + '</td>',
        '<td data-label="Boca Receptora">' + r.boca + '</td>',
        '<td data-label="Asunto"><b>' + r.asunto + '</b></td>',
        '<td data-label="Descripción" style="font-size:11.5px;">' + escaparHtml(r.desc) + '</td>',
        '<td data-label="Barrio">' + (r.barrio || 'SIN BARRIO') + '</td>',
        '<td data-label="Calle">' + r.calle + '</td>',
        '<td data-label="Altura">' + r.altura + '</td>',
        '<td data-label="Visualizado">' + r.visTxt + '</td>',
        '<td data-label="Cierre-Fecha">' + r.cierreTxt + '</td>',
        '<td data-label="Dep. Principal"><b>' + r.depPrincipal + '</b></td>',
        '<td data-label="Gestor">' + r.gestor + '</td>',
        '<td data-label="Gestor-Dep."><b>' + r.gestorDep + '</b></td>',
        '<td data-label="Estado del pendiente" class="' + clsEst + '" id="tdEst_' + r.id + '">' + selHtml + '</td>',
        '<td data-label="Motivos del pendiente" class="' + clsMot + '" id="tdMot_' + r.id + '">' + motHtml + '</td>',
        '<td data-label="Fecha últ. resp." id="tdResp_' + r.id + '" style="font-weight:700; color:#1e3a8a;">' + r.ultResp + '</td>',
        '</tr>'
      );
    } else {
      html.push(
        '<tr>',
        '<td data-label="Reiteraciones"><b style="color:#991b1b;">' + r.reit + 'x</b></td>',
        '<td data-label="ID Contacto"><b>#' + r.id + '</b></td>',
        '<td data-label="Fecha">' + r.fechaTxt + '</td>',
        '<td data-label="Problema"><b>' + r.problema + '</b></td>',
        '<td data-label="Barrio">' + (r.barrio || 'SIN BARRIO') + '</td>',
        '<td data-label="Ciudadano">' + r.ciudadano + '</td>',
        '<td data-label="DNI">' + r.dni + '</td>',
        '<td data-label="Secretaría">' + r.secretariaSAC + '</td>',
        '<td data-label="Dependencia"><b>' + r.dependencia + '</b></td>',
        '<td data-label="Gestor">' + r.gestor + '</td>',
        '<td data-label="Estado de reincidencia" class="' + clsEst + '" id="tdEst_' + r.id + '">' + selHtml + '</td>',
        '<td data-label="Motivos de reincidencia" class="' + clsMot + '" id="tdMot_' + r.id + '">' + motHtml + '</td>',
        '<td data-label="Fecha últ. resp." id="tdResp_' + r.id + '" style="font-weight:700; color:#1e3a8a;">' + r.ultResp + '</td>',
        '</tr>'
      );
    }
  }

  html.push('</tbody>');
  tbl.innerHTML = html.join('');
}

function guardarFilaOptimista(idContacto, filaHoja) {
  var selEl = document.getElementById('sel_' + idContacto);
  var motEl = document.getElementById('mot_' + idContacto);
  var tdEst = document.getElementById('tdEst_' + idContacto);
  var tdMot = document.getElementById('tdMot_' + idContacto);
  var tdResp = document.getElementById('tdResp_' + idContacto);

  var valEst = selEl.value.trim();
  var valMot = motEl.value.trim();

  // 1. Actualización visual instantánea en 0 ms (Optimistic UI)
  selEl.className = 'chip-select ' + claseColorChip(valEst);
  tdEst.classList.toggle('mandatory-alert', valEst === '');
  tdMot.classList.toggle('mandatory-alert', valMot === '');

  var ahoraLocal = new Date().toLocaleString('es-AR', { hour12: false });
  if (tdResp) tdResp.textContent = ahoraLocal;

  var lista = STATE.reclamos[SEC_ACTIVA][TIPO_ACTIVO];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].id === idContacto) {
      lista[i].estado = valEst;
      lista[i].motivo = valMot;
      lista[i].ultResp = ahoraLocal;
      break;
    }
  }
  try { localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(STATE)); } catch (e) {}

  // 2. Envío silencioso en segundo plano a Google Sheets
  actualizarPillSync('⏳ Guardando #' + idContacto + '...');
  llamarAPI('GUARDAR_CELDA', {
    sec: SEC_ACTIVA,
    tipoReclamo: TIPO_ACTIVO,
    filaHoja: filaHoja,
    idContacto: idContacto,
    estado: valEst,
    motivo: valMot
  }, function(res) {
    if (tdResp) tdResp.textContent = res.ultResp;
    actualizarPillSync('✅ Guardado (' + res.ultResp + ')');
  }, function(errTxt) {
    actualizarPillSync('⚠️ Reintentando guardado...');
  });
}

/* ============================================================================
 * 3. NAVEGACIÓN DE MÓDULOS Y PANEL EN VIVO COMPLETO (CON RANGO ETARIO DNI)
 * ============================================================================ */

function abrirModuloPrincipal(mod) {
  ['PLANILLA', 'VIVO', 'CARGA', 'PERMISOS', 'CONFIG'].forEach(function(m) {
    document.getElementById('mod' + m).classList.toggle('active', m === mod);
  });
  document.getElementById('navPlanilla').classList.toggle('active', mod === 'PLANILLA');
  document.getElementById('navVivo').classList.toggle('active', mod === 'VIVO');
  document.getElementById('navCarga').classList.toggle('active', mod === 'CARGA');
  document.getElementById('navPermisos').classList.toggle('active', mod === 'PERMISOS');
  document.getElementById('navConfig').classList.toggle('active', mod === 'CONFIG');

  if (mod === 'VIVO') recalcularPanelEnVivo();
  if (mod === 'PERMISOS') renderizarModuloPermisos();
  if (mod === 'CONFIG') cargarFormularioParametrosSistema();
}

function abrirSubTabVivo(idx) {
  var tabs = document.querySelectorAll('.sub-tab');
  var panes = document.querySelectorAll('.sub-pane');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', i === idx);
    panes[i].classList.toggle('active', i === idx);
  }
}

function estimarRangoEtarioPorDNI(dniNum) {
  var d = parseInt(dniNum, 10);
  if (isNaN(d) || d < 3000000 || d > 65000000) return 'DNI no informado / Inválido';
  if (d < 16000000) return 'Mayores de 60 años (Adultos Mayores)';
  if (d < 26000000) return '45 a 59 años';
  if (d < 36000000) return '30 a 44 años';
  return '18 a 29 años (Jóvenes)';
}

function recalcularPanelEnVivo() {
  var fSec = document.getElementById('fVivoSec').value;
  var fClase = document.getElementById('fVivoClase').value;
  var fDesde = document.getElementById('fVivoDesde').value;
  var fHasta = document.getElementById('fVivoHasta').value;
  var fEst = document.getElementById('fVivoEstado').value;

  var brutos = [];
  if (fSec === 'TODAS' || fSec === 'SERVICIOS_PUBLICOS') brutos = brutos.concat(STATE.reclamos.SERVICIOS_PUBLICOS[fClase] || []);
  if (fSec === 'TODAS' || fSec === 'OBRAS_PUBLICAS') brutos = brutos.concat(STATE.reclamos.OBRAS_PUBLICAS[fClase] || []);

  var vistos = {}, duplicados = 0, filtrados = [];
  for (var i = 0; i < brutos.length; i++) {
    var r = brutos[i];
    if (fDesde && (!r.fechaISO || r.fechaISO < fDesde)) continue;
    if (fHasta && (!r.fechaISO || r.fechaISO > fHasta)) continue;
    if (fEst === 'CON_RESPUESTA' && !r.estado) continue;
    if (fEst === 'SIN_RESPUESTA' && r.estado) continue;
    if (vistos[r.id]) { duplicados++; continue; }
    vistos[r.id] = true;
    filtrados.push(r);
  }

  var N = filtrados.length;
  var vis = 0, noVis = 0, resp = 0, sol = 0, sinB = 0, ciegos = 0, q1 = 0, q2 = 0;
  var mCausas = {}, mTipos = {}, mVias = {}, mAsuntos = {}, mDeps = {}, mGest = {}, mBarrios = {}, mEdades = {};
  var mSec = { 'Servicios Públicos': { c: 0, r: 0, v: 0 }, 'Obras Públicas': { c: 0, r: 0, v: 0 } };
  var mDias = { 1: { n: 'Lunes', c: 0 }, 2: { n: 'Martes', c: 0 }, 3: { n: 'Miércoles', c: 0 }, 4: { n: 'Jueves', c: 0 }, 5: { n: 'Viernes', c: 0 }, 6: { n: 'Sábado', c: 0 }, 7: { n: 'Domingo', c: 0 } };

  filtrados.forEach(function(r) {
    mSec[r.secNombre].c++;
    if (r.vis) { vis++; mSec[r.secNombre].v++; } else noVis++;
    if (r.estado) { resp++; mSec[r.secNombre].r++; if (r.estado === 'Solucionado') sol++; }

    var estK = r.estado || 'Sin respuesta aún';
    var asK = (fClase === 'Pendientes' ? r.asunto : r.problema) || 'Sin especificar';
    var depK = (fClase === 'Pendientes' ? r.depPrincipal : r.dependencia) || 'SIN DEPENDENCIA';
    var gesK = r.gestor || 'SIN GESTOR';

    mCausas[estK] = (mCausas[estK] || 0) + 1;
    mAsuntos[asK] = (mAsuntos[asK] || 0) + 1;
    mDeps[depK] = (mDeps[depK] || 0) + 1;
    mGest[gesK] = (mGest[gesK] || 0) + 1;

    if (fClase === 'Pendientes') {
      mTipos[r.contactoTipo || 'Reclamo'] = (mTipos[r.contactoTipo || 'Reclamo'] || 0) + 1;
      mVias[r.via || 'Sin especificar'] = (mVias[r.via || 'Sin especificar'] || 0) + 1;
    } else {
      var rEtario = estimarRangoEtarioPorDNI(r.dni);
      mEdades[rEtario] = (mEdades[rEtario] || 0) + 1;
      mTipos['Reiteración (' + r.reit + 'x)'] = (mTipos['Reiteración (' + r.reit + 'x)'] || 0) + 1;
    }

    var esSinB = (!r.barrio || r.barrio.toUpperCase() === 'SIN BARRIO');
    if (esSinB) sinB++;
    if (esSinB && !r.calle && !r.altura) ciegos++;
    var bNorm = esSinB ? 'SIN BARRIO / PERIFERIA' : r.barrio;
    mBarrios[bNorm] = (mBarrios[bNorm] || 0) + 1;

    if (r.diaSem >= 1 && r.diaSem <= 7) mDias[r.diaSem].c++;
    if (r.quincena === 1) q1++; else if (r.quincena === 2) q2++;
  });

  var cantG = Object.keys(mGest).length;
  var idealG = cantG > 0 ? (N / cantG) : 0;

  document.getElementById('kpiStripVivo').innerHTML =
    '<div class="kpi-card"><div class="kpi-lbl">Contactos Únicos</div><div class="kpi-val">' + N + '</div><div class="kpi-sub">SP: ' + mSec['Servicios Públicos'].c + ' | OP: ' + mSec['Obras Públicas'].c + '</div></div>' +
    '<div class="kpi-card green"><div class="kpi-lbl">Visualizados</div><div class="kpi-val">' + vis + '</div><div class="kpi-sub">' + pct(vis, N) + '</div></div>' +
    '<div class="kpi-card rose"><div class="kpi-lbl">No Visualizados</div><div class="kpi-val">' + noVis + '</div><div class="kpi-sub">' + pct(noVis, N) + '</div></div>' +
    '<div class="kpi-card green"><div class="kpi-lbl">Con Respuesta</div><div class="kpi-val">' + resp + '</div><div class="kpi-sub">' + sol + ' Solucionados</div></div>' +
    '<div class="kpi-card amber"><div class="kpi-lbl">Asuntos Únicos</div><div class="kpi-val">' + Object.keys(mAsuntos).length + '</div><div class="kpi-sub">Tipologías</div></div>' +
    '<div class="kpi-card"><div class="kpi-lbl">Barrios</div><div class="kpi-val">' + Object.keys(mBarrios).length + '</div><div class="kpi-sub">Sin B°: ' + sinB + '</div></div>' +
    '<div class="kpi-card rose"><div class="kpi-lbl">Reg. "Ciegos"</div><div class="kpi-val">' + ciegos + '</div><div class="kpi-sub">' + pct(ciegos, N) + '</div></div>' +
    '<div class="kpi-card amber"><div class="kpi-lbl">Gestores</div><div class="kpi-val">' + cantG + '</div><div class="kpi-sub">Ideal: ' + idealG.toFixed(1) + ' c/u</div></div>';

  var lCausas = ordenarObjeto(mCausas, N);
  var lTipos = ordenarObjeto(mTipos, N);
  var lDeps = ordenarObjeto(mDeps, N);
  var lGest = ordenarObjeto(mGest, N);
  var lBar = ordenarObjeto(mBarrios, N);
  var lAs = ordenarObjeto(mAsuntos, N);
  var lViasOEdades = ordenarObjeto(fClase === 'Pendientes' ? mVias : mEdades, N);

  renderChart('chVivoCausas', 'bar', lCausas.map(x => x.k), lCausas.map(x => x.v), '#2563eb', true);
  renderChart('chVivoVis', 'doughnut', ['Visualizados', 'No visualizados'], [vis, noVis], ['#10b981', '#e11d48'], false);
  renderChart('chVivoTipos', 'bar', lTipos.slice(0, 8).map(x => x.k), lTipos.slice(0, 8).map(x => x.v), '#0f766e', false);
  renderChart('chVivoDeps', 'bar', lDeps.slice(0, 10).map(x => x.k), lDeps.slice(0, 10).map(x => x.v), '#1d4ed8', true);
  renderChart('chVivoGestores', 'bar', lGest.slice(0, 12).map(x => x.k), lGest.slice(0, 12).map(x => x.v), '#d97706', true);
  renderChart('chVivoBarrios', 'bar', lBar.slice(0, 15).map(x => x.k), lBar.slice(0, 15).map(x => x.v), '#4338ca', true);
  renderChart('chVivoAsuntos', 'bar', lAs.slice(0, 12).map(x => x.k), lAs.slice(0, 12).map(x => x.v), '#0d9488', true);
  renderChart('chVivoDias', 'bar', [1,2,3,4,5,6,7].map(d => mDias[d].n), [1,2,3,4,5,6,7].map(d => mDias[d].c), '#0284c7', false);
  renderChart('chVivoVias', 'bar', lViasOEdades.map(x => x.k), lViasOEdades.map(x => x.v), '#7c3aed', false);

  document.getElementById('tblVivoCausas').innerHTML = '<tr><th>Estado</th><th>Cant.</th><th>%</th></tr>' +
    lCausas.map(x => '<tr><td><b>' + x.k + '</b></td><td>' + x.v + '</td><td>' + x.p.toFixed(1) + '%</td></tr>').join('');

  document.getElementById('tblVivoSec').innerHTML = '<tr><th>Secretaría</th><th>Total</th><th>Respondidos</th></tr>' +
    ['Servicios Públicos', 'Obras Públicas'].map(s => '<tr><td><b>' + s + '</b></td><td>' + mSec[s].c + '</td><td>' + mSec[s].r + ' (' + pct(mSec[s].r, mSec[s].c) + ')</td></tr>').join('');

  document.getElementById('tblVivoDeps').innerHTML = '<tr><th>Dependencia</th><th>Reclamos</th><th>%</th></tr>' +
    lDeps.map(x => '<tr><td><b>' + x.k + '</b></td><td>' + x.v + '</td><td>' + x.p.toFixed(1) + '%</td></tr>').join('');

  document.getElementById('tblVivoGestores').innerHTML = '<tr><th>Gestor</th><th>Carga</th><th>Diagnóstico Equidad</th><th>Sugerencia</th></tr>' +
    lGest.map(g => {
      var desv = g.v - idealG;
      var est = '<span class="pill-green">🟢 EQUILIBRADO</span>', sug = 'Carga adecuada';
      if (idealG > 0 && g.v > idealG * 1.25 && desv >= 1.5) { est = '<span class="pill-red">🔴 SOBRECARGADO</span>'; sug = 'Reasignar ~' + Math.round(desv); }
      else if (idealG > 0 && g.v < idealG * 0.75 && Math.abs(desv) >= 1.5) { est = '<span class="pill-blue">🔵 SUBCARGADO</span>'; sug = 'Puede recibir +' + Math.round(Math.abs(desv)); }
      return '<tr><td><b>' + g.k + '</b></td><td>' + g.v + '</td><td>' + est + '</td><td>' + sug + '</td></tr>';
    }).join('');

  document.getElementById('tblVivoBarrios').innerHTML = '<tr><th>Barrio / Zona</th><th>Reclamos</th><th>%</th></tr>' +
    lBar.map(x => '<tr><td><b>' + x.k + '</b></td><td>' + x.v + '</td><td>' + x.p.toFixed(1) + '%</td></tr>').join('');

  var acum = 0;
  document.getElementById('tblVivoAsuntos').innerHTML = '<tr><th>#</th><th>Asunto / Problema</th><th>Cant.</th><th>%</th><th>% Acum.</th><th>Curva ABC</th></tr>' +
    lAs.map((x, idx) => {
      acum += x.p;
      var abc = acum <= 65 ? '<span class="pill-red">Clase A</span>' : (acum <= 85 ? '<span class="pill-blue">Clase B</span>' : '<span class="pill-green">Clase C</span>');
      return '<tr><td>' + (idx + 1) + '</td><td><b>' + x.k + '</b></td><td>' + x.v + '</td><td>' + x.p.toFixed(1) + '%</td><td>' + acum.toFixed(1) + '%</td><td>' + abc + '</td></tr>';
    }).join('');

  document.getElementById('tblVivoTemporal').innerHTML = '<tr><th>Período</th><th>Cantidad</th><th>%</th></tr>' +
    '<tr><td>1ra Quincena (Días 1-15)</td><td>' + q1 + '</td><td>' + pct(q1, N) + '</td></tr>' +
    '<tr><td>2da Quincena (Días 16-31)</td><td>' + q2 + '</td><td>' + pct(q2, N) + '</td></tr>';

  document.getElementById('tblVivoCanales').innerHTML = '<tr><th>Categoría (' + (fClase === 'Pendientes' ? 'Vía de Captación' : 'Rango Etario Estimado por DNI') + ')</th><th>Cant.</th><th>%</th></tr>' +
    lViasOEdades.map(x => '<tr><td><b>' + x.k + '</b></td><td>' + x.v + '</td><td>' + x.p.toFixed(1) + '%</td></tr>').join('');

  document.getElementById('tblVivoCalidad').innerHTML = '<tr><th>Indicador de Calidad</th><th>Cantidad</th><th>% s/ Total</th></tr>' +
    '<tr><td>Barrio vacío o "SIN BARRIO" (Periferia)</td><td>' + sinB + '</td><td>' + pct(sinB, N) + '</td></tr>' +
    '<tr><td><b>Registros "Ciegos" (Sin Barrio, Calle ni Altura)</b></td><td><b>' + ciegos + '</b></td><td><b>' + pct(ciegos, N) + '</b></td></tr>' +
    '<tr><td>Contactos duplicados descartados del conteo único</td><td>' + duplicados + '</td><td>-</td></tr>';
}

function renderChart(id, tipo, labels, data, color, horiz) {
  if (CHARTS_VIVO[id]) CHARTS_VIVO[id].destroy();
  var ctx = document.getElementById(id).getContext('2d');
  CHARTS_VIVO[id] = new Chart(ctx, {
    type: tipo,
    data: {
      labels: labels.map(l => l.length > 30 ? l.substring(0, 30) + '…' : l),
      datasets: [{ data: data, backgroundColor: color, borderRadius: 4 }]
    },
    options: { indexAxis: horiz ? 'y' : 'x', responsive: true, maintainAspectRatio: false, plugins: { legend: { display: tipo === 'doughnut' } } }
  });
}

/* ============================================================================
 * 4. MÓDULO DE PERMISOS + TILDE "PANEL EN VIVO" + AUDITORÍA (PUNTOS 6 Y 7)
 * ============================================================================ */

function cambiarModoPermisos(modo) {
  document.getElementById('tabModoAsignar').classList.toggle('active', modo === 'ASIGNAR');
  document.getElementById('tabModoAuditoria').classList.toggle('active', modo === 'AUDITORIA');
  document.getElementById('vistaPermAsignar').style.display = (modo === 'ASIGNAR') ? 'grid' : 'none';
  document.getElementById('vistaPermAuditoria').style.display = (modo === 'AUDITORIA') ? 'grid' : 'none';
  renderizarModuloPermisos();
}

function alCambiarSecretariaPerm() {
  var sec = document.getElementById('selSecPerm').value;
  var correos = Object.keys(STATE.configPermisos.mapeos[sec] || {});
  CORREO_EDITANDO_PERM = correos.length > 0 ? correos[0] : null;
  renderizarModuloPermisos();
}

function obtenerClaveCat(modoCol, tipo) {
  if (tipo === 'Pendientes') return modoCol === 'COL_F_D' ? 'Pendientes_F' : (modoCol === 'COL_M' ? 'Pendientes_M' : 'Pendientes_O');
  return modoCol === 'COL_F_D' ? 'Reiterados_D' : 'Reiterados_I';
}

function obtenerCatalogoActivoPerm(sec, modoCol, tipo) {
  var k = obtenerClaveCat(modoCol, tipo);
  var base = (STATE.catalogo[sec] && STATE.catalogo[sec][k]) || [];
  var cust = (STATE.configPermisos.customCatalogo[sec] && STATE.configPermisos.customCatalogo[sec][k]) || [];
  var elim = ((STATE.configPermisos.eliminadosCatalogo[sec] && STATE.configPermisos.eliminadosCatalogo[sec][k]) || []).map(x => x.toUpperCase());
  return unirUnicos(base, cust).filter(it => elim.indexOf(it.toUpperCase()) === -1);
}

function calcularMapaUsoPorItem(sec, tipo) {
  var mapa = {};
  var mSec = STATE.configPermisos.mapeos[sec] || {};
  Object.keys(mSec).forEach(function(mail) {
    var arr = (mSec[mail] && mSec[mail][tipo]) || [];
    arr.forEach(function(it) {
      var up = String(it || '').trim().toUpperCase();
      if (!up) return;
      if (!mapa[up]) mapa[up] = { nombre: it, correos: [] };
      if (mapa[up].correos.indexOf(mail) === -1) mapa[up].correos.push(mail);
    });
  });
  return mapa;
}

function agregarCorreoPerm() {
  var sec = document.getElementById('selSecPerm').value;
  var inp = document.getElementById('inpNuevoCorreoPerm');
  var mail = inp.value.trim().toLowerCase();
  if (!mail || mail.indexOf('@') === -1) return alert('Ingresá un correo válido.');
  if (!STATE.configPermisos.mapeos[sec]) STATE.configPermisos.mapeos[sec] = {};
  if (!STATE.configPermisos.mapeos[sec][mail]) {
    STATE.configPermisos.mapeos[sec][mail] = { esAdmin: false, verPanelEnVivo: false, esModerador: false, Pendientes: [], Reiterados: [] };
  }
  inp.value = '';
  CORREO_EDITANDO_PERM = mail;
  renderizarModuloPermisos();
}

function alCambiarTildeEspecial(campo, valor) {
  if (!CORREO_EDITANDO_PERM) return;
  var sec = document.getElementById('selSecPerm').value;
  STATE.configPermisos.mapeos[sec][CORREO_EDITANDO_PERM][campo] = Boolean(valor);
  renderizarModuloPermisos();
}

function aplicarRolEnAmbasSecretarias() {
  if (!CORREO_EDITANDO_PERM) return;
  var secAct = document.getElementById('selSecPerm').value;
  var orig = STATE.configPermisos.mapeos[secAct][CORREO_EDITANDO_PERM];
  ['SERVICIOS_PUBLICOS', 'OBRAS_PUBLICAS'].forEach(function(s) {
    if (!STATE.configPermisos.mapeos[s]) STATE.configPermisos.mapeos[s] = {};
    if (!STATE.configPermisos.mapeos[s][CORREO_EDITANDO_PERM]) {
      STATE.configPermisos.mapeos[s][CORREO_EDITANDO_PERM] = { Pendientes: [], Reiterados: [] };
    }
    STATE.configPermisos.mapeos[s][CORREO_EDITANDO_PERM].esAdmin = Boolean(orig.esAdmin);
    STATE.configPermisos.mapeos[s][CORREO_EDITANDO_PERM].verPanelEnVivo = Boolean(orig.verPanelEnVivo);
    STATE.configPermisos.mapeos[s][CORREO_EDITANDO_PERM].esModerador = Boolean(orig.esModerador);
  });
  renderizarModuloPermisos();
  mostrarMsgPerm(true, '🌐 Se aplicaron los roles especiales de <b>' + CORREO_EDITANDO_PERM + '</b> en AMBAS Secretarías.');
}

function renderizarModuloPermisos() {
  var sec = document.getElementById('selSecPerm').value;
  var modoCol = document.getElementById('selColPtesPerm').value;
  STATE.configPermisos.columnaPendientes = modoCol;

  var mSec = STATE.configPermisos.mapeos[sec] || {};
  var correos = Object.keys(mSec);
  document.getElementById('badgeCantCorreos').textContent = correos.length + ' correo(s)';

  if (!CORREO_EDITANDO_PERM && correos.length > 0) CORREO_EDITANDO_PERM = correos[0];

  var htmlC = '';
  correos.forEach(function(m) {
    var o = mSec[m];
    var cP = (o.Pendientes || []).length, cR = (o.Reiterados || []).length;
    var tags = [];
    if (o.esAdmin) tags.push('👑 Admin');
    if (o.verPanelEnVivo) tags.push('📊 Vivo');
    if (o.esModerador) tags.push('🛡️ Mod');
    tags.push('P:' + cP + ' | R:' + cR);

    var cls = (m === CORREO_EDITANDO_PERM) ? 'email-item active' : 'email-item';
    htmlC += '<div class="' + cls + '" onclick="CORREO_EDITANDO_PERM=\'' + m + '\'; renderizarModuloPermisos();">' +
      '<div><div>' + m + '</div><div style="font-size:10.5px; color:#64748b;">' + tags.join(' · ') + '</div></div>' +
      '<button type="button" class="del-btn" onclick="eliminarCorreoPerm(\'' + m + '\', event)">✕</button>' +
    '</div>';
  });
  document.getElementById('listaCorreosPerm').innerHTML = htmlC || '<div style="padding:12px; color:#64748b;">Agregá un correo arriba.</div>';

  var banner = document.getElementById('bannerRolesEspeciales');
  var catP = obtenerCatalogoActivoPerm(sec, modoCol, 'Pendientes');
  var catR = obtenerCatalogoActivoPerm(sec, modoCol, 'Reiterados');
  var usoP = calcularMapaUsoPorItem(sec, 'Pendientes');
  var usoR = calcularMapaUsoPorItem(sec, 'Reiterados');

  if (!CORREO_EDITANDO_PERM || !mSec[CORREO_EDITANDO_PERM]) {
    banner.style.display = 'none';
    document.getElementById('listaDepsPendientes').innerHTML = construirChecksPermHtml(catP, [], 'Pendientes', usoP, true);
    document.getElementById('listaDepsReiterados').innerHTML = construirChecksPermHtml(catR, [], 'Reiterados', usoR, true);
  } else {
    banner.style.display = 'flex';
    var uObj = mSec[CORREO_EDITANDO_PERM];
    document.getElementById('chkEsAdminPerm').checked = Boolean(uObj.esAdmin);
    document.getElementById('chkVerPanelVivoPerm').checked = Boolean(uObj.verPanelEnVivo);
    document.getElementById('chkEsModeradorPerm').checked = Boolean(uObj.esModerador);
    document.getElementById('lblCorreoSeleccionadoPerm').innerHTML = '🎯 Configurando accesos para: <span style="color:#2563eb;">' + CORREO_EDITANDO_PERM + '</span>';

    var asigP = uObj.Pendientes || [];
    var asigR = uObj.Reiterados || [];
    document.getElementById('listaDepsPendientes').innerHTML = construirChecksPermHtml(unirUnicos(catP, asigP), asigP, 'Pendientes', usoP, false);
    document.getElementById('listaDepsReiterados').innerHTML = construirChecksPermHtml(unirUnicos(catR, asigR), asigR, 'Reiterados', usoR, false);
  }

  renderizarPanelesAuditoria(catP, catR, usoP, usoR);
}

function construirChecksPermHtml(lista, asignadas, tipo, mapaUso, deshabilitar) {
  if (lista.length === 0) return '<div style="padding:10px; color:#64748b;">Sin elementos. Podés agregar uno arriba con "+".</div>';
  return lista.map(function(dep) {
    var up = dep.toUpperCase();
    var marcado = asignadas.indexOf(dep) !== -1;
    var info = mapaUso[up] || { correos: [] };
    var n = info.correos.length;
    var tag = n === 0
      ? '<span class="mini-tag tag-none">🚨 Sin gestor</span>'
      : (n === 1 ? '<span class="mini-tag tag-one" title="' + info.correos[0] + '">✅ 1 gestor</span>' : '<span class="mini-tag tag-dup" title="' + info.correos.join(', ') + '">👥 Repetido (' + n + ')</span>');
    var depEsc = dep.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    return '<div class="chk-row-wrap ' + (marcado ? 'checked-row' : '') + '">' +
      '<label class="chk-label"><input type="checkbox" ' + (marcado ? 'checked' : '') + ' ' + (deshabilitar ? 'disabled' : '') + ' onchange="toggleCheckPerm(\'' + tipo + '\', \'' + depEsc + '\', this.checked)"><span>' + dep + '</span></label>' +
      '<div class="item-meta">' + tag + '<button type="button" class="btn-del-item" title="Eliminar de la lista" onclick="eliminarItemCatalogoPerm(\'' + tipo + '\', \'' + depEsc + '\', event)">🗑️</button></div>' +
    '</div>';
  }).join('');
}

function toggleCheckPerm(tipo, dep, marcado) {
  if (!CORREO_EDITANDO_PERM) return;
  var sec = document.getElementById('selSecPerm').value;
  var arr = STATE.configPermisos.mapeos[sec][CORREO_EDITANDO_PERM][tipo] || [];
  var idx = arr.indexOf(dep);
  if (marcado && idx === -1) arr.push(dep);
  if (!marcado && idx !== -1) arr.splice(idx, 1);
  STATE.configPermisos.mapeos[sec][CORREO_EDITANDO_PERM][tipo] = arr;
  renderizarModuloPermisos();
}

function marcarTodasPerm(tipo, marcar) {
  if (!CORREO_EDITANDO_PERM) return;
  var sec = document.getElementById('selSecPerm').value;
  var modoCol = document.getElementById('selColPtesPerm').value;
  var base = obtenerCatalogoActivoPerm(sec, modoCol, tipo);
  STATE.configPermisos.mapeos[sec][CORREO_EDITANDO_PERM][tipo] = marcar ? base.slice() : [];
  renderizarModuloPermisos();
}

function agregarItemManualPerm(tipo) {
  var sec = document.getElementById('selSecPerm').value;
  var modoCol = document.getElementById('selColPtesPerm').value;
  var idInp = tipo === 'Pendientes' ? 'inpNuevaDepPtes' : 'inpNuevaDepReit';
  var val = document.getElementById(idInp).value.trim();
  if (!val) return;

  var k = obtenerClaveCat(modoCol, tipo);
  if (!STATE.configPermisos.customCatalogo[sec][k]) STATE.configPermisos.customCatalogo[sec][k] = [];
  if (STATE.configPermisos.customCatalogo[sec][k].indexOf(val) === -1) STATE.configPermisos.customCatalogo[sec][k].push(val);

  if (CORREO_EDITANDO_PERM) toggleCheckPerm(tipo, val, true);
  document.getElementById(idInp).value = '';
  renderizarModuloPermisos();
}

function eliminarItemCatalogoPerm(tipo, dep, ev) {
  if (ev) ev.stopPropagation();
  var sec = document.getElementById('selSecPerm').value;
  var modoCol = document.getElementById('selColPtesPerm').value;
  var k = obtenerClaveCat(modoCol, tipo);
  var up = dep.toUpperCase();

  if (STATE.catalogo[sec] && STATE.catalogo[sec][k]) STATE.catalogo[sec][k] = STATE.catalogo[sec][k].filter(x => x.toUpperCase() !== up);
  if (STATE.configPermisos.customCatalogo[sec] && STATE.configPermisos.customCatalogo[sec][k]) {
    STATE.configPermisos.customCatalogo[sec][k] = STATE.configPermisos.customCatalogo[sec][k].filter(x => x.toUpperCase() !== up);
  }
  if (!STATE.configPermisos.eliminadosCatalogo[sec][k]) STATE.configPermisos.eliminadosCatalogo[sec][k] = [];
  STATE.configPermisos.eliminadosCatalogo[sec][k].push(dep);

  var mSec = STATE.configPermisos.mapeos[sec] || {};
  Object.keys(mSec).forEach(function(m) {
    if (mSec[m] && mSec[m][tipo]) mSec[m][tipo] = mSec[m][tipo].filter(x => x.toUpperCase() !== up);
  });
  renderizarModuloPermisos();
}

function eliminarCorreoPerm(mail, ev) {
  ev.stopPropagation();
  var sec = document.getElementById('selSecPerm').value;
  delete STATE.configPermisos.mapeos[sec][mail];
  CORREO_EDITANDO_PERM = null;
  renderizarModuloPermisos();
}

function renderizarPanelesAuditoria(catP, catR, usoP, usoR) {
  var repP = [], sinP = [], repR = [], sinR = [];
  catP.forEach(function(it) {
    var c = (usoP[it.toUpperCase()] && usoP[it.toUpperCase()].correos) || [];
    if (c.length === 0) sinP.push(it); else if (c.length >= 2) repP.push({ n: it, c: c });
  });
  catR.forEach(function(it) {
    var c = (usoR[it.toUpperCase()] && usoR[it.toUpperCase()].correos) || [];
    if (c.length === 0) sinR.push(it); else if (c.length >= 2) repR.push({ n: it, c: c });
  });

  document.getElementById('badgeTotalRepetidos').textContent = repP.length + repR.length;
  document.getElementById('badgeTotalSinAsignar').textContent = sinP.length + sinR.length;
  document.getElementById('cntRepPtes').textContent = repP.length;
  document.getElementById('cntRepReit').textContent = repR.length;
  document.getElementById('cntSinPtes').textContent = sinP.length;
  document.getElementById('cntSinReit').textContent = sinR.length;

  document.getElementById('listaRepPtes').innerHTML = repP.map(x => '<div class="audit-item rep"><b>' + x.n + '</b><br><small>👥 Compartido por: ' + x.c.join(', ') + '</small></div>').join('') || '<div style="padding:8px; color:#166534;">✅ Sin repetidos en Pendientes</div>';
  document.getElementById('listaRepReit').innerHTML = repR.map(x => '<div class="audit-item rep"><b>' + x.n + '</b><br><small>👥 Compartido por: ' + x.c.join(', ') + '</small></div>').join('') || '<div style="padding:8px; color:#166534;">✅ Sin repetidos en Reiterados</div>';
  document.getElementById('listaSinPtes').innerHTML = sinP.map(it => '<div class="audit-item unassigned"><b>' + it + '</b></div>').join('') || '<div style="padding:8px; color:#166534;">✅ Todos asignados</div>';
  document.getElementById('listaSinReit').innerHTML = sinR.map(it => '<div class="audit-item unassigned"><b>' + it + '</b></div>').join('') || '<div style="padding:8px; color:#166534;">✅ Todos asignados</div>';
}

function guardarPermisosWeb(aplicarAhora) {
  mostrarMsgPerm(true, '⏳ Guardando configuración de permisos en Drive...');
  var payload = {
    aplicarEnHojaAhora: aplicarAhora,
    columnaPendientes: document.getElementById('selColPtesPerm').value,
    mapeos: STATE.configPermisos.mapeos,
    customCatalogo: STATE.configPermisos.customCatalogo,
    eliminadosCatalogo: STATE.configPermisos.eliminadosCatalogo,
    parametrosSistema: STATE.parametrosSistema
  };
  llamarAPI('GUARDAR_PERMISOS', payload, function(nuevoPaquete) {
    STATE = nuevoPaquete;
    localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(nuevoPaquete));
    reconstruirPerfilUsuario(USUARIO_SESION.email);
    mostrarMsgPerm(true, '✅ ¡Permisos guardados y aplicados correctamente!');
  });
}

function mostrarMsgPerm(ok, txt) {
  var el = document.getElementById('msgEstadoPerm');
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.innerHTML = txt;
}

/* ============================================================================
 * 5. CARGA DE CRUDOS, CONFIGURACIÓN SIN CÓDIGO Y DESCARGAS LOCALES A LA PC
 * ============================================================================ */

function listarArchivosCrudosDrive() {
  llamarAPI('LISTAR_CRUDOS', {}, function(lista) {
    var sel = document.getElementById('selArchivoCrudoDrive');
    sel.innerHTML = '';
    if (!lista || lista.length === 0) {
      sel.innerHTML = '<option value="">La carpeta Carga_Crudos_SAC está vacía</option>';
      return;
    }
    lista.forEach(function(a) {
      var o = document.createElement('option');
      o.value = a.id;
      o.textContent = a.nombre + ' (' + a.fecha + ')';
      sel.appendChild(o);
    });
  });
}

function procesarCargaCrudo() {
  var fileInput = document.getElementById('inpArchivoCrudoPC');
  var idDrive = document.getElementById('selArchivoCrudoDrive').value;
  var paramsBase = {
    secretaria: document.getElementById('cargaSec').value,
    tipoReclamo: document.getElementById('cargaTipo').value,
    fechaDesde: document.getElementById('cargaFechaDesde').value,
    fechaHasta: document.getElementById('cargaFechaHasta').value,
    hacerBackupPrevio: document.getElementById('chkBackupCarga').checked
  };

  var caja = document.getElementById('cajaEstadoCarga');
  caja.className = 'msg ok';
  caja.innerHTML = '⏳ Procesando archivo Excel crudo y generando resguardo en Drive...';

  if (fileInput.files && fileInput.files.length > 0) {
    var f = fileInput.files[0];
    var reader = new FileReader();
    reader.onload = function(e) {
      var base64 = e.target.result.split(',')[1];
      paramsBase.base64Data = base64;
      paramsBase.fileName = f.name;
      llamarAPI('CARGAR_CRUDO_BASE64', paramsBase, function(res) {
        STATE = res.paqueteActualizado;
        localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(STATE));
        caja.innerHTML = '✅ ' + res.resumen;
        actualizarContadoresYSelectores();
        renderizarGrillaReclamos();
      });
    };
    reader.readAsDataURL(f);
  } else if (idDrive) {
    paramsBase.idArchivo = idDrive;
    llamarAPI('CARGAR_CRUDO', paramsBase, function(res) {
      STATE = res.paqueteActualizado;
      localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(STATE));
      caja.innerHTML = '✅ ' + res.resumen;
      actualizarContadoresYSelectores();
      renderizarGrillaReclamos();
    });
  } else {
    caja.className = 'msg err';
    caja.innerHTML = '⚠️ Seleccioná un archivo de la carpeta Carga_Crudos_SAC o subí uno desde tu PC.';
  }
}

function procesarVaciadoHoja() {
  var caja = document.getElementById('cajaEstadoCarga');
  caja.className = 'msg ok';
  caja.innerHTML = '⏳ Resguardando backup y vaciando hoja...';
  llamarAPI('VACIAR_HOJA', {
    secretaria: document.getElementById('limpiarSec').value,
    tipoReclamo: document.getElementById('limpiarTipo').value,
    hacerBackupPrevio: document.getElementById('chkBackupLimpiar').checked
  }, function(res) {
    STATE = res.paqueteActualizado;
    localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(STATE));
    caja.innerHTML = '✅ ' + res.resumen;
    actualizarContadoresYSelectores();
    renderizarGrillaReclamos();
  });
}

function importarPlanillasExistentes() {
  var caja = document.getElementById('cajaEstadoCarga');
  caja.className = 'msg ok';
  caja.innerHTML = '⏳ Importando reclamos y permisos desde tus planillas de Drive...';
  llamarAPI('IMPORTAR_EXISTENTES', {}, function(res) {
    STATE = res.paqueteActualizado;
    localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(STATE));
    caja.innerHTML = '✅ ' + res.resumen;
    actualizarContadoresYSelectores();
    renderizarGrillaReclamos();
  });
}

function ejecutarBackupGeneral() {
  actualizarPillSync('⏳ Creando Backup en Drive...');
  llamarAPI('GENERAR_BACKUP', {}, function(res) {
    actualizarPillSync('✅ Backup en Drive: ' + res.nombreBackup);
    alert('✅ Backup creado exitosamente en tu carpeta BackUp_Panel de Google Drive:\n' + res.nombreBackup);
  });
}

function descargarVistaActualCSV() {
  var filas = STATE.reclamos[SEC_ACTIVA][TIPO_ACTIVO] || [];
  exportarArregloACSV(filas, 'SAC_' + SEC_ACTIVA + '_' + TIPO_ACTIVO + '.csv');
}

function descargarBackupCompletoEnPC() {
  var todas = [].concat(
    STATE.reclamos.SERVICIOS_PUBLICOS.Pendientes || [],
    STATE.reclamos.SERVICIOS_PUBLICOS.Reiterados || [],
    STATE.reclamos.OBRAS_PUBLICAS.Pendientes || [],
    STATE.reclamos.OBRAS_PUBLICAS.Reiterados || []
  );
  exportarArregloACSV(todas, 'Backup_Consolidado_SAC_' + new Date().toISOString().slice(0, 10) + '.csv');
}

function exportarArregloACSV(arr, nombreArchivo) {
  if (!arr || arr.length === 0) return alert('No hay registros para descargar.');
  var cols = Object.keys(arr[0]);
  var lineas = [cols.join(';')];
  arr.forEach(function(r) {
    var fila = cols.map(function(c) {
      return '"' + String(r[c] == null ? '' : r[c]).replace(/"/g, '""') + '"';
    });
    lineas.push(fila.join(';'));
  });
  var blob = new Blob(['\uFEFF' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombreArchivo;
  a.click();
}

function cargarFormularioParametrosSistema() {
  var p = STATE.parametrosSistema;
  document.getElementById('cfgOpcionesPtes').value = (p.opcionesPendientes || []).join('\n');
  document.getElementById('cfgOpcionesReit').value = (p.opcionesReiterados || []).join('\n');
  document.getElementById('cfgCarpetaProyecto').value = p.carpetaProyecto || 'Proyecto_SAC';
  document.getElementById('cfgCarpetaCrudos').value = p.carpetaCrudos || 'Carga_Crudos_SAC';
  document.getElementById('cfgCarpetaBackup').value = p.carpetaBackup || 'BackUp_Panel';
}

function guardarParametrosSistemaDesdeWeb() {
  var nuevos = {
    opcionesPendientes: document.getElementById('cfgOpcionesPtes').value.split('\n').map(x => x.trim()).filter(Boolean),
    opcionesReiterados: document.getElementById('cfgOpcionesReit').value.split('\n').map(x => x.trim()).filter(Boolean),
    carpetaProyecto: document.getElementById('cfgCarpetaProyecto').value.trim(),
    carpetaCrudos: document.getElementById('cfgCarpetaCrudos').value.trim(),
    carpetaBackup: document.getElementById('cfgCarpetaBackup').value.trim()
  };
  actualizarPillSync('⏳ Guardando parámetros...');
  llamarAPI('GUARDAR_PARAMETROS_SISTEMA', nuevos, function(paquete) {
    STATE = paquete;
    localStorage.setItem(CACHE_KEY_BOOT, JSON.stringify(paquete));
    actualizarPillSync('✅ Parámetros actualizados');
    alert('✅ Parámetros y listas desplegables actualizados en todo el sistema.');
  });
}

/* ============================================================================
 * UTILIDADES
 * ============================================================================ */

function actualizarPillSync(txt) {
  var el = document.getElementById('badgeEstadoSync');
  if (el) el.textContent = txt;
}

function alternarPantallaCompleta() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(function(){});
  else document.exitFullscreen().catch(function(){});
}

function ordenarObjeto(m, total) {
  return Object.keys(m).map(function(k) {
    return { k: k, v: m[k], p: total > 0 ? (m[k] / total) * 100 : 0 };
  }).sort(function(a, b) { return b.v - a.v; });
}

function pct(v, tot) { return tot > 0 ? ((v / tot) * 100).toFixed(1) + '%' : '0.0%'; }
function escaparHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escaparAttr(s) { return String(s || '').replace(/"/g, '&quot;'); }
function unirUnicos(a, b) {
  var m = {};
  (a || []).forEach(function(x) { if (x) m[x] = true; });
  (b || []).forEach(function(x) { if (x) m[x] = true; });
  return Object.keys(m).sort();
}
