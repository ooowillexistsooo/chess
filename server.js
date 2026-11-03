import express from "express";
import {createServer} from "node:http";
import {randomUUID} from "node:crypto";
import {Server} from "socket.io";
import {Chess} from "chess.js";
import {FieldValue, firebaseAuth, firestore} from "./firebase-admin.js";
import {calculateEloRatings} from "./elo.js";

const app = express();
app.use(express.static("public"));

const httpServer = createServer(app);
const io = new Server(httpServer);

io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string") {
            next(new Error("Sign in required."));
            return;
        }

        const decodedToken = await firebaseAuth.verifyIdToken(token);
        socket.data.uid = decodedToken.uid;

        const profile = await firestore
            .collection("users")
            .doc(decodedToken.uid)
            .get();
        socket.data.username = profile.exists
            ? profile.data()?.username ?? null
            : null;

        next();
    } catch (error) {
        console.error("Socket authentication failed:", error);
        next(new Error("Sign-in could not be verified."));
    }
});

const games = new Map();
const socketToRoom = new Map();
let waitingSocketId = null;

function isUserInGame(uid) {
    return [...games.values()].some((room) =>
        room.userIds.w === uid || room.userIds.b === uid
    );
}

function isUserWaiting(uid) {
    return io.sockets.sockets.get(waitingSocketId)?.data.uid === uid;
}

function startGame(whiteSocket, blackSocket) {
    if (
        !whiteSocket?.data.username ||
        !blackSocket?.data.username ||
        !whiteSocket.connected ||
        !blackSocket.connected ||
        whiteSocket.id === blackSocket.id ||
        isUserInGame(whiteSocket.data.uid) ||
        isUserInGame(blackSocket.data.uid) ||
        socketToRoom.has(whiteSocket.id) ||
        socketToRoom.has(blackSocket.id) ||
        isUserWaiting(whiteSocket.data.uid) ||
        isUserWaiting(blackSocket.data.uid)
    ) {
        return false;
    }

    const roomId = `game-${randomUUID()}`;
    const game = new Chess();
    const room = {
        game,
        players: {w: whiteSocket.id, b: blackSocket.id},
        userIds: {w: whiteSocket.data.uid, b: blackSocket.data.uid}
    };

    games.set(roomId, room);
    socketToRoom.set(whiteSocket.id, roomId);
    socketToRoom.set(blackSocket.id, roomId);
    whiteSocket.join(roomId);
    blackSocket.join(roomId);

    io.to(whiteSocket.id).emit("game-started", {
        color: "w",
        fen: game.fen()
    });
    io.to(blackSocket.id).emit("game-started", {
        color: "b",
        fen: game.fen()
    });

    return true;
}

function finishGame(roomId, room) {
    games.delete(roomId);

    for (const playerId of Object.values(room.players)) {
        socketToRoom.delete(playerId);
        io.sockets.sockets.get(playerId)?.leave(roomId);
    }
}

function getCount(profile, field) {
    const value = profile[field];
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

async function recordGameResult(roomId, room) {
    const whiteRef = firestore.collection("users").doc(room.userIds.w);
    const blackRef = firestore.collection("users").doc(room.userIds.b);
    const matchRef = firestore.collection("games").doc(roomId);
    const whiteScore = room.game.isDraw()
        ? 0.5
        : room.game.turn() === "b"
            ? 1
            : 0;

    return firestore.runTransaction(async (transaction) => {
        const [matchSnapshot, whiteSnapshot, blackSnapshot] = await Promise.all([
            transaction.get(matchRef),
            transaction.get(whiteRef),
            transaction.get(blackRef)
        ]);

        if (matchSnapshot.exists) {
            return {alreadyRecorded: true};
        }
        if (!whiteSnapshot.exists || !blackSnapshot.exists) {
            throw new Error("Cannot record result: a player profile is missing.");
        }

        const white = whiteSnapshot.data();
        const black = blackSnapshot.data();
        const whiteOldRating = Number.isFinite(white.rating) ? white.rating : 1200;
        const blackOldRating = Number.isFinite(black.rating) ? black.rating : 1200;
        const ratings = calculateEloRatings(
            whiteOldRating,
            blackOldRating,
            whiteScore
        );
        const isDraw = whiteScore === 0.5;
        const whiteWon = whiteScore === 1;
        const blackWon = whiteScore === 0;

        transaction.create(matchRef, {
            whiteId: room.userIds.w,
            blackId: room.userIds.b,
            whiteUsername: white.username,
            blackUsername: black.username,
            result: isDraw ? "draw" : whiteWon ? "white" : "black",
            pgn: room.game.pgn(),
            finishedAt: FieldValue.serverTimestamp()
        });
        transaction.set(whiteRef, {
            rating: ratings.white,
            gamesPlayed: getCount(white, "gamesPlayed") + 1,
            wins: getCount(white, "wins") + (whiteWon ? 1 : 0),
            draws: getCount(white, "draws") + (isDraw ? 1 : 0),
            losses: getCount(white, "losses") + (blackWon ? 1 : 0)
        }, {merge: true});
        transaction.set(blackRef, {
            rating: ratings.black,
            gamesPlayed: getCount(black, "gamesPlayed") + 1,
            wins: getCount(black, "wins") + (blackWon ? 1 : 0),
            draws: getCount(black, "draws") + (isDraw ? 1 : 0),
            losses: getCount(black, "losses") + (whiteWon ? 1 : 0)
        }, {merge: true});

        return {
            alreadyRecorded: false,
            white: {
                username: white.username,
                oldRating: whiteOldRating,
                rating: ratings.white
            },
            black: {
                username: black.username,
                oldRating: blackOldRating,
                rating: ratings.black
            }
        };
    });
}

io.on("connection", (socket) => {
    socket.join(`user:${socket.data.uid}`);

    socket.on("find-match", () => {
        if (!socket.data.username) {
            socket.emit("match-error", {
                message: "Create a username before finding a match."
            });
            return;
        }
        if (isUserInGame(socket.data.uid)) {
            socket.emit("match-error", {
                message: "You are already in a game."
            });
            return;
        }
        if (socketToRoom.has(socket.id)) return;
        if (waitingSocketId === socket.id) return;
        if (isUserWaiting(socket.data.uid)) {
            socket.emit("match-error", {
                message: "You are already in the matchmaking queue."
            });
            return;
        }

        if (!waitingSocketId) {
            waitingSocketId = socket.id;
            socket.emit("waiting");
            return;
        }

        const whiteSocket = io.sockets.sockets.get(waitingSocketId);
        if (
            !whiteSocket ||
            !whiteSocket.data.username ||
            socketToRoom.has(whiteSocket.id) ||
            whiteSocket.data.uid === socket.data.uid
        ) {
            if (whiteSocket?.data.uid === socket.data.uid) {
                socket.emit("match-error", {
                    message: "You cannot be matched with yourself."
                });
                return;
            }

            waitingSocketId = null;
            waitingSocketId = socket.id;
            socket.emit("waiting");
            return;
        }

        waitingSocketId = null;
        if (!startGame(whiteSocket, socket)) {
            socket.emit("match-error", {
                message: "Could not start a match. Please try again."
            });
        }
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

        if (game.isGameOver() && !room.ratingsProcessed) {
            room.ratingsProcessed = true;
            void recordGameResult(roomId, room)
                .then((result) => {
                    if (result.alreadyRecorded) return;
                    io.to(`user:${room.userIds.w}`).emit("ratings-updated", result);
                    io.to(`user:${room.userIds.b}`).emit("ratings-updated", result);
                })
                .catch((error) => {
                    console.error("Could not record completed game:", error);
                    const event = {
                        message: "The game ended, but its rating could not be updated."
                    };
                    io.to(`user:${room.userIds.w}`).emit("ratings-error", event);
                    io.to(`user:${room.userIds.b}`).emit("ratings-error", event);
                });

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

    socket.on("ensure-profile", async (payload = {}, callback) => {
        const reply = typeof callback === "function" ? callback : () => {};

        try {
            const userRef = firestore.collection("users").doc(socket.data.uid);
            const existingUser = await userRef.get();

            if (existingUser.exists) {
                socket.data.username = existingUser.data().username;
                reply({username: socket.data.username});
                return;
            }

            const username = String(payload?.username ?? "")
                .trim()
                .toLowerCase();

            if (!/^[a-z0-9_]{3,20}$/.test(username)) {
                reply({
                    error: "Choose a username of 3-20 letters, numbers, or underscores."
                });
                return;
            }

            const usernameRef = firestore.collection("usernames").doc(username);

            await firestore.runTransaction(async (transaction) => {
                const reserved = await transaction.get(usernameRef);
                const user = await transaction.get(userRef);

                if (user.exists) {
                    throw new Error("PROFILE_ALREADY_EXISTS");
                }

                if (reserved.exists) {
                    throw new Error("USERNAME_TAKEN");
                }

                transaction.create(usernameRef, {uid: socket.data.uid});
                transaction.create(userRef, {
                    username,
                    rating: 1200,
                    createdAt: FieldValue.serverTimestamp(),
                    gamesPlayed: 0,
                    wins: 0,
                    losses: 0,
                    draws: 0
                });
            });

            socket.data.username = username;
            reply({username});
        } catch (error) {
            if (error instanceof Error && error.message === "USERNAME_TAKEN") {
                reply({error: "That username is already taken."});
                return;
            }

            if (error instanceof Error && error.message === "PROFILE_ALREADY_EXISTS") {
                try {
                    const user = await firestore
                        .collection("users")
                        .doc(socket.data.uid)
                        .get();

                    socket.data.username = user.data()?.username ?? null;
                    if (!socket.data.username) {
                        reply({error: "Your profile could not be loaded."});
                        return;
                    }

                    reply({username: socket.data.username});
                } catch (profileError) {
                    console.error("Could not reload user profile:", profileError);
                    reply({error: "Could not load your profile."});
                }
                return;
            }

            console.error("Could not create user profile:", error);
            reply({error: "Could not save your username."});
        }
    });

    socket.on("challenge-user", async (payload = {}, callback) => {
        const reply = typeof callback === "function" ? callback : () => {};
        const username = String(payload?.username ?? "")
            .trim()
            .toLowerCase();

        if (!socket.data.username) {
            reply({error: "Create a username before sending challenges."});
            return;
        }

        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
            reply({error: "Enter a valid username."});
            return;
        }

        try {
            const usernameDoc = await firestore
                .collection("usernames")
                .doc(username)
                .get();

            if (!usernameDoc.exists) {
                reply({error: "No user has that username."});
                return;
            }

            const opponentId = usernameDoc.data()?.uid;

            if (opponentId === socket.data.uid) {
                reply({error: "You cannot challenge yourself."});
                return;
            }

            const challengeRef = firestore.collection("challenges").doc();

            await challengeRef.set({
                challengerId: socket.data.uid,
                challengerUsername: socket.data.username,
                challengedId: opponentId,
                status: "pending",
                createdAt: FieldValue.serverTimestamp()
            });

            io.to(`user:${opponentId}`).emit("challenge-received", {
                id: challengeRef.id,
                username: socket.data.username
            });
            reply({ok: true, message: `Challenge sent to ${username}.`});
        } catch (error) {
            console.error("Could not send challenge:", error);
            reply({error: "Could not send the challenge."});
        }
    });

    socket.on("load-challenges", async () => {
        if (!socket.data.username) {
            socket.emit("challenge-error", {
                message: "Create a username before loading challenges."
            });
            return;
        }

        try {
            const snapshot = await firestore
                .collection("challenges")
                .where("challengedId", "==", socket.data.uid)
                .where("status", "==", "pending")
                .get();

            socket.emit("pending-challenges", snapshot.docs.map((doc) => ({
                id: doc.id,
                username: doc.data().challengerUsername
            })));
        } catch (error) {
            console.error("Could not load challenges:", error);
            socket.emit("challenge-error", {
                message: "Could not load your challenges."
            });
        }
    });

    socket.on("respond-to-challenge", async (payload = {}, callback) => {
        const reply = typeof callback === "function" ? callback : () => {};
        const id = payload?.id;
        const accept = payload?.accept;

        if (
            typeof id !== "string" ||
            !/^[A-Za-z0-9_-]{1,150}$/.test(id) ||
            typeof accept !== "boolean"
        ) {
            reply({error: "Invalid challenge response."});
            return;
        }

        if (!socket.data.username) {
            reply({error: "Create a username before responding to challenges."});
            return;
        }

        const challengeRef = firestore.collection("challenges").doc(id);
        let challengerId;
        let startedRoomId = null;

        try {
            const challengeUpdate = await firestore.runTransaction(async (transaction) => {
                const challengeSnapshot = await transaction.get(challengeRef);
                if (!challengeSnapshot.exists) {
                    return {error: "Challenge not found."};
                }

                const challenge = challengeSnapshot.data();
                if (
                    challenge.challengedId !== socket.data.uid ||
                    challenge.status !== "pending"
                ) {
                    return {error: "Challenge is no longer available."};
                }

                if (!accept) {
                    transaction.update(challengeRef, {
                        status: "declined",
                        answeredAt: FieldValue.serverTimestamp()
                    });
                    return {challengerId: challenge.challengerId};
                }

                transaction.update(challengeRef, {
                    status: "accepting",
                    answeredAt: FieldValue.serverTimestamp()
                });
                return {challengerId: challenge.challengerId};
            });

            if (challengeUpdate.error) {
                reply({error: challengeUpdate.error});
                return;
            }

            challengerId = challengeUpdate.challengerId;

            if (!accept) {
                io.to(`user:${challengerId}`).emit("challenge-declined", {
                    username: socket.data.username
                });
                reply({ok: true});
                return;
            }

            if (waitingSocketId === socket.id) {
                await challengeRef.update({status: "pending"});
                reply({error: "Leave the matchmaking queue before accepting."});
                return;
            }

            const challengerRoom = await io
                .in(`user:${challengerId}`)
                .fetchSockets();
            const challengerSocket = challengerRoom
                .map((remoteSocket) => io.sockets.sockets.get(remoteSocket.id))
                .find((candidate) =>
                    candidate &&
                    !socketToRoom.has(candidate.id) &&
                    waitingSocketId !== candidate.id
                );

            if (!challengerSocket) {
                await challengeRef.update({status: "pending"});
                reply({error: "The challenger is offline or busy."});
                return;
            }

            if (!startGame(challengerSocket, socket)) {
                await challengeRef.update({status: "pending"});
                reply({error: "A player is already in a game or matchmaking queue."});
                return;
            }

            startedRoomId = socketToRoom.get(socket.id);
            await challengeRef.update({status: "accepted"});
            io.to(`user:${challengerId}`).emit("challenge-accepted", {
                username: socket.data.username
            });
            reply({ok: true});
        } catch (error) {
            console.error("Could not respond to challenge:", error);
            if (startedRoomId) {
                const startedRoom = games.get(startedRoomId);
                if (startedRoom) {
                    for (const playerId of Object.values(startedRoom.players)) {
                        io.to(playerId).emit("game-cancelled", {
                            message: "The challenge could not be finalized. Please try again."
                        });
                    }
                    finishGame(startedRoomId, startedRoom);
                }
            }
            try {
                const snapshot = await challengeRef.get();
                if (
                    snapshot.exists &&
                    ["accepting", "accepted"].includes(snapshot.data()?.status)
                ) {
                    await challengeRef.update({status: "pending"});
                }
            } catch (recoveryError) {
                console.error("Could not restore challenge state:", recoveryError);
            }
            reply({error: "Could not respond to the challenge."});
        }
    });

    socket.on("get-profile", async (payload = {}, callback) => {
        const reply = typeof callback === "function" ? callback : () => {};
        const username = String(payload?.username ?? "").trim().toLowerCase();

        if (!/^[a-z0-9_]{3,20}$/.test(username)) {
            reply({error: "Enter a valid username."});
            return;
        }

        try {
            const usernameDoc = await firestore
                .collection("usernames")
                .doc(username)
                .get();

            if (!usernameDoc.exists) {
                reply({error: "Player not found."});
                return;
            }

            const uid = usernameDoc.data()?.uid;
            if (typeof uid !== "string") {
                reply({error: "Player profile not found."});
                return;
            }
            const userDoc = await firestore.collection("users").doc(uid).get();

            if (!userDoc.exists) {
                reply({error: "Player profile not found."});
                return;
            }

            const profile = userDoc.data();

            reply({
                username: profile.username,
                rating: Number.isFinite(profile.rating) ? profile.rating : 1200,
                gamesPlayed: profile.gamesPlayed ?? 0,
                wins: profile.wins ?? 0,
                draws: profile.draws ?? 0,
                losses: profile.losses ?? 0
            });
        } catch (error) {
            console.error("Could not load player profile:", error);
            reply({error: "Could not load that profile."});
        }
    });
});

const port = Number(process.env.PORT) || 3000;

httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Chess server running on port ${port}`)
})