/** Optional overall scores use the same 1–5 scale as the review UI. */
export function assertReviewRating(rating: number | null | undefined): void {
  if (rating != null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
    throw new Error("Review rating must be a finite score from 1 to 5");
  }
}
