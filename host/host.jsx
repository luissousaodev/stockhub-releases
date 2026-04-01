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

        function findFreeTrack(seq, pTicks) {
            for (var t = 0; t < seq.videoTracks.numTracks; t++) {
                var trk = seq.videoTracks[t];
                var free = true;

                for (var c = 0; c < trk.clips.numItems; c++) {
                    var clip = trk.clips[c];
                    var clipStart = Number(clip.start.ticks);
                    var clipEnd = Number(clip.end.ticks);

                    if (pTicks >= clipStart && pTicks < clipEnd) {
                        free = false;
                        break;
                    }
                }

                if (free) return trk;
            }
            return null;
        }

        var targetTrack = findFreeTrack(activeSequence, playheadTicks);

        if (!targetTrack) {
            app.enableQE();
            var qeSeq = qe.project.getActiveSequence();

            var oldNumTracks = activeSequence.videoTracks.numTracks;

            // força criação acima da última existente
            qeSeq.addTracks(1, oldNumTracks, 0, 0);

            var newNumTracks = activeSequence.videoTracks.numTracks;

            if (newNumTracks <= oldNumTracks) {
                return JSON.stringify({
                    success: false,
                    error: "Não foi possível criar nova video track no topo"
                });
            }

            // pega diretamente a nova track criada
            targetTrack = activeSequence.videoTracks[oldNumTracks];
        }

        targetTrack.overwriteClip(projectItem, currentTime);

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
