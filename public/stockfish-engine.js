import {Chess} from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

let worker;
let ready;
let resolveReady;
let rejectReady;
let activeAnalysis = null;
let isAnalyzing = false;

function startWorker() {
    if (ready) return ready;

    worker = new Worker(
        new URL("./stockfish/stockfish-19.js", import.meta.url)
    );

    ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(
                "Stockfish did not become ready. Check that stockfish-19.wasm is beside stockfish-19.js."
            ));
        }, 15000);

        resolveReady = () => {
            clearTimeout(timeout);
            resolve();
        };
        rejectReady = (error) => {
            clearTimeout(timeout);
            reject(error);
        };

        worker.onmessage = (event) => {
            const line = String(event.data).trim();

            if (line === "uciok") {
                worker.postMessage("isready");
                return;
            }

            if (line === "readyok") {
                resolveReady();
                return;
            }

            if (!activeAnalysis) return;

            if (line.startsWith("info ")) {
                const score = line.match(/\bscore (cp|mate) (-?\d+)/);
                const pv = line.match(/\bpv (.+)$/);

                if (score) {
                    activeAnalysis.result.score = {
                        type: score[1],
                        value: Number(score[2])
                    };
                }

                if (pv) {
                    activeAnalysis.result.pv = pv[1];
                }
            }

            if (line.startsWith("bestmove ")) {
                const finished = activeAnalysis;
                activeAnalysis = null;
                finished.resolve(finished.result);
            }
        };

        worker.onerror = (event) => {
            const error = new Error(event.message || "Stockfish worker failed.");
            rejectReady(error);

            if (activeAnalysis) {
                const failed = activeAnalysis;
                activeAnalysis = null;
                failed.reject(error);
            }
        };

        worker.postMessage("uci");
    });

    return ready;
}

function analyzeFen(fen, depth) {
    return new Promise((resolve, reject) => {
        activeAnalysis = {
            resolve,
            reject,
            result: {score: null, pv: ""}
        };

        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${depth}`);
    });
}

export async function analyzePgn(
    pgn,
    {depth = 10, maxPositions = 80, onProgress = () => {}} = {}
) {
    if (isAnalyzing) {
        throw new Error("An analysis is already running.");
    }

    if (!Number.isInteger(depth) || depth < 1) {
        throw new RangeError("Analysis depth must be a positive integer.");
    }

    if (!Number.isInteger(maxPositions) || maxPositions < 1) {
        throw new RangeError("Maximum positions must be a positive integer.");
    }

    isAnalyzing = true;

    try {
        await startWorker();

        const completedGame = new Chess();
        completedGame.loadPgn(pgn);

        const moves = completedGame.history({verbose: true});
        const replay = new Chess();
        const positions = [];

        for (const [index, move] of moves.entries()) {
            replay.move({
                from: move.from,
                to: move.to,
                ...(move.promotion ? {promotion: move.promotion} : {})
            });

            positions.push({
                ply: index + 1,
                played: move.san,
                fen: replay.fen()
            });
        }

        const selectedPositions = positions.slice(-maxPositions);
        const results = [];

        for (const [index, position] of selectedPositions.entries()) {
            const result = await analyzeFen(position.fen, depth);
            const analysis = {...position, ...result};

            results.push(analysis);
            onProgress(index + 1, selectedPositions.length, analysis);
        }

        return results;
    } finally {
        isAnalyzing = false;
    }
}