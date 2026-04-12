// =============================================================================
// update-manager.js — Módulo de auto-update do StockHub
// Responsabilidades:
//   - Verificar periodicamente se há nova versão no repositório de releases
//   - Exibir modal informativo com notas de versão
//   - Persistir estado de "adiado" para re-avisar após 2 horas
//   - Baixar, extrair e aplicar o update automaticamente (Windows e macOS)
// =============================================================================

// --- Funções puras testáveis (fora da IIFE para serem exportáveis via Node) ---

/**
 * Compara duas strings de versão semântica (ex: "1.2.0" vs "1.1.0").
 * Retorna: 1 se a > b, -1 se a < b, 0 se iguais ou inválidas.
 */
function _compareSemver(a, b) {
  if (!a || !b) return 0;
  var pa = a.split(".").map(Number);
  var pb = b.split(".").map(Number);
  for (var i = 0; i < 3; i++) {
    var na = pa[i] || 0;
    var nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Decide se o modal de update deve ser exibido agora.
 * Lógica:
 *   - Não exibe se outro modal já está aberto (modalIsOpen)
 *   - Exibe imediatamente se a versão remota é diferente da que foi adiada
 *   - Exibe se a mesma versão foi adiada e já passaram >= 2 horas
 *
 * @param {string|null} dismissedVersion - versão que o usuário adiou
 * @param {number|null} dismissedAt      - timestamp (ms) do adiamento
 * @param {string}      remoteVersion    - versão disponível remotamente
 * @param {boolean}     modalIsOpen      - true se #modalContainer tem conteúdo
 * @returns {boolean}
 */
function _shouldShowUpdate(dismissedVersion, dismissedAt, remoteVersion, modalIsOpen) {
  if (modalIsOpen) return false;
  if (dismissedVersion !== remoteVersion) return true;
  if (!dismissedAt) return true;
  return (Date.now() - dismissedAt) >= 2 * 60 * 60 * 1000;
}

// Exporta para testes Node (no browser, `module` é undefined — branch ignorado)
if (typeof module !== "undefined") {
  module.exports = { _compareSemver: _compareSemver, _shouldShowUpdate: _shouldShowUpdate };
}

// =============================================================================
// IIFE principal — expõe window.UpdateManager
// =============================================================================
var UpdateManager = (function () {

  // ---------------------------------------------------------------------------
  // Node built-ins (disponíveis via CEP com Node.js habilitado)
  // ---------------------------------------------------------------------------
  var _fs    = (typeof require !== "undefined") ? require("fs")             : null;
  var _path  = (typeof require !== "undefined") ? require("path")           : null;
  var _https = (typeof require !== "undefined") ? require("https")          : null;
  var _child = (typeof require !== "undefined") ? require("child_process")  : null;
  var _os    = (typeof require !== "undefined") ? require("os")             : null;

  // ---------------------------------------------------------------------------
  // Estado privado
  // ---------------------------------------------------------------------------
  var _pendingUrl     = null;   // downloadUrl da versão remota
  var _pendingVersion = null;   // string da versão remota
  var _intervalId     = null;   // handle do setInterval de verificação periódica
  var _stateRef       = null;   // referência viva ao objeto `state` do app.js
  var _saveStateFn    = null;   // referência à função saveState() do app.js

  // URL do version.json no repositório de releases
  var UPDATE_CHECK_URL =
    "https://raw.githubusercontent.com/luissousaodev/stockhub-releases/refs/heads/main/version.json";

  // ---------------------------------------------------------------------------
  // Helpers de rede
  // ---------------------------------------------------------------------------

  /**
   * GET HTTPS com suporte a redirect. Chama cb(err, body).
   */
  function _httpsGet(url, cb) {
    _https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return _httpsGet(res.headers.location, cb);
      }
      if (res.statusCode !== 200) {
        return cb(new Error("HTTP " + res.statusCode));
      }
      var data = "";
      res.on("data", function (c) { data += c; });
      res.on("end",  function ()  { cb(null, data); });
    }).on("error", function (e) { cb(e); });
  }

  /**
   * Download de arquivo para disco com callback de progresso.
   * progressCb(received, total) — total pode ser 0 se Content-Length ausente.
   */
  function _downloadFile(url, dest, progressCb, cb) {
    var file = _fs.createWriteStream(dest);
    _https.get(url, function (res) {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        try { _fs.unlinkSync(dest); } catch (e) {}
        return _downloadFile(res.headers.location, dest, progressCb, cb);
      }
      if (res.statusCode !== 200) {
        file.close();
        return cb(new Error("HTTP " + res.statusCode));
      }
      var total    = parseInt(res.headers["content-length"] || "0", 10);
      var received = 0;
      res.on("data", function (chunk) {
        received += chunk.length;
        if (progressCb) progressCb(received, total);
      });
      res.pipe(file);
      file.on("finish", function () { file.close(function () { cb(null); }); });
    }).on("error", function (e) { file.close(); cb(e); });
  }

  // ---------------------------------------------------------------------------
  // Helpers de sistema de arquivos
  // ---------------------------------------------------------------------------

  /** Cópia recursiva de diretório. */
  function _copyDirSync(src, dest) {
    if (!_fs.existsSync(src)) return;
    _fs.mkdirSync(dest, { recursive: true });
    var items = _fs.readdirSync(src, { withFileTypes: true });
    for (var i = 0; i < items.length; i++) {
      var s = _path.join(src, items[i].name);
      var d = _path.join(dest, items[i].name);
      if (items[i].isDirectory()) { _copyDirSync(s, d); }
      else                        { _fs.copyFileSync(s, d); }
    }
  }

  /** Remoção recursiva de diretório. */
  function _rmDirSync(dir) {
    if (!_fs.existsSync(dir)) return;
    var items = _fs.readdirSync(dir, { withFileTypes: true });
    for (var i = 0; i < items.length; i++) {
      var p = _path.join(dir, items[i].name);
      if (items[i].isDirectory()) { _rmDirSync(p); }
      else                        { _fs.unlinkSync(p); }
    }
    _fs.rmdirSync(dir);
  }

  /**
   * Encontra a raiz da extensão dentro do ZIP extraído.
   * Lida com ZIPs que têm uma pasta wrapper (ex: stockhub-1.2.0/).
   */
  function _findExtractedRoot(dir) {
    var items = _fs.readdirSync(dir);
    if (items.indexOf("CSXS") !== -1 || items.indexOf("client") !== -1) return dir;
    if (items.length === 1) {
      var sub = _path.join(dir, items[0]);
      if (_fs.statSync(sub).isDirectory()) return _findExtractedRoot(sub);
    }
    return dir;
  }

  // ---------------------------------------------------------------------------
  // Modal helpers
  // ---------------------------------------------------------------------------

  /**
   * Atualiza a barra de progresso no modal já aberto.
   * received e total em bytes. Se total=0, usa animação indeterminada.
   */
  function _showProgress(received, total) {
    var wrap  = document.getElementById("updateProgressWrap");
    var bar   = document.getElementById("updateProgressBar");
    var label = document.getElementById("updateProgressLabel");
    if (!wrap || !bar || !label) return;

    wrap.style.display = "block";

    if (total > 0) {
      var pct = Math.round((received / total) * 100);
      bar.classList.remove("update-progress-indeterminate");
      bar.style.width = pct + "%";
      label.textContent = pct + "%";
    } else {
      // Sem Content-Length — animação indeterminada
      bar.style.width = "100%";
      bar.classList.add("update-progress-indeterminate");
      label.textContent = "Baixando…";
    }
  }

  /** Desabilita os botões do modal durante o download. */
  function _lockModalButtons(label) {
    var dismissBtn = document.getElementById("updateDismissBtn");
    var nowBtn     = document.getElementById("updateNowBtn");
    if (dismissBtn) { dismissBtn.disabled = true; }
    if (nowBtn)     { nowBtn.disabled = true; nowBtn.textContent = label || "Baixando…"; }
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * Inicializa o módulo guardando referências ao estado do app.
   * Deve ser chamado UMA vez, dentro de init() no app.js.
   *
   * @param {object}   stateObj    - o objeto `state` vivo do app.js
   * @param {function} saveStateFn - a função saveState() do app.js
   */
  function init(stateObj, saveStateFn) {
    _stateRef    = stateObj;
    _saveStateFn = saveStateFn;
  }

  /**
   * Verifica o repositório de releases em busca de nova versão.
   * Se encontrar, decide se exibe o modal baseado no estado de "adiado".
   */
  function check() {
    if (!_https) return; // ambiente sem Node (ex: testes DOM-only)
    _httpsGet(UPDATE_CHECK_URL, function (err, body) {
      if (err) return; // falha silenciosa — sem internet ou repositório offline
      try {
        var remote = JSON.parse(body);
        if (!remote.version) return;
        // Só age se a versão remota for maior que a instalada
        if (_compareSemver(remote.version, window.APP_VERSION) <= 0) return;

        _pendingUrl     = remote.downloadUrl || null;
        _pendingVersion = remote.version;

        // Verifica se o modal de outro contexto já está aberto
        var mc        = document.getElementById("modalContainer");
        var isOpen    = mc ? mc.innerHTML.trim() !== "" : false;
        var dismissed = _stateRef ? _stateRef.updateDismissedVersion : null;
        var dismissAt = _stateRef ? _stateRef.lastUpdateDismissedAt  : null;

        if (_shouldShowUpdate(dismissed, dismissAt, remote.version, isOpen)) {
          showModal(remote.version, remote.notes || "");
        }
      } catch (e) { /* JSON inválido — ignora */ }
    });
  }

  /**
   * Exibe o modal de atualização disponível.
   *
   * @param {string} version - versão disponível (ex: "1.2.0")
   * @param {string} notes   - notas de versão (pode ser string vazia)
   */
  function showModal(version, notes) {
    var mc = document.getElementById("modalContainer");
    if (!mc) return;

    var currentVersion = window.APP_VERSION || "?";

    var notesBlock = notes
      ? '<div class="update-notes">' + notes + '</div>'
      : "";

    mc.innerHTML =
      '<div class="modal-overlay" onclick="UpdateManager.dismiss()">' +
        '<div class="modal update-modal" onclick="event.stopPropagation()">' +

          // Título com ícone de download
          '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" ' +
                'stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
              '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>' +
              '<polyline points="7 10 12 15 17 10"/>' +
              '<line x1="12" y1="15" x2="12" y2="3"/>' +
            '</svg>' +
            '<h3 style="margin:0;">Atualização disponível</h3>' +
          '</div>' +

          // Linha de versão: atual → nova
          '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">' +
            '<span style="font-size:11px;color:var(--text-secondary);">Versão atual:</span>' +
            '<span style="font-size:11px;font-weight:600;color:var(--text-muted);">v' + currentVersion + '</span>' +
            '<span style="color:var(--accent);font-size:14px;">→</span>' +
            '<span style="font-size:13px;font-weight:600;color:var(--accent);">v' + version + '</span>' +
          '</div>' +

          // Notas de versão (opcional)
          notesBlock +

          // Barra de progresso (oculta até o download iniciar)
          '<div id="updateProgressWrap" style="display:none;margin-bottom:12px;">' +
            '<div style="height:4px;background:var(--bg-primary);border-radius:2px;overflow:hidden;position:relative;">' +
              '<div id="updateProgressBar" ' +
                   'style="height:100%;width:0%;background:var(--accent);transition:width 0.2s;border-radius:2px;">' +
              '</div>' +
            '</div>' +
            '<div id="updateProgressLabel" ' +
                 'style="font-size:10px;color:var(--text-muted);margin-top:4px;text-align:right;">0%</div>' +
          '</div>' +

          // Botões de ação
          '<div class="modal-actions">' +
            '<button class="btn" id="updateDismissBtn" onclick="UpdateManager.dismiss()">' +
              'Lembrar mais tarde' +
            '</button>' +
            '<button class="btn btn-primary" id="updateNowBtn" onclick="UpdateManager.performUpdate()">' +
              'Atualizar agora' +
            '</button>' +
          '</div>' +

        '</div>' +
      '</div>';
  }

  /**
   * Adia o aviso de update.
   * Grava a versão e o timestamp atual no state para religar o aviso após 2h.
   */
  function dismiss() {
    if (_stateRef) {
      _stateRef.lastUpdateDismissedAt  = Date.now();
      _stateRef.updateDismissedVersion = _pendingVersion;
    }
    if (_saveStateFn) _saveStateFn();

    // Limpa o modalContainer (fecha o modal)
    var mc = document.getElementById("modalContainer");
    if (mc) mc.innerHTML = "";
  }

  /**
   * Executa o processo de atualização automática:
   *   1. Verifica permissão de escrita
   *   2. Baixa o ZIP com barra de progresso
   *   3. Cria backup
   *   4. Extrai (PowerShell no Windows, unzip no macOS)
   *   5. Copia arquivos novos preservando dados do usuário
   *   6. Limpa temporários e recarrega o painel
   */
  function performUpdate() {
    if (!_pendingUrl) {
      if (typeof showToast === "function") showToast("URL de download não disponível");
      return;
    }

    var extensionDir = _path.join(__dirname, "..");
    var tempDir      = _path.join(_os.tmpdir(), "stockhub-update");
    var zipPath      = _path.join(_os.tmpdir(), "stockhub-update.zip");
    var backupDir    = _path.join(_os.tmpdir(), "stockhub-backup-" + (window.APP_VERSION || "old"));
    var isWin        = process.platform === "win32";

    // 1. Verificar permissão de escrita na pasta da extensão
    try {
      _fs.accessSync(extensionDir, _fs.constants.W_OK);
    } catch (e) {
      var mc = document.getElementById("modalContainer");
      if (mc) {
        mc.innerHTML =
          '<div class="modal-overlay" onclick="closeModal(event)">' +
            '<div class="modal" onclick="event.stopPropagation()" style="max-width:420px;">' +
              '<h3 style="margin:0 0 8px;">Atualização manual necessária</h3>' +
              '<p style="font-size:11px;color:var(--text-secondary);line-height:1.5;">' +
                'Sem permissão de escrita na pasta da extensão. ' +
                'Instale o StockHub em user-scope para habilitar o auto-update.' +
              '</p>' +
              '<p style="font-size:10px;color:var(--text-muted);margin:8px 0;word-break:break-all;">' +
                extensionDir +
              '</p>' +
              '<div class="modal-actions">' +
                '<button class="btn btn-primary" onclick="closeModal()">Entendi</button>' +
              '</div>' +
            '</div>' +
          '</div>';
      }
      return;
    }

    // 2. Travar botões e iniciar download
    _lockModalButtons("Baixando…");

    _downloadFile(_pendingUrl, zipPath, _showProgress, function (err) {
      if (err) {
        if (typeof showToast === "function") showToast("Erro no download: " + err.message);
        // Re-habilita botões em caso de falha
        var dismissBtn = document.getElementById("updateDismissBtn");
        var nowBtn     = document.getElementById("updateNowBtn");
        if (dismissBtn) { dismissBtn.disabled = false; }
        if (nowBtn)     { nowBtn.disabled = false; nowBtn.textContent = "Tentar novamente"; nowBtn.onclick = function() { performUpdate(); }; }
        return;
      }

      try {
        // 3. Backup de segurança
        if (_fs.existsSync(backupDir)) _rmDirSync(backupDir);
        _copyDirSync(extensionDir, backupDir);

        // 4. Extrair ZIP
        if (_fs.existsSync(tempDir)) _rmDirSync(tempDir);
        _fs.mkdirSync(tempDir, { recursive: true });

        var extractCmd = isWin
          ? 'powershell -Command "Expand-Archive -Path \'' + zipPath.replace(/'/g, "''") + '\' -DestinationPath \'' + tempDir.replace(/'/g, "''") + '\' -Force"'
          : 'unzip -o "' + zipPath + '" -d "' + tempDir + '"';

        _child.execSync(extractCmd, { timeout: 30000 });

        // 5. Copiar arquivos novos, preservando dados do usuário
        var sourceRoot = _findExtractedRoot(tempDir);
        var items      = _fs.readdirSync(sourceRoot, { withFileTypes: true });
        var skip       = [".cache", "stockhub-data.json", ".debug", "stockhub-updates"];

        for (var i = 0; i < items.length; i++) {
          if (skip.indexOf(items[i].name) !== -1) continue;
          var s = _path.join(sourceRoot, items[i].name);
          var d = _path.join(extensionDir, items[i].name);
          if (items[i].isDirectory()) { _copyDirSync(s, d); }
          else                        { _fs.copyFileSync(s, d); }
        }

        // 6. Limpar temporários e recarregar
        try { _fs.unlinkSync(zipPath); }    catch (e) {}
        try { _rmDirSync(tempDir); }        catch (e) {}

        if (typeof showToast === "function") {
          showToast("Atualizado para v" + _pendingVersion + "! Recarregando…");
        }

        // Fecha o modal antes de recarregar
        var mc2 = document.getElementById("modalContainer");
        if (mc2) mc2.innerHTML = "";

        setTimeout(function () { location.reload(); }, 1500);

      } catch (e) {
        // Restaura backup se a instalação falhou
        try {
          if (_fs.existsSync(backupDir)) {
            _copyDirSync(backupDir, extensionDir);
            if (typeof showToast === "function") {
              showToast("Erro na atualização — backup restaurado: " + e.message);
            }
          }
        } catch (restoreErr) {
          if (typeof showToast === "function") {
            showToast("Erro crítico: " + e.message);
          }
        }
      }
    });
  }

  /**
   * Agenda verificações periódicas de update.
   * Limpa qualquer intervalo anterior para evitar vazamento de memória.
   *
   * @param {number} [intervalMs=7200000] - intervalo em ms (padrão: 2 horas)
   */
  function schedulePeriodicCheck(intervalMs) {
    intervalMs = intervalMs || (2 * 60 * 60 * 1000);
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
    _intervalId = setInterval(function () { check(); }, intervalMs);
  }

  /**
   * Cancela o intervalo periódico.
   * Chamar ao desmontar o painel (boa prática, mesmo que CEP não garanta o evento).
   */
  function destroy() {
    if (_intervalId !== null) {
      clearInterval(_intervalId);
      _intervalId = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Exposição da API pública
  // ---------------------------------------------------------------------------
  return {
    init:                 init,
    check:                check,
    showModal:            showModal,
    dismiss:              dismiss,
    performUpdate:        performUpdate,
    schedulePeriodicCheck: schedulePeriodicCheck,
    destroy:              destroy
  };

})();
