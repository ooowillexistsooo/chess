import {Chess} from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";
import {analyzePgn} from "./stockfish-engine.js";

const game = new Chess()

const pieceSymbols = {
    w: {p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔'},
    b: {p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚'}
}

const socket = window.io();
const matchButton = document.getElementById("find-match");
const matchStatus = document.getElementById("match-status");
const analysisOutput = document.getElementById("analysis-output");
let myColor = null;

matchButton.addEventListener("click", () => {
    matchButton.disabled = true;
    matchStatus.textContent = "Finding an opponent...";
    socket.emit("find-match");
});

socket.on("waiting", () => {
    matchStatus.textContent = "Waiting for an opponent...";
});

socket.on("game-started", ({color, fen}) => {
    myColor = color;
    game.load(fen);
    analysisOutput.textContent = "";
    createBoard();
    turnIndicatior.textContent = game.turn() === "w" ? "White" : "Black";

    matchStatus.textContent =
        color === "w" ? "You are White." : "You are Black.";
});

const boardElement = document.getElementById("chessboard");
const turnIndicatior = document.getElementById("turn-indicator");

function createBoard() {
    const position = game.board();
    boardElement.innerHTML = '';

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            const square = document.createElement('div');
            square.classList.add('square');

            if ((r+c) % 2 === 0) {
                square.classList.add('light');
            } else {
                square.classList.add('dark');
            }

            square.dataset.row = r;
            square.dataset.col = c;

            const piece = position[r][c];
            square.dataset.square = `${'abcdefgh'[c]}${8-r}`;

            if (piece) {
                square.textContent = pieceSymbols[piece.color][piece.type];
                square.draggable =
                    piece.color === myColor &&
                    piece.color === game.turn();
            }

            square.addEventListener('dragstart', handleDragStart);
            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);

            boardElement.appendChild(square);
        }
    }
}

function handleDragStart(e) {
    const square = e.currentTarget;
    e.dataTransfer.setData('text/plain', square.dataset.square);
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();

    const targetSquare = e.target.closest(".square");
    if (!targetSquare || !myColor) return;

    const from = e.dataTransfer.getData("text/plain");
    const to = targetSquare.dataset.square;

    socket.emit("make-move", {from,to, promotion:"q"});
}

socket.on("move-made", async ({fen, pgn, gameOver}) => {
    game.load(fen);
    createBoard();

    turnIndicatior.textContent =
        game.turn() === "w" ? "White" : "Black";

    if (gameOver) {
        myColor = null;
        createBoard();
        matchStatus.textContent = "Game over. Reviewing the game...";
        analysisOutput.textContent = "Analyzing the completed game...";

        try {
            const results = await analyzePgn(pgn, {
                depth: 10,
                maxPositions: 80,
                onProgress: (done, total) => {
                    analysisOutput.textContent =
                        `Analyzing position ${done} of ${total}...`;
                }
            });

            analysisOutput.textContent = results.map((item) => {
                const score = item.score
                    ? item.score.type === "cp"
                        ? `${(item.score.value / 100).toFixed(2)} pawns (side to move)`
                        : `mate in ${item.score.value}`
                    : "score unavailable";

                return `Ply ${item.ply} (${item.played}): ${score}\nPV: ${item.pv || "unavailable"}`;
            }).join("\n\n") || "No moves to analyze.";
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            analysisOutput.textContent = `Analysis failed: ${message}`;
        } finally {
            matchButton.disabled = false;
        }
    }
});

socket.on("move-rejected", ({message}) => {
    matchStatus.textContent = message;
});

socket.on("opponent-left", () => {
    myColor = null;
    createBoard();
    matchButton.disabled = false;
    matchStatus.textContent = "Your opponent disconnected.";
});

socket.on("connect_error", (error) => {
    matchButton.disabled = false;
    matchStatus.textContent = `Could not connect to the game server: ${error.message}`;
});

createBoard()