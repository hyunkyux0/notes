After this image-attachments PR is merged, implement the first review-scheduler
checkpoint from section 4: a small, independently tested scheduling core that
calculates reviews after 3, 7, and 30 calendar days using configurable intervals,
local alert time, and an explicit timezone. Specify and test daylight-saving gap
and overlap behavior, date boundaries, and invalid settings. Keep scheduling
separate from editor rendering; do not reset schedules on ordinary edits. Defer
calendar API calls, desktop notifications, and the persistence/UI integration to
subsequent focused checkpoints. Review structure and naming, consolidate actual
duplication, self-review, validate, and open a focused PR with Summary, How to
review, and How to test. Send the Telegram ping and stop for human review.
