# Evidence retention

Raw validation runs are local or short-retention CI artifacts. They are not
committed to the source repository because they are large, difficult to review,
and may contain workstation or runner metadata.

Only compact top-level JSON or Markdown summaries may be retained here. A
retained summary must be synthetic-data-only, contain no credentials or absolute
host paths, and state the tested source revision. Full logs, SBOMs, screenshots,
guest reports, source copies, and per-run directories are uploaded by CI with a
bounded retention period.
