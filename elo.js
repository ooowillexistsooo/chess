export function calculateEloRatings(whiteRating, blackRating, whiteScore) {
    if (
        !Number.isFinite(whiteRating) ||
        !Number.isFinite(blackRating) ||
        ![0, 0.5, 1].includes(whiteScore)
    ) {
        throw new TypeError("Ratings must be finite and score must be 0, 0.5, or 1.");
    }

    const expectedWhite =
        1 / (1 + 10 ** ((blackRating - whiteRating) / 400));
    const expectedBlack = 1 - expectedWhite;

    return {
        white: Math.round(whiteRating + 32 * (whiteScore - expectedWhite)),
        black: Math.round(blackRating + 32 * ((1 - whiteScore) - expectedBlack))
    };
}
