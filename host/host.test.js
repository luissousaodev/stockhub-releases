// Teste unitário da lógica pura de seleção de track livre.
// Executa em Node, sem depender do Premiere/ExtendScript.
// Rodar: node host/host.test.js

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

// Mock builder: faz uma tracks-collection {numTracks, 0..n-1} onde cada track
// tem clips {numItems, 0..m-1} com {start.ticks, end.ticks}.
function mkTracks(trackClipRanges) {
    const col = { numTracks: trackClipRanges.length };
    trackClipRanges.forEach((ranges, i) => {
        const clips = { numItems: ranges.length };
        ranges.forEach(([s, e], j) => {
            clips[j] = { start: { ticks: s }, end: { ticks: e } };
        });
        col[i] = { clips };
    });
    return col;
}

let passed = 0, failed = 0;
function eq(name, actual, expected) {
    if (actual === expected) { passed++; console.log("  ok  " + name); }
    else { failed++; console.log("  FAIL " + name + " — expected " + expected + ", got " + actual); }
}

console.log("findFreeTrackIndex");

// 1) Todas vazias → track 0
eq("all empty returns 0", findFreeTrackIndex(mkTracks([[], [], []]), 100), 0);

// 2) Sem tracks → -1
eq("no tracks returns -1", findFreeTrackIndex(mkTracks([]), 100), -1);

// 3) Track 0 ocupada no playhead, track 1 livre
eq("t0 busy, t1 free", findFreeTrackIndex(mkTracks([[[0, 200]], []]), 100), 1);

// 4) Todas ocupadas → -1
eq("all busy", findFreeTrackIndex(mkTracks([[[0, 200]], [[0, 200]]]), 100), -1);

// 5) Playhead exatamente no start: ocupado (s <= p < e)
eq("playhead == start -> busy", findFreeTrackIndex(mkTracks([[[100, 200]]]), 100), -1);

// 6) Playhead exatamente no end: livre (p === e é fim exclusivo)
eq("playhead == end -> free", findFreeTrackIndex(mkTracks([[[0, 100]]]), 100), 0);

// 7) Playhead antes de qualquer clip: livre
eq("playhead before clips", findFreeTrackIndex(mkTracks([[[500, 600]]]), 100), 0);

// 8) Múltiplos clips na mesma track, playhead no gap
eq("gap between clips", findFreeTrackIndex(mkTracks([[[0, 100], [200, 300]]]), 150), 0);

// 9) Múltiplos clips na mesma track, playhead dentro do segundo → procura próxima
eq("inside 2nd clip on t0, t1 free", findFreeTrackIndex(mkTracks([[[0, 100], [200, 300]], []]), 250), 1);

// 10) Retorna o PRIMEIRO índice livre (ordem crescente)
eq("returns lowest free index", findFreeTrackIndex(mkTracks([[], [], [[0, 999]]]), 100), 0);

// Cenário que reproduz o bug reportado: V1/V2/V3 e A1/A2/A3 todas ocupadas no
// playhead — findFreeTrackIndex deve retornar -1 em ambas, e o caller então
// cria UMA nova track no topo. Isso garante que A2 não é tocada.
const videoAllBusy = mkTracks([[[0, 500]], [[0, 500]], [[0, 500]]]);
const audioAllBusy = mkTracks([[[0, 500]], [[0, 500]], [[0, 500]]]);
eq("bug repro: all video busy", findFreeTrackIndex(videoAllBusy, 100), -1);
eq("bug repro: all audio busy", findFreeTrackIndex(audioAllBusy, 100), -1);

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed === 0 ? 0 : 1);
