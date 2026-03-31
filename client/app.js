// StockHub - CEP Extension for Premiere Pro
var cs = new CSInterface();

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
  userId: null,
};

// --- Stock Folder ---
function getDefaultStockFolder() {
  var path = require("path");
  var userProfile = process.env.USERPROFILE || process.env.HOME || "";
  return path.join(userProfile, "StockHub");
}

function getStockFolder() {
  return state.customFolder || getDefaultStockFolder();
}

function ensureStockFolder() {
  try {
    var fs = require("fs");
    var path = require("path");
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
  var child = require("child_process");
  var psScript = '[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null; ' +
    '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
    '$dlg.Description = "Selecionar pasta de assets"; ' +
    '$dlg.ShowNewFolderButton = $true; ' +
    'if ($dlg.ShowDialog() -eq "OK") { $dlg.SelectedPath } else { "" }';
  child.exec('powershell -Command "' + psScript.replace(/"/g, '\\"') + '"', function(err, stdout) {
    var result = stdout ? stdout.trim() : "";
    if (!err && result) {
      showAutoCategoryModal(result);
    }
  });
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
  state.customFolder = folderPath;
  state.autoCategories = autoCategories;
  if (autoCategories) state.deletedCategoryIds = [];
  saveState();
  ensureStockFolder();
  thumbLookupCache = {};
  thumbCache = {};
  resolutionCache = {};
  var fp = document.getElementById("stockFolderPath");
  if (fp) fp.textContent = folderPath;
  refreshFiles();
  showToast("Pasta alterada: " + folderPath);
}

function resetStockFolder() {
  state.customFolder = null;
  saveState();
  ensureStockFolder();
  thumbLookupCache = {};
  thumbCache = {};
  resolutionCache = {};
  var fp = document.getElementById("stockFolderPath");
  if (fp) fp.textContent = getDefaultStockFolder();
  refreshFiles();
  showToast("Pasta restaurada para padrao: " + getDefaultStockFolder());
}

// --- Storage ---
function getStoragePath() {
  var path = require("path");
  var dataDir = cs.getSystemPath(SystemPath.USER_DATA);
  return path.join(dataDir, "stockhub-data.json");
}

function loadState() {
  try {
    var fs = require("fs");
    var filePath = getStoragePath();
    if (fs.existsSync(filePath)) {
      var data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (data.categories) state.categories = data.categories;
      if (data.gridSize) state.gridSize = data.gridSize;
      if (data.fileCategories) state.fileCategories = data.fileCategories;
      if (data.customFolder) state.customFolder = data.customFolder;
      if (data.autoCategories !== undefined) state.autoCategories = data.autoCategories;
      if (data.deletedCategoryIds) state.deletedCategoryIds = data.deletedCategoryIds;
      if (data.userId) state.userId = data.userId;
    }
  } catch (e) {
    console.log("No saved state:", e);
  }
}

function saveState() {
  try {
    var fs = require("fs");
    var path = require("path");
    var filePath = getStoragePath();
    var dataDir = path.dirname(filePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify({
      categories: state.categories,
      gridSize: state.gridSize,
      fileCategories: state.fileCategories,
      customFolder: state.customFolder,
      autoCategories: state.autoCategories,
      deletedCategoryIds: state.deletedCategoryIds,
      userId: state.userId,
    }), "utf-8");
  } catch (e) {
    console.error("Save failed:", e);
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
  var fs = require("fs");
  var path = require("path");
  var files = [];

  try {
    if (!folderPath || !fs.existsSync(folderPath)) {
      console.error("Pasta nao encontrada:", folderPath);
      return files;
    }

    function walk(dir, category) {
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
          if (item.charAt(0) === ".") continue;
          var catId = item.toLowerCase().replace(/[^a-z0-9]/g, "-");
          if (state.autoCategories) {
            var exists = false;
            for (var j = 0; j < state.categories.length; j++) {
              if (state.categories[j].id === catId) { exists = true; break; }
            }
            if (!exists && state.deletedCategoryIds.indexOf(catId) === -1) {
              state.categories.push({ id: catId, name: item, color: getRandomColor() });
            }
          }
          walk(fullPath, catId);
        } else {
          var ext = path.extname(item).toLowerCase();
          if (ALL_EXTENSIONS.indexOf(ext) >= 0) {
            files.push({
              name: item,
              path: fullPath,
              ext: ext.replace(".", ""),
              type: getFileType(ext),
              category: (state.fileCategories && state.fileCategories[fullPath]) || category || "all",
              size: stat.size,
              modified: stat.mtime,
            });
          }
        }
      }
    }

    walk(folderPath, null);
  } catch (e) {
    console.error("Scan error:", e);
  }
  return files;
}

function refreshFiles() {
  var folder = getStockFolder();
  state.files = scanFolder(folder);
  renderAll();
  showToast(state.files.length + " arquivos encontrados");
  document.getElementById("statusText").textContent = "Atualizado";

  // Pre-generate ffmpeg thumbnails + detect resolutions in background
  if (findFFmpeg()) {
    var queue = [];
    var resQueue = [];
    for (var i = 0; i < state.files.length; i++) {
      var f = state.files[i];
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
        img.src = "file:///" + rf.path.replace(/\\/g, "/");
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

    // Process thumbnails 1 at a time, update only that grid item
    function processQueue(idx) {
      if (idx >= queue.length) {
        document.getElementById("statusText").textContent = "Pronto";
        return;
      }
      document.getElementById("statusText").textContent = "Gerando thumbs... " + (idx + 1) + "/" + queue.length;
      generateThumbFFmpeg(queue[idx].path, function(url) {
        if (url) {
          var el = document.querySelector('[data-filepath="' + CSS.escape(queue[idx].path) + '"] .thumbnail, [data-filepath="' + CSS.escape(queue[idx].path) + '"] .placeholder');
          if (el) {
            var img = document.createElement("img");
            img.className = "thumbnail";
            img.src = url;
            img.loading = "lazy";
            el.replaceWith(img);
          }
        }
        processQueue(idx + 1);
      });
    }
    processQueue(0);
    processResQueue(0);
  }
}

// --- Thumbnails (cached, no filesystem hit on re-render) ---
var thumbLookupCache = {};

function getThumbnail(file) {
  if (thumbLookupCache[file.path] !== undefined) return thumbLookupCache[file.path];
  try {
    var path = require("path");
    var fs = require("fs");
    var dir = path.dirname(file.path);
    var base = path.basename(file.path, path.extname(file.path));
    var thumbExts = [".png", ".jpg", ".jpeg", ".gif"];
    for (var i = 0; i < thumbExts.length; i++) {
      var thumbPath = path.join(dir, base + thumbExts[i]);
      if (fs.existsSync(thumbPath)) {
        var url = "file:///" + thumbPath.replace(/\\/g, "/");
        thumbLookupCache[file.path] = url;
        return url;
      }
      var thumbPath2 = path.join(dir, "thumbs", base + thumbExts[i]);
      if (fs.existsSync(thumbPath2)) {
        var url2 = "file:///" + thumbPath2.replace(/\\/g, "/");
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
  var escapedPath = file.path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
  var path = require("path");
  return path.join(getStockFolder(), ".cache");
}

function ensureCacheDir() {
  var fs = require("fs");
  var dir = getCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function findFFmpeg() {
  if (ffmpegPath) return ffmpegPath;
  var fs = require("fs");
  var path = require("path");
  var child = require("child_process");

  try {
    var result = child.execSync("where ffmpeg", { timeout: 5000, encoding: "utf-8" });
    var lines = result.trim().split("\n");
    if (lines[0] && fs.existsSync(lines[0].trim())) {
      ffmpegPath = lines[0].trim();
      ffprobePath = path.join(path.dirname(ffmpegPath), "ffprobe.exe");
      if (!fs.existsSync(ffprobePath)) ffprobePath = null;
      return ffmpegPath;
    }
  } catch (e) {}

  var localAppData = process.env.LOCALAPPDATA || "";
  var userProfile = process.env.USERPROFILE || "";
  var locations = [
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe",
    "C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe",
    path.join(localAppData, "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(userProfile, "ffmpeg", "bin", "ffmpeg.exe"),
    path.join(userProfile, "scoop", "shims", "ffmpeg.exe")
  ];

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

  for (var i = 0; i < locations.length; i++) {
    if (locations[i] && fs.existsSync(locations[i])) {
      ffmpegPath = locations[i];
      ffprobePath = locations[i].replace("ffmpeg.exe", "ffprobe.exe");
      if (!fs.existsSync(ffprobePath)) ffprobePath = null;
      return ffmpegPath;
    }
  }

  return null;
}

function getVideoDuration(filePath, callback) {
  if (!ffprobePath) { callback(null); return; }
  var child = require("child_process");
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
  var child = require("child_process");
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
  var path = require("path");
  var fs = require("fs");
  var child = require("child_process");

  var ffmpeg = findFFmpeg();
  if (!ffmpeg) { callback(null); return; }

  var cacheDir = ensureCacheDir();
  var hash = filePath.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 120);
  var thumbFile = path.join(cacheDir, hash + "_thumb.jpg");

  if (fs.existsSync(thumbFile)) {
    thumbCache[filePath] = "file:///" + thumbFile.replace(/\\/g, "/");
    callback(thumbCache[filePath]);
    return;
  }

  getVideoDuration(filePath, function(duration) {
    var seekTime = duration ? (duration / 2) : 1;
    child.execFile(ffmpeg, [
      "-ss", String(seekTime),
      "-i", filePath,
      "-vframes", "1",
      "-q:v", "5",
      "-vf", "scale=240:-1",
      "-y",
      thumbFile
    ], { timeout: 15000 }, function(err) {
      if (err || !fs.existsSync(thumbFile)) {
        callback(null);
        return;
      }
      thumbCache[filePath] = "file:///" + thumbFile.replace(/\\/g, "/");
      callback(thumbCache[filePath]);
    });
  });
}

function generateProxyFFmpeg(filePath, callback) {
  var path = require("path");
  var fs = require("fs");
  var child = require("child_process");

  var ffmpeg = findFFmpeg();
  if (!ffmpeg) { callback(null); return; }

  var cacheDir = ensureCacheDir();
  var hash = filePath.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 120);
  var proxyFile = path.join(cacheDir, hash + "_proxy.mp4");

  if (fs.existsSync(proxyFile)) {
    proxyCache[filePath] = "file:///" + proxyFile.replace(/\\/g, "/");
    callback(proxyCache[filePath]);
    return;
  }

  child.execFile(ffmpeg, [
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
    if (err || !fs.existsSync(proxyFile)) {
      callback(null);
      return;
    }
    proxyCache[filePath] = "file:///" + proxyFile.replace(/\\/g, "/");
    callback(proxyCache[filePath]);
  });
}

// --- Video Preview on Hover ---
var activePreview = null;
var hoverTimer = null;

function onMouseEnter(el, fileIndex) {
  var file = state.files[fileIndex];
  if (!file || file.type !== "video") return;

  // Small delay to avoid triggering on quick mouse passes
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(function() {
    if (!el.matches(":hover")) return;

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
      createPreviewVideo(el, "file:///" + file.path.replace(/\\/g, "/"));
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
  video.loop = true;
  video.playsInline = true;
  video.onerror = function() { video.remove(); activePreview = null; };
  el.appendChild(video);
  activePreview = { el: el, video: video };
  // Only show video after first frame is ready to avoid flicker
  video.oncanplay = function() {
    video.oncanplay = null;
    if (!el.matches(":hover")) { cleanupPreview(); return; }
    video.style.opacity = "1";
    video.play().catch(function() {});
  };
  video.src = src;
}

function onMouseLeave(el) {
  clearTimeout(hoverTimer);
  cleanupPreview();
}

function cleanupPreview() {
  if (activePreview) {
    var v = activePreview.video;
    v.pause();
    v.removeAttribute("src");
    v.load(); // Release memory
    v.remove();
    activePreview = null;
  }
}

// --- Drag to Categorize ---
function onFileDragStart(e, fileIndex) {
  e.dataTransfer.setData("text/plain", String(fileIndex));
  e.dataTransfer.effectAllowed = "move";
  e.target.closest(".grid-item").classList.add("dragging");
}

function onFileDragEnd(e) {
  var el = e.target.closest(".grid-item");
  if (el) el.classList.remove("dragging");
  var cats = document.querySelectorAll(".cat-item");
  for (var i = 0; i < cats.length; i++) cats[i].classList.remove("drag-over");
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
  state.fileCategories[file.path] = catId;
  saveState();
  renderAll();
  var catName = "";
  for (var i = 0; i < state.categories.length; i++) {
    if (state.categories[i].id === catId) { catName = state.categories[i].name; break; }
  }
  showToast("Movido para: " + catName);
}

function onDoubleClick(fileIndex) {
  var file = state.files[fileIndex];
  if (!file) return;
  var escapedPath = file.path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
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
    if (state.activeCategory !== "all" && f.category !== state.activeCategory) return false;
    if (state.searchQuery) {
      return f.name.toLowerCase().indexOf(state.searchQuery.toLowerCase()) >= 0;
    }
    return true;
  });
}

// --- UI Actions ---
function setFormat(format, btn) {
  state.activeFormat = format;
  var tabs = document.querySelectorAll("#formatTabs .tab");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
  btn.classList.add("active");
  renderGrid();
}

function setCategory(catId) {
  state.activeCategory = catId;
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
    settingsPanel.style.display = "block";
    sidebar.style.display = "none";
    gridContainer.style.display = "none";
    if (gridSlider) gridSlider.style.display = "none";
    settingsBtn.style.color = "var(--accent)";
    var fp = document.getElementById("stockFolderPath");
    if (fp) fp.textContent = getStockFolder();
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
  state.categories = state.categories.filter(function(c) { return c.id !== catId || c.system; });
  if (state.activeCategory === catId) state.activeCategory = "all";
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

  var header = document.createElement("div");
  header.style.cssText = "padding:6px 12px;font-size:10px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.3px;";
  header.textContent = "Mover para categoria";
  menu.appendChild(header);

  state.categories.forEach(function(cat) {
    var item = document.createElement("div");
    item.style.cssText =
      "padding:5px 12px;font-size:11px;cursor:pointer;" +
      "color:" + (file.category === cat.id ? "var(--accent)" : "var(--text-primary)") + ";" +
      "display:flex;align-items:center;gap:6px;";
    item.innerHTML = '<span style="width:8px;height:8px;border-radius:2px;background:' + cat.color + ';flex-shrink:0;"></span>' + cat.name;
    item.onmouseover = function() { item.style.background = "var(--bg-hover)"; };
    item.onmouseout = function() { item.style.background = "transparent"; };
    item.onclick = function() {
      file.category = cat.id;
      if (!state.fileCategories) state.fileCategories = {};
      state.fileCategories[file.path] = cat.id;
      saveState();
      renderGrid();
      menu.remove();
      showToast("Movido para: " + cat.name);
    };
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  var closeCtx = function() { menu.remove(); document.removeEventListener("click", closeCtx); };
  setTimeout(function() { document.addEventListener("click", closeCtx); }, 10);
}

// --- Render ---
function renderCategories() {
  var list = document.getElementById("categoryList");
  list.innerHTML = state.categories.map(function(cat) {
    var count = cat.system
      ? state.files.length
      : state.files.filter(function(f) { return f.category === cat.id; }).length;
    return '<div class="cat-item ' + (state.activeCategory === cat.id ? "active" : "") + '" ' +
      'onclick="setCategory(\'' + cat.id + '\')" ' +
      'ondragover="onCatDragOver(event)" ' +
      'ondragleave="onCatDragLeave(event)" ' +
      'ondrop="onCatDrop(event, \'' + cat.id + '\')">' +
      '<span style="display:flex;align-items:center;gap:6px;">' +
        '<span style="width:8px;height:8px;border-radius:2px;background:' + cat.color + ';flex-shrink:0;"></span>' +
        cat.name +
      '</span>' +
      '<span class="cat-count">' + count + '</span>' +
    '</div>';
  }).join("");
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
      thumbContent = '<img class="thumbnail" src="file:///' + f.path.replace(/\\/g, "/") + '" loading="lazy" />';
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

    return '<div class="grid-item" ' +
      'data-filepath="' + f.path.replace(/"/g, '&quot;') + '" ' +
      'draggable="true" ' +
      'ondragstart="onFileDragStart(event, ' + idx + ')" ' +
      'ondragend="onFileDragEnd(event)" ' +
      'ondblclick="onDoubleClick(' + idx + ')" ' +
      'oncontextmenu="showContextMenu(event, ' + idx + ')" ' +
      'onmouseenter="onMouseEnter(this, ' + idx + ')" ' +
      'onmouseleave="onMouseLeave(this)" ' +
      'title="' + f.name + '">' +
      thumbContent +
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
}

var selectedCategories = {};

function renderCatEditList() {
  var list = document.getElementById("catEditList");
  list.innerHTML = state.categories.filter(function(c) { return !c.system; }).map(function(cat) {
    var checked = selectedCategories[cat.id] ? "checked" : "";
    return '<div class="cat-edit-row">' +
      '<input type="checkbox" class="cat-checkbox" data-catid="' + cat.id + '" ' + checked + ' onchange="toggleCatSelection(\'' + cat.id + '\', this.checked)">' +
      '<span class="cat-color" style="background:' + cat.color + '" onclick="cycleCatColor(\'' + cat.id + '\')"></span>' +
      '<input value="' + cat.name + '" onblur="renameCategory(\'' + cat.id + '\', this.value)" onkeydown="if(event.key===\'Enter\')this.blur()">' +
    '</div>';
  }).join("");
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
  var path = require("path");
  return path.join(getStockFolder(), "stockhub-data", "events");
}

function trackEvent(file, action) {
  if (!state.userId) return;
  var fs = require("fs");
  var path = require("path");
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
  var fs = require("fs");
  var path = require("path");
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
  var path = require("path");
  var fs = require("fs");
  var exportPath = path.join(getStockFolder(), "stockhub-export-" + new Date().toISOString().slice(0, 10) + ".csv");
  try {
    fs.writeFileSync(exportPath, "\uFEFF" + csv, "utf-8"); // BOM for Excel
    showToast("Exportado: " + exportPath);
    // Open in explorer
    cs.evalScript('new File("' + exportPath.replace(/\\/g, "/") + '").execute()');
  } catch (e) {
    showToast("Erro ao exportar: " + e.toString());
  }
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
        '<input type="date" id="metricsStartDate" value="' + metricsState.startDate + '" onchange="metricsState.startDate=this.value;renderMetrics()">' +
        '<label>Ate:</label>' +
        '<input type="date" id="metricsEndDate" value="' + metricsState.endDate + '" onchange="metricsState.endDate=this.value;renderMetrics()">' +
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
            var lastDate = a.lastUse ? a.lastUse.slice(0, 10) : "-";
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
        return '<div class="metrics-day-bar" title="' + day + ': ' + count + ' usos">' +
          '<div class="metrics-day-bar-fill" style="height:' + h + 'px"></div>' +
          '<div class="metrics-day-label">' + day.slice(5) + '</div>' +
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
    document.getElementById("gridSize").value = state.gridSize;
    ensureStockFolder();

    var ff = findFFmpeg();
    if (ff) {
      console.log("StockHub: FFmpeg found at " + ff);
    } else {
      console.log("StockHub: FFmpeg not found. MOV previews disabled.");
    }

    refreshFiles();

    // Show userId modal if not set
    if (!state.userId) {
      showUserIdModal();
    }
  } catch (e) {
    alert("StockHub init error: " + e.toString());
  }
}

init();
