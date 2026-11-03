import {Chess} from "https://cdn.jsdelivr.net/npm/chess.js@1.4.0/+esm";
import {analyzePgn} from "./stockfish-engine.js";
import {auth} from "./firebase-client.js";
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";

const game = new Chess()

const pieceSymbols = {
    w: {p: '♙', r: '♖', n: '♘', b: '♗', q: '♕', k: '♔'},
    b: {p: '♟', r: '♜', n: '♞', b: '♝', q: '♛', k: '♚'}
}

const socket = window.io({autoConnect: false});
const matchButton = document.getElementById("find-match");
const matchStatus = document.getElementById("match-status");
const analysisOutput = document.getElementById("analysis-output");
const accountStatus = document.getElementById("account-status");
const challengeStatus = document.getElementById("challenge-status");
const incomingChallenges = document.getElementById("incoming-challenges");
const myProfile = document.getElementById("my-profile");
const profileResult = document.getElementById("profile-result");
let myColor = null;
let currentUser = null;
let profileReady = false;
let profileUsername = null;

const boardElement = document.getElementById("chessboard");
const turnIndicatior = document.getElementById("turn-indicator");

matchButton.disabled = true;

document.getElementById("sign-up").addEventListener("click", async () => {
    try {
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        await createUserWithEmailAndPassword(auth, email, password);
        accountStatus.textContent = "Account created. Saving your username...";
    } catch (error) {
        accountStatus.textContent = error.message;
    }
});

document.getElementById("sign-in").addEventListener("click", async () => {
    try {
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        accountStatus.textContent = error.message;
    }
});

document.getElementById("sign-out").addEventListener("click", async () => {
    try {
        await signOut(auth);
    } catch (error) {
        accountStatus.textContent = error.message;
    }
});

document.getElementById("save-username").addEventListener("click", () => {
    if (!currentUser) {
        accountStatus.textContent = "Sign in before saving a username.";
        return;
    }
    if (!socket.connected) {
        accountStatus.textContent = "Wait for the server connection, then try again.";
        return;
    }

    initializeSocketProfile();
});

onAuthStateChanged(auth, (user) => {
    const previousUser = currentUser;
    currentUser = user;
    profileReady = false;
    matchButton.disabled = true;

    if (previousUser && user && previousUser.uid !== user.uid) {
        socket.disconnect();
    }

    if (!user) {
        socket.disconnect();
        myColor = null;
        profileUsername = null;
        createBoard();
        incomingChallenges.replaceChildren();
        myProfile.textContent = "Sign in to see your profile.";
        profileResult.textContent = "";
        accountStatus.textContent = "Signed out.";
        matchStatus.textContent = "Sign in to play.";
        challengeStatus.textContent = "";
        return;
    }

    accountStatus.textContent = "Connecting...";
    socket.auth = (callback) => {
        user.getIdToken()
            .then((token) => callback({token}))
            .catch((error) => {
                accountStatus.textContent = `Could not get sign-in token: ${error.message}`;
                callback({});
            });
    };

    if (!socket.connected) {
        socket.connect();
        return;
    }

    initializeSocketProfile();
});

function initializeSocketProfile() {
    if (!currentUser || !socket.connected) return;

    socket.emit(
        "ensure-profile",
        {username: document.getElementById("username").value},
        (result) => {
            if (!result || result.error) {
                accountStatus.textContent =
                    result?.error || "Could not load your profile.";
                return;
            }

            profileReady = true;
            profileUsername = result.username;
            accountStatus.textContent = `Signed in as ${result.username}.`;
            matchButton.disabled = false;
            loadProfile(result.username, myProfile);
            socket.emit("load-challenges");
        }
    );
}

socket.on("connect", initializeSocketProfile);

function renderProfile(element, profile) {
    const heading = document.createElement("strong");
    heading.textContent = profile.username;

    const rating = document.createElement("p");
    rating.textContent = `Rating: ${profile.rating} Elo`;

    const games = document.createElement("p");
    games.textContent =
        `${profile.gamesPlayed} games · ${profile.wins} wins · ` +
        `${profile.draws} draws · ${profile.losses} losses`;

    element.replaceChildren(heading, rating, games);
}

function loadProfile(username, element) {
    if (!profileReady || !socket.connected) {
        element.textContent = "Sign in to view profiles.";
        return;
    }

    element.textContent = "Loading profile...";
    socket.emit("get-profile", {username}, (result) => {
        if (!result || result.error) {
            element.textContent =
                result?.error || "Could not load this profile.";
            return;
        }

        renderProfile(element, result);
    });
}

document.getElementById("view-profile").addEventListener("click", () => {
    loadProfile(
        document.getElementById("profile-username").value,
        profileResult
    );
});

socket.on("ratings-updated", (result) => {
    const updatedPlayer = [result.white, result.black]
        .find((player) => player.username === profileUsername);

    if (profileUsername) {
        loadProfile(profileUsername, myProfile);
    }

    if (updatedPlayer) {
        const change = updatedPlayer.rating - updatedPlayer.oldRating;
        const formattedChange = change > 0 ? `+${change}` : String(change);
        matchStatus.textContent =
            `Game over. Your rating is ${updatedPlayer.rating} (${formattedChange}).`;
    }
});

socket.on("ratings-error", ({message}) => {
    matchStatus.textContent = message;
});

matchButton.addEventListener("click", () => {
    if (!profileReady) return;
    matchButton.disabled = true;
    matchStatus.textContent = "Finding an opponent...";
    socket.emit("find-match");
});

socket.on("waiting", () => {
    matchStatus.textContent = "Waiting for an opponent...";
});

socket.on("match-error", ({message}) => {
    matchStatus.textContent = message;
    matchButton.disabled = !profileReady;
});

socket.on("game-started", ({color, fen}) => {
    matchButton.disabled = true;
    myColor = color;
    game.load(fen);
    analysisOutput.textContent = "";
    createBoard();
    turnIndicatior.textContent = game.turn() === "w" ? "White" : "Black";

    matchStatus.textContent =
        color === "w" ? "You are White." : "You are Black.";
});

document.getElementById("send-challenge").addEventListener("click", () => {
    if (!profileReady) {
        challengeStatus.textContent = "Sign in before sending a challenge.";
        return;
    }

    const username = document.getElementById("challenge-username").value;
    socket.emit("challenge-user", {username}, (result) => {
        challengeStatus.textContent =
            result?.error || result?.message || "Could not send challenge.";
    });
});

function showChallenge({id, username}) {
    if (!id || document.getElementById(`challenge-${id}`)) return;

    const row = document.createElement("div");
    row.id = `challenge-${id}`;
    const label = document.createElement("span");
    label.textContent = `Challenge from ${username} `;
    row.append(label);

    for (const [accept, text] of [[true, "Accept"], [false, "Decline"]]) {
        const button = document.createElement("button");
        button.textContent = text;
        button.addEventListener("click", () => {
            button.disabled = true;
            socket.emit("respond-to-challenge", {id, accept}, (result) => {
                if (result?.error) {
                    challengeStatus.textContent = result.error;
                    button.disabled = false;
                    return;
                }

                row.remove();
                challengeStatus.textContent = accept
                    ? "Challenge accepted."
                    : "Challenge declined.";
            });
        });
        row.append(button);
    }

    incomingChallenges.append(row);
}

socket.on("challenge-received", showChallenge);
socket.on("pending-challenges", (challenges) => {
    incomingChallenges.replaceChildren();
    challenges.forEach(showChallenge);
});
socket.on("challenge-error", ({message}) => {
    challengeStatus.textContent = message;
});
socket.on("challenge-declined", ({username}) => {
    challengeStatus.textContent = `${username} declined your challenge.`;
});
socket.on("challenge-accepted", ({username}) => {
    challengeStatus.textContent = `${username} accepted your challenge.`;
});

socket.on("game-cancelled", ({message}) => {
    myColor = null;
    createBoard();
    matchButton.disabled = !profileReady;
    matchStatus.textContent = message;
});

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
            matchButton.disabled = !profileReady;
        }
    }
});

socket.on("move-rejected", ({message}) => {
    matchStatus.textContent = message;
});

socket.on("opponent-left", () => {
    myColor = null;
    createBoard();
    matchButton.disabled = !profileReady;
    matchStatus.textContent = "Your opponent disconnected.";
});

socket.on("disconnect", () => {
    profileReady = false;
    matchButton.disabled = true;
    if (currentUser) {
        matchStatus.textContent = "Disconnected. Reconnecting...";
    }
});

socket.on("connect_error", (error) => {
    profileReady = false;
    matchButton.disabled = true;
    matchStatus.textContent = `Could not connect to the game server: ${error.message}`;
});

createBoard()