const boardElement = document.getElementById("chessboard");
const turnIndicatior = document.getElementById("turn-indicator");

let currentTurn = 'white';
let draggedPiece = null;
let sourceSquare = null;

const initialBoard = [
    ['♜','♞','♝','♛','♚','♝','♞','♜'],
    ['♟','♟','♟','♟','♟','♟','♟','♟'],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['','','','','','','',''],
    ['♙','♙','♙','♙','♙','♙','♙','♙'],
    ['♖','♘','♗','♕','♔','♗','♘','♖']
];

function getPieceColor(piece) {
    if (!piece) return null;
    const whitePieces = ['♙','♖','♘','♗','♕','♔']
    return whitePieces.includes(piece) ? 'white' : 'black';
}

function createBoard() {
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

            const piece = initialBoard[r][c];
            if (!piece !== '') {
                square.innerText = piece;
                square.setAttribute('draggable', 'true');
            }

            square.addEventListener('dragstart', handleDragStart);
            square.addEventListener('dragover', handleDragOver);
            square.addEventListener('drop', handleDrop);

            boardElement.appendChild(square);
        }
    }
}

function handleDragStart(e) {
    const piece = e.target.innerText;
    const color = getPieceColor(piece);

    if (color === currentTurn) {
        draggedPiece = piece;
        sourceSquare = e.target;
        e.dataTransfer.setData('text/plain', piece);
    } else {
        e.preventDefault();
    }
}

function handleDragOver(e) {
    e.preventDefault();
}

function handleDrop(e) {
    e.preventDefault();
    let targetSquare = e.target;

    if (!targetSquare.classList.contains('square')) {
        targetSquare = targetSquare.parentElement;
    } 

    const targetPiece = targetSquare.innerText;
    const targetColor = getPieceColor(targetPiece);

    if (targetColor === currentTurn) return;

    const startRow = parseInt(sourceSquare.dataset.row);
    const startCol = parseInt(sourceSquare.dataset.col);
    const targetRow = parseInt(targetSquare.dataset.row);
    const targetCol = parseInt(targetSquare.dataset.col);

    initialBoard[targetRow][targetCol] = draggedPiece;
    initialBoard[startRow][startCol] = '';

    createBoard();

    currentTurn = currentTurn === 'white' ? 'black' : 'white';
    turnIndicatior.innerText = currentTurn.charAt(0).toUpperCase() + currentTurn.slice(1);
}

createBoard()