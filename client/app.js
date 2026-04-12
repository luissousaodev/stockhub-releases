// StockHub - CEP Extension for Premiere Pro
var APP_VERSION = "1.1.0";
var cs = new CSInterface();
var fs = require("fs");
var path = require("path");
var child = require("child_process");
var os = require("os");
var isWindows = process.platform === "win32";
var isMac = process.platform === "darwin";

// Estado global de drag — usado para pausar trabalho pesado de ffmpeg
// (geracao de proxy/thumb) enquanto o usuario arrasta um arquivo para
// o Premiere, evitando disputa de CPU/disco.
var isDragging = false;
// Processo ffmpeg ativo gerando proxy de hover (cancelavel ao sair do hover/drag)
var activeProxyProc = null;
// Processos ffmpeg ativos gerando thumbs (worker pool — varios em paralelo)
var activeThumbChildren = [];
// Sinalizador para pausar a fila de geracao de thumbs em background
var thumbQueuePaused = false;

function killActiveProxyProc() {
  if (activeProxyProc) {
    try { activeProxyProc.kill("SIGKILL"); } catch (e) {}
    activeProxyProc = null;
  }
}

function killActiveThumbChildren() {
  for (var i = 0; i < activeThumbChildren.length; i++) {
    try { activeThumbChildren[i].kill("SIGKILL"); } catch (e) {}
  }
  activeThumbChildren = [];
}

// Converte caminho do filesystem para URL file:// valida em Windows e macOS.
// Windows: C:\foo\bar -> file:///C:/foo/bar
// macOS:   /Users/foo -> file:///Users/foo
function toFileURL(p) {
  if (!p) return p;
  var normalized = String(p).replace(/\\/g, "/");
  if (normalized.charAt(0) === "/") {
    // path absoluto unix: remove a barra inicial para nao gerar file:////
    return "file://" + normalized;
  }
  return "file:///" + normalized;
}

// --- Format Groups ---
var FORMAT_GROUPS = {
  video: [".mp4",".mov",".avi",".mxf",".m4v",".wmv",".mkv",".flv",".mpg",".mpeg",".m2v",".m2t",".m2ts",".mts",".ts",".vob",".webm",".3gp",".f4v",".r3d",".braw"],
  audio: [".mp3",".wav",".aac",".aif",".aiff",".ogg",".wma",".flac",".m4a"],
  image: [".jpg",".jpeg",".png",".bmp",".tif",".tiff",".psd",".gif",".dpx",".exr",".tga",".ai",".eps",".svg"],
  mogrt: [".mogrt"]
};

var ALL_EXTENSIONS = [].concat(FORMAT_GROUPS.video, FORMAT_GROUPS.audio, FORMAT_GROUPS.image, FORMAT_GROUPS.mogrt);

// --- State ---
var state = {
  files: [],
  categories: [
    { id: "all", name: "Todos", color: "#0078d4", system: true },
    { id: "overlays", name: "Overlays", color: "#f44747" },
    { id: "transitions", name: "Transicoes", color: "#4ec9b0" },
    { id: "backgrounds", name: "Backgrounds", color: "#ce9178" },
    { id: "lower-thirds", name: "Lower Thirds", color: "#dcdcaa" },
    { id: "icons", name: "Icones", color: "#c586c0" },
    { id: "sfx", name: "SFX/Audio", color: "#569cd6" },
  ],
  activeCategory: "all",
  activeFormat: "all",
  searchQuery: "",
  gridSize: 110,
  showSettings: false,
  fileCategories: {},
  customFolder: null,
  autoCategories: true,
  deletedCategoryIds: [],
  favoriteFiles: {},
  userId: null,
  stagingFolder: null,
  lastSeenVersion: null,
  welcomed: false,
};

// --- Stock Folder ---
function getDefaultStockFolder() {
  var home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, "StockHub");
}

function getStockFolder() {
  return state.customFolder || getDefaultStockFolder();
}

function ensureStockFolder() {
  try {
    var folder = getStockFolder();
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
      ["Videos", "Imagens", "Audio", "Transicoes", "MOGRT"].forEach(function(sub) {
        fs.mkdirSync(path.join(folder, sub), { recursive: true });
      });
    }
    return folder;
  } catch (e) {
    alert("Erro ao criar pasta StockHub: " + e.toString());
    return null;
  }
}

function openStockFolder() {
  try {
    var folder = getStockFolder().replace(/\\/g, "/");
    cs.evalScript('new Folder("' + folder + '").execute()');
  } catch (e) {}
}

function changeStockFolder() {
  if (isWindows) {
    var psFile = path.join(os.tmpdir(), "stockhub_folder_picker.ps1");
    var psContent = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '',
      '$source = @"',
      'using System;',
      'using System.Runtime.InteropServices;',
      'using System.Windows.Forms;',
      '',
      '[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]',
      'class FileOpenDialogRCW {}',
      '',
      '[ComImport, Guid("d57c7288-d4ad-4768-be02-9d969532d960"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
      'interface IFileOpenDialog {',
      '    [PreserveSig] int Show(IntPtr hwndOwner);',
      '    void SetFileTypes(); void SetFileTypeIndex(); void GetFileTypeIndex();',
      '    void Advise(); void Unadvise();',
      '    void SetOptions(uint fos); void GetOptions(out uint pfos);',
      '    void SetDefaultFolder(IShellItem psi); void SetFolder(IShellItem psi);',
      '    void GetFolder(out IShellItem ppsi); void GetCurrentSelection(out IShellItem ppsi);',
      '    void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string pszName);',
      '    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);',
      '    void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string pszTitle);',
      '    void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string pszText);',
      '    void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string pszLabel);',
      '    void GetResult(out IShellItem ppsi);',
      '    void AddPlace(IShellItem psi, int alignment);',
      '    void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);',
      '    void Close(int hr); void SetClientGuid(ref Guid guid);',
      '    void ClearClientData(); void SetFilter(IntPtr pFilter);',
      '}',
      '',
      '[ComImport, Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
      'interface IShellItem {',
      '    void BindToHandler(); void GetParent();',
      '    [PreserveSig] int GetDisplayName(uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);',
      '    void GetAttributes(); void Compare();',
      '}',
      '',
      'public class FolderPicker {',
      '    public static string Show(IntPtr hwnd) {',
      '        var dlg = (IFileOpenDialog)new FileOpenDialogRCW();',
      '        dlg.SetTitle("Selecionar pasta de assets");',
      '        dlg.SetOkButtonLabel("Selecionar pasta");',
      '        uint opts; dlg.GetOptions(out opts);',
      '        dlg.SetOptions(opts | 0x20);',
      '        if (dlg.Show(hwnd) != 0) return "";',
      '        IShellItem item; dlg.GetResult(out item);',
      '        string path; item.GetDisplayName(0x80058000, out path);',
      '        return path;',
      '    }',
      '}',
      '"@',
      '',
      'Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms',
      '',
      '$form = New-Object System.Windows.Forms.Form',
      '$form.TopMost = $true',
      '$form.Width = 0',
      '$form.Height = 0',
      '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
      '$form.Location = New-Object System.Drawing.Point(-1000,-1000)',
      '$form.Show()',
      '$result = [FolderPicker]::Show($form.Handle)',
      '$form.Close()',
      'if ($result) { $result }',
    ].join("\n");
    fs.writeFileSync(psFile, psContent, "utf-8");
    child.exec('powershell -ExecutionPolicy Bypass -File "' + psFile + '"', function(err, stdout, stderr) {
      try { fs.unlinkSync(psFile); } catch(e) {}
      var result = stdout ? stdout.trim() : "";
      if (!err && result) {
        showAutoCategoryModal(result);
      }
    });
  } else {
    var appleScript = "osascript -e 'tell application \"System Events\"' -e 'activate' -e 'set folderPath to POSIX path of (choose folder with prompt \"Selecionar pasta de assets\")' -e 'end tell'";
    child.exec(appleScript, function(err, stdout) {
      var result = stdout ? stdout.trim() : "";
      if (!err && result) {
        showAutoCategoryModal(result);
      }
    });
  }
}

function showAutoCategoryModal(folderPath) {
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal" onclick="event.stopPropagation()">' +
        '<h3>Criar categorias automaticamente?</h3>' +
        '<p style="font-size:11px;color:var(--text-secondary);margin:8px 0 12px;">Subpastas encontradas serao adicionadas como categorias no painel lateral.</p>' +
        '<div class="modal-actions">' +
          '<button class="btn" onclick="applyFolderChange(\'' + folderPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\', false)">Nao criar</button>' +
          '<button class="btn btn-primary" onclick="applyFolderChange(\'' + folderPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + '\', true)">Criar categorias</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function applyFolderChange(folderPath, autoCategories) {
  closeModal();
  // Fechar configs/métricas e voltar para tela de assets
  if (state.showSettings) toggleSettings();
  if (metricsState.visible) toggleMetrics();
  state.customFolder = folderPath;
  state.autoCategories = autoCategories;
  state.categories = state.categories.filter(function(c) { return c.system; });
  state.fileCategories = {};
  state.deletedCategoryIds = [];
  state.activeCategory = "all";
  saveState();
  ensureStockFolder();
  thumbLookupCache = {};
  thumbCache = {};
  resolutionCache = {};
  refreshFiles();
  showToast("Pasta alterada: " + folderPath);
}

function resetStockFolder() {
  if (state.showSettings) toggleSettings();
  if (metricsState.visible) toggleMetrics();
  state.customFolder = null;
  state.categories = state.categories.filter(function(c) { return c.system; });
  state.fileCategories = {};
  state.deletedCategoryIds = [];
  state.activeCategory = "all";
  saveState();
  ensureStockFolder();
  thumbLookupCache = {};
  thumbCache = {};
  resolutionCache = {};
  refreshFiles();
  showToast("Pasta restaurada para padrao: " + getDefaultStockFolder());
}

// --- Storage ---
function getStoragePath() {
  var dataDir = cs.getSystemPath(SystemPath.USER_DATA);
  return path.join(dataDir, "stockhub-data.json");
}

// Migra um dicionario keyed por path absoluto para path relativo a pasta
// de stock. Usado uma unica vez quando o stockhub-data.json esta no formato
// antigo (dataSchemaVersion < 2). Retorna o novo objeto.
function migrateAbsoluteKeysToRelative(dict, stockFolder) {
  if (!dict) return dict;
  var out = {};
  var keys = Object.keys(dict);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    // Detecta path absoluto: "C:\..." no Windows, "/..." no Unix
    var isAbs = (k.length > 2 && k.charAt(1) === ":") || k.charAt(0) === "/" || k.charAt(0) === "\\";
    if (!isAbs) {
      out[k] = dict[k]; // ja esta relativo
      continue;
    }
    try {
      var rel = path.relative(stockFolder, k);
      if (!rel || rel.indexOf("..") === 0) continue; // fora da pasta — descarta
      out[rel.split(path.sep).join("/")] = dict[k];
    } catch (e) {}
  }
  return out;
}

function loadState() {
  try {
    var filePath = getStoragePath();
    if (fs.existsSync(filePath)) {
      var data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (data.categories) state.categories = data.categories;
      if (data.gridSize) state.gridSize = data.gridSize;
      if (data.fileCategories) state.fileCategories = data.fileCategories;
      if (data.customFolder) {
        if (fs.existsSync(data.customFolder)) {
          state.customFolder = data.customFolder;
        } else {
          console.warn("Pasta personalizada nao encontrada, revertendo para padrao:", data.customFolder);
          state.customFolder = null;
        }
      }
      if (data.autoCategories !== undefined) state.autoCategories = data.autoCategories;
      if (data.deletedCategoryIds) state.deletedCategoryIds = data.deletedCategoryIds;
      if (data.userId) state.userId = data.userId;
      if (data.sidebarWidth) state.sidebarWidth = data.sidebarWidth;
      if (data.favoriteFiles) state.favoriteFiles = data.favoriteFiles;
      if (data.stagingFolder) state.stagingFolder = data.stagingFolder;
      if (data.lastSeenVersion) state.lastSeenVersion = data.lastSeenVersion;
      if (data.welcomed) state.welcomed = data.welcomed;
      state.dataSchemaVersion = data.dataSchemaVersion || 1;

      // Migracao one-shot: chaves absolutas -> chaves relativas a pasta de stock.
      // Roda uma unica vez quando o arquivo esta no formato antigo (v1).
      if (state.dataSchemaVersion < 2) {
        var stockFolder = getStockFolder();
        state.fileCategories = migrateAbsoluteKeysToRelative(state.fileCategories, stockFolder);
        state.favoriteFiles = migrateAbsoluteKeysToRelative(state.favoriteFiles, stockFolder);
        state.dataSchemaVersion = 2;
        try { saveState(); } catch (e) {}
        console.log("StockHub: migrado stockhub-data.json para schema v2 (paths relativos)");
      }
    }
  } catch (e) {
    console.log("No saved state:", e);
  }
}

function saveState() {
  try {
    var filePath = getStoragePath();
    var dataDir = path.dirname(filePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify({
      dataSchemaVersion: 2,
      categories: state.categories,
      gridSize: state.gridSize,
      fileCategories: state.fileCategories,
      customFolder: state.customFolder,
      autoCategories: state.autoCategories,
      deletedCategoryIds: state.deletedCategoryIds,
      favoriteFiles: state.favoriteFiles,
      userId: state.userId,
      sidebarWidth: state.sidebarWidth,
      stagingFolder: state.stagingFolder,
      lastSeenVersion: state.lastSeenVersion,
      welcomed: state.welcomed,
    }), "utf-8");
  } catch (e) {
    console.error("Save failed:", e);
  }
}

// --- Changelog ---
var changelogData = null;
function loadChangelog() {
  try {
    var file = path.join(__dirname, "..", "CHANGELOG.json");
    if (fs.existsSync(file)) {
      changelogData = JSON.parse(fs.readFileSync(file, "utf-8"));
    }
  } catch (e) {
    console.error("Failed to load CHANGELOG.json:", e);
  }
}

// --- Semver ---
function compareSemver(a, b) {
  if (!a || !b) return 0;
  var pa = String(a).split(".").map(Number);
  var pb = String(b).split(".").map(Number);
  for (var i = 0; i < 3; i++) {
    var va = pa[i] || 0, vb = pb[i] || 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

// --- Sobre modal ---
function showAboutModal() {
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal about-modal" onclick="event.stopPropagation()">' +
        '<div style="margin-bottom:16px;opacity:0.8;">' +
          '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>' +
          '</svg>' +
        '</div>' +
        '<h3 style="margin:0 0 6px;font-size:18px;">StockHub</h3>' +
        '<p style="color:var(--accent);font-size:12px;font-weight:600;margin:0 0 12px;">v' + APP_VERSION + '</p>' +
        '<p style="font-size:11px;margin:0 0 16px;color:var(--text-secondary);line-height:1.6;">Painel de assets para Adobe Premiere Pro.<br>Centraliza stocks em um unico lugar com preview, categorias e importacao direta.</p>' +
        '<p style="font-size:10px;color:var(--text-muted);margin:0 0 20px;">Desenvolvido por Luis Sousa</p>' +
        '<div style="display:flex;gap:8px;justify-content:center;">' +
          '<button class="btn" onclick="showChangelogModal()" style="flex:1;">Ver changelog</button>' +
          '<button class="btn btn-primary" onclick="closeModal()" style="flex:1;">Fechar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// --- Changelog modal ---
function renderChangelogHTML(versions) {
  var html = '';
  for (var i = 0; i < versions.length; i++) {
    var v = versions[i];
    html += '<div class="changelog-version">' +
      '<h4 style="margin:0 0 6px;color:var(--accent);">v' + v.version + ' <span style="font-weight:400;color:var(--text-muted);font-size:10px;">— ' + v.date + '</span></h4>';
    if (v.changes.added && v.changes.added.length) {
      html += '<div class="changelog-section"><span class="changelog-tag changelog-added">Adicionado</span><ul>';
      for (var a = 0; a < v.changes.added.length; a++) html += '<li>' + v.changes.added[a] + '</li>';
      html += '</ul></div>';
    }
    if (v.changes.fixed && v.changes.fixed.length) {
      html += '<div class="changelog-section"><span class="changelog-tag changelog-fixed">Corrigido</span><ul>';
      for (var f = 0; f < v.changes.fixed.length; f++) html += '<li>' + v.changes.fixed[f] + '</li>';
      html += '</ul></div>';
    }
    if (v.changes.changed && v.changes.changed.length) {
      html += '<div class="changelog-section"><span class="changelog-tag changelog-changed">Alterado</span><ul>';
      for (var c = 0; c < v.changes.changed.length; c++) html += '<li>' + v.changes.changed[c] + '</li>';
      html += '</ul></div>';
    }
    html += '</div>';
  }
  return html;
}

function showChangelogModal() {
  if (!changelogData) loadChangelog();
  var versions = changelogData ? changelogData.versions : [];
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal changelog-modal" onclick="event.stopPropagation()">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/>' +
          '</svg>' +
          '<h3 style="margin:0;font-size:14px;">Changelog</h3>' +
        '</div>' +
        '<div class="changelog-list">' +
          renderChangelogHTML(versions) +
        '</div>' +
        '<div class="modal-actions" style="margin-top:14px;">' +
          '<button class="btn btn-primary" onclick="closeModal()" style="width:100%;">Fechar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}

// --- What's New modal (apos update) ---
function showWhatsNewModal() {
  if (!changelogData) loadChangelog();
  var versions = changelogData ? changelogData.versions : [];
  var newer = [];
  for (var i = 0; i < versions.length; i++) {
    if (compareSemver(versions[i].version, state.lastSeenVersion) > 0) {
      newer.push(versions[i]);
    }
  }
  if (newer.length === 0) return;
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay" onclick="closeWhatsNewModal(event)">' +
      '<div class="modal changelog-modal" onclick="event.stopPropagation()">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>' +
          '</svg>' +
          '<h3 style="margin:0;font-size:14px;">O que ha de novo</h3>' +
        '</div>' +
        '<p style="color:var(--text-muted);font-size:10px;margin:0 0 14px;">StockHub v' + APP_VERSION + '</p>' +
        '<div class="changelog-list">' +
          renderChangelogHTML(newer) +
        '</div>' +
        '<div class="modal-actions" style="margin-top:14px;">' +
          '<button class="btn btn-primary" onclick="closeWhatsNewModal()" style="width:100%;">Entendi</button>' +
        '</div>' +
      '</div>' +
    '</div>';
}
function closeWhatsNewModal(e) {
  if (e && e.target !== e.currentTarget) return;
  state.lastSeenVersion = APP_VERSION;
  saveState();
  document.getElementById("modalContainer").innerHTML = "";
}

// --- Welcome modal (primeira execucao) ---
var welcomeSlides = [
  {
    icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    title: 'Bem-vindo ao StockHub!',
    text: 'Centralize seus assets de stock — videos, imagens, audios e MOGRTs — em um unico painel dentro do Premiere Pro.'
  },
  {
    icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>',
    title: 'Configure sua pasta de assets',
    text: 'Clique no icone de engrenagem e escolha a pasta onde ficam seus stocks. Subpastas viram categorias automaticamente.'
  },
  {
    icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    title: 'Importe e arraste para a timeline',
    text: 'Arraste qualquer asset direto para a timeline do Premiere. Duplo clique insere na posicao do playhead automaticamente.'
  },
  {
    icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#4ec9b0" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    title: 'Tudo pronto!',
    text: 'Voce esta pronto para usar o StockHub. Acesse as configuracoes a qualquer momento pelo icone de engrenagem.'
  }
];

function showWelcomeModal(step) {
  if (step < 0) step = 0;
  if (step >= welcomeSlides.length) { closeWelcomeModal(); return; }
  var s = welcomeSlides[step];
  var dots = '';
  for (var d = 0; d < welcomeSlides.length; d++) {
    dots += '<span class="welcome-dot' + (d === step ? ' active' : '') + '"></span>';
  }
  var prevBtn = step > 0
    ? '<button class="btn" onclick="showWelcomeModal(' + (step - 1) + ')">Anterior</button>'
    : '';
  var nextBtn = step < welcomeSlides.length - 1
    ? '<button class="btn btn-primary" onclick="showWelcomeModal(' + (step + 1) + ')">Proximo</button>'
    : '<button class="btn btn-primary" onclick="closeWelcomeModal()">Comecar</button>';
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay">' +
      '<div class="modal welcome-modal" onclick="event.stopPropagation()" style="max-width:360px;text-align:center;">' +
        '<div class="welcome-slide">' +
          '<div style="margin-bottom:16px;">' + s.icon + '</div>' +
          '<h3 style="margin:0 0 8px;">' + s.title + '</h3>' +
          '<p style="font-size:11px;color:var(--text-secondary);margin:0 0 20px;line-height:1.5;">' + s.text + '</p>' +
        '</div>' +
        '<div class="welcome-dots">' + dots + '</div>' +
        '<div class="modal-actions" style="justify-content:center;gap:8px;margin-top:16px;">' +
          prevBtn + nextBtn +
        '</div>' +
      '</div>' +
    '</div>';
}
function closeWelcomeModal() {
  state.welcomed = true;
  saveState();
  document.getElementById("modalContainer").innerHTML = "";
}

// --- Staging Local ---
function getDefaultStagingFolder() {
  var home = process.env.HOME || process.env.USERPROFILE || "";
  return path.join(home, "StockHub_staging");
}
function getStagingFolder() {
  return state.stagingFolder || getDefaultStagingFolder();
}

function stageFileIfNeeded(file) {
  if (!file || !file.cloudOnly) return file.path;
  var rel = toRelPath(file.path);
  var stagedPath = path.join(getStagingFolder(), rel);
  // Se ja existe com mesmo tamanho, reusar
  try {
    if (fs.existsSync(stagedPath)) {
      var st = fs.statSync(stagedPath);
      if (st.size === file.size && st.size > 0) return stagedPath;
    }
  } catch (e) {}
  // Copiar para staging
  try {
    fs.mkdirSync(path.dirname(stagedPath), { recursive: true });
    fs.copyFileSync(file.path, stagedPath);
    showToast("Asset copiado para staging local");
    return stagedPath;
  } catch (e) {
    console.error("Staging copy failed:", e);
    return file.path; // fallback para path original
  }
}

function getStagedPathIfExists(file) {
  if (!file || !file.cloudOnly) return null;
  var rel = toRelPath(file.path);
  var stagedPath = path.join(getStagingFolder(), rel);
  try {
    if (fs.existsSync(stagedPath)) {
      var st = fs.statSync(stagedPath);
      if (st.size > 0) return stagedPath;
    }
  } catch (e) {}
  return null;
}

function changeStagingFolder() {
  var result = window.cep && window.cep.fs && window.cep.fs.showOpenDialogEx
    ? window.cep.fs.showOpenDialogEx(false, true, "Escolha a pasta de staging", "")
    : null;
  if (result && result.data && result.data.length > 0) {
    state.stagingFolder = result.data[0];
    saveState();
    var el = document.getElementById("stagingFolderPath");
    if (el) el.textContent = state.stagingFolder;
    showToast("Pasta de staging alterada");
  }
}

function getStagingSize() {
  var folder = getStagingFolder();
  var total = 0;
  function walk(dir) {
    try {
      var items = fs.readdirSync(dir);
      for (var i = 0; i < items.length; i++) {
        var full = path.join(dir, items[i]);
        var st = fs.statSync(full);
        if (st.isDirectory()) walk(full);
        else total += st.size;
      }
    } catch (e) {}
  }
  try { if (fs.existsSync(folder)) walk(folder); } catch (e) {}
  if (total < 1024 * 1024) return (total / 1024).toFixed(1) + " KB";
  if (total < 1024 * 1024 * 1024) return (total / (1024 * 1024)).toFixed(1) + " MB";
  return (total / (1024 * 1024 * 1024)).toFixed(1) + " GB";
}

function clearStagingFolder() {
  var folder = getStagingFolder();
  try {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.mkdirSync(folder, { recursive: true });
    var el = document.getElementById("stagingSize");
    if (el) el.textContent = "0 KB";
    showToast("Staging limpo com sucesso");
  } catch (e) {
    showToast("Erro ao limpar staging: " + e.message);
  }
}

// --- Auto-update via Drive ---
function checkForUpdates() {
  try {
    var updateDir = path.join(getStockFolder(), "stockhub-updates");
    var versionFile = path.join(updateDir, "version.json");
    if (!fs.existsSync(versionFile)) return;
    var remote = JSON.parse(fs.readFileSync(versionFile, "utf-8"));
    if (!remote.version) return;
    if (compareSemver(remote.version, APP_VERSION) > 0) {
      showUpdateBanner(remote.version, remote.notes || "");
    }
  } catch (e) {
    // Silencioso se nao encontrar — normal quando nao ha update
  }
}

function showUpdateBanner(version, notes) {
  if (document.getElementById("updateBanner")) return;
  var app = document.getElementById("app");
  if (!app) return;
  var banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.className = "update-banner";
  banner.innerHTML =
    '<div style="flex:1;display:flex;align-items:center;gap:8px;">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' +
      '</svg>' +
      '<span>StockHub <strong>v' + version + '</strong> disponivel' + (notes ? ' — ' + notes : '') + '</span>' +
    '</div>' +
    '<button class="btn" onclick="performUpdate(\'' + version + '\')" style="background:#ffffff22;border:none;color:#fff;font-size:10px;padding:3px 10px;">Atualizar agora</button>' +
    '<span onclick="this.parentElement.remove()" style="cursor:pointer;opacity:0.7;padding:0 4px;font-size:14px;">✕</span>';
  app.insertBefore(banner, app.firstChild);
}

function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  var items = fs.readdirSync(src, { withFileTypes: true });
  for (var i = 0; i < items.length; i++) {
    var s = path.join(src, items[i].name);
    var d = path.join(dest, items[i].name);
    if (items[i].isDirectory()) {
      copyDirSync(s, d);
    } else {
      fs.copyFileSync(s, d);
    }
  }
}

function performUpdate(version) {
  var extensionDir = path.join(__dirname, "..");
  var latestDir = path.join(getStockFolder(), "stockhub-updates", "latest");

  // Verifica permissao de escrita
  try {
    fs.accessSync(extensionDir, fs.constants.W_OK);
  } catch (e) {
    // Sem permissao — mostra instrucoes manuais
    var container = document.getElementById("modalContainer");
    container.innerHTML =
      '<div class="modal-overlay" onclick="closeModal(event)">' +
        '<div class="modal" onclick="event.stopPropagation()" style="max-width:420px;">' +
          '<h3 style="margin:0 0 8px;">Atualizacao manual necessaria</h3>' +
          '<p style="font-size:11px;color:var(--text-secondary);line-height:1.5;">Nao foi possivel atualizar automaticamente (sem permissao de escrita na pasta da extensao).</p>' +
          '<p style="font-size:11px;margin:8px 0;">Copie o conteudo de:</p>' +
          '<p style="font-size:10px;color:var(--green);word-break:break-all;">' + latestDir + '</p>' +
          '<p style="font-size:11px;margin:8px 0;">Para:</p>' +
          '<p style="font-size:10px;color:var(--green);word-break:break-all;">' + extensionDir + '</p>' +
          '<p style="font-size:11px;margin:8px 0;">E recarregue o painel.</p>' +
          '<div class="modal-actions"><button class="btn btn-primary" onclick="closeModal()">Entendi</button></div>' +
        '</div>' +
      '</div>';
    return;
  }

  // Copia todos os arquivos
  try {
    if (!fs.existsSync(latestDir)) {
      showToast("Pasta de atualizacao nao encontrada: " + latestDir);
      return;
    }
    copyDirSync(latestDir, extensionDir);
    showToast("Atualizado para v" + version + "! Recarregando...");
    var banner = document.getElementById("updateBanner");
    if (banner) banner.remove();
    setTimeout(function() { location.reload(); }, 1500);
  } catch (e) {
    showToast("Erro na atualizacao: " + e.message);
  }
}

// --- File Scanning ---
function getFileType(ext) {
  if (FORMAT_GROUPS.video.indexOf(ext) >= 0) return "video";
  if (FORMAT_GROUPS.audio.indexOf(ext) >= 0) return "audio";
  if (FORMAT_GROUPS.image.indexOf(ext) >= 0) return "image";
  if (FORMAT_GROUPS.mogrt.indexOf(ext) >= 0) return "mogrt";
  return null;
}

function scanFolder(folderPath) {
  var files = [];

  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      console.error("Pasta nao encontrada:", folderPath);
      return files;
    }

    function walk(dir, category, depth, parentCatId) {
      var items;
      try {
        items = fs.readdirSync(dir);
      } catch (e) {
        return;
      }

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var fullPath = path.join(dir, item);
        var stat;
        try {
          stat = fs.statSync(fullPath);
        } catch (e) {
          continue;
        }

        if (stat.isDirectory()) {
          if (item.charAt(0) === "." || item === "stockhub-data") continue;
          var catId = item.toLowerCase().replace(/[^a-z0-9]/g, "-");
          if (depth === 1 && parentCatId) catId = parentCatId + "/" + catId;
          if (depth <= 1 && state.autoCategories) {
            var exists = false;
            for (var j = 0; j < state.categories.length; j++) {
              if (state.categories[j].id === catId) { exists = true; break; }
            }
            if (!exists && state.deletedCategoryIds.indexOf(catId) === -1) {
              var catObj = { id: catId, name: item, color: getRandomColor() };
              if (depth === 1) catObj.parent = parentCatId;
              state.categories.push(catObj);
            }
          }
          var nextParent = (depth === 0) ? catId : parentCatId;
          walk(fullPath, catId, depth + 1, nextParent);
        } else {
          var ext = path.extname(item).toLowerCase();
          if (ALL_EXTENSIONS.indexOf(ext) >= 0) {
            // Heuristica de placeholder do Google Drive Stream:
            // - macOS: stat.blocks === 0 para arquivos nao baixados
            // - Windows: cloud files reportam size === 0 ate o download
            // (campo .blocks pode ser undefined no Windows; tratamos como 0)
            var blocks = (typeof stat.blocks === "number") ? stat.blocks : -1;
            var cloudOnly = (blocks === 0) || (stat.size === 0);
            files.push({
              name: item,
              path: fullPath,
              ext: ext.replace(".", ""),
              type: getFileType(ext),
              category: (state.fileCategories && state.fileCategories[toRelPath(fullPath)]) || category || "all",
              size: stat.size,
              modified: stat.mtime,
              cloudOnly: cloudOnly,
            });
          }
        }
      }
    }

    walk(folderPath, null, 0, null);
  } catch (e) {
    console.error("Scan error:", e);
  }
  return files;
}

// --- Filesystem watcher (polling) ---
// fs.watch recursivo nao funciona no macOS, e Drive Desktop tampouco emite
// eventos confiaveis. Substituido por polling: a cada 5s reconstroi um snapshot
// (relPath -> {mtimeMs, size}) e dispara re-scan se houver diff. Polling tem
// custo baixo mesmo em pastas grandes do Drive porque readdir nao baixa nada.
var _watchSnapshot = null;
var _watchTimer = null;
var _watchInterval = null;
var _watchedFolder = null;
var POLL_INTERVAL_MS = 5000;

function buildSnapshot(rootDir) {
  var snap = {};
  function walk(dir) {
    var items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (var i = 0; i < items.length; i++) {
      var d = items[i];
      var name = d.name;
      if (name.charAt(0) === "." || name === "stockhub-data") continue;
      var full = path.join(dir, name);
      if (d.isDirectory()) {
        walk(full);
      } else {
        var ext = path.extname(name).toLowerCase();
        if (ALL_EXTENSIONS.indexOf(ext) < 0) continue;
        try {
          var st = fs.statSync(full);
          var rel = path.relative(rootDir, full).split(path.sep).join("/");
          snap[rel] = { m: st.mtimeMs, s: st.size };
        } catch (e) {}
      }
    }
  }
  walk(rootDir);
  return snap;
}

function snapshotsDiffer(a, b) {
  if (!a || !b) return true;
  var ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return true;
  for (var i = 0; i < ak.length; i++) {
    var k = ak[i];
    if (!b[k]) return true;
    if (a[k].m !== b[k].m || a[k].s !== b[k].s) return true;
  }
  return false;
}

function stopFolderWatcher() {
  if (_watchInterval) {
    clearInterval(_watchInterval);
    _watchInterval = null;
  }
  if (_watchTimer) {
    clearTimeout(_watchTimer);
    _watchTimer = null;
  }
  _watchSnapshot = null;
  _watchedFolder = null;
}

function startFolderWatcher(folder) {
  if (_watchedFolder === folder && _watchInterval) return;
  stopFolderWatcher();
  if (!folder || !fs.existsSync(folder)) return;
  _watchedFolder = folder;
  _watchSnapshot = buildSnapshot(folder);

  function pollOnce() {
    if (_watchedFolder !== folder) return;
    var next;
    try { next = buildSnapshot(folder); } catch (e) { return; }
    if (snapshotsDiffer(_watchSnapshot, next)) {
      _watchSnapshot = next;
      // Reusa o debounce de 400ms para coalescer rajadas de mudancas
      if (_watchTimer) clearTimeout(_watchTimer);
      _watchTimer = setTimeout(function() {
        _watchTimer = null;
        try {
          state.files = scanFolder(folder);
          renderAll();
          var statusEl = document.getElementById("statusText");
          if (statusEl) statusEl.textContent = "Atualizado automaticamente";
        } catch (e) {
          console.error("Auto-refresh error:", e);
        }
      }, 400);
    } else {
      _watchSnapshot = next; // mantem snapshot atualizado
    }
  }

  _watchInterval = setInterval(pollOnce, POLL_INTERVAL_MS);
}

// Para o watcher quando a janela e fechada/recarregada
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", function() { stopFolderWatcher(); });
}

function refreshFiles() {
  var folder = getStockFolder();
  if (state.customFolder && !fs.existsSync(state.customFolder)) {
    var invalidFolder = state.customFolder;
    state.customFolder = null;
    saveState();
    folder = getStockFolder();
    var fp = document.getElementById("stockFolderPath");
    if (fp) fp.textContent = folder;
    showToast("Pasta \"" + invalidFolder + "\" nao encontrada. Revertendo para pasta padrao.");
  }
  state.files = scanFolder(folder);
  renderAll();
  showToast(state.files.length + " arquivos encontrados");
  document.getElementById("statusText").textContent = "Atualizado";
  startFolderWatcher(folder);

  // Pre-generate ffmpeg thumbnails + detect resolutions in background
  if (findFFmpeg()) {
    var queue = [];
    var resQueue = [];
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
      // Pula placeholders do Drive Stream — gerar thumb forcaria download
      if (f.cloudOnly) continue;
      if (f.type === "video") {
        if (!thumbCache[f.path]) queue.push(f);
        if (!resolutionCache[f.path]) resQueue.push(f);
      } else if (f.type === "image" && !resolutionCache[f.path]) {
        resQueue.push(f);
      }
    }

    // Detect resolutions in parallel (lightweight ffprobe calls)
    function processResQueue(idx) {
      if (idx >= resQueue.length) return;
      var rf = resQueue[idx];
      if (rf.type === "image") {
        // Use Image object for image resolution
        var img = new Image();
        img.onload = function() {
          resolutionCache[rf.path] = img.naturalWidth + "x" + img.naturalHeight;
          updateResBadge(rf.path, resolutionCache[rf.path]);
          processResQueue(idx + 1);
        };
        img.onerror = function() { processResQueue(idx + 1); };
        img.src = toFileURL(rf.path);
      } else {
        getVideoResolution(rf.path, function(res) {
          if (res) updateResBadge(rf.path, res);
          processResQueue(idx + 1);
        });
      }
    }

    function updateResBadge(filePath, res) {
      var el = document.querySelector('[data-filepath="' + CSS.escape(filePath) + '"] .res-badge');
      if (el) el.textContent = res;
    }

    // Pool paralelo de geracao de thumbs:
    // - Duas filas: visiveis (prioridade) e o resto
    // - Ate THUMB_CONCURRENCY ffmpegs simultaneos
    // - IntersectionObserver promove cards visiveis para a fila prioritaria
    state.thumbQueueVisible = [];
    state.thumbQueueRest = queue.slice();
    state._thumbTotal = queue.length;
    state._thumbDone = 0;
    pumpThumbPool();
    setupViewportObserver();
    processResQueue(0);
  }
}

// --- Worker pool de thumbs ---
var THUMB_CONCURRENCY = 2;
var thumbPoolActive = 0;

function pumpThumbPool() {
  if (!state.thumbQueueVisible) return;
  // Consome a fila respeitando a pausa de drag e o limite de concorrencia
  while (
    !thumbQueuePaused &&
    thumbPoolActive < THUMB_CONCURRENCY &&
    (state.thumbQueueVisible.length + state.thumbQueueRest.length > 0)
  ) {
    var f = state.thumbQueueVisible.length > 0
      ? state.thumbQueueVisible.shift()
      : state.thumbQueueRest.shift();
    if (!f) break;
    thumbPoolActive++;
    (function(file) {
      generateThumbFFmpeg(file.path, function(url) {
        thumbPoolActive--;
        state._thumbDone = (state._thumbDone || 0) + 1;
        if (url) {
          var el = document.querySelector('[data-filepath="' + CSS.escape(file.path) + '"] .thumbnail, [data-filepath="' + CSS.escape(file.path) + '"] .placeholder');
          if (el) {
            var img = document.createElement("img");
            img.className = "thumbnail";
            img.src = url;
            img.loading = "lazy";
            el.replaceWith(img);
          }
        }
        var statusEl = document.getElementById("statusText");
        var pending = state.thumbQueueVisible.length + state.thumbQueueRest.length + thumbPoolActive;
        if (statusEl) {
          statusEl.textContent = pending > 0
            ? "Gerando thumbs... " + state._thumbDone + "/" + state._thumbTotal
            : "Pronto";
        }
        pumpThumbPool();
      });
    })(f);
  }
  if (thumbQueuePaused && (state.thumbQueueVisible.length + state.thumbQueueRest.length > 0)) {
    var statusEl2 = document.getElementById("statusText");
    if (statusEl2) statusEl2.textContent = "Pausado (drag em andamento)";
  }
}

// IntersectionObserver: promove cards visiveis na viewport para a fila
// prioritaria, fazendo as primeiras telas se popularem antes do resto.
var _thumbIO = null;
function setupViewportObserver() {
  if (_thumbIO) { try { _thumbIO.disconnect(); } catch (e) {} _thumbIO = null; }
  if (typeof IntersectionObserver === "undefined") return;
  var grid = document.getElementById("grid");
  if (!grid) return;
  _thumbIO = new IntersectionObserver(function(entries) {
    var promoted = false;
    for (var i = 0; i < entries.length; i++) {
      if (!entries[i].isIntersecting) continue;
      var rel = entries[i].target.getAttribute("data-rel");
      if (!rel) continue;
      // Procura na fila do "resto" e move para a frente da fila visivel
      for (var j = 0; j < state.thumbQueueRest.length; j++) {
        if (toRelPath(state.thumbQueueRest[j].path) === rel) {
          state.thumbQueueVisible.unshift(state.thumbQueueRest.splice(j, 1)[0]);
          promoted = true;
          break;
        }
      }
    }
    if (promoted) pumpThumbPool();
  }, { root: grid, rootMargin: "200px" });
  var items = grid.querySelectorAll(".grid-item");
  for (var k = 0; k < items.length; k++) _thumbIO.observe(items[k]);
}

// --- Thumbnails (cached, no filesystem hit on re-render) ---
var thumbLookupCache = {};

function getThumbnail(file) {
  if (thumbLookupCache[file.path] !== undefined) return thumbLookupCache[file.path];
  try {
    var dir = path.dirname(file.path);
    var base = path.basename(file.path, path.extname(file.path));
    var thumbExts = [".png", ".jpg", ".jpeg", ".gif"];
    for (var i = 0; i < thumbExts.length; i++) {
      var thumbPath = path.join(dir, base + thumbExts[i]);
      if (fs.existsSync(thumbPath)) {
        var url = toFileURL(thumbPath);
        thumbLookupCache[file.path] = url;
        return url;
      }
      var thumbPath2 = path.join(dir, "thumbs", base + thumbExts[i]);
      if (fs.existsSync(thumbPath2)) {
        var url2 = toFileURL(thumbPath2);
        thumbLookupCache[file.path] = url2;
        return url2;
      }
    }
  } catch (e) {}
  thumbLookupCache[file.path] = null;
  return null;
}

// --- Import ---
function importToProject(fileIndex) {
  var file = state.files[fileIndex];
  if (!file) return;
  var importPath = stageFileIfNeeded(file);
  var escapedPath = importPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  cs.evalScript("importFileToProject('" + escapedPath + "')", function(result) {
    try {
      var res = JSON.parse(result);
      if (res.success && !res.alreadyExists) trackEvent(file, "import");
      showToast(res.success ? (res.alreadyExists ? "Ja no projeto: " + file.name : "Importado: " + file.name) : (res.error || "Erro ao importar"));
    } catch (e) {
      showToast("Erro ao importar");
    }
  });
}

// --- FFmpeg Thumbnail & Proxy ---
var thumbCache = {};
var proxyCache = {};
var resolutionCache = {};
var ffmpegPath = null;
var ffprobePath = null;

function getCacheDir() {
  return path.join(getStockFolder(), ".cache");
}

// Converte um path absoluto para um path relativo a pasta de stock,
// normalizado para barra "/" para que Windows e Mac gerem a mesma chave
// para o mesmo arquivo logico (essencial em pastas compartilhadas via Drive).
// Se o path estiver fora da pasta de stock, retorna o proprio path absoluto.
function toRelPath(absPath) {
  if (!absPath) return absPath;
  try {
    var rel = path.relative(getStockFolder(), absPath);
    if (!rel || rel.indexOf("..") === 0) return absPath;
    return rel.split(path.sep).join("/");
  } catch (e) {
    return absPath;
  }
}

// Hash estavel baseado no caminho RELATIVO a pasta de stock (djb2). Cache files
// gerados com esse hash sao portaveis entre maquinas que compartilham a mesma
// pasta via Google Drive — duas maquinas com a mesma estrutura logica
// produzem o mesmo nome de arquivo de cache.
function hashPath(absPath) {
  var rel = toRelPath(absPath);
  var h = 5381;
  for (var i = 0; i < rel.length; i++) {
    h = ((h << 5) + h + rel.charCodeAt(i)) | 0;
  }
  var base = String(rel).replace(/[^a-zA-Z0-9]/g, "_");
  var tail = base.substring(Math.max(0, base.length - 60));
  return tail + "_" + (h >>> 0).toString(16);
}

function ensureCacheDir() {
  var dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function findFFmpeg() {
  if (ffmpegPath) return ffmpegPath;
  var ffprobeBin = isWindows ? "ffprobe.exe" : "ffprobe";

  // Try system PATH lookup
  try {
    var whichCmd = isWindows ? "where ffmpeg" : "which ffmpeg";
    var result = child.execSync(whichCmd, { timeout: 5000, encoding: "utf-8" });
    var lines = result.trim().split("\n");
    if (lines[0] && fs.existsSync(lines[0].trim())) {
      ffmpegPath = lines[0].trim();
      ffprobePath = path.join(path.dirname(ffmpegPath), ffprobeBin);
      if (!fs.existsSync(ffprobePath)) ffprobePath = null;
      return ffmpegPath;
    }
  } catch (e) {}

  var locations = [];

  if (isWindows) {
    var localAppData = process.env.LOCALAPPDATA || "";
    var userProfile = process.env.USERPROFILE || "";
    locations = [
      "C:\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
      "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
      path.join(localAppData, "ffmpeg", "bin", "ffmpeg.exe"),
      path.join(userProfile, "ffmpeg", "bin", "ffmpeg.exe"),
      path.join(userProfile, "scoop", "shims", "ffmpeg.exe")
    ];

    // Search WinGet packages
    try {
      var wingetPkgs = path.join(localAppData, "Microsoft", "WinGet", "Packages");
      if (fs.existsSync(wingetPkgs)) {
        var pkgDirs = fs.readdirSync(wingetPkgs);
        for (var w = 0; w < pkgDirs.length; w++) {
          if (pkgDirs[w].toLowerCase().indexOf("ffmpeg") >= 0) {
            var pkgDir = path.join(wingetPkgs, pkgDirs[w]);
            var subDirs = fs.readdirSync(pkgDir);
            for (var s = 0; s < subDirs.length; s++) {
              var binPath = path.join(pkgDir, subDirs[s], "bin", "ffmpeg.exe");
              if (fs.existsSync(binPath)) {
                locations.unshift(binPath);
              }
            }
          }
        }
      }
    } catch (e) {}
  } else {
    // macOS / Linux common locations
    locations = [
      "/usr/local/bin/ffmpeg",
      "/opt/homebrew/bin/ffmpeg",
      "/usr/bin/ffmpeg",
      "/opt/local/bin/ffmpeg"
    ];
  }

  for (var i = 0; i < locations.length; i++) {
    if (locations[i] && fs.existsSync(locations[i])) {
      ffmpegPath = locations[i];
      ffprobePath = path.join(path.dirname(ffmpegPath), ffprobeBin);
      if (!fs.existsSync(ffprobePath)) ffprobePath = null;
      return ffmpegPath;
    }
  }

  return null;
}

function getVideoDuration(filePath, callback) {
  if (!ffprobePath) { callback(null); return; }
  child.execFile(ffprobePath, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    filePath
  ], { timeout: 10000 }, function(err, stdout) {
    if (err) { callback(null); return; }
    var dur = parseFloat(stdout);
    callback(isNaN(dur) ? null : dur);
  });
}

function getVideoResolution(filePath, callback) {
  if (resolutionCache[filePath]) { callback(resolutionCache[filePath]); return; }
  if (!ffprobePath) { callback(null); return; }
  child.execFile(ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=s=x:p=0",
    filePath
  ], { timeout: 10000 }, function(err, stdout) {
    if (err || !stdout) { callback(null); return; }
    var parts = stdout.trim().split("x");
    if (parts.length === 2) {
      var res = parts[0] + "x" + parts[1];
      resolutionCache[filePath] = res;
      callback(res);
    } else {
      callback(null);
    }
  });
}

function generateThumbFFmpeg(filePath, callback) {

  var ffmpeg = findFFmpeg();
  if (!ffmpeg) { callback(null); return; }

  var cacheDir = ensureCacheDir();
  var hash = hashPath(filePath);
  var thumbFile = path.join(cacheDir, hash + "_thumb.jpg");

  if (fs.existsSync(thumbFile)) {
    thumbCache[filePath] = toFileURL(thumbFile);
    callback(thumbCache[filePath]);
    return;
  }

  getVideoDuration(filePath, function(duration) {
    var seekTime = duration ? (duration / 2) : 1;
    var proc = child.execFile(ffmpeg, [
      "-ss", String(seekTime),
      "-i", filePath,
      "-vframes", "1",
      "-q:v", "5",
      "-vf", "scale=240:-1",
      "-y",
      thumbFile
    ], { timeout: 15000 }, function(err) {
      // Remove do array de processos ativos do pool
      var idx = activeThumbChildren.indexOf(proc);
      if (idx >= 0) activeThumbChildren.splice(idx, 1);
      if (err || !fs.existsSync(thumbFile)) {
        callback(null);
        return;
      }
      thumbCache[filePath] = toFileURL(thumbFile);
      callback(thumbCache[filePath]);
    });
    activeThumbChildren.push(proc);
  });
}

function generateProxyFFmpeg(filePath, callback) {

  var ffmpeg = findFFmpeg();
  if (!ffmpeg) { callback(null); return; }

  var cacheDir = ensureCacheDir();
  var hash = hashPath(filePath);
  var proxyFile = path.join(cacheDir, hash + "_proxy.mp4");

  if (fs.existsSync(proxyFile)) {
    proxyCache[filePath] = toFileURL(proxyFile);
    callback(proxyCache[filePath]);
    return;
  }

  // Mata qualquer proxy anterior que ainda esteja rodando — so um por vez
  killActiveProxyProc();
  activeProxyProc = child.execFile(ffmpeg, [
    "-i", filePath,
    "-vf", "scale=-2:360",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "30",
    "-an",
    "-movflags", "+faststart",
    "-t", "15",
    "-y",
    proxyFile
  ], { timeout: 60000 }, function(err) {
    activeProxyProc = null;
    if (err || !fs.existsSync(proxyFile)) {
      callback(null);
      return;
    }
    proxyCache[filePath] = toFileURL(proxyFile);
    callback(proxyCache[filePath]);
  });
}

// --- Video Preview on Hover ---
var activePreview = null;
var hoverTimer = null;

function onMouseEnter(el, fileIndex) {
  var file = state.files[fileIndex];
  if (!file || (file.type !== "video" && file.type !== "audio")) return;
  // Para placeholders do Drive: pre-stage em background para que o drag
  // use o path staged, mas nao gera preview de video (evita download pesado do ffmpeg)
  if (file.cloudOnly) {
    setTimeout(function() { stageFileIfNeeded(file); }, 0);
    return;
  }

  // Small delay to avoid triggering on quick mouse passes
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(function() {
    if (!el.matches(":hover")) return;

    if (file.type === "audio") {
      createPreviewAudio(el, toFileURL(file.path));
      return;
    }

    var ext = file.ext.toLowerCase();
    var needsProxy = (ext === "mov" || ext === "mxf" || ext === "avi" || ext === "mkv");

    if (needsProxy) {
      if (proxyCache[file.path]) {
        createPreviewVideo(el, proxyCache[file.path]);
      } else if (findFFmpeg()) {
        generateProxyFFmpeg(file.path, function(proxyUrl) {
          if (proxyUrl && el.matches(":hover")) {
            createPreviewVideo(el, proxyUrl);
          }
        });
      }
    } else {
      createPreviewVideo(el, toFileURL(file.path));
    }
  }, 150);
}

function createPreviewVideo(el, src) {
  // Remove any previous active preview to save memory
  cleanupPreview();
  var video = document.createElement("video");
  video.className = "video-preview";
  video.style.opacity = "0";
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.onerror = function() { video.remove(); activePreview = null; };
  el.appendChild(video);

  // Barra de progresso visual no rodape do card (estilo Premiere/Finder)
  var bar = document.createElement("div");
  bar.className = "scrub-bar";
  var fill = document.createElement("div");
  fill.className = "scrub-bar-fill";
  bar.appendChild(fill);
  el.appendChild(bar);

  activePreview = { el: el, video: video, bar: bar, fill: fill, onMove: null };

  // Scrubbing: mapeia a posicao X do mouse no card para o currentTime do video
  function onMove(ev) {
    if (!video.duration || isNaN(video.duration)) return;
    var rect = el.getBoundingClientRect();
    var x = ev.clientX - rect.left;
    var ratio = Math.max(0, Math.min(1, x / rect.width));
    try { video.currentTime = ratio * video.duration; } catch (e) {}
    fill.style.width = (ratio * 100) + "%";
  }
  activePreview.onMove = onMove;

  // Quando os metadados estao prontos, exibe e ja posiciona conforme o mouse
  video.onloadedmetadata = function() {
    video.onloadedmetadata = null;
    if (!el.matches(":hover")) { cleanupPreview(); return; }
    video.style.opacity = "1";
    el.addEventListener("mousemove", onMove);
    // Posicao inicial: centro do video (sera substituida no primeiro mousemove)
    try { video.currentTime = video.duration / 2; } catch (e) {}
    fill.style.width = "50%";
  };

  video.src = src;
}

function createPreviewAudio(el, src) {
  cleanupPreview();
  var audio = document.createElement("audio");
  audio.preload = "auto";
  audio.loop = true;
  audio.onerror = function() { audio.remove(); activePreview = null; };
  activePreview = { el: el, audio: audio };

  // Visual feedback: add playing indicator
  var indicator = document.createElement("div");
  indicator.className = "audio-playing-indicator";
  indicator.innerHTML =
    '<div class="audio-bar"></div>' +
    '<div class="audio-bar"></div>' +
    '<div class="audio-bar"></div>' +
    '<div class="audio-bar"></div>';
  el.appendChild(indicator);
  activePreview.indicator = indicator;

  audio.oncanplay = function() {
    audio.oncanplay = null;
    if (!el.matches(":hover")) { cleanupPreview(); return; }
    audio.play().catch(function() {});
  };
  audio.src = src;
}

function onMouseLeave(el) {
  clearTimeout(hoverTimer);
  cleanupPreview();
  // Cancela transcode de proxy iniciado por hover que ainda esteja rodando
  killActiveProxyProc();
}

function cleanupPreview() {
  if (activePreview) {
    var media = activePreview.video || activePreview.audio;
    media.pause();
    media.removeAttribute("src");
    media.load();
    media.remove();
    if (activePreview.indicator) activePreview.indicator.remove();
    if (activePreview.bar) activePreview.bar.remove();
    if (activePreview.onMove && activePreview.el) {
      activePreview.el.removeEventListener("mousemove", activePreview.onMove);
    }
    activePreview = null;
  }
}

// --- Drag (categorize internamente + drop nativo na timeline do Premiere) ---
function onFileDragStart(e, fileIndex) {
  var file = state.files[fileIndex];
  // Libera CPU/disco para o Premiere durante o drag: mata proxy em andamento,
  // mata todos os ffmpeg de thumbs do pool, pausa a fila e marca drag.
  isDragging = true;
  thumbQueuePaused = true;
  killActiveProxyProc();
  killActiveThumbChildren();
  cleanupPreview();
  // Para drop interno (categorias) — usa o indice
  e.dataTransfer.setData("text/plain", String(fileIndex));
  e.dataTransfer.effectAllowed = "copyMove";

  if (file && file.path) {
    // Usa path staged se disponivel (nao copia no drag — ja foi staged no hover)
    var dragPath = getStagedPathIfExists(file) || file.path;
    // MIME oficial do CEP para drop nativo em apps Adobe (Premiere/AE/etc).
    // O Premiere aceita ate 9 arquivos via .file.0 ... .file.8
    try { e.dataTransfer.setData("com.adobe.cep.dnd.file.0", dragPath); } catch (err) {}
    // Fallback URI para outros alvos
    try {
      var uri = toFileURL(dragPath).replace(/ /g, "%20");
      e.dataTransfer.setData("text/uri-list", uri);
    } catch (err2) {}
  }

  var item = e.target.closest && e.target.closest(".grid-item");
  if (item) item.classList.add("dragging");

  // Suprime o preview visual (drag image) que o Premiere renderiza na timeline
  // durante o arrasto. Usamos uma imagem 1x1 transparente como drag image.
  try {
    if (e.dataTransfer.setDragImage) {
      if (!window.__emptyDragImage) {
        var img = new Image();
        img.src =
          "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        window.__emptyDragImage = img;
      }
      e.dataTransfer.setDragImage(window.__emptyDragImage, 0, 0);
    }
  } catch (errImg) {}
}

function onFileDragEnd(e, fileIndex) {
  var el = e.target.closest(".grid-item");
  if (el) el.classList.remove("dragging");
  var cats = document.querySelectorAll(".cat-item");
  for (var i = 0; i < cats.length; i++) cats[i].classList.remove("drag-over");

  // Move o arquivo da raiz para a bin StockHub (o drop nativo do Premiere
  // importa na raiz — precisamos mover para manter organizado)
  var file = state.files[fileIndex];
  if (file && file.path) {
    var dragPath = getStagedPathIfExists(file) || file.path;
    var escaped = dragPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    setTimeout(function() {
      cs.evalScript("moveFileToStockHubBin('" + escaped + "')");
    }, 500);
  }

  // Libera a fila de thumbs apos um pequeno delay para o Premiere terminar
  // de ler o arquivo recem-droppado antes de voltarmos a usar disco/CPU.
  isDragging = false;
  setTimeout(function() {
    thumbQueuePaused = false;
    pumpThumbPool();
  }, 800);
}

function onCatDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  e.currentTarget.classList.add("drag-over");
}

function onCatDragLeave(e) {
  e.currentTarget.classList.remove("drag-over");
}

function onCatDrop(e, catId) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  var fileIndex = parseInt(e.dataTransfer.getData("text/plain"));
  var file = state.files[fileIndex];
  if (!file) return;
  file.category = catId;
  if (!state.fileCategories) state.fileCategories = {};
  state.fileCategories[toRelPath(file.path)] = catId;
  saveState();
  renderAll();
  var catName = "";
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId) { catName = state.categories[i].name; break; }
  }
  showToast("Movido para: " + catName);
}

function onFavoritesDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove("drag-over");
  var fileIndex = parseInt(e.dataTransfer.getData("text/plain"));
  var file = state.files[fileIndex];
  if (!file) return;
  if (!state.favoriteFiles) state.favoriteFiles = {};
  state.favoriteFiles[toRelPath(file.path)] = true;
  saveState();
  renderAll();
  showToast("Adicionado aos favoritos: " + file.name);
}

function onDoubleClick(fileIndex) {
  var file = state.files[fileIndex];
  if (!file) return;
  var importPath = stageFileIfNeeded(file);
  var escapedPath = importPath.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  cs.evalScript("importFileToTimeline('" + escapedPath + "')", function(result) {
    try {
      var res = JSON.parse(result);
      if (res.success) trackEvent(file, "timeline");
      showToast(res.success ? "Inserido na timeline: " + file.name : (res.error || "Erro ao inserir"));
    } catch (e) {
      showToast("Erro ao inserir na timeline");
    }
  });
}

// --- Filtering ---
function getFilteredFiles() {
  return state.files.filter(function(f) {
    if (state.activeFormat !== "all" && f.type !== state.activeFormat) return false;
    if (state.activeCategory === "__favorites") {
      if (!state.favoriteFiles || !state.favoriteFiles[toRelPath(f.path)]) return false;
    } else if (state.activeCategory !== "all") {
      if (f.category !== state.activeCategory) {
        if (f.category && f.category.indexOf(state.activeCategory + "/") === 0) {
          // match — subcategoria do pai ativo
        } else {
          return false;
        }
      }
    }
    if (state.searchQuery) {
      return f.name.toLowerCase().indexOf(state.searchQuery.toLowerCase()) >= 0;
    }
    return true;
  });
}

// --- UI Actions ---
function setFormat(format, btn) {
  if (state.showSettings) toggleSettings();
  if (metricsState.visible) toggleMetrics();
  state.activeFormat = format;
  var tabs = document.querySelectorAll("#formatTabs .tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
  btn.classList.add("active");
  renderGrid();
}

function setCategory(catId) {
  state.activeCategory = catId;
  // Auto-expand parent when selecting it or a subcategory
  var cat = null;
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId) { cat = state.categories[i]; break; }
  }
  if (cat && !cat.parent && !cat.system) {
    state.expandedCategories[catId] = true;
  } else if (cat && cat.parent) {
    state.expandedCategories[cat.parent] = true;
  }
  renderCategories();
  renderGrid();
}

var searchTimer = null;
function filterFiles() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function() {
    state.searchQuery = document.getElementById("searchInput").value;
    renderGrid();
  }, 200);
}

function toggleSettings() {
  state.showSettings = !state.showSettings;
  var settingsPanel = document.getElementById("settingsPanel");
  var sidebar = document.getElementById("sidebar");
  var gridContainer = document.getElementById("gridContainer");
  var settingsBtn = document.getElementById("settingsBtn");
  var gridSlider = document.getElementById("gridSliderBar");

  if (state.showSettings) {
    if (metricsState.visible) toggleMetrics();
    settingsPanel.style.display = "flex";
    sidebar.style.display = "none";
    gridContainer.style.display = "none";
    if (gridSlider) gridSlider.style.display = "none";
    settingsBtn.style.color = "var(--accent)";
    var fp = document.getElementById("stockFolderPath");
    if (fp) fp.textContent = getStockFolder();
    var sfp = document.getElementById("stagingFolderPath");
    if (sfp) sfp.textContent = getStagingFolder();
    var ss = document.getElementById("stagingSize");
    if (ss) ss.textContent = getStagingSize();
    renderCatEditList();
  } else {
    settingsPanel.style.display = "none";
    sidebar.style.display = "flex";
    gridContainer.style.display = "block";
    if (gridSlider) gridSlider.style.display = "flex";
    settingsBtn.style.color = "";
  }
}

function saveSettings() {
  saveState();
  toggleSettings();
  refreshFiles();
}

function updateGridSize() {
  state.gridSize = parseInt(document.getElementById("gridSize").value);
  document.getElementById("fileGrid").style.gridTemplateColumns =
    "repeat(auto-fill, minmax(" + state.gridSize + "px, 1fr))";
  saveState();
}

// --- Categories ---
function getRandomColor() {
  var colors = ["#f44747","#4ec9b0","#ce9178","#dcdcaa","#c586c0","#569cd6","#d7ba7d","#9cdcfe"];
  return colors[Math.floor(Math.random() * colors.length)];
}

function showAddCategoryModal() {
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal" onclick="event.stopPropagation()">' +
        '<h3>Nova Categoria</h3>' +
        '<input type="text" id="newCatName" placeholder="Nome da categoria" autofocus onkeydown="if(event.key===\'Enter\')addCategory()">' +
        '<div class="modal-actions">' +
          '<button class="btn" onclick="closeModal()">Cancelar</button>' +
          '<button class="btn btn-primary" onclick="addCategory()">Criar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  setTimeout(function() { document.getElementById("newCatName").focus(); }, 100);
}

function addCategory() {
  var name = document.getElementById("newCatName").value.trim();
  if (!name) return;
  var id = name.toLowerCase().replace(/[^a-z0-9]/g, "-");
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === id) {
      showToast("Categoria ja existe");
      return;
    }
  }
  state.categories.push({ id: id, name: name, color: getRandomColor() });
  state.deletedCategoryIds = state.deletedCategoryIds.filter(function(d) { return d !== id; });
  saveState();
  closeModal();
  renderCategories();
  if (state.showSettings) renderCatEditList();
  showToast("Categoria criada: " + name);
}

function removeCategory(catId) {
  var existing = document.getElementById("catCtxMenu");
  if (existing) existing.remove();
  // Remove category and its subcategories
  state.categories = state.categories.filter(function(c) {
    if (c.system) return true;
    if (c.id === catId) return false;
    if (c.parent === catId) return false;
    return true;
  });
  if (state.activeCategory === catId || state.activeCategory.indexOf(catId + "/") === 0) state.activeCategory = "all";
  if (state.deletedCategoryIds.indexOf(catId) === -1) state.deletedCategoryIds.push(catId);
  saveState();
  renderCategories();
  renderGrid();
  if (state.showSettings) renderCatEditList();
}

function renameCategory(catId, newName) {
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId && !state.categories[i].system) {
      state.categories[i].name = newName;
      saveState();
      renderCategories();
      break;
    }
  }
}

function cycleCatColor(catId) {
  var colors = ["#f44747","#4ec9b0","#ce9178","#dcdcaa","#c586c0","#569cd6","#d7ba7d","#9cdcfe","#0078d4","#b5cea8"];
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId) {
      var idx = colors.indexOf(state.categories[i].color);
      state.categories[i].color = colors[(idx + 1) % colors.length];
      saveState();
      renderCatEditList();
      renderCategories();
      break;
    }
  }
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById("modalContainer").innerHTML = "";
}

function toggleFileFavorite(filePath) {
  if (!state.favoriteFiles) state.favoriteFiles = {};
  var key = toRelPath(filePath);
  if (state.favoriteFiles[key]) {
    delete state.favoriteFiles[key];
    showToast("Removido dos favoritos");
  } else {
    state.favoriteFiles[key] = true;
    showToast("Adicionado aos favoritos");
  }
  saveState();
  renderCategories();
  renderGrid();
}

// --- Context Menu ---
function showContextMenu(e, fileIndex) {
  e.preventDefault();
  var file = state.files[fileIndex];
  if (!file) return;
  var existing = document.getElementById("contextMenu");
  if (existing) existing.remove();

  var menu = document.createElement("div");
  menu.id = "contextMenu";
  menu.style.cssText =
    "position:fixed;left:" + e.clientX + "px;top:" + e.clientY + "px;" +
    "background:var(--bg-secondary);border:1px solid var(--border);" +
    "border-radius:var(--radius);padding:4px 0;min-width:160px;" +
    "z-index:999;box-shadow:0 4px 12px #00000066;";

  // Favorite toggle
  var isFav = state.favoriteFiles && state.favoriteFiles[toRelPath(file.path)];
  var favItem = document.createElement("div");
  favItem.style.cssText = "padding:5px 12px;font-size:11px;cursor:pointer;color:" + (isFav ? "#e8a634" : "var(--text-primary)") + ";display:flex;align-items:center;gap:8px;";
  favItem.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="' + (isFav ? "#e8a634" : "none") + '" stroke="#e8a634" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' +
    '</svg>' +
    (isFav ? "Remover dos favoritos" : "Adicionar aos favoritos");
  favItem.onmouseover = function() { favItem.style.background = "var(--bg-hover)"; };
  favItem.onmouseout = function() { favItem.style.background = "transparent"; };
  favItem.onclick = function() {
    toggleFileFavorite(file.path);
    menu.remove();
  };
  menu.appendChild(favItem);

  // Divider
  var divider = document.createElement("div");
  divider.style.cssText = "height:1px;background:var(--border);margin:4px 8px;";
  menu.appendChild(divider);

  var header = document.createElement("div");
  header.style.cssText = "padding:6px 12px;font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.3px;flex-shrink:0;";
  header.textContent = "Mover para categoria";
  menu.appendChild(header);

  var catList = document.createElement("div");
  catList.style.cssText = "overflow-y:auto;flex:1;min-height:0;";

  state.categories.forEach(function(cat) {
    var isSub = !!cat.parent;
    var item = document.createElement("div");
    item.style.cssText =
      "padding:5px " + (isSub ? "12px 5px 24px" : "12px") + ";font-size:" + (isSub ? "10" : "11") + "px;cursor:pointer;" +
      "color:" + (file.category === cat.id ? "var(--accent)" : "var(--text-primary)") + ";" +
      (isSub ? "opacity:0.8;" : "") +
      "display:flex;align-items:center;gap:6px;";
    item.innerHTML = (isSub ? '&nbsp;&nbsp;' : '') + cat.name;
    item.onmouseover = function() { item.style.background = "var(--bg-hover)"; };
    item.onmouseout = function() { item.style.background = "transparent"; };
    item.onclick = function() {
      file.category = cat.id;
      if (!state.fileCategories) state.fileCategories = {};
      state.fileCategories[toRelPath(file.path)] = cat.id;
      saveState();
      renderGrid();
      menu.remove();
      showToast("Movido para: " + cat.name);
    };
    catList.appendChild(item);
  });
  menu.appendChild(catList);

  document.body.appendChild(menu);

  // Ajustar posição e tamanho máximo dentro da janela
  var sliderBar = document.getElementById("gridSliderBar");
  var bottomLimit = sliderBar ? sliderBar.getBoundingClientRect().top : window.innerHeight;
  var maxHeight = bottomLimit - e.clientY - 8;
  if (maxHeight < 150) {
    // Se pouco espaço abaixo, abrir para cima
    var topSpace = e.clientY - 8;
    menu.style.top = "";
    menu.style.bottom = (window.innerHeight - e.clientY) + "px";
    maxHeight = topSpace;
  }
  menu.style.maxHeight = Math.min(maxHeight, 400) + "px";
  menu.style.display = "flex";
  menu.style.flexDirection = "column";

  var rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + "px";

  var closeCtx = function() { menu.remove(); document.removeEventListener("click", closeCtx); };
  setTimeout(function() { document.addEventListener("click", closeCtx); }, 10);
}

// --- Render ---
if (!state.expandedCategories) state.expandedCategories = {};

function getCatFileCount(catId, isSystem) {
  if (isSystem) return state.files.length;
  return state.files.filter(function(f) {
    return f.category === catId || (f.category && f.category.indexOf(catId + "/") === 0);
  }).length;
}

function toggleCategoryExpand(catId, e) {
  e.stopPropagation();
  state.expandedCategories[catId] = !state.expandedCategories[catId];
  renderCategories();
}

function renderCatItem(cat, isSub, childrenMap) {
  var children = childrenMap[cat.id] || [];
  var hasChildren = children.length > 0;
  var isExpanded = state.expandedCategories[cat.id];
  var count = isSub
    ? state.files.filter(function(f) { return f.category === cat.id; }).length
    : getCatFileCount(cat.id, cat.system);

  var arrow = '';
  if (hasChildren && !cat.system) {
    arrow = '<span class="cat-arrow ' + (isExpanded ? "expanded" : "") + '" ' +
      'onclick="toggleCategoryExpand(\'' + cat.id + '\', event)">' +
      '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="9 18 15 12 9 6"/>' +
      '</svg></span>';
  }

  var ctxMenu = cat.system ? '' : 'oncontextmenu="showCatContextMenu(event, \'' + cat.id + '\')"';

  var isActive = state.activeCategory === cat.id;
  var isParentActive = !isActive && typeof state.activeCategory === "string" &&
    state.activeCategory.indexOf(cat.id + "/") === 0;
  var stateClass = isActive ? "active" : (isParentActive ? "parent-active" : "");
  var html = '<div class="cat-item ' + (isSub ? "cat-sub " : "") + stateClass + '" ' +
    'onclick="setCategory(\'' + cat.id + '\')" ' +
    ctxMenu + ' ' +
    'ondragover="onCatDragOver(event)" ' +
    'ondragleave="onCatDragLeave(event)" ' +
    'ondrop="onCatDrop(event, \'' + cat.id + '\')">' +
    '<span style="display:flex;align-items:center;gap:6px;overflow:hidden;">' +
      arrow +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + cat.name + '</span>' +
    '</span>' +
    '<span class="cat-count">' + count + '</span>' +
  '</div>';

  // Subcategories wrapped in a group container with vertical line
  if (hasChildren && isExpanded) {
    html += '<div class="cat-sub-group">';
    for (var c = 0; c < children.length; c++) {
      html += renderCatItem(children[c], true, childrenMap);
    }
    html += '</div>';
  }

  return html;
}

function getFavoriteCount() {
  if (!state.favoriteFiles) return 0;
  var count = 0;
  for (var i = 0; i < state.files.length; i++) {
    if (state.favoriteFiles[toRelPath(state.files[i].path)]) count++;
  }
  return count;
}

function renderCategories() {
  var list = document.getElementById("categoryList");
  var html = "";

  // Favorites (files) section — always on top
  var favCount = getFavoriteCount();
  html += '<div class="cat-item ' + (state.activeCategory === "__favorites" ? "active" : "") + '" ' +
    'onclick="setCategory(\'__favorites\')" ' +
    'ondragover="onCatDragOver(event)" ' +
    'ondragleave="onCatDragLeave(event)" ' +
    'ondrop="onFavoritesDrop(event)">' +
    '<span style="display:flex;align-items:center;gap:6px;overflow:hidden;">' +
      '<svg width="11" height="11" viewBox="0 0 24 24" fill="' + (state.activeCategory === "__favorites" ? "#e8a634" : "none") + '" stroke="#e8a634" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' +
      '</svg>' +
      '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Favoritos</span>' +
    '</span>' +
    '<span class="cat-count">' + favCount + '</span>' +
  '</div>';

  html += '<div class="cat-divider"></div>';

  // Separate: system, parents, subcategories
  var systemCats = [];
  var normalCats = [];
  var childrenMap = {};

  for (var i = 0; i < state.categories.length; i++) {
    var cat = state.categories[i];
    if (cat.parent) {
      if (!childrenMap[cat.parent]) childrenMap[cat.parent] = [];
      childrenMap[cat.parent].push(cat);
    } else if (cat.system) {
      systemCats.push(cat);
    } else {
      normalCats.push(cat);
    }
  }

  // System categories (Todos)
  for (var s = 0; s < systemCats.length; s++) {
    html += renderCatItem(systemCats[s], false, childrenMap);
  }

  // Normal categories
  if (normalCats.length > 0) {
    html += '<div class="cat-divider"></div>';
    for (var n = 0; n < normalCats.length; n++) {
      html += renderCatItem(normalCats[n], false, childrenMap);
    }
  }

  list.innerHTML = html;
}

// --- Category Context Menu ---
function showCatContextMenu(e, catId) {
  e.preventDefault();
  e.stopPropagation();
  var existing = document.getElementById("catCtxMenu");
  if (existing) existing.remove();

  var cat = null;
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId) { cat = state.categories[i]; break; }
  }
  if (!cat || cat.system) return;

  var menu = document.createElement("div");
  menu.id = "catCtxMenu";
  menu.className = "cat-ctx-menu";
  menu.style.left = e.clientX + "px";
  menu.style.top = e.clientY + "px";

  menu.innerHTML =
    '<div class="cat-ctx-item" onclick="showRenameCategoryModal(\'' + catId + '\')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>' +
        '<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
      '</svg>' +
      'Renomear' +
    '</div>' +
    '<div class="cat-ctx-item danger" onclick="removeCategory(\'' + catId + '\')">' +
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>' +
      '</svg>' +
      'Excluir' +
    '</div>';

  document.body.appendChild(menu);

  // Adjust position if menu goes off screen
  var rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + "px";
  if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + "px";

  var closeFn = function() {
    menu.remove();
    document.removeEventListener("click", closeFn);
  };
  setTimeout(function() { document.addEventListener("click", closeFn); }, 10);
}

function showRenameCategoryModal(catId) {
  var existing = document.getElementById("catCtxMenu");
  if (existing) existing.remove();
  var cat = null;
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId) { cat = state.categories[i]; break; }
  }
  if (!cat) return;
  var container = document.getElementById("modalContainer");
  container.innerHTML =
    '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal" onclick="event.stopPropagation()">' +
        '<h3>Renomear Categoria</h3>' +
        '<input type="text" id="renameCatInput" value="' + cat.name.replace(/"/g, '&quot;') + '" autofocus onkeydown="if(event.key===\'Enter\'){renameCategory(\'' + catId + '\',this.value);closeModal()}">' +
        '<div class="modal-actions">' +
          '<button class="btn" onclick="closeModal()">Cancelar</button>' +
          '<button class="btn btn-primary" onclick="renameCategory(\'' + catId + '\',document.getElementById(\'renameCatInput\').value);closeModal()">Salvar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  setTimeout(function() { var inp = document.getElementById("renameCatInput"); inp.focus(); inp.select(); }, 100);
}

// --- Sidebar Resize ---
function initSidebarResize() {
  var handle = document.getElementById("sidebarResizeHandle");
  var sidebar = document.getElementById("sidebar");
  if (!handle || !sidebar) return;

  var dragging = false;
  var startX, startWidth;

  handle.addEventListener("mousedown", function(e) {
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startWidth = sidebar.offsetWidth;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });

  document.addEventListener("mousemove", function(e) {
    if (!dragging) return;
    var newWidth = startWidth + (e.clientX - startX);
    if (newWidth >= 100 && newWidth <= 280) {
      sidebar.style.width = newWidth + "px";
    }
  });

  document.addEventListener("mouseup", function() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    state.sidebarWidth = sidebar.offsetWidth;
    saveState();
  });
}

function renderGrid() {
  var grid = document.getElementById("fileGrid");
  var files = getFilteredFiles();

  // Cleanup any active preview
  cleanupPreview();

  document.getElementById("fileCount").textContent = files.length + " arquivos";

  if (files.length === 0) {
    grid.innerHTML = "";
    var container = document.getElementById("gridContainer");
    var emptyEl = container.querySelector(".empty-state");
    if (!emptyEl) {
      emptyEl = document.createElement("div");
      emptyEl.className = "empty-state";
      container.appendChild(emptyEl);
    }

    if (state.files.length === 0) {
      var folder = getStockFolder();
      emptyEl.innerHTML =
        '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>' +
        '</svg>' +
        '<h3>Nenhum arquivo encontrado</h3>' +
        '<p>Coloque seus stocks na pasta:</p>' +
        '<p style="color:var(--green);font-size:10px;word-break:break-all;">' + folder + '</p>' +
        '<button class="btn btn-primary" onclick="openStockFolder()">Abrir pasta</button>';
    } else {
      emptyEl.innerHTML =
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
        '</svg>' +
        '<h3>Nenhum arquivo encontrado</h3>' +
        '<p>Tente ajustar os filtros ou busca.</p>';
    }
    emptyEl.style.display = "flex";
    return;
  }

  var emptyEl2 = document.getElementById("gridContainer").querySelector(".empty-state");
  if (emptyEl2) emptyEl2.style.display = "none";

  grid.style.gridTemplateColumns = "repeat(auto-fill, minmax(" + state.gridSize + "px, 1fr))";

  // Build index for fast lookup
  var fileIndexMap = {};
  for (var m = 0; m < state.files.length; m++) {
    fileIndexMap[state.files[m].path] = m;
  }

  grid.innerHTML = files.map(function(f) {
    var thumb = getThumbnail(f);
    var idx = fileIndexMap[f.path];
    var badgeClass = "badge-" + (f.type || "video");
    var res = resolutionCache[f.path] || "";

    // Determine thumbnail content - prefer cached images over <video> elements
    var thumbContent;
    if (thumb) {
      thumbContent = '<img class="thumbnail" src="' + thumb + '" loading="lazy" />';
    } else if (f.type === "video" && thumbCache[f.path]) {
      thumbContent = '<img class="thumbnail" src="' + thumbCache[f.path] + '" loading="lazy" />';
    } else if (f.type === "image") {
      thumbContent = '<img class="thumbnail" src="' + toFileURL(f.path) + '" loading="lazy" />';
    } else {
      // Lightweight placeholder - NO <video> elements in grid
      var iconSvg;
      if (f.type === "audio") {
        iconSvg = '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>';
      } else {
        iconSvg = '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>';
      }
      thumbContent = '<div class="placeholder">' +
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
              iconSvg +
            '</svg>' +
            '<span style="font-size:9px;">' + f.ext.toUpperCase() + '</span>' +
          '</div>';
    }

    var cloudBadge = f.cloudOnly
      ? '<span class="cloud-badge" title="Arquivo na nuvem (nao baixado)">' +
          '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>' +
          '</svg>' +
        '</span>'
      : '';

    return '<div class="grid-item' + (f.cloudOnly ? ' cloud-only' : '') + '" ' +
      'data-filepath="' + f.path.replace(/"/g, '&quot;') + '" ' +
      'data-rel="' + toRelPath(f.path).replace(/"/g, '&quot;') + '" ' +
      'draggable="true" ' +
      'ondragstart="onFileDragStart(event, ' + idx + ')" ' +
      'ondragend="onFileDragEnd(event, ' + idx + ')" ' +
      'ondblclick="onDoubleClick(' + idx + ')" ' +
      'oncontextmenu="showContextMenu(event, ' + idx + ')" ' +
      'onmouseenter="onMouseEnter(this, ' + idx + ')" ' +
      'onmouseleave="onMouseLeave(this)" ' +
      'title="' + f.name + (f.cloudOnly ? " (na nuvem)" : "") + '">' +
      thumbContent +
      cloudBadge +
      '<span class="file-badge ' + badgeClass + '">' + f.ext + '</span>' +
      '<span class="res-badge">' + res + '</span>' +
      '<button class="import-btn" onclick="event.stopPropagation(); importToProject(' + idx + ')" title="Importar no projeto">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
          '<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>' +
        '</svg>' +
      '</button>' +
      '<span class="file-name">' + f.name.replace(/\.[^.]+$/, "") + '</span>' +
    '</div>';
  }).join("");

  // Reconfigura o IntersectionObserver apos cada render para que cards
  // visiveis sejam priorizados na fila de geracao de thumbs
  if (typeof setupViewportObserver === "function") setupViewportObserver();
}

var selectedCategories = {};

function renderCatEditList() {
  var list = document.getElementById("catEditList");
  var nonSystem = state.categories.filter(function(c) { return !c.system; });
  // Sort: parents first, then children grouped under parent
  var parents = nonSystem.filter(function(c) { return !c.parent; });
  var html = "";
  for (var p = 0; p < parents.length; p++) {
    var cat = parents[p];
    var checked = selectedCategories[cat.id] ? "checked" : "";
    html += '<div class="cat-edit-row">' +
      '<input type="checkbox" class="cat-checkbox" data-catid="' + cat.id + '" ' + checked + ' onchange="toggleCatSelection(\'' + cat.id + '\', this.checked)">' +
      '<input value="' + cat.name + '" onblur="renameCategory(\'' + cat.id + '\', this.value)" onkeydown="if(event.key===\'Enter\')this.blur()">' +
    '</div>';
    // Children of this parent
    var children = nonSystem.filter(function(c) { return c.parent === cat.id; });
    for (var c = 0; c < children.length; c++) {
      var sub = children[c];
      var subChecked = selectedCategories[sub.id] ? "checked" : "";
      html += '<div class="cat-edit-row" style="padding-left:20px;opacity:0.8;">' +
        '<input type="checkbox" class="cat-checkbox" data-catid="' + sub.id + '" ' + subChecked + ' onchange="toggleCatSelection(\'' + sub.id + '\', this.checked)">' +
        '<input value="' + sub.name + '" onblur="renameCategory(\'' + sub.id + '\', this.value)" onkeydown="if(event.key===\'Enter\')this.blur()" style="font-size:10px;">' +
      '</div>';
    }
  }
  list.innerHTML = html;
  updateSelectAllBtn();
}

function toggleCatSelection(catId, checked) {
  if (checked) {
    selectedCategories[catId] = true;
  } else {
    delete selectedCategories[catId];
  }
  updateSelectAllBtn();
}

function toggleSelectAllCategories() {
  var nonSystem = state.categories.filter(function(c) { return !c.system; });
  var allSelected = nonSystem.length > 0 && nonSystem.every(function(c) { return selectedCategories[c.id]; });
  if (allSelected) {
    selectedCategories = {};
  } else {
    selectedCategories = {};
    nonSystem.forEach(function(c) { selectedCategories[c.id] = true; });
  }
  renderCatEditList();
}

function updateSelectAllBtn() {
  var btn = document.getElementById("selectAllCatsBtn");
  if (!btn) return;
  var nonSystem = state.categories.filter(function(c) { return !c.system; });
  var allSelected = nonSystem.length > 0 && nonSystem.every(function(c) { return selectedCategories[c.id]; });
  btn.querySelector("svg").style.opacity = allSelected ? "1" : "0.5";
}

function removeSelectedCategories() {
  var ids = Object.keys(selectedCategories);
  if (ids.length === 0) {
    showToast("Nenhuma categoria selecionada");
    return;
  }
  ids.forEach(function(id) {
    if (state.deletedCategoryIds.indexOf(id) === -1) state.deletedCategoryIds.push(id);
  });
  state.categories = state.categories.filter(function(c) {
    return c.system || !selectedCategories[c.id];
  });
  if (selectedCategories[state.activeCategory]) {
    state.activeCategory = "all";
  }
  selectedCategories = {};
  saveState();
  renderCategories();
  renderGrid();
  renderCatEditList();
  showToast(ids.length + " categoria(s) removida(s)");
}

function renderAll() {
  renderCategories();
  renderGrid();
}

// --- Toast ---
function showToast(msg) {
  var existing = document.querySelector(".toast");
  if (existing) existing.remove();
  var toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(function() { toast.remove(); }, 3000);
}

// --- User ID Setup ---
function showUserIdModal() {
  var container = document.getElementById("modalContainer");
  var defaultName = (process.env.USERNAME || process.env.USER || "").replace(/[^a-zA-Z0-9_-]/g, "");
  container.innerHTML =
    '<div class="modal-overlay">' +
      '<div class="modal" onclick="event.stopPropagation()">' +
        '<h3>Bem-vindo ao StockHub</h3>' +
        '<p style="font-size:11px;color:var(--text-secondary);margin:0 0 12px;">Informe seu nome para rastrear o uso de assets pela equipe.</p>' +
        '<input type="text" id="userIdInput" placeholder="Seu nome (ex: joao, maria)" value="' + defaultName + '" onkeydown="if(event.key===\'Enter\')confirmUserId()">' +
        '<div class="modal-actions">' +
          '<button class="btn btn-primary" onclick="confirmUserId()">Confirmar</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  setTimeout(function() {
    var inp = document.getElementById("userIdInput");
    if (inp) { inp.focus(); inp.select(); }
  }, 100);
}

function confirmUserId() {
  var input = document.getElementById("userIdInput");
  var name = input ? input.value.trim() : "";
  if (!name) { showToast("Informe seu nome"); return; }
  state.userId = name.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  saveState();
  closeModal();
  showToast("Usuario definido: " + state.userId);
}

// --- Event Tracking (JSONL) ---
function getEventsDir() {
  return path.join(getStockFolder(), "stockhub-data", "events");
}

function trackEvent(file, action) {
  if (!state.userId) return;
  var now = new Date();
  var dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
  var dayDir = path.join(getEventsDir(), dateStr);

  try {
    if (!fs.existsSync(dayDir)) fs.mkdirSync(dayDir, { recursive: true });
  } catch (e) {
    console.error("trackEvent mkdir:", e);
    return;
  }

  var event = {
    assetName: file.name,
    assetPath: file.path,
    category: file.category || "all",
    type: file.type || "unknown",
    userId: state.userId,
    action: action,
    usedAt: now.toISOString()
  };

  var filePath = path.join(dayDir, state.userId + ".jsonl");
  try {
    fs.appendFileSync(filePath, JSON.stringify(event) + "\n", "utf-8");
  } catch (e) {
    console.error("trackEvent write:", e);
  }
}

// --- Event Reading & Aggregation ---
function readEvents(startDate, endDate, filters) {
  var eventsDir = getEventsDir();
  var events = [];

  if (!fs.existsSync(eventsDir)) return events;

  var dirs;
  try { dirs = fs.readdirSync(eventsDir); } catch (e) { return events; }

  var start = startDate || "0000-00-00";
  var end = endDate || "9999-99-99";

  for (var d = 0; d < dirs.length; d++) {
    var dateDir = dirs[d];
    if (dateDir < start || dateDir > end) continue;
    var fullDir = path.join(eventsDir, dateDir);
    var stat;
    try { stat = fs.statSync(fullDir); } catch (e) { continue; }
    if (!stat.isDirectory()) continue;

    var files;
    try { files = fs.readdirSync(fullDir); } catch (e) { continue; }

    for (var f = 0; f < files.length; f++) {
      if (!files[f].endsWith(".jsonl")) continue;

      // userId filter at file level
      if (filters && filters.userId) {
        var fileUserId = files[f].replace(".jsonl", "");
        if (fileUserId !== filters.userId) continue;
      }

      var content;
      try { content = fs.readFileSync(path.join(fullDir, files[f]), "utf-8"); } catch (e) { continue; }
      var lines = content.trim().split("\n");

      for (var l = 0; l < lines.length; l++) {
        if (!lines[l]) continue;
        try {
          var evt = JSON.parse(lines[l]);
          if (filters) {
            if (filters.category && evt.category !== filters.category) continue;
            if (filters.type && evt.type !== filters.type) continue;
          }
          events.push(evt);
        } catch (e) { continue; }
      }
    }
  }

  return events;
}

function aggregateEvents(events) {
  var topAssets = {};
  var byUser = {};
  var byCategory = {};
  var byDay = {};
  var lastUse = {};

  for (var i = 0; i < events.length; i++) {
    var e = events[i];

    // Top assets
    var key = e.assetName;
    topAssets[key] = (topAssets[key] || 0) + 1;

    // By user
    byUser[e.userId] = (byUser[e.userId] || 0) + 1;

    // By category
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;

    // By day
    var day = e.usedAt ? e.usedAt.slice(0, 10) : "unknown";
    byDay[day] = (byDay[day] || 0) + 1;

    // Last use per asset
    if (!lastUse[key] || e.usedAt > lastUse[key]) {
      lastUse[key] = e.usedAt;
    }
  }

  // Sort top assets
  var topList = Object.keys(topAssets).map(function(k) {
    return { name: k, count: topAssets[k], lastUse: lastUse[k] || "" };
  }).sort(function(a, b) { return b.count - a.count; });

  return {
    total: events.length,
    topAssets: topList,
    byUser: byUser,
    byCategory: byCategory,
    byDay: byDay
  };
}

// --- CSV Export ---
function exportEventsCSV(events) {
  var header = "assetName,assetPath,category,type,userId,action,usedAt";
  var lines = [header];
  for (var i = 0; i < events.length; i++) {
    var e = events[i];
    lines.push([
      '"' + (e.assetName || "").replace(/"/g, '""') + '"',
      '"' + (e.assetPath || "").replace(/"/g, '""') + '"',
      e.category || "",
      e.type || "",
      e.userId || "",
      e.action || "",
      e.usedAt || ""
    ].join(","));
  }

  var csv = lines.join("\n");
  var defaultName = "stockhub-export-" + new Date().toISOString().slice(0, 10) + ".csv";

  if (isWindows) {
    var psFile = path.join(os.tmpdir(), "stockhub_save_csv.ps1");
    var psContent = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$form = New-Object System.Windows.Forms.Form',
      '$form.TopMost = $true',
      '$form.Width = 0',
      '$form.Height = 0',
      '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::Manual',
      '$form.Location = New-Object System.Drawing.Point(-1000,-1000)',
      '$form.Show()',
      '$dlg = New-Object System.Windows.Forms.SaveFileDialog',
      '$dlg.Title = "Salvar exportacao CSV"',
      '$dlg.Filter = "CSV (*.csv)|*.csv"',
      '$dlg.FileName = "' + defaultName + '"',
      '$dlg.DefaultExt = "csv"',
      '$dlg.InitialDirectory = [Environment]::GetFolderPath("Desktop")',
      'if ($dlg.ShowDialog($form) -eq [System.Windows.Forms.DialogResult]::OK) {',
      '  $dlg.FileName',
      '}',
      '$form.Close()',
    ].join("\n");
    fs.writeFileSync(psFile, psContent, "utf-8");
    child.exec('powershell -ExecutionPolicy Bypass -File "' + psFile + '"', function(err, stdout) {
      try { fs.unlinkSync(psFile); } catch(ex) {}
      var exportPath = stdout ? stdout.trim() : "";
      if (!err && exportPath) {
        try {
          fs.writeFileSync(exportPath, "\uFEFF" + csv, "utf-8");
          showToast("Exportado: " + exportPath);
          cs.evalScript('new File("' + exportPath.replace(/\\/g, "/") + '").execute()');
        } catch (ex) {
          showToast("Erro ao exportar: " + ex.toString());
        }
      }
    });
  } else {
    var appleScript = "osascript -e 'tell application \"System Events\"' -e 'activate' " +
      "-e 'set savePath to POSIX path of (choose file name with prompt \"Salvar exportacao CSV\" default name \"" + defaultName + "\")' " +
      "-e 'end tell'";
    child.exec(appleScript, function(err, stdout) {
      var exportPath = stdout ? stdout.trim() : "";
      if (!err && exportPath) {
        if (!exportPath.match(/\.csv$/i)) exportPath += ".csv";
        try {
          fs.writeFileSync(exportPath, "\uFEFF" + csv, "utf-8");
          showToast("Exportado: " + exportPath);
        } catch (ex) {
          showToast("Erro ao exportar: " + ex.toString());
        }
      }
    });
  }
}

// --- Custom Date Picker (PT-BR, DD/MM/AAAA) ---
var PT_MONTHS = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];
var PT_DAYS_SHORT = ["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"];

var _dpState = { field: null, year: 0, month: 0 };

function formatDateBR(iso) {
  if (!iso) return "";
  var p = iso.split("-");
  return p[2] + "/" + p[1] + "/" + p[0];
}

function _isoToday() {
  return new Date().toISOString().slice(0, 10);
}

function openDatePicker(field, currentIso) {
  _dpState.field = field;
  var d = currentIso ? new Date(currentIso + "T00:00:00") : new Date();
  _dpState.year  = d.getFullYear();
  _dpState.month = d.getMonth();

  var overlay = document.getElementById("dpOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "dpOverlay";
    overlay.className = "dp-overlay";
    overlay.innerHTML =
      '<div class="dp-modal" id="dpModal">' +
        '<div class="dp-header">' +
          '<button class="dp-nav" onclick="dpNavigate(-1)">&#8249;</button>' +
          '<span class="dp-title" id="dpTitle"></span>' +
          '<button class="dp-nav" onclick="dpNavigate(1)">&#8250;</button>' +
        '</div>' +
        '<div class="dp-weekdays" id="dpWeekdays"></div>' +
        '<div class="dp-grid" id="dpGrid"></div>' +
        '<div class="dp-footer">' +
          '<button class="dp-btn-cancel" onclick="closeDatePicker()">Cancelar</button>' +
          '<button class="dp-btn-today" onclick="dpSelectToday()">Hoje</button>' +
        '</div>' +
      '</div>';
    overlay.addEventListener("click", function(e) { if (e.target === overlay) closeDatePicker(); });
    document.body.appendChild(overlay);
  }

  _refreshDatePicker();
  overlay.style.display = "flex";
}

function dpNavigate(dir) {
  _dpState.month += dir;
  if (_dpState.month > 11) { _dpState.month = 0; _dpState.year++; }
  if (_dpState.month < 0)  { _dpState.month = 11; _dpState.year--; }
  _refreshDatePicker();
}

function _refreshDatePicker() {
  var y = _dpState.year, m = _dpState.month;
  document.getElementById("dpTitle").textContent = PT_MONTHS[m] + " " + y;

  document.getElementById("dpWeekdays").innerHTML = PT_DAYS_SHORT.map(function(d) {
    return '<span class="dp-weekday">' + d + '</span>';
  }).join("");

  var firstDay = new Date(y, m, 1).getDay();
  var daysInMonth = new Date(y, m + 1, 0).getDate();
  var todayIso = _isoToday();
  var currentIso = _dpState.field === "start" ? metricsState.startDate : metricsState.endDate;

  var cells = "";
  for (var i = 0; i < firstDay; i++) cells += '<span class="dp-cell dp-empty"></span>';
  for (var day = 1; day <= daysInMonth; day++) {
    var iso = y + "-" + (m < 9 ? "0" : "") + (m + 1) + "-" + (day < 10 ? "0" : "") + day;
    var cls = "dp-cell";
    if (iso === currentIso) cls += " dp-selected";
    else if (iso === todayIso) cls += " dp-today-mark";
    cells += '<span class="' + cls + '" onclick="dpSelectDay(\'' + iso + '\')">' + day + '</span>';
  }
  document.getElementById("dpGrid").innerHTML = cells;
}

function dpSelectDay(iso) {
  if (_dpState.field === "start") {
    metricsState.startDate = iso;
  } else {
    metricsState.endDate = iso;
  }
  closeDatePicker();
  renderMetrics();
}

function dpSelectToday() { dpSelectDay(_isoToday()); }

function closeDatePicker() {
  var overlay = document.getElementById("dpOverlay");
  if (overlay) overlay.style.display = "none";
}

// --- Metrics Panel ---
var metricsState = {
  visible: false,
  startDate: "",
  endDate: "",
  filterUserId: "",
  filterCategory: "",
  filterType: ""
};

function toggleMetrics() {
  metricsState.visible = !metricsState.visible;
  var panel = document.getElementById("metricsPanel");
  var sidebar = document.getElementById("sidebar");
  var gridContainer = document.getElementById("gridContainer");
  var gridSlider = document.getElementById("gridSliderBar");
  var metricsBtn = document.getElementById("metricsBtn");

  if (metricsState.visible) {
    // Close settings if open
    if (state.showSettings) toggleSettings();

    panel.style.display = "block";
    sidebar.style.display = "none";
    gridContainer.style.display = "none";
    if (gridSlider) gridSlider.style.display = "none";
    metricsBtn.style.color = "var(--accent)";

    // Default date range: last 30 days
    if (!metricsState.endDate) {
      var today = new Date();
      metricsState.endDate = today.toISOString().slice(0, 10);
      var start = new Date(today);
      start.setDate(start.getDate() - 30);
      metricsState.startDate = start.toISOString().slice(0, 10);
    }

    renderMetrics();
  } else {
    panel.style.display = "none";
    sidebar.style.display = "flex";
    gridContainer.style.display = "block";
    if (gridSlider) gridSlider.style.display = "flex";
    metricsBtn.style.color = "";
  }
}

function renderMetrics() {
  var filters = {};
  if (metricsState.filterUserId) filters.userId = metricsState.filterUserId;
  if (metricsState.filterCategory) filters.category = metricsState.filterCategory;
  if (metricsState.filterType) filters.type = metricsState.filterType;

  var events = readEvents(metricsState.startDate, metricsState.endDate, filters);
  var agg = aggregateEvents(events);

  // Get unique users for filter dropdown
  var allEvents = readEvents(metricsState.startDate, metricsState.endDate, {});
  var uniqueUsers = {};
  for (var u = 0; u < allEvents.length; u++) uniqueUsers[allEvents[u].userId] = true;
  var userList = Object.keys(uniqueUsers).sort();

  // Get categories for filter
  var catOptions = state.categories.filter(function(c) { return !c.system; }).map(function(c) {
    return '<option value="' + c.id + '"' + (metricsState.filterCategory === c.id ? " selected" : "") + '>' + c.name + '</option>';
  }).join("");

  // Get users for filter
  var userOptions = userList.map(function(uid) {
    return '<option value="' + uid + '"' + (metricsState.filterUserId === uid ? " selected" : "") + '>' + uid + '</option>';
  }).join("");

  var panel = document.getElementById("metricsContent");

  // --- Filters ---
  var filtersHtml =
    '<div class="metrics-filters">' +
      '<div class="metrics-filter-row">' +
        '<label>De:</label>' +
        '<button class="date-picker-btn" onclick="openDatePicker(\'start\', metricsState.startDate)">' + (metricsState.startDate ? formatDateBR(metricsState.startDate) : "DD/MM/AAAA") + '</button>' +
        '<label>Até:</label>' +
        '<button class="date-picker-btn" onclick="openDatePicker(\'end\', metricsState.endDate)">' + (metricsState.endDate ? formatDateBR(metricsState.endDate) : "DD/MM/AAAA") + '</button>' +
      '</div>' +
      '<div class="metrics-filter-row">' +
        '<label>Usuario:</label>' +
        '<select onchange="metricsState.filterUserId=this.value;renderMetrics()"><option value="">Todos</option>' + userOptions + '</select>' +
        '<label>Categoria:</label>' +
        '<select onchange="metricsState.filterCategory=this.value;renderMetrics()"><option value="">Todas</option>' + catOptions + '</select>' +
        '<label>Tipo:</label>' +
        '<select onchange="metricsState.filterType=this.value;renderMetrics()">' +
          '<option value="">Todos</option>' +
          '<option value="video"' + (metricsState.filterType === "video" ? " selected" : "") + '>Video</option>' +
          '<option value="audio"' + (metricsState.filterType === "audio" ? " selected" : "") + '>Audio</option>' +
          '<option value="image"' + (metricsState.filterType === "image" ? " selected" : "") + '>Imagem</option>' +
          '<option value="mogrt"' + (metricsState.filterType === "mogrt" ? " selected" : "") + '>MOGRT</option>' +
        '</select>' +
      '</div>' +
    '</div>';

  // --- Summary cards ---
  var summaryHtml =
    '<div class="metrics-summary">' +
      '<div class="metrics-card">' +
        '<div class="metrics-card-value">' + agg.total + '</div>' +
        '<div class="metrics-card-label">Total de usos</div>' +
      '</div>' +
      '<div class="metrics-card">' +
        '<div class="metrics-card-value">' + agg.topAssets.length + '</div>' +
        '<div class="metrics-card-label">Assets unicos</div>' +
      '</div>' +
      '<div class="metrics-card">' +
        '<div class="metrics-card-value">' + Object.keys(agg.byUser).length + '</div>' +
        '<div class="metrics-card-label">Usuarios ativos</div>' +
      '</div>' +
      '<div class="metrics-card">' +
        '<div class="metrics-card-value">' + Object.keys(agg.byDay).length + '</div>' +
        '<div class="metrics-card-label">Dias com uso</div>' +
      '</div>' +
    '</div>';

  // --- Top assets table ---
  var topN = agg.topAssets.slice(0, 20);
  var topHtml =
    '<div class="metrics-section">' +
      '<div class="metrics-section-title">Top Assets</div>' +
      '<div class="metrics-table-wrap">' +
        '<table class="metrics-table">' +
          '<thead><tr><th>#</th><th>Asset</th><th>Usos</th><th>Ultimo uso</th></tr></thead>' +
          '<tbody>' +
          topN.map(function(a, i) {
            var lastDate = a.lastUse ? formatDateBR(a.lastUse.slice(0, 10)) : "-";
            return '<tr><td>' + (i + 1) + '</td><td title="' + a.name + '">' + a.name + '</td><td>' + a.count + '</td><td>' + lastDate + '</td></tr>';
          }).join("") +
          (topN.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);">Nenhum evento encontrado</td></tr>' : '') +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

  // --- Usage by user ---
  var userEntries = Object.keys(agg.byUser).map(function(k) { return { name: k, count: agg.byUser[k] }; })
    .sort(function(a, b) { return b.count - a.count; });
  var maxUserCount = userEntries.length > 0 ? userEntries[0].count : 1;

  var userHtml =
    '<div class="metrics-section">' +
      '<div class="metrics-section-title">Uso por usuario</div>' +
      '<div class="metrics-bars">' +
      userEntries.map(function(u) {
        var pct = Math.round((u.count / maxUserCount) * 100);
        return '<div class="metrics-bar-row">' +
          '<span class="metrics-bar-label">' + u.name + '</span>' +
          '<div class="metrics-bar-track"><div class="metrics-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<span class="metrics-bar-value">' + u.count + '</span>' +
        '</div>';
      }).join("") +
      (userEntries.length === 0 ? '<div style="color:var(--text-muted);font-size:11px;padding:8px;">Nenhum dado</div>' : '') +
      '</div>' +
    '</div>';

  // --- Usage by category ---
  var catEntries = Object.keys(agg.byCategory).map(function(k) {
    var catName = k;
    for (var c = 0; c < state.categories.length; c++) {
      if (state.categories[c].id === k) { catName = state.categories[c].name; break; }
    }
    return { id: k, name: catName, count: agg.byCategory[k] };
  }).sort(function(a, b) { return b.count - a.count; });
  var maxCatCount = catEntries.length > 0 ? catEntries[0].count : 1;

  var catHtml =
    '<div class="metrics-section">' +
      '<div class="metrics-section-title">Uso por categoria</div>' +
      '<div class="metrics-bars">' +
      catEntries.map(function(c) {
        var pct = Math.round((c.count / maxCatCount) * 100);
        var color = "var(--accent)";
        for (var i = 0; i < state.categories.length; i++) {
          if (state.categories[i].id === c.id) { color = state.categories[i].color; break; }
        }
        return '<div class="metrics-bar-row">' +
          '<span class="metrics-bar-label">' + c.name + '</span>' +
          '<div class="metrics-bar-track"><div class="metrics-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>' +
          '<span class="metrics-bar-value">' + c.count + '</span>' +
        '</div>';
      }).join("") +
      (catEntries.length === 0 ? '<div style="color:var(--text-muted);font-size:11px;padding:8px;">Nenhum dado</div>' : '') +
      '</div>' +
    '</div>';

  // --- Volume by day (mini chart) ---
  var dayKeys = Object.keys(agg.byDay).sort();
  var maxDayCount = 1;
  for (var dk = 0; dk < dayKeys.length; dk++) {
    if (agg.byDay[dayKeys[dk]] > maxDayCount) maxDayCount = agg.byDay[dayKeys[dk]];
  }

  var dayHtml =
    '<div class="metrics-section">' +
      '<div class="metrics-section-title">Volume por dia</div>' +
      '<div class="metrics-day-chart">' +
      dayKeys.map(function(day) {
        var count = agg.byDay[day];
        var h = Math.max(4, Math.round((count / maxDayCount) * 60));
        return '<div class="metrics-day-bar" title="' + formatDateBR(day) + ': ' + count + ' usos">' +
          '<div class="metrics-day-bar-fill" style="height:' + h + 'px"></div>' +
          '<div class="metrics-day-label">' + day.slice(8) + '/' + day.slice(5, 7) + '</div>' +
        '</div>';
      }).join("") +
      (dayKeys.length === 0 ? '<div style="color:var(--text-muted);font-size:11px;padding:8px;">Nenhum dado</div>' : '') +
      '</div>' +
    '</div>';

  // --- Export button ---
  var exportHtml =
    '<div style="margin-top:8px;">' +
      '<button class="btn" onclick="exportEventsCSV(readEvents(metricsState.startDate,metricsState.endDate,{' +
        (metricsState.filterUserId ? 'userId:\'' + metricsState.filterUserId + '\',' : '') +
        (metricsState.filterCategory ? 'category:\'' + metricsState.filterCategory + '\',' : '') +
        (metricsState.filterType ? 'type:\'' + metricsState.filterType + '\'' : '') +
      '}))" style="width:100%;">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>' +
        '</svg>' +
        'Exportar CSV' +
      '</button>' +
    '</div>';

  panel.innerHTML = filtersHtml + summaryHtml +
    '<div class="metrics-columns">' + topHtml + '<div>' + userHtml + catHtml + '</div></div>' +
    dayHtml + exportHtml;
}

// --- Init ---
function init() {
  try {
    loadState();
    loadChangelog();
    document.getElementById("gridSize").value = state.gridSize;
    ensureStockFolder();

    // Version label no footer
    var vl = document.getElementById("versionLabel");
    if (vl) vl.textContent = "v" + APP_VERSION;

    var ff = findFFmpeg();
    if (ff) {
      console.log("StockHub: FFmpeg found at " + ff);
    } else {
      console.log("StockHub: FFmpeg not found. MOV previews disabled.");
    }

    // Restore sidebar width
    if (state.sidebarWidth) {
      var sb = document.getElementById("sidebar");
      if (sb) sb.style.width = state.sidebarWidth + "px";
    }
    initSidebarResize();

    refreshFiles();

    // Show userId modal if not set
    if (!state.userId) {
      showUserIdModal();
    }

    // Welcome modal (primeira execucao)
    if (!state.welcomed) {
      showWelcomeModal(0);
    }

    // What's new modal (apos update)
    if (state.lastSeenVersion && compareSemver(APP_VERSION, state.lastSeenVersion) > 0) {
      showWhatsNewModal();
    } else if (!state.lastSeenVersion) {
      state.lastSeenVersion = APP_VERSION;
      saveState();
    }

    // Auto-update check
    checkForUpdates();
  } catch (e) {
    alert("StockHub init error: " + e.toString());
  }
}

init();
