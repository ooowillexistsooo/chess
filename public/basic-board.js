import {Chess} from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";

const game = new Chess()

const pieceSymbols = {
    w: {p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔'},
    b: {p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚'}
}

const boardElement = document.getElementById("chessboard");
const turnIndicatior = document.getElementById("turn-indicator");

let currentTurn = 'white';
let draggedPiece = null;
let sourceSquare = null;

function getPieceColor(piece) {
    if (!piece) return null;
    const whitePieces = ['♙','♖','♘','♗','♕','♔']
    return whitePieces.includes(piece) ? 'white' : 'black';
}

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
                square.draggable = piece.color === game.turn();
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
    const targetSquare = e.target.closest('.square');
    if (!targetSquare) return;

    const from = e.dataTransfer.getData('text/plain');
    const to = targetSquare.dataset.square;

    const isLegal = game.moves({square: from, verbose: true})
        .some(move => move.to === to);

    if (!isLegal) return;

    game.move({from, to, promotion: 'q'});
    createBoard();
    turnIndicatior.textContent = game.turn() === 'w' ? 'white' : 'black';
}

createBoard()