// StockHub - ExtendScript Backend for Premiere Pro
// Handles importing files into the project and timeline

// Recursively search all project items for a file by its media path
function findProjectItemByPath(parentItem, filePath) {
    var normalizedPath = filePath.replace(/\//g, "\\").toLowerCase();

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
                if (mediaPath && mediaPath.replace(/\//g, "\\").toLowerCase() === normalizedPath) {
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

        // Check if file already exists in project
        var projectItem = findProjectItemByPath(project.rootItem, filePath);

        if (!projectItem) {
            // Import first
            var importResult = JSON.parse(importFileToProject(filePath));
            if (!importResult.success) {
                return JSON.stringify(importResult);
            }
            // Find the newly imported item
            projectItem = findProjectItemByPath(project.rootItem, filePath);
        }

        if (!projectItem) {
            return JSON.stringify({ success: false, error: "Não foi possível encontrar o arquivo no projeto" });
        }

        // Insert at playhead position on a free track (never overlap existing clips)
        var currentTime = activeSequence.getPlayerPosition();
        var videoTrackCount = activeSequence.videoTracks.numTracks;

        // Find first video track with no clips (safest: any track that has clips is skipped
        // at the playhead region). Note: .ticks returns strings in ExtendScript, so we
        // must convert to Number for correct numeric comparison.
        var playheadTicks = Number(currentTime.ticks);
        var targetTrack = null;
        for (var t = 0; t < videoTrackCount; t++) {
            var track = activeSequence.videoTracks[t];
            var trackIsFree = true;
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                var cEnd = Number(clip.end.ticks);

                // Track is NOT free if any existing clip overlaps with or starts at/after playhead
                // This conservatively prevents overwriting any clip
                if (cEnd > playheadTicks) {
                    trackIsFree = false;
                    break;
                }
            }
            if (trackIsFree) {
                targetTrack = track;
                break;
            }
        }

        // If no free track found, create a new video track via QE DOM
        if (!targetTrack) {
            app.enableQE();
            var qeSequence = qe.project.getActiveSequence();
            // addTracks(numVideoTracks, numAudioTracks, audioTrackType)
            // audioTrackType: 0=mono, 1=stereo, 2=5.1
            qeSequence.addTracks(1, 0, 1);
            targetTrack = activeSequence.videoTracks[activeSequence.videoTracks.numTracks - 1];
        }

        // Use overwriteClip instead of insertClip to avoid pushing/rippling existing clips
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
