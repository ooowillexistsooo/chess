import express from "express";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {Server} from "socket.io";
import {Chess} from "chess.js";

const app = express();
app.use(express.static("public"));

const httpServer = createServer(app);
const io = new Server(httpServer);

const games = new Map();
const socketToRoom = new Map();
let waitingSocketId = null;

function finishGame(roomId, room) {
    games.delete(roomId);

    for (const playerId of Object.values(room.players)) {
        socketToRoom.delete(playerId);
        io.sockets.sockets.get(playerId)?.leave(roomId);
    }
}

io.on("connection", (socket) => {
    socket.on("find-match", () => {
        if (socketToRoom.has(socket.id)) return;
        if (waitingSocketId === socket.id) return;

        if (!waitingSocketId) {
            waitingSocketId = socket.id;
            socket.emit("waiting")
            return;
        }

        const whiteSocket = io.sockets.sockets.get(waitingSocketId);
        if (!whiteSocket) {
            waitingSocketId = socket.id;
            socket.emit("waiting");
            return;
        }

        const whiteId = whiteSocket.id;
        const blackId = socket.id;
        waitingSocketId = null;

        const roomId = `game-${randomUUID()}`;
        const game = new Chess();

        games.set(roomId, {
            game,
            players: {w: whiteId, b: blackId}
        });

        socketToRoom.set(whiteId, roomId);
        socketToRoom.set(blackId, roomId);

        whiteSocket.join(roomId);
        socket.join(roomId);

        io.to(whiteId).emit("game-started", {
            color: "w",
            fen: game.fen()
        });

        io.to(blackId).emit("game-started", {
            color: "b",
            fen: game.fen()
        });
    });

    socket.on("make-move", (payload = {}) => {
        const {from, to, promotion} = payload ?? {};
        const roomId = socketToRoom.get(socket.id);
        const room = games.get(roomId);

        const reject = (message) => {
            socket.emit("move-rejected", {message});
        };

        if (!room) {
            reject("You are not in a game.");
            return;
        }

        const {game, players} = room;
        const color = players.w === socket.id
            ? "w"
            : players.b === socket.id
                ? "b"
                : null;

        if (!color || color !== game.turn()) {
            reject("It is not your turn.");
            return;
        }

        const selectedPromotion = promotion ?? "q";
        if (
            game.isGameOver() ||
            typeof from !== "string" ||
            typeof to !== "string" ||
            !/^[a-h][1-8]$/.test(from) ||
            !/^[a-h][1-8]$/.test(to) ||
            !["q", "r", "b", "n"].includes(selectedPromotion)
        ) {
            reject("That move cannot be made.");
            return;
        }

        const legalMove = game.moves({square: from, verbose: true})
            .find((move) =>
                move.to === to &&
                (!move.promotion || move.promotion === selectedPromotion)
            );

        if (!legalMove) {
            reject("Illegal move.");
            return;
        }

        const move = game.move({
            from,
            to,
            ...(legalMove.promotion
                ? {promotion: selectedPromotion}
                : {}
            )
        });

        io.to(roomId).emit("move-made", {
            move: {
                from: move.from,
                to: move.to,
                ...(move.promotion ? {promotion: move.promotion} : {})
            },
            pgn: game.pgn(),
            fen: game.fen(),
            turn: game.turn(),
            gameOver: game.isGameOver()
        });

        if (game.isGameOver()) {
            finishGame(roomId, room);
        }
    });

    socket.on("disconnect", () => {
        if (waitingSocketId === socket.id) {
            waitingSocketId = null;
        }

        const roomId = socketToRoom.get(socket.id);
        const room = games.get(roomId);

        if (room) {
            const opponentId = room.players.w === socket.id
                ? room.players.b
                : room.players.w;

            io.to(opponentId).emit("opponent-left");
            socketToRoom.delete(opponentId);
            io.sockets.sockets.get(opponentId)?.leave(roomId);
            games.delete(roomId);
        }

        socketToRoom.delete(socket.id);
    });
});

httpServer.listen(3000, () => {
    console.log("Chess server listening at http://localhost:3000");
});