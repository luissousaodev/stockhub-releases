// StockHub - ExtendScript Backend for Premiere Pro
// Handles importing files into the project and timeline

// Recursively search all project items for a file by its media path
function findProjectItemByPath(parentItem, filePath) {
    // Normalize separators to forward slash for cross-platform comparison
    var normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

    for (var i = 0; i < parentItem.children.numItems; i++) {
        var child = parentItem.children[i];

        // Check if this item is a bin (folder)
        if (child.type === ProjectItemType.BIN) {
            var found = findProjectItemByPath(child, filePath);
            if (found) return found;
        } else {
            // Compare media path
            try {
                var mediaPath = child.getMediaPath();
                if (mediaPath && mediaPath.replace(/\\/g, "/").toLowerCase() === normalizedPath) {
                    return child;
                }
            } catch (e) {
                // Some items may not have media paths
            }
        }
    }
    return null;
}

// Get or create the StockHub bin
function getStockHubBin() {
    var rootItem = app.project.rootItem;
    for (var i = 0; i < rootItem.children.numItems; i++) {
        if (rootItem.children[i].name === "StockHub") {
            return rootItem.children[i];
        }
    }
    return rootItem.createBin("StockHub");
}

function importFileToProject(filePath) {
    try {
        var project = app.project;
        if (!project) {
            return JSON.stringify({ success: false, error: "Nenhum projeto aberto" });
        }

        var fileObj = new File(filePath);
        if (!fileObj.exists) {
            return JSON.stringify({ success: false, error: "Arquivo não encontrado: " + filePath });
        }

        // Check if file already exists in project
        var existingItem = findProjectItemByPath(project.rootItem, filePath);
        if (existingItem) {
            return JSON.stringify({ success: true, message: "Arquivo já no projeto", alreadyExists: true });
        }

        var stockHubBin = getStockHubBin();

        // Import the file
        var importArray = [filePath];
        var success = project.importFiles(importArray, false, stockHubBin, false);

        if (success) {
            return JSON.stringify({ success: true, message: "Arquivo importado com sucesso" });
        } else {
            return JSON.stringify({ success: false, error: "Falha ao importar arquivo" });
        }
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

function importFileToTimeline(filePath) {
    try {
        var project = app.project;
        if (!project) {
            return JSON.stringify({ success: false, error: "Nenhum projeto aberto" });
        }

        var activeSequence = project.activeSequence;
        if (!activeSequence) {
            return JSON.stringify({ success: false, error: "Nenhuma sequência ativa" });
        }

        var projectItem = findProjectItemByPath(project.rootItem, filePath);

        if (!projectItem) {
            var importResult = JSON.parse(importFileToProject(filePath));
            if (!importResult.success) {
                return JSON.stringify(importResult);
            }

            projectItem = findProjectItemByPath(project.rootItem, filePath);
        }

        if (!projectItem) {
            return JSON.stringify({ success: false, error: "Não foi possível encontrar o arquivo no projeto" });
        }

        var currentTime = activeSequence.getPlayerPosition();
        var playheadTicks = Number(currentTime.ticks);

        // --- Lógica pura (testável) ---
        // Retorna o índice da primeira track livre no ponto pTicks, ou -1.
        function findFreeTrackIndex(tracks, pTicks) {
            for (var t = 0; t < tracks.numTracks; t++) {
                var trk = tracks[t];
                var free = true;
                for (var c = 0; c < trk.clips.numItems; c++) {
                    var clip = trk.clips[c];
                    var s = Number(clip.start.ticks);
                    var e = Number(clip.end.ticks);
                    if (pTicks >= s && pTicks < e) { free = false; break; }
                }
                if (free) return t;
            }
            return -1;
        }

        function itemHasAudio(item) {
            try {
                if (typeof item.hasAudio === "function") return item.hasAudio();
            } catch (e) {}
            return true; // assume áudio por segurança
        }

        var hasAudio = itemHasAudio(projectItem);
        var videoIdx = findFreeTrackIndex(activeSequence.videoTracks, playheadTicks);
        var audioIdx = hasAudio ? findFreeTrackIndex(activeSequence.audioTracks, playheadTicks) : -2;

        app.enableQE();

        // Append estrito no topo. Retorna o índice da nova track ou -1 em falha.
        // NUNCA insere no meio (isso deslocaria tracks existentes e quebraria
        // referências/targeting).
        function appendVideoTrack() {
            var before = activeSequence.videoTracks.numTracks;
            try {
                qe.project.getActiveSequence().addTracks(1, before, 0, 0, 1, 0, 0, 1);
            } catch (e) {
                return -1;
            }
            activeSequence = project.activeSequence;
            if (activeSequence.videoTracks.numTracks === before + 1) return before;
            return -1;
        }

        function appendAudioTrack(audType) {
            var before = activeSequence.audioTracks.numTracks;
            try {
                qe.project.getActiveSequence().addTracks(0, 0, 1, before, audType, 0, 0, 1);
            } catch (e) {
                return -1;
            }
            activeSequence = project.activeSequence;
            if (activeSequence.audioTracks.numTracks === before + 1) return before;
            return -1;
        }

        if (videoIdx === -1) {
            videoIdx = appendVideoTrack();
            if (videoIdx === -1) {
                return JSON.stringify({
                    success: false,
                    error: "Falha ao criar video track (atual: " + activeSequence.videoTracks.numTracks + ")"
                });
            }
        }

        if (hasAudio && audioIdx === -1) {
            // audType 1 = stereo na maioria das versões do QE do Premiere
            audioIdx = appendAudioTrack(1);
            if (audioIdx === -1) {
                return JSON.stringify({
                    success: false,
                    error: "Falha ao criar audio track (atual: " + activeSequence.audioTracks.numTracks + ")"
                });
            }
        }

        // Snapshot do targeting atual ANTES de mexer, usando a contagem atual
        // (já inclui qualquer track recém-criada).
        var numV = activeSequence.videoTracks.numTracks;
        var numA = activeSequence.audioTracks.numTracks;
        var prevVideoTargets = new Array(numV);
        var prevAudioTargets = new Array(numA);
        for (var vi = 0; vi < numV; vi++) {
            prevVideoTargets[vi] = activeSequence.videoTracks[vi].isTargeted();
            activeSequence.videoTracks[vi].setTargeted(vi === videoIdx, true);
        }
        for (var ai = 0; ai < numA; ai++) {
            prevAudioTargets[ai] = activeSequence.audioTracks[ai].isTargeted();
            activeSequence.audioTracks[ai].setTargeted(hasAudio && ai === audioIdx, true);
        }

        activeSequence.videoTracks[videoIdx].overwriteClip(projectItem, currentTime);

        // Restaura targeting (mesmo tamanho do snapshot — nenhuma track foi
        // adicionada/removida entre o snapshot e agora).
        for (var vi2 = 0; vi2 < numV; vi2++) {
            activeSequence.videoTracks[vi2].setTargeted(prevVideoTargets[vi2], true);
        }
        for (var ai2 = 0; ai2 < numA; ai2++) {
            activeSequence.audioTracks[ai2].setTargeted(prevAudioTargets[ai2], true);
        }

        return JSON.stringify({ success: true, message: "Clip inserido na timeline" });
    } catch (e) {
        return JSON.stringify({ success: false, error: e.toString() });
    }
}

function getProjectPath() {
    try {
        if (app.project && app.project.path) {
            var projectFile = new File(app.project.path);
            return projectFile.parent.fsName;
        }
        return "";
    } catch (e) {
        return "";
    }
}
